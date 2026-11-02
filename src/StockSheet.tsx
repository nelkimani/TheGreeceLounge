import { useRef, useState } from 'react'
import { supabase, Profile } from './supabase'
import { Btn, HomeBtn } from './ui'
import { confirmDialog, toast } from './feedback'
import { readStockSheet, SheetRow } from './stockSheetReader'
import { categoryName, isLiquorCategory, unitFor } from './stockSheetRules'

// First stock take: download the blank Excel sheet, type the opening count of each drink, upload it here.
// The upload is checked first (dry run). Nothing is saved until the accountant presses Load.

type Check = {
  ok: boolean
  errors?: { row: number; name: string; problem: string }[]
  new_products?: number
  existing_products?: number
  opening_lines?: number
  opening_units?: number
  skipped_opening?: string[]
}

const TEMPLATE_URL = `${import.meta.env.BASE_URL}Glizz-Lounge-Stock-Sheet.xlsx`
const num = (n: number | undefined) => Number(n ?? 0).toLocaleString('en-KE', { maximumFractionDigits: 3 })

export default function StockSheet({ onDone }: { profile: Profile; onDone: () => void }) {
  const pick = useRef<HTMLInputElement>(null)
  const [fileName, setFileName] = useState('')
  const [rows, setRows] = useState<SheetRow[]>([])
  const [problems, setProblems] = useState<string[]>([])
  const [check, setCheck] = useState<Check | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [done, setDone] = useState<Check | null>(null)

  const payload = (r: SheetRow[]) => r.map(x => ({
    row: x.row, category: categoryName(x.category), name: x.name, unit: unitFor(x.category, x.name),
    liquor: isLiquorCategory(x.category), qty: x.qty, price: x.price,
  }))

  const reset = () => { setFileName(''); setRows([]); setProblems([]); setCheck(null); setErr(''); if (pick.current) pick.current.value = '' }

  const onFile = async (file: File | undefined) => {
    if (!file) return
    reset(); setDone(null); setBusy(true); setFileName(file.name)
    try {
      const read = await readStockSheet(await file.arrayBuffer())
      setRows(read.rows); setProblems(read.problems)
      if (read.problems.length === 0) {
        const { data, error } = await supabase.rpc('import_stock_sheet', { p_rows: payload(read.rows), p_dry_run: true })
        if (error) setErr(error.message); else setCheck(data as Check)
      }
    } catch (e) {
      setErr((e as Error).message || 'This file could not be read.')
    }
    setBusy(false)
  }

  const load = async () => {
    if (!check?.ok || busy) return
    const ok = await confirmDialog({
      title: 'Load the opening stock?',
      message: `${num(check.new_products)} new drink(s) will be added to the catalogue and opening stock will be recorded for ${num(check.opening_lines)} drink(s) (${num(check.opening_units)} units) in the Main Bar. Opening stock can only be loaded once per drink.`,
      confirmText: 'Load',
    })
    if (!ok) return
    setBusy(true); setErr('')
    const { data, error } = await supabase.rpc('import_stock_sheet', { p_rows: payload(rows), p_dry_run: false })
    setBusy(false)
    if (error) { setErr(error.message); toast('Nothing was saved', 'error'); return }
    const res = data as Check
    if (!res.ok) { setCheck(res); toast('Nothing was saved', 'error'); return }
    toast(`Loaded ${num(res.opening_lines)} drinks, ${num(res.opening_units)} units`)
    reset(); setDone(res)
  }

  const counted = rows.filter(r => r.qty != null && r.qty > 0)
  const serverErrors = check && !check.ok ? check.errors ?? [] : []
  const ready = !!check?.ok && problems.length === 0
  const nothing = ready && (check?.new_products ?? 0) === 0 && (check?.opening_lines ?? 0) === 0
  const card = 'rounded-xl bg-slate-800 p-4'
  const stat = (label: string, value: string) => (
    <div className="rounded-lg bg-slate-900 px-4 py-3"><div className="text-3xl font-bold tabular-nums">{value}</div><div className="text-sm text-slate-400">{label}</div></div>
  )

  return (
    <div className="mx-auto max-w-4xl p-4 pb-16">
      <div className="mb-3 flex items-center gap-3">
        <h2 className="mr-auto text-3xl font-bold">Stock sheet</h2>
        <HomeBtn onClick={onDone} className="!h-12" />
      </div>
      <p className="mb-4 text-slate-300">For the first stock take: download the sheet, count every drink on the counter and type the number in the
        <b> Opening stock</b> column, then upload it here. The same sheet is used afterwards to reconcile every day of the week (opening, issued, sold, 8am count).</p>

      {err && <div className="mb-3 rounded-lg bg-red-700 p-3 text-lg font-semibold">{err}</div>}

      <div className="grid gap-4 md:grid-cols-2">
        <section className={card}>
          <h3 className="mb-1 text-xl font-bold">1. Download the blank sheet</h3>
          <p className="mb-3 text-slate-300">All drinks by category, empty. Open it in Excel, fill the yellow cells and save.</p>
          <a href={TEMPLATE_URL} download="Glizz-Lounge-Stock-Sheet.xlsx"
             className="inline-flex h-btn items-center rounded-xl bg-amber-500 px-6 text-xl font-semibold text-on-accent active:bg-amber-400">Download Excel sheet</a>
        </section>

        <section className={card}>
          <h3 className="mb-1 text-xl font-bold">2. Upload the filled sheet</h3>
          <p className="mb-3 text-slate-300">It is checked first. Nothing is saved until you press Load.</p>
          <input ref={pick} type="file" className="hidden" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                 onChange={e => onFile(e.target.files?.[0])} />
          <Btn kind="ghost" onClick={() => pick.current?.click()} disabled={busy}>{busy ? 'Checking…' : fileName ? 'Choose another file' : 'Choose filled sheet'}</Btn>
          {fileName && <div className="mt-2 break-all text-sm text-slate-400">{fileName}</div>}
        </section>
      </div>

      {done && (
        <div className="mt-4 rounded-xl bg-green-700 p-4 text-lg">
          <div className="font-bold">Opening stock loaded.</div>
          <div>{num(done.new_products)} drink(s) added, {num(done.opening_lines)} drink(s) with opening stock ({num(done.opening_units)} units).
            Check the numbers in <b>Bar stock</b>. Drinks without a price stay hidden from waiters until you set one in <b>Products &amp; prices</b>.</div>
          {(done.skipped_opening?.length ?? 0) > 0 && <div className="mt-1">Skipped because they already had opening stock: {done.skipped_opening!.join(', ')}.</div>}
        </div>
      )}

      {(problems.length > 0 || serverErrors.length > 0) && (
        <section className="mt-4 rounded-xl border-2 border-red-500 bg-slate-800 p-4">
          <h3 className="mb-2 text-xl font-bold text-red-300">Fix these in Excel, save, and upload again. Nothing was saved.</h3>
          <ul className="max-h-72 list-disc space-y-1 overflow-y-auto pl-6 text-lg">
            {problems.map((p, i) => <li key={'p' + i}>{p}</li>)}
            {serverErrors.map((p, i) => <li key={'s' + i}>Row {p.row}{p.name ? ` (${p.name})` : ''}: {p.problem}.</li>)}
          </ul>
        </section>
      )}

      {ready && check && (
        <section className="mt-4 rounded-xl bg-slate-800 p-4">
          <h3 className="mb-3 text-xl font-bold">The sheet is ready to load</h3>
          <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
            {stat('drinks on the sheet', num(rows.length))}
            {stat('with a count', num(counted.length))}
            {stat('new drinks to add', num(check.new_products))}
            {stat('units of opening stock', num(check.opening_units))}
          </div>
          {(check.existing_products ?? 0) > 0 && <p className="mb-2 text-slate-300">{num(check.existing_products)} drink(s) are already in the catalogue and are left as they are.</p>}
          {(check.skipped_opening?.length ?? 0) > 0 && (
            <p className="mb-2 rounded-lg bg-amber-600 p-3 text-on-accent">These already have opening stock and will be skipped: {check.skipped_opening!.join(', ')}.</p>
          )}
          {nothing
            ? <p className="text-lg text-slate-300">There is nothing new to load from this file.</p>
            : <Btn onClick={load} disabled={busy}>{busy ? 'Loading…' : 'Load opening stock'}</Btn>}
        </section>
      )}
    </div>
  )
}
