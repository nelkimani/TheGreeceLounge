import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase, Profile, can } from './supabase'
import { Btn, HomeBtn } from './ui'
import { kes, uid } from './lib'
import { toast } from './feedback'
import { Sale, STATION_LABEL, Station } from './sale'
import SaleDone from './SaleDone'
import { tradingDate } from './tradingDay'

type Row = {
  captain_order_id: string; slip_no: number; order_id: string; order_no: number; station: Station; created_at: string
  waiter_name: string; table_number: string | null; customer_name: string | null
  lines: { qty: number; name: string; price: number; notes: string | null }[] | null
  total: number; reprints: number; seen_at: string | null; voided_at: string | null; void_reason: string | null; void_pending: boolean
}
type Order = { id: string; no: number; at: string; waiter: string; label: string; slips: Row[] }

const REASONS = ['Wrong item', 'Customer changed mind', 'Waiter mistake', 'Out of stock']
const hhmm = (iso: string) => new Date(iso).toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit' })

const toSale = (o: Order, slips: Row[], markVoid = false): Sale => ({
  order_id: o.id, order_no: o.no, created_at: o.at, waiter: o.waiter, label: o.label,
  total: slips.filter(s => !s.voided_at).reduce((t, s) => t + Number(s.total), 0),
  slips: slips.map(s => ({ id: s.captain_order_id, slip_no: s.slip_no, station: s.station, lines: s.lines ?? [], voided: markVoid || !!s.voided_at })),
})

// Today's orders. Reprint the receipt and captain orders, or print the VOID slip once a manager has voided a slip.
// Only a manager (approval.grant) can void; waiters have no Void button (migration 035 enforces it in the database too).
export default function MyOrders({ profile, onDone }: { profile: Profile; onDone: () => void }) {
  const canVoid = can(profile, 'approval.grant')
  const [orders, setOrders] = useState<Order[]>([])
  const [view, setView] = useState<{ sale: Sale; hideReceipt: boolean } | null>(null)
  const [voidFor, setVoidFor] = useState<Row | null>(null)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const key = useRef(uid())

  const load = useCallback(async () => {
    const { data } = await supabase.from('sales_slips').select('*').eq('business_date', tradingDate()).order('created_at', { ascending: false })
    const map = new Map<string, Order>()
    for (const r of (data ?? []) as Row[]) {
      const o = map.get(r.order_id) ?? { id: r.order_id, no: r.order_no, at: r.created_at, waiter: r.waiter_name,
        label: r.table_number ? `Table ${r.table_number}` : (r.customer_name ?? 'Sale'), slips: [] }
      o.slips.push(r); map.set(r.order_id, o)
    }
    setOrders(Array.from(map.values()).map(o => ({ ...o, slips: o.slips.sort((a, b) => a.slip_no - b.slip_no) })))
  }, [])
  useEffect(() => { load(); const t = setInterval(load, 10000); return () => clearInterval(t) }, [load])

  const sendVoid = async () => {
    if (!voidFor || busy || !reason.trim()) return
    setBusy(true)
    const { data, error } = await supabase.rpc('request_void', { p_captain: voidFor.captain_order_id, p_reason: reason.trim(), p_key: key.current })
    setBusy(false)
    if (error) { toast(error.message, 'error'); return }
    toast((data as { status: string }).status === 'approved' ? 'Voided. Print the VOID slip for the station.' : 'Void request recorded.')
    setVoidFor(null); setReason(''); key.current = uid(); load()
  }

  if (view) return <SaleDone sale={view.sale} reprint hideReceipt={view.hideReceipt} onDone={() => setView(null)} />

  return (
    <div className="mx-auto max-w-4xl p-4">
      <div className="mb-3 flex items-center gap-3">
        <h2 className="mr-auto text-3xl font-bold">My orders today</h2>
        <HomeBtn onClick={onDone} />
      </div>
      {orders.length === 0 && <div className="text-xl text-slate-400">No orders yet today.</div>}
      <div className="space-y-3">
        {orders.map(o => {
          const live = o.slips.filter(s => !s.voided_at)
          return (
            <div key={o.id} className="rounded-xl bg-slate-800 p-3">
              <div className="flex flex-wrap items-center gap-3 text-xl">
                <span className="text-2xl font-bold">#{o.no}</span>
                <span className="font-semibold">{o.label}</span>
                <span className="text-slate-300">{hhmm(o.at)} · {o.waiter}</span>
                <span className="ml-auto text-2xl font-bold">{kes(live.reduce((t, s) => t + Number(s.total), 0))}</span>
              </div>
              <div className="mt-2 space-y-2">
                {o.slips.map(s => (
                  <div key={s.captain_order_id} className="flex flex-wrap items-center gap-2 rounded-lg bg-slate-900/50 p-2">
                    <div className="min-w-0 flex-1 text-lg">
                      <b>{STATION_LABEL[s.station]}</b> <span className="text-slate-400">slip #{s.slip_no}</span>
                      <div className="text-base text-slate-300">{(s.lines ?? []).map(l => `${l.qty} × ${l.name}`).join(', ')}</div>
                      {s.voided_at && <div className="text-base font-semibold text-red-400">VOIDED · {s.void_reason}</div>}
                      {s.void_pending && !s.voided_at && <div className="text-base font-semibold text-amber-300">Void waiting for the manager</div>}
                    </div>
                    {s.voided_at
                      ? <Btn kind="ghost" className="!h-12 !text-base" onClick={() => setView({ sale: toSale(o, [s], true), hideReceipt: true })}>Print VOID slip</Btn>
                      : <>
                          <Btn kind="ghost" className="!h-12 !text-base" onClick={() => setView({ sale: toSale(o, [s]), hideReceipt: true })}>Reprint slip</Btn>
                          {canVoid && !s.void_pending && <Btn kind="danger" className="!h-12 !text-base" onClick={() => { setVoidFor(s); setReason('') }}>Void</Btn>}
                        </>}
                  </div>
                ))}
              </div>
              {live.length > 0 && <div className="mt-2"><Btn kind="ghost" className="!h-12 !text-base" onClick={() => setView({ sale: toSale(o, o.slips), hideReceipt: false })}>Reprint receipt</Btn></div>}
            </div>
          )
        })}
      </div>

      {canVoid && voidFor && (
        <div className="fixed inset-0 z-[60] flex items-start justify-center bg-black/60 p-4 pt-6" role="dialog" aria-modal="true" aria-label="Void order">
          <div className="flex w-[min(40rem,96vw)] flex-col gap-3 rounded-2xl bg-slate-800 p-5">
            <h2 className="text-2xl font-bold">Void {STATION_LABEL[voidFor.station]} slip #{voidFor.slip_no}?</h2>
            <div className="text-lg text-slate-300">{(voidFor.lines ?? []).map(l => `${l.qty} × ${l.name}`).join(', ')} · {kes(voidFor.total)}</div>
            <div className="flex flex-wrap gap-2">
              {REASONS.map(r => (
                <button key={r} onClick={() => setReason(r)} className={`h-12 rounded-full px-4 text-lg font-semibold ${reason === r ? 'bg-amber-500 text-on-accent' : 'bg-slate-700'}`}>{r}</button>
              ))}
            </div>
            <input value={reason} maxLength={120} onChange={e => setReason(e.target.value)} placeholder="Reason (required)" aria-label="Reason"
              className="h-[3.25rem] rounded-xl border-2 border-slate-600 bg-slate-900 px-3 text-xl" />
            <div className="text-base text-slate-400">The void applies at once and is logged. The stock goes back; print the VOID slip for the station.</div>
            <div className="flex gap-3">
              <Btn kind="ghost" className="flex-1" onClick={() => setVoidFor(null)}>Cancel</Btn>
              <Btn kind="danger" className="flex-1" onClick={sendVoid} disabled={busy || !reason.trim()}>{busy ? 'Voiding…' : 'Void slip'}</Btn>
            </div>
          </div>
        </div>
      )}
      <div className="mt-4 text-sm text-slate-400">Profile: {profile.full_name}. Only today's orders are listed.</div>
    </div>
  )
}
