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
  lines: { id: string; qty: number; name: string; price: number; notes: string | null; voided: boolean; void_reason: string | null }[] | null
  total: number; reprints: number; seen_at: string | null; voided_at: string | null; void_reason: string | null; void_pending: boolean
}
type Order = { id: string; no: number; at: string; waiter: string; label: string; slips: Row[] }

const REASONS = ['Wrong item', 'Customer changed mind', 'Waiter mistake', 'Out of stock']
const hhmm = (iso: string) => new Date(iso).toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit' })

type Line = NonNullable<Row['lines']>[number]
type Target =
  | { kind: 'order'; order: Order }
  | { kind: 'slip'; slip: Row }
  | { kind: 'item'; slip: Row; line: Line }

// A reprint shows only what is still live. A VOID slip (markVoid) carries the lines to cancel: the whole slip, or just the lines given.
const toSale = (o: Order, slips: Row[], markVoid = false, onlyLines?: Line[]): Sale => ({
  order_id: o.id, order_no: o.no, created_at: o.at, waiter: o.waiter, label: o.label,
  total: slips.filter(s => !s.voided_at).reduce((t, s) => t + Number(s.total), 0),
  slips: slips.map(s => ({
    id: s.captain_order_id, slip_no: s.slip_no, station: s.station, voided: markVoid || !!s.voided_at,
    lines: onlyLines ?? ((markVoid || s.voided_at) ? (s.lines ?? []) : (s.lines ?? []).filter(l => !l.voided)),
  })),
})

// Today's orders. Reprint the receipt and captain orders, or print the VOID slip once a manager has voided a slip or one item.
// The counter (bartender) and managers (order.void) can void ITEMS; only a manager (approval.grant) can void a whole slip or
// receipt. Waiters have no Void button (migrations 035, 046 and 049 enforce it in the database too).
export default function MyOrders({ profile, onDone }: { profile: Profile; onDone: () => void }) {
  const canVoid = can(profile, 'approval.grant')          // whole slip / whole receipt
  const canVoidItem = can(profile, 'order.void')           // single items (counter + manager)
  const [orders, setOrders] = useState<Order[]>([])
  const [view, setView] = useState<{ sale: Sale; hideReceipt: boolean } | null>(null)
  const [voidFor, setVoidFor] = useState<Target | null>(null)
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
    const r = reason.trim()
    const { error } = voidFor.kind === 'order'
      ? await supabase.rpc('request_void_order', { p_order: voidFor.order.id, p_reason: r, p_key: key.current })
      : voidFor.kind === 'item'
        ? await supabase.rpc('request_void_item', { p_item: voidFor.line.id, p_reason: r, p_key: key.current })
        : await supabase.rpc('request_void', { p_captain: voidFor.slip.captain_order_id, p_reason: r, p_key: key.current })
    setBusy(false)
    if (error) { toast(error.message, 'error'); return }
    toast('Voided. Print the VOID slip for the station.')
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
                  <div key={s.captain_order_id} className="rounded-lg bg-slate-900/50 p-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="min-w-0 flex-1 text-lg">
                        <b>{STATION_LABEL[s.station]}</b> <span className="text-slate-400">slip #{s.slip_no}</span>
                        {s.voided_at && <div className="text-base font-semibold text-red-400">VOIDED · {s.void_reason}</div>}
                        {s.void_pending && !s.voided_at && <div className="text-base font-semibold text-amber-300">Void waiting for the manager</div>}
                      </div>
                      {s.voided_at
                        ? <Btn kind="ghost" className="!h-12 !text-base" onClick={() => setView({ sale: toSale(o, [s], true), hideReceipt: true })}>Print VOID slip</Btn>
                        : <>
                            <Btn kind="ghost" className="!h-12 !text-base" onClick={() => setView({ sale: toSale(o, [s]), hideReceipt: true })}>Reprint slip</Btn>
                            {canVoid && !s.void_pending && <Btn kind="danger" className="!h-12 !text-base" onClick={() => { setVoidFor({ kind: 'slip', slip: s }); setReason('') }}>Void whole slip</Btn>}
                          </>}
                    </div>
                    <div className="mt-1 space-y-1">
                      {(s.lines ?? []).map(l => (
                        <div key={l.id} className="flex flex-wrap items-center gap-2 border-t border-slate-700/60 pt-1 text-lg">
                          <div className={`min-w-0 flex-1 ${l.voided ? 'text-slate-500 line-through' : 'text-slate-200'}`}>
                            {l.qty} × {l.name} <span className="text-base">· {kes(Number(l.qty) * Number(l.price))}</span>
                            {l.notes && <span className="text-base text-slate-400"> · {l.notes}</span>}
                          </div>
                          {l.voided
                            ? <>
                                <span className="text-base font-semibold text-red-400">VOIDED{l.void_reason ? ` · ${l.void_reason}` : ''}</span>
                                {!s.voided_at && <Btn kind="ghost" className="!h-10 !text-base" onClick={() => setView({ sale: toSale(o, [s], true, [l]), hideReceipt: true })}>Print VOID slip</Btn>}
                              </>
                            : canVoidItem && !s.voided_at && !s.void_pending &&
                              <Btn kind="danger" className="!h-10 !text-base" onClick={() => { setVoidFor({ kind: 'item', slip: s, line: l }); setReason('') }}>Void item</Btn>}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
              {live.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-2">
                  <Btn kind="ghost" className="!h-12 !text-base" onClick={() => setView({ sale: toSale(o, o.slips), hideReceipt: false })}>Reprint receipt</Btn>
                  {canVoid && <Btn kind="danger" className="!h-12 !text-base" onClick={() => { setVoidFor({ kind: 'order', order: o }); setReason('') }}>Void whole receipt</Btn>}
                </div>)}
            </div>
          )
        })}
      </div>

      {(canVoid || canVoidItem) && voidFor && (
        <div className="fixed inset-0 z-[60] flex items-start justify-center bg-black/60 p-4 pt-6" role="dialog" aria-modal="true" aria-label="Void">
          <div className="flex w-[min(40rem,96vw)] flex-col gap-3 rounded-2xl bg-slate-800 p-5">
            <h2 className="text-2xl font-bold">
              {voidFor.kind === 'order' ? `Void the whole receipt #${voidFor.order.no}?`
                : voidFor.kind === 'item' ? `Void ${voidFor.line.qty} × ${voidFor.line.name}?`
                : `Void ${STATION_LABEL[voidFor.slip.station]} slip #${voidFor.slip.slip_no}?`}
            </h2>
            <div className="text-lg text-slate-300">
              {voidFor.kind === 'order'
                ? `${voidFor.order.slips.filter(x => !x.voided_at).map(x => `${STATION_LABEL[x.station]} slip #${x.slip_no}`).join(', ')} · ${kes(voidFor.order.slips.filter(x => !x.voided_at).reduce((t, x) => t + Number(x.total), 0))}`
                : voidFor.kind === 'item'
                  ? `${STATION_LABEL[voidFor.slip.station]} slip #${voidFor.slip.slip_no} · ${kes(Number(voidFor.line.qty) * Number(voidFor.line.price))}. The rest of the slip stays.`
                  : `${(voidFor.slip.lines ?? []).filter(l => !l.voided).map(l => `${l.qty} × ${l.name}`).join(', ')} · ${kes(voidFor.slip.total)}`}
            </div>
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
              <Btn kind="danger" className="flex-1" onClick={sendVoid} disabled={busy || !reason.trim()}>
                {busy ? 'Voiding…' : voidFor.kind === 'order' ? 'Void receipt' : voidFor.kind === 'item' ? 'Void item' : 'Void slip'}</Btn>
            </div>
          </div>
        </div>
      )}
      <div className="mt-4 text-sm text-slate-400">Profile: {profile.full_name}. Only today's orders are listed.</div>
    </div>
  )
}
