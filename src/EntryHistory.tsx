import { useState } from 'react'
import { supabase } from './supabase'
import { Btn } from './ui'
import { toast } from './feedback'
import { uid } from './lib'

// History list shared by "Issue to store" and "Issue to counter". A manager can EDIT an entry (new quantity + reason).
// An edit never rewrites history: it adds a correction for the difference, and the row then shows "was <original>".
export type Entry = { id: string; at: string; product: string; qty: number; original_qty: number; base_unit: string; by: string | null; note: string | null; edited: boolean }
const n = (x: number) => Number(x).toLocaleString('en-KE', { maximumFractionDigits: 3 })
const input = 'h-12 rounded-lg border border-slate-500 bg-slate-900 px-3 text-lg'

// canEdit: true for a manager (any entry), or a function deciding per entry (the person who made it, same day).
export default function EntryHistory({ rows, canEdit, empty, onChanged }: { rows: Entry[]; canEdit: boolean | ((e: Entry) => boolean); empty: string; onChanged: () => void }) {
  const mayEdit = (e: Entry) => typeof canEdit === 'function' ? canEdit(e) : canEdit
  const [open, setOpen] = useState<string | null>(null)
  const [qty, setQty] = useState('')
  const [why, setWhy] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const key = useState(() => ({ k: uid() }))[0]

  const start = (e: Entry) => { setOpen(e.id); setQty(String(e.qty)); setWhy(''); setErr(''); key.k = uid() }
  const save = async (e: Entry) => {
    if (busy) return
    setBusy(true); setErr('')
    const { error } = await supabase.rpc('edit_stock_entry', { p_move: e.id, p_new_qty: Number(qty), p_reason: why, p_key: key.k })
    setBusy(false)
    if (error) { setErr(error.message); return }
    toast(`${e.product} changed to ${n(Number(qty))}.`)
    setOpen(null); onChanged()
  }

  if (rows.length === 0) return <div className="text-xl text-slate-400">{empty}</div>
  return (
    <div className="space-y-2">
      {rows.map(h => (
        <div key={h.id} className="rounded-xl bg-slate-800 p-3 text-lg">
          <div className="flex flex-wrap items-center gap-3">
            <span className="min-w-0 flex-1 font-semibold">{h.product}</span>
            <b className={`tabular-nums ${Number(h.qty) === 0 ? 'text-slate-500 line-through' : ''}`}>{n(h.qty)} {h.base_unit}</b>
            {h.edited && <span className="rounded bg-slate-600 px-2 text-sm font-semibold">{Number(h.qty) === 0 ? 'Cancelled' : 'Edited'} · was {n(h.original_qty)}</span>}
            <span className="text-slate-400">{new Date(h.at).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
            <span className="text-slate-300">{h.by ?? ''}{h.note ? ` · ${h.note}` : ''}</span>
            {mayEdit(h) && open !== h.id && <Btn kind="ghost" className="!h-11 !text-base" onClick={() => start(h)}>Edit</Btn>}
          </div>
          {open === h.id && (
            <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-700 pt-3">
              <label className="text-base text-slate-300">New quantity
                <input className={input + ' ml-2 w-28'} type="number" inputMode="decimal" min="0" value={qty} onChange={e => setQty(e.target.value)} /></label>
              <input className={input + ' min-w-0 flex-1 md:max-w-sm'} placeholder="Why? (required)" value={why} onChange={e => setWhy(e.target.value)} />
              <Btn onClick={() => save(h)} disabled={busy || qty === '' || Number(qty) < 0 || Number(qty) === Number(h.qty) || !why.trim()}>{busy ? 'Saving…' : 'Save'}</Btn>
              <Btn kind="ghost" onClick={() => setOpen(null)}>Cancel</Btn>
              <div className="basis-full text-sm text-slate-400">Enter 0 to cancel this entry. The stock moves by the difference only, and the old figure stays on record.</div>
              {err && <div className="basis-full rounded-lg bg-red-700 p-2 text-base font-semibold">{err}</div>}
            </div>)}
        </div>))}
    </div>
  )
}
