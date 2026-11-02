import { useCallback, useEffect, useState } from 'react'
import { supabase, Profile, can } from './supabase'
import { Btn, HomeBtn } from './ui'
import { kes } from './lib'
import { STATION_LABEL, Station } from './sale'

type Tab = 'slips' | 'close'
type Slip = {
  captain_order_id: string; slip_no: number; order_no: number; station: Station; created_at: string
  waiter_name: string; table_number: string | null; customer_name: string | null
  lines: { qty: number; name: string }[] | null; total: number; reprints: number
  seen_at: string | null; voided_at: string | null; void_reason: string | null; void_pending: boolean
}
type Summary = Record<string, number | string | null>
type Exc = { kind: string; detail: string; amount: number | null }

// Trading day rolls over at 05:00 Nairobi (UTC+3) = 02:00 UTC
const today = () => new Date(Date.now() - 2 * 3600_000).toISOString().slice(0, 10)
const input = 'h-12 rounded-lg border border-slate-500 bg-slate-900 px-3 text-lg'

export default function Recon({ profile, onDone }: { profile: Profile; onDone: () => void }) {
  const [tab, setTab] = useState<Tab>('slips')
  const [date, setDate] = useState(today())
  const [msg, setMsg] = useState('')
  const [bad, setBad] = useState(false)
  const flash = useCallback((m: string, isBad = false) => { setMsg(m); setBad(isBad) }, [])

  const tabBtn = (t: Tab, n: string) => (
    <button key={t} onClick={() => { setTab(t); setMsg('') }}
      className={`h-14 rounded-xl px-6 text-xl font-semibold ${tab === t ? 'bg-amber-500 text-on-accent' : 'bg-slate-700'}`}>{n}</button>
  )

  return (
    <div className="mx-auto max-w-6xl p-4">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h2 className="mr-4 text-3xl font-bold">Reconciliation</h2>
        {tabBtn('slips', 'Captain orders')}{tabBtn('close', 'Day close')}
        <input type="date" className={input + ' ml-auto'} value={date} onChange={e => setDate(e.target.value)} />
        <HomeBtn onClick={onDone} className="!h-12" />
      </div>
      {msg && <div className={`mb-3 rounded-lg p-3 text-lg font-semibold ${bad ? 'bg-red-700' : 'bg-green-700'}`}>{msg}</div>}
      {tab === 'slips' && <Slips date={date} profile={profile} flash={flash} />}
      {tab === 'close' && <Close date={date} profile={profile} flash={flash} />}
    </div>
  )
}

type P = { date: string; profile: Profile; flash: (m: string, bad?: boolean) => void }

// The accountant collects the captain orders from the bar, choma zone and restaurant, and ticks each one off here.
// A slip that is in the system but not in the pile is a missing slip: it shows up as an exception for the day close.
function Slips({ date, profile, flash }: P) {
  const [rows, setRows] = useState<Slip[]>([])
  const [filter, setFilter] = useState<'missing' | 'seen' | 'voided' | 'all'>('missing')
  const [station, setStation] = useState<'all' | Station>('all')
  const [sel, setSel] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const load = useCallback(async () => {
    const { data } = await supabase.from('sales_slips').select('*').eq('business_date', date).order('slip_no')
    setRows((data ?? []) as Slip[]); setSel(new Set())
  }, [date])
  useEffect(() => { load() }, [load])

  const live = rows.filter(r => !r.voided_at)
  const shown = rows.filter(r => (station === 'all' || r.station === station) && (
    filter === 'all' ? true : filter === 'voided' ? !!r.voided_at : filter === 'seen' ? !r.voided_at && !!r.seen_at : !r.voided_at && !r.seen_at))
  const allowed = can(profile, 'recon.view_all')
  const toggle = (id: string) => setSel(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  const mark = async (seen: boolean) => {
    if (busy || sel.size === 0) return
    setBusy(true)
    const { error } = await supabase.rpc('mark_slips_seen', { p_ids: Array.from(sel), p_seen: seen })
    setBusy(false)
    if (error) { flash(error.message, true); return }
    flash(seen ? `${sel.size} slip(s) ticked off.` : `${sel.size} slip(s) un-ticked.`); load()
  }
  const stat = (st: Station) => {
    const mine = live.filter(r => r.station === st)
    return `${STATION_LABEL[st]}: ${mine.filter(r => r.seen_at).length} of ${mine.length} seen · ${kes(mine.reduce((t, r) => t + Number(r.total), 0))}`
  }
  const chip = (f: typeof filter, n: string) => (
    <button key={f} onClick={() => setFilter(f)} className={`h-12 rounded-lg px-4 text-lg font-semibold ${filter === f ? 'bg-amber-500 text-on-accent' : 'bg-slate-700'}`}>{n}</button>)
  const schip = (s: typeof station, n: string) => (
    <button key={s} onClick={() => setStation(s)} className={`h-12 rounded-lg px-4 text-lg font-semibold ${station === s ? 'bg-amber-500 text-on-accent' : 'bg-slate-700'}`}>{n}</button>)

  return (
    <div>
      <div className="mb-3 grid gap-2 rounded-xl bg-slate-800 p-3 text-lg sm:grid-cols-3">
        {(['bar', 'choma', 'restaurant'] as Station[]).map(s => <div key={s}>{stat(s)}</div>)}
      </div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {chip('missing', `Not seen (${live.filter(r => !r.seen_at).length})`)}{chip('seen', 'Seen')}{chip('voided', `Voided (${rows.filter(r => r.voided_at).length})`)}{chip('all', 'All')}
        <span className="mx-2 text-slate-500">|</span>
        {schip('all', 'All stations')}{schip('bar', 'Bar')}{schip('choma', 'Choma zone')}{schip('restaurant', 'Restaurant')}
      </div>
      {allowed && (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <Btn kind="ghost" className="!h-12" onClick={() => setSel(new Set(shown.filter(r => !r.voided_at).map(r => r.captain_order_id)))}>Select all shown</Btn>
          <Btn className="!h-12" disabled={busy || sel.size === 0} onClick={() => mark(true)}>Tick off selected ({sel.size})</Btn>
          <Btn kind="ghost" className="!h-12" disabled={busy || sel.size === 0} onClick={() => mark(false)}>Un-tick</Btn>
        </div>
      )}
      <div className="space-y-2">
        {shown.length === 0 && <div className="text-xl text-slate-400">Nothing here.</div>}
        {shown.map(r => (
          <div key={r.captain_order_id} className={`flex flex-wrap items-center gap-3 rounded-xl p-3 ${r.voided_at ? 'bg-red-950' : r.seen_at ? 'bg-slate-800' : 'bg-slate-700'}`}>
            {allowed && !r.voided_at && (
              <input type="checkbox" className="h-7 w-7" checked={sel.has(r.captain_order_id)} onChange={() => toggle(r.captain_order_id)} aria-label={`Select slip ${r.slip_no}`} />)}
            <div className="w-20 text-xl font-bold">#{r.slip_no}</div>
            <div className="w-32 text-lg font-semibold">{STATION_LABEL[r.station]}</div>
            <div className="w-20 text-lg text-slate-300">{new Date(r.created_at).toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit' })}</div>
            <div className="w-40 text-lg">{r.waiter_name}</div>
            <div className="w-28 text-lg">{r.table_number ? `Table ${r.table_number}` : r.customer_name}</div>
            <div className="min-w-0 flex-1 text-base text-slate-300">{(r.lines ?? []).map(l => `${l.qty} × ${l.name}`).join(', ')}</div>
            <div className="w-28 text-right text-xl font-semibold">{kes(r.total)}</div>
            {r.voided_at && <span className="rounded bg-red-700 px-2 py-1 font-semibold">VOID · {r.void_reason}</span>}
            {r.void_pending && !r.voided_at && <span className="rounded bg-amber-600 px-2 py-1 font-semibold text-on-accent">Void asked</span>}
            {r.seen_at && !r.voided_at && <span className="rounded bg-green-700 px-2 py-1 font-semibold">Seen</span>}
            {r.reprints > 0 && <span className="rounded bg-slate-600 px-2 py-1 text-sm font-semibold">Reprinted ×{r.reprints}</span>}
          </div>))}
      </div>
    </div>
  )
}

function Close({ date, profile, flash }: P) {
  const [s, setS] = useState<Summary | null>(null)
  const [exc, setExc] = useState<Exc[]>([])
  const [spent, setSpent] = useState(0)
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const load = useCallback(async () => {
    const [a, b] = await Promise.all([supabase.rpc('day_summary', { p_date: date }), supabase.rpc('day_exceptions', { p_date: date })])
    if (a.error) flash(a.error.message, true); else setS(a.data as Summary)
    setExc((b.data ?? []) as Exc[])
    const x = await supabase.from('expenses_v').select('amount, voided').eq('business_date', date)
    setSpent(((x.data ?? []) as { amount: number; voided: boolean }[]).filter(r => !r.voided).reduce((t, r) => t + Number(r.amount), 0))
  }, [date, flash])
  useEffect(() => { load() }, [load])

  const run = async (fn: string, args: Record<string, unknown>, ok: string) => {
    if (busy) return
    setBusy(true)
    const { error } = await supabase.rpc(fn, args)
    setBusy(false)
    if (error) { flash(error.message, true); return }
    flash(ok); setNotes(''); load()
  }
  if (!s) return <div className="text-xl text-slate-400">Loading…</div>
  const n = (k: string) => Number(s[k] ?? 0)
  const status = (s.close_status as string | null) ?? 'not closed'
  const open = n('slips_missing') + n('voids_pending') + n('open_tabs')
  const row = (label: string, v: string, warn = false) => (
    <div className="flex justify-between border-b border-slate-700 py-2 text-xl"><span>{label}</span><b className={warn ? 'text-red-400' : ''}>{v}</b></div>)

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="rounded-xl bg-slate-800 p-4">
        <div className="mb-2 flex items-center gap-3 text-2xl font-bold">Day {date}
          <span className="rounded bg-slate-600 px-3 py-1 text-lg">{status}</span></div>
        {row('Sales (captain orders, not voided)', kes(n('sales_total')))}
        {row('Captain orders in the system', String(n('slips_total')))}
        {row('Captain orders seen', String(n('slips_seen')))}
        {row('Captain orders NOT seen', String(n('slips_missing')), n('slips_missing') > 0)}
        {row('Voided orders', String(n('slips_voided')))}
        {row('Voids waiting for the manager', String(n('voids_pending')), n('voids_pending') > 0)}
        {row('Cash paid out as expenses', kes(spent))}
        {row('Old open tabs (from before the change)', `${n('open_tabs')} · ${kes(n('open_tabs_balance'))}`, n('open_tabs') > 0)}
        {row('Stock count variances', String(n('count_variances')), n('count_variances') > 0)}
        {row('Approvals pending', String(n('pending_approvals')), n('pending_approvals') > 0)}
        <div className="mt-2 text-base text-slate-400">Cash and M-Pesa are checked outside the system (the waiters' books). Count the bar in Bar stock: expected stock comes from the captain orders.</div>
        {s.close_submitted_by && <div className="mt-2 text-slate-300">Submitted by {String(s.close_submitted_by)}{s.close_notes ? ` — ${String(s.close_notes)}` : ''}</div>}

        {status !== 'approved' && (
          <div className="mt-4 space-y-3">
            <input className={input + ' w-full'} value={notes} onChange={e => setNotes(e.target.value)}
              placeholder={open > 0 ? 'Reason for closing with open items / decision note' : 'Note (optional)'} />
            <div className="flex flex-wrap gap-3">
              {can(profile, 'close.submit') && (
                <Btn disabled={busy} onClick={() => run('submit_daily_close', { p_date: date, p_notes: notes || null }, open > 0 ? 'Submitted as PROVISIONAL.' : 'Day submitted for approval.')}>
                  {status === 'returned' || status === 'submitted' || status === 'provisional' ? 'Resubmit close' : 'Submit day close'}</Btn>)}
              {can(profile, 'close.approve') && s.close_id && (status === 'submitted' || status === 'provisional') && (<>
                <Btn disabled={busy} onClick={() => run('approve_daily_close', { p_id: s.close_id, p_approve: true, p_notes: notes || null }, 'Day approved and locked.')}>Approve</Btn>
                <Btn kind="danger" disabled={busy} onClick={() => run('approve_daily_close', { p_id: s.close_id, p_approve: false, p_notes: notes || null }, 'Returned to the accountant.')}>Return</Btn></>)}
            </div>
          </div>)}
        {status === 'approved' && <div className="mt-4 rounded-lg bg-green-800 p-3 text-lg font-semibold">This day is approved and locked.</div>}
      </div>
      <div className="rounded-xl bg-slate-800 p-4">
        <div className="mb-2 text-2xl font-bold">Exceptions ({exc.length})</div>
        {exc.length === 0 && <div className="text-xl text-slate-400">None.</div>}
        <div className="space-y-2">
          {exc.map((e, i) => (
            <div key={i} className="rounded-lg bg-slate-700 p-2">
              <div className="flex justify-between text-lg font-semibold"><span>{e.kind}</span>{e.amount !== null && <span>{kes(e.amount)}</span>}</div>
              <div className="text-slate-300">{e.detail}</div>
            </div>))}
        </div>
      </div>
    </div>
  )
}
