import { useMemo, useRef, useState } from 'react'
import { supabase } from './supabase'
import { Btn } from './ui'
import { confirmDialog } from './feedback'
import { kes, uid } from './lib'
import { readDeliverySheet, DeliveryRow } from './deliverySheetReader'
import { suggest } from './deliveryMatch'
import { categoryName, guessCategory, isLiquorCategory, unitFor } from './stockSheetRules'

// Purchasing > Upload delivery. The accountant picks the supplier, types the delivery note number and uploads the
// Excel delivery sheet (item, qty, price paid, selling price). Each line is matched to a drink in the catalogue
// (the person can change any match, or add the drink as new). One press records the whole delivery with its cost.

type Supplier = { supplier_id: string; name: string }
type Product = { id: string; name: string; base_unit: string }
type Line = Omit<DeliveryRow, 'sell'> & { choice: string; newName: string; category: string; sell: string; level: 'sure' | 'check' | 'none'; why: string }
type Check = {
  ok: boolean; dry_run?: boolean; errors?: { row: number; name: string; problem: string }[]
  lines?: number; new_drinks?: number; units?: number; total?: number; repeats?: string[]
  receipt_no?: number; prices_changed?: number; already_recorded?: boolean
}

const input = 'h-12 rounded-lg border border-slate-500 bg-slate-900 px-3 text-lg'
const LOCS: [string, string][] = [['store', 'Store'], ['main_bar', 'Counter (bar)'], ['kitchen', 'Kitchen'], ['choma', 'Choma']]
const NEW = '__new__'
const num = (n: number | undefined) => Number(n ?? 0).toLocaleString('en-KE', { maximumFractionDigits: 3 })

export default function DeliveryUpload({ suppliers, products, categories, flash, reload }: {
  suppliers: Supplier[]; products: Product[]; categories: string[]
  flash: (m: string, b?: boolean) => void; reload: () => void
}) {
  const pick = useRef<HTMLInputElement>(null)
  const key = useRef(uid())
  const [supplier, setSupplier] = useState('')
  const [noteNo, setNoteNo] = useState('')
  const [note, setNote] = useState('')
  const [location, setLocation] = useState('store')
  const [counted, setCounted] = useState(false)       // the goods were physically counted and match the invoice
  const [fileName, setFileName] = useState('')
  const [lines, setLines] = useState<Line[]>([])
  const [problems, setProblems] = useState<string[]>([])
  const [errors, setErrors] = useState<{ row: number; name: string; problem: string }[]>([])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const reset = () => { setFileName(''); setLines([]); setProblems([]); setErrors([]); setErr(''); if (pick.current) pick.current.value = '' }

  const onFile = async (file: File | undefined) => {
    if (!file) return
    reset(); setBusy(true); setFileName(file.name)
    try {
      const read = await readDeliverySheet(await file.arrayBuffer())
      setProblems(read.problems)
      setLines(read.rows.map(r => {
        const m = suggest(r.name, products)
        return { ...r, choice: m.id ?? NEW, newName: r.name, category: m.id ? '' : guessCategory(r.name, categories), sell: r.sell == null ? '' : String(r.sell), level: m.level, why: m.why }
      }))
    } catch (e) { setErr((e as Error).message || 'This file could not be read.') }
    setBusy(false)
  }

  const set = (i: number, patch: Partial<Line>) => setLines(l => l.map((x, j) => j === i ? { ...x, ...patch } : x))
  const nameOf = (id: string) => products.find(p => p.id === id)?.name ?? ''

  const useCount = useMemo(() => {
    const m = new Map<string, number>()
    for (const l of lines) if (l.choice !== NEW) m.set(l.choice, (m.get(l.choice) ?? 0) + 1)
    return m
  }, [lines])
  const lineIssue = (l: Line) => {
    if (l.choice === NEW) {
      if (!l.newName.trim()) return 'Type a name'
      if (!l.category) return 'Choose a category'
      return ''
    }
    return (useCount.get(l.choice) ?? 0) > 1 ? 'Same drink as another line' : ''
  }
  const bad = lines.filter(l => lineIssue(l)).length
  const unsure = lines.filter(l => l.choice !== NEW && l.level === 'check').length
  const newCount = lines.filter(l => l.choice === NEW).length
  const units = lines.reduce((s, l) => s + l.qty, 0)
  const total = lines.reduce((s, l) => s + l.qty * l.cost, 0)
  const ready = !!supplier && !!noteNo.trim() && lines.length > 0 && bad === 0 && problems.length === 0 && counted

  const payload = () => lines.map(l => {
    const cat = l.choice === NEW ? categoryName(l.category) : ''
    const newName = l.newName.trim()
    return {
      row: l.row, product_id: l.choice === NEW ? null : l.choice, name: l.choice === NEW ? newName : nameOf(l.choice),
      category: cat, unit: unitFor(cat, newName), liquor: isLiquorCategory(cat),
      qty: l.qty, unit_cost: l.cost, selling_price: l.sell.trim() === '' ? null : Number(l.sell),
    }
  })
  const call = (dry: boolean) => supabase.rpc('receive_delivery_sheet', {
    p_supplier: supplier, p_note_no: noteNo, p_note: note || null, p_location: location, p_lines: payload(), p_key: key.current, p_dry_run: dry })

  const submit = async () => {
    if (busy || !ready) return
    if (lines.some(l => l.sell.trim() !== '' && !(Number(l.sell) >= 0))) { setErr('A selling price is not a valid number.'); return }
    setBusy(true); setErr(''); setErrors([])
    const first = await call(true)
    if (first.error) { setBusy(false); setErr(first.error.message); return }
    const check = first.data as Check
    if (!check.ok) { setBusy(false); setErrors(check.errors ?? []); return }
    const repeats = check.repeats ?? []
    const go = await confirmDialog({
      title: 'Record this delivery?',
      message: `${num(check.lines)} lines, ${num(check.units)} units, total cost ${kes(check.total ?? 0)}. ${num(check.new_drinks)} new drink(s) will be added.`
        + (repeats.length ? ` WARNING: the same quantity and cost was already received from this supplier in the last 30 days for: ${repeats.join(', ')}. If this is the same delivery again, press Cancel.` : ''),
      confirmText: 'Record delivery',
    })
    if (!go) { setBusy(false); return }
    const res = await call(false)
    setBusy(false)
    if (res.error) { setErr(res.error.message); return }
    const done = res.data as Check
    if (!done.ok) { setErrors(done.errors ?? []); return }
    flash(`Delivery #${done.receipt_no} recorded: ${num(done.units)} units, ${kes(done.total ?? 0)}. ${num(done.new_drinks)} new drink(s) added, ${num(done.prices_changed)} selling price(s) changed.`)
    reset(); setNoteNo(''); setNote(''); setSupplier(''); setCounted(false); key.current = uid(); reload()
  }

  return (
    <div className="space-y-4">
      <p className="text-slate-300">Upload the Excel delivery sheet (Item Name, Qty, Price paid, and the selling price if you have it). Stock goes into the store first; issue it to the counter afterwards (Stock, then Issue to counter). Every line is matched to a drink; check the matches, then record the delivery. A selling price on the sheet updates that drink's price.</p>
      <div className="flex flex-wrap gap-3">
        <select className={input + ' w-72'} value={supplier} onChange={e => setSupplier(e.target.value)}>
          <option value="">Supplier…</option>{suppliers.map(s => <option key={s.supplier_id} value={s.supplier_id}>{s.name}</option>)}</select>
        <input className={input + ' w-56'} placeholder="Delivery note no." value={noteNo} onChange={e => setNoteNo(e.target.value)} />
        <select className={input + ' w-40'} value={location} onChange={e => setLocation(e.target.value)} title="Where the stock goes">
          {LOCS.map(([c, n]) => <option key={c} value={c}>Goes to {n}</option>)}</select>
        <input className={input + ' w-80'} placeholder="Note (optional)" value={note} onChange={e => setNote(e.target.value)} />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <input ref={pick} type="file" className="hidden" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={e => onFile(e.target.files?.[0])} />
        <Btn kind="ghost" onClick={() => pick.current?.click()} disabled={busy}>{busy && !lines.length ? 'Reading…' : fileName ? 'Choose another file' : 'Choose delivery sheet'}</Btn>
        {fileName && <span className="break-all text-slate-400">{fileName}</span>}
      </div>

      {err && <div className="rounded-lg bg-red-700 p-3 text-lg font-semibold">{err}</div>}
      {(problems.length > 0 || errors.length > 0) && (
        <section className="rounded-xl border-2 border-red-500 bg-slate-800 p-4">
          <h3 className="mb-2 text-xl font-bold text-red-300">Fix these and try again. Nothing was saved.</h3>
          <ul className="max-h-60 list-disc space-y-1 overflow-y-auto pl-6 text-lg">
            {problems.map((p, i) => <li key={'p' + i}>{p}</li>)}
            {errors.map((p, i) => <li key={'e' + i}>{p.row ? `Row ${p.row}${p.name ? ` (${p.name})` : ''}: ` : ''}{p.problem}.</li>)}
          </ul>
        </section>)}

      {lines.length > 0 && (
        <div className="space-y-2">
          <div className="hidden grid-cols-[1.1fr_60px_90px_100px_1.3fr] gap-2 text-sm text-slate-400 md:grid">
            <span>On the sheet</span><span>Qty</span><span>Cost each</span><span>Sells at</span><span>Drink in the app</span></div>
          {lines.map((l, i) => {
            const issue = lineIssue(l)
            const tone = issue ? 'border-red-500' : l.choice === NEW ? 'border-sky-500' : l.level === 'check' ? 'border-amber-500' : 'border-transparent'
            return (
              <div key={l.row} className={`grid grid-cols-1 items-center gap-2 rounded-lg border-2 bg-slate-800 p-2 md:grid-cols-[1.1fr_60px_90px_100px_1.3fr] ${tone}`}>
                <div className="text-lg font-semibold">{l.name}</div>
                <div className="text-lg tabular-nums">{num(l.qty)}</div>
                <div className="text-lg tabular-nums">{kes(l.cost)}</div>
                <input className={input + ' !h-10 w-full'} type="number" min="0" placeholder="no price" value={l.sell} onChange={e => set(i, { sell: e.target.value })} />
                <div className="space-y-1">
                  <select className={input + ' !h-10 w-full'} value={l.choice} onChange={e => set(i, { choice: e.target.value })}>
                    <option value={NEW}>+ Add as a new drink</option>
                    {products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                  {l.choice === NEW && (
                    <div className="flex gap-2">
                      <input className={input + ' !h-10 min-w-0 flex-1'} value={l.newName} onChange={e => set(i, { newName: e.target.value })} />
                      <select className={input + ' !h-10 w-40'} value={l.category} onChange={e => set(i, { category: e.target.value })}>
                        <option value="">Category…</option>{categories.map(c => <option key={c} value={c}>{c}</option>)}</select>
                    </div>)}
                  {issue ? <div className="text-sm font-semibold text-red-300">{issue}</div>
                    : l.choice !== NEW && l.level === 'check' ? <div className="text-sm text-amber-300">Check this match ({l.why})</div> : null}
                </div>
              </div>)
          })}
          <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
            <div>
              <div className="text-3xl font-bold">Total {kes(total)}</div>
              <div className="text-slate-300">{lines.length} lines · {num(units)} units{newCount > 0 ? ` · ${newCount} new drink(s)` : ''}{unsure > 0 ? ` · ${unsure} match(es) to check` : ''}</div>
              {bad > 0 && <div className="font-semibold text-red-300">{bad} line(s) need fixing before you can record.</div>}
              {(!supplier || !noteNo.trim()) && <div className="text-amber-300">Choose the supplier and type the delivery note number.</div>}
              <label className="mt-2 flex items-start gap-2 text-lg"><input type="checkbox" className="mt-1 h-6 w-6 shrink-0" checked={counted} onChange={e => setCounted(e.target.checked)} />
                <span>I counted the drinks received and the quantities match the invoice.</span></label>
            </div>
            <Btn onClick={submit} disabled={busy || !ready}>{busy ? 'Saving…' : 'Record delivery'}</Btn>
          </div>
        </div>)}
    </div>
  )
}
