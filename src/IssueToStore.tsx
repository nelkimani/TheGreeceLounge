import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase, Profile, can } from './supabase'
import { Btn, HomeBtn } from './ui'
import { confirmDialog, toast } from './feedback'
import { uid } from './lib'
import EntryHistory, { Entry } from './EntryHistory'

// Stock flow: new drinks are put into the STORE here first. Then "Issue to counter" moves part of it to the counter,
// which is what the waiters sell from. Quantities only; use Purchasing when the prices paid must be recorded.

type Row = { product_id: string; name: string; category: string | null; base_unit: string; store_qty: number; counter_qty: number; reorder_level: number | null }
const input = 'h-12 rounded-lg border border-slate-500 bg-slate-900 px-3 text-lg'
const n = (x: number) => Number(x).toLocaleString('en-KE', { maximumFractionDigits: 3 })

export default function IssueToStore({ profile, onDone }: { profile: Profile; onDone: () => void }) {
  const [tab, setTab] = useState<'issue' | 'history'>('issue')
  const [rows, setRows] = useState<Row[]>([])
  const [history, setHistory] = useState<Entry[]>([])
  const [qty, setQty] = useState<Record<string, string>>({})
  const [q, setQ] = useState('')          // the search that is applied
  const [draft, setDraft] = useState('')   // what is typed in the box
  const [cat, setCat] = useState('')
  const [note, setNote] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [problems, setProblems] = useState<{ name: string; problem: string }[]>([])
  const key = useRef(uid())
  // a manager edits any entry; anyone else can correct their own entries for 24 hours
  const isManager = can(profile, 'close.approve')
  const canEdit = (e: Entry) => isManager || (e.by === profile.full_name && Date.now() - new Date(e.at).getTime() < 24 * 3600 * 1000)

  const load = useCallback(async () => {
    const [o, h] = await Promise.all([supabase.rpc('stock_overview'), supabase.rpc('store_receipt_history', { p_days: 14 })])
    if (o.error) setErr(o.error.message); else setRows((o.data ?? []) as Row[])
    if (!h.error) setHistory(((h.data ?? []) as (Omit<Entry, 'by'> & Record<string, unknown>)[]).map(x => ({ ...x, by: (x as Record<string, unknown>)['received_by'] as string | null })) as Entry[])
    setLoading(false)
  }, [])
  useEffect(() => { load() }, [load])

  const cats = useMemo(() => [...new Set(rows.map(r => r.category).filter((c): c is string => !!c))].sort(), [rows])
  const catCount = useMemo(() => { const m = new Map<string, number>(); rows.forEach(r => { const k = r.category ?? '__none'; m.set(k, (m.get(k) ?? 0) + 1) }); return m }, [rows])
  const shown = useMemo(() => rows.filter(r =>
    (!cat || (cat === '__none' ? !r.category : r.category === cat))
    && (!q.trim() || r.name.toLowerCase().includes(q.trim().toLowerCase()))), [rows, cat, q])

  const lines = rows.filter(r => Number(qty[r.product_id]) > 0)
  const units = lines.reduce((s, r) => s + Number(qty[r.product_id]), 0)

  const submit = async () => {
    if (busy || lines.length === 0) return
    const ok = await confirmDialog({
      title: 'Put into the store?',
      message: `${lines.length} drink${lines.length === 1 ? '' : 's'}, ${n(units)} units will be added to the store. They reach the counter, where waiters sell, only after you issue them there.`,
      confirmText: 'Put in store',
    })
    if (!ok) return
    setBusy(true); setErr(''); setProblems([])
    const { data, error } = await supabase.rpc('receive_to_store', {
      p_lines: lines.map(r => ({ product_id: r.product_id, qty: Number(qty[r.product_id]) })), p_note: note || null, p_key: key.current })
    setBusy(false)
    if (error) { setErr(error.message); return }
    const res = data as { ok: boolean; errors?: { name: string; problem: string }[]; units?: number; lines?: number }
    if (!res.ok) { setProblems(res.errors ?? []); return }
    toast(`Added ${n(res.units ?? units)} units (${res.lines ?? lines.length} drinks) to the store.`)
    setQty({}); setNote(''); key.current = uid(); load()
  }

  return (
    <div className="mx-auto max-w-5xl p-3 pb-32 md:p-4">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <h2 className="mr-auto text-3xl font-bold">Issue to store</h2>
        <HomeBtn onClick={onDone} className="!h-12" />
      </div>
      <p className="mb-3 text-slate-300">When drinks arrive, put them into the <b>store</b> here first. Then use <b>Issue to counter</b> to move what you need to the counter, which is what waiters sell from. This records quantities only; use Purchasing if you want the supplier and prices paid recorded.</p>
      <div className="mb-3 flex gap-2">
        {([['issue', 'Receive'], ['history', 'History']] as const).map(([t, l]) => (
          <button key={t} onClick={() => setTab(t)} className={`h-12 rounded-xl px-6 text-lg font-semibold ${tab === t ? 'bg-amber-500 text-on-accent' : 'bg-slate-700'}`}>{l}</button>))}
      </div>
      {err && <div className="mb-3 rounded-lg bg-red-700 p-3 text-lg font-semibold">{err}</div>}
      {problems.length > 0 && (
        <section className="mb-3 rounded-xl border-2 border-red-500 bg-slate-800 p-3">
          <h3 className="mb-1 text-xl font-bold text-red-300">Nothing was added. Fix these:</h3>
          <ul className="list-disc pl-6 text-lg">{problems.map((p, i) => <li key={i}>{p.name} {p.problem}.</li>)}</ul>
        </section>)}

      {loading ? <div className="text-slate-400">Loading…</div> : tab === 'history' ? (
        <EntryHistory rows={history} canEdit={canEdit} empty="Nothing has been put into the store in the last 14 days." onChanged={load} />
      ) : (
        <>
          {history.some(h => Date.now() - new Date(h.at).getTime() < 24 * 3600 * 1000 && canEdit(h)) && (
            <section className="mb-4 rounded-xl border border-slate-600 bg-slate-800/50 p-3">
              <h3 className="mb-2 text-xl font-bold">Entered in the last 24 hours <span className="text-base font-normal text-slate-400">· made a mistake? tap Edit</span></h3>
              <EntryHistory rows={history.filter(h => Date.now() - new Date(h.at).getTime() < 24 * 3600 * 1000)} canEdit={canEdit} empty="" onChanged={load} />
            </section>)}
          <form className="mb-2 flex gap-2" onSubmit={e => { e.preventDefault(); setQ(draft) }}>
            <input className={input + ' min-w-0 flex-1 md:max-w-md'} placeholder="Search drinks" value={draft}
                   onChange={e => { setDraft(e.target.value); setQ(e.target.value) }} aria-label="Search drinks" />
            <Btn onClick={() => setQ(draft)}>Search</Btn>
            {(draft || q) && <Btn kind="ghost" onClick={() => { setDraft(''); setQ('') }}>Clear</Btn>}
          </form>
          <div className="mb-3 flex flex-wrap gap-2">
            {[['', 'All', rows.length] as const, ...cats.map(c => [c, c, catCount.get(c) ?? 0] as const),
              ...(catCount.has('__none') ? [['__none', 'No category', catCount.get('__none') ?? 0] as const] : [])].map(([id, label, count]) => (
              <button key={id} type="button" onClick={() => setCat(id)}
                className={`h-11 rounded-full px-4 text-base font-semibold ${cat === id ? 'bg-amber-500 text-on-accent' : 'bg-slate-700'}`}>{label} <span className="opacity-70">{count}</span></button>))}
          </div>
          <div className="mb-2 text-sm text-slate-400">Showing {shown.length} of {rows.length} drinks{lines.length > 0 ? ` · ${lines.length} with a quantity entered (kept while you search)` : ''}</div>
          <div className="hidden grid-cols-[1fr_90px_90px_120px] gap-3 px-3 text-sm text-slate-400 md:grid"><span>Drink</span><span className="text-right">Store</span><span className="text-right">Counter</span><span>Receive</span></div>
          <div className="space-y-2">
            {shown.length === 0 && <div className="text-xl text-slate-400">No drinks match.</div>}
            {shown.map(r => {
              const v = qty[r.product_id] ?? ''
              const low = r.reorder_level != null && Number(r.counter_qty) <= Number(r.reorder_level)
              return (
                <div key={r.product_id} className={`grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1 rounded-xl bg-slate-800 p-3 md:grid-cols-[1fr_90px_90px_120px] ${Number(v) > 0 ? 'ring-2 ring-amber-500' : ''}`}>
                  <div className="min-w-0 text-lg font-semibold">{r.name}
                    {low && <span className="ml-2 rounded bg-amber-500 px-2 text-sm font-bold text-on-accent">COUNTER LOW</span>}
                    {Number(r.counter_qty) < 0 && <span className="ml-2 rounded bg-red-700 px-2 text-sm font-bold">NEGATIVE</span>}
                  </div>
                  <div className="row-span-2 md:row-span-1 md:order-last"><input className={input + ' w-24 md:w-full'} type="number" inputMode="decimal" min="0" placeholder="0" value={v} onChange={e => setQty(s => ({ ...s, [r.product_id]: e.target.value }))} aria-label={`Issue ${r.name}`} /></div>
                  <div className="flex gap-4 text-slate-300 md:contents">
                    <span className="md:text-right md:text-lg md:tabular-nums"><span className="md:hidden">Store </span><b className="text-lg tabular-nums text-slate-100">{n(r.store_qty)}</b></span>
                    <span className="md:text-right md:text-lg md:tabular-nums"><span className="md:hidden">Counter </span><b className="text-lg tabular-nums text-slate-100">{n(r.counter_qty)}</b></span>
                  </div>
                </div>)
            })}
          </div>
          <div className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-600 bg-slate-900 p-3 md:left-60">
            <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-3">
              <input className={input + ' min-w-0 flex-1 md:max-w-xs'} placeholder="Note (optional)" value={note} onChange={e => setNote(e.target.value)} />
              <div className="text-lg"><b>{lines.length}</b> drink{lines.length === 1 ? '' : 's'} · <b>{n(units)}</b> units</div>
              <Btn onClick={submit} disabled={busy || lines.length === 0}>{busy ? 'Saving…' : 'Put in store'}</Btn>
            </div>
          </div>
        </>)}
    </div>
  )
}
