import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase, Profile } from './supabase'
import { Btn, HomeBtn } from './ui'
import { confirmDialog, toast } from './feedback'
import { uid } from './lib'

// Stock flow: drinks are received into the STORE; the manager or accountant issues part of it to the COUNTER,
// which is what the waiters sell from. When the counter runs low they come here and issue more.
// This screen shows both quantities side by side, takes the quantities to issue, and keeps a history.

type Row = { product_id: string; name: string; category: string | null; base_unit: string; store_qty: number; counter_qty: number; reorder_level: number | null }
type Issue = { at: string; product: string; qty: number; base_unit: string; issued_by: string | null; note: string | null }
const input = 'h-12 rounded-lg border border-slate-500 bg-slate-900 px-3 text-lg'
const n = (x: number) => Number(x).toLocaleString('en-KE', { maximumFractionDigits: 3 })

export default function IssueToCounter({ onDone }: { profile: Profile; onDone: () => void }) {
  const [tab, setTab] = useState<'issue' | 'history'>('issue')
  const [rows, setRows] = useState<Row[]>([])
  const [history, setHistory] = useState<Issue[]>([])
  const [qty, setQty] = useState<Record<string, string>>({})
  const [q, setQ] = useState('')
  const [cat, setCat] = useState('')
  const [all, setAll] = useState(true)
  const [note, setNote] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [problems, setProblems] = useState<{ name: string; problem: string }[]>([])
  const key = useRef(uid())

  const load = useCallback(async () => {
    const [o, h] = await Promise.all([supabase.rpc('stock_overview'), supabase.rpc('issue_history', { p_days: 14 })])
    if (o.error) setErr(o.error.message); else setRows((o.data ?? []) as Row[])
    if (!h.error) setHistory((h.data ?? []) as Issue[])
    setLoading(false)
  }, [])
  useEffect(() => { load() }, [load])

  const cats = useMemo(() => [...new Set(rows.map(r => r.category).filter((c): c is string => !!c))].sort(), [rows])
  const shown = useMemo(() => rows.filter(r =>
    (all || Number(r.store_qty) > 0 || Number(qty[r.product_id]) > 0)
    && (!cat || r.category === cat)
    && (!q.trim() || r.name.toLowerCase().includes(q.trim().toLowerCase()))), [rows, all, cat, q, qty])

  const lines = rows.filter(r => Number(qty[r.product_id]) > 0)
  const units = lines.reduce((s, r) => s + Number(qty[r.product_id]), 0)
  const over = lines.filter(r => Number(qty[r.product_id]) > Number(r.store_qty))

  const submit = async () => {
    if (busy || lines.length === 0 || over.length > 0) return
    const ok = await confirmDialog({
      title: 'Issue to the counter?',
      message: `${lines.length} drink${lines.length === 1 ? '' : 's'}, ${n(units)} units will move from the store to the counter, where the waiters can sell them.`,
      confirmText: 'Issue to counter',
    })
    if (!ok) return
    setBusy(true); setErr(''); setProblems([])
    const { data, error } = await supabase.rpc('issue_to_counter', {
      p_lines: lines.map(r => ({ product_id: r.product_id, qty: Number(qty[r.product_id]) })), p_note: note || null, p_key: key.current })
    setBusy(false)
    if (error) { setErr(error.message); return }
    const res = data as { ok: boolean; errors?: { name: string; problem: string }[]; units?: number; lines?: number }
    if (!res.ok) { setProblems(res.errors ?? []); return }
    toast(`Issued ${n(res.units ?? units)} units (${res.lines ?? lines.length} drinks) to the counter.`)
    setQty({}); setNote(''); key.current = uid(); load()
  }

  return (
    <div className="mx-auto max-w-5xl p-3 pb-32 md:p-4">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <h2 className="mr-auto text-3xl font-bold">Issue to counter</h2>
        <HomeBtn onClick={onDone} className="!h-12" />
      </div>
      <p className="mb-3 text-slate-300">Drinks are received into the <b>store</b>. Issue part of the stock to the <b>counter</b>; that is what waiters can see and sell. Issue more when the counter runs low.</p>
      <div className="mb-3 flex gap-2">
        {([['issue', 'Issue'], ['history', 'History']] as const).map(([t, l]) => (
          <button key={t} onClick={() => setTab(t)} className={`h-12 rounded-xl px-6 text-lg font-semibold ${tab === t ? 'bg-amber-500 text-on-accent' : 'bg-slate-700'}`}>{l}</button>))}
      </div>
      {err && <div className="mb-3 rounded-lg bg-red-700 p-3 text-lg font-semibold">{err}</div>}
      {problems.length > 0 && (
        <section className="mb-3 rounded-xl border-2 border-red-500 bg-slate-800 p-3">
          <h3 className="mb-1 text-xl font-bold text-red-300">Nothing was issued. Fix these:</h3>
          <ul className="list-disc pl-6 text-lg">{problems.map((p, i) => <li key={i}>{p.name} {p.problem}.</li>)}</ul>
        </section>)}

      {loading ? <div className="text-slate-400">Loading…</div> : tab === 'history' ? (
        <div className="space-y-2">
          {history.length === 0 && <div className="text-xl text-slate-400">Nothing has been issued in the last 14 days.</div>}
          {history.map((h, i) => (
            <div key={i} className="flex flex-wrap items-center gap-3 rounded-xl bg-slate-800 p-3 text-lg">
              <span className="min-w-0 flex-1 font-semibold">{h.product}</span>
              <b className="tabular-nums">{n(h.qty)} {h.base_unit}</b>
              <span className="text-slate-400">{new Date(h.at).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
              <span className="text-slate-300">{h.issued_by ?? ''}{h.note ? ` · ${h.note}` : ''}</span>
            </div>))}
        </div>
      ) : (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-3">
            <input className={input + ' w-full md:w-72'} placeholder="Search drinks" value={q} onChange={e => setQ(e.target.value)} />
            <select className={input + ' w-full md:w-52'} value={cat} onChange={e => setCat(e.target.value)}>
              <option value="">All categories</option>{cats.map(c => <option key={c} value={c}>{c}</option>)}</select>
            <label className="flex items-center gap-2 text-lg"><input type="checkbox" className="h-6 w-6" checked={all} onChange={e => setAll(e.target.checked)} /> Show drinks with 0 in the store</label>
          </div>
          <div className="hidden grid-cols-[1fr_90px_90px_120px] gap-3 px-3 text-sm text-slate-400 md:grid"><span>Drink</span><span className="text-right">Store</span><span className="text-right">Counter</span><span>Issue</span></div>
          <div className="space-y-2">
            {shown.length === 0 && <div className="text-xl text-slate-400">{rows.some(r => Number(r.store_qty) > 0) ? 'No drinks match.' : 'There is nothing in the store yet. Stock arrives through Purchasing.'}</div>}
            {shown.map(r => {
              const v = qty[r.product_id] ?? ''
              const tooMuch = Number(v) > Number(r.store_qty)
              const low = r.reorder_level != null && Number(r.counter_qty) <= Number(r.reorder_level)
              return (
                <div key={r.product_id} className={`grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1 rounded-xl bg-slate-800 p-3 md:grid-cols-[1fr_90px_90px_120px] ${tooMuch ? 'ring-2 ring-red-500' : Number(v) > 0 ? 'ring-2 ring-amber-500' : ''}`}>
                  <div className="min-w-0 text-lg font-semibold">{r.name}
                    {low && <span className="ml-2 rounded bg-amber-500 px-2 text-sm font-bold text-on-accent">COUNTER LOW</span>}
                    {Number(r.counter_qty) < 0 && <span className="ml-2 rounded bg-red-700 px-2 text-sm font-bold">NEGATIVE</span>}
                  </div>
                  <div className="row-span-2 md:row-span-1 md:order-last"><input className={input + ' w-24 md:w-full'} type="number" inputMode="decimal" min="0" placeholder="0" value={v} onChange={e => setQty(s => ({ ...s, [r.product_id]: e.target.value }))} aria-label={`Issue ${r.name}`} /></div>
                  <div className="flex gap-4 text-slate-300 md:contents">
                    <span className="md:text-right md:text-lg md:tabular-nums"><span className="md:hidden">Store </span><b className="text-lg tabular-nums text-slate-100">{n(r.store_qty)}</b></span>
                    <span className="md:text-right md:text-lg md:tabular-nums"><span className="md:hidden">Counter </span><b className="text-lg tabular-nums text-slate-100">{n(r.counter_qty)}</b></span>
                  </div>
                  {tooMuch && <div className="col-span-2 text-sm font-semibold text-red-300">Only {n(r.store_qty)} in the store.</div>}
                </div>)
            })}
          </div>
          <div className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-600 bg-slate-900 p-3 md:left-60">
            <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-3">
              <input className={input + ' min-w-0 flex-1 md:max-w-xs'} placeholder="Note (optional)" value={note} onChange={e => setNote(e.target.value)} />
              <div className="text-lg"><b>{lines.length}</b> drink{lines.length === 1 ? '' : 's'} · <b>{n(units)}</b> units</div>
              <Btn onClick={submit} disabled={busy || lines.length === 0 || over.length > 0}>{busy ? 'Issuing…' : 'Issue to counter'}</Btn>
            </div>
          </div>
        </>)}
    </div>
  )
}
