import { useCallback, useEffect, useState } from 'react'
import { supabase, Profile } from './supabase'
import { Btn, HomeBtn } from './ui'
import { kes } from './lib'
import { tradingDate } from './tradingDay'

type Prod = { product: string; qty: number; gross: number }
type W = { rank: number; waiter_id: string; waiter: string; staff_no: string; gross: number; orders: number; items: number
  days_worked: number; avg_order: number | null; top_products: Prod[]; by_day: { date: string; gross: number }[] }
type Data = { totals: { gross: number; orders: number; waiters: number }; waiters: W[]; top_products: Prod[] }

const addDays = (d: string, n: number) => new Date(Date.parse(d + 'T00:00:00Z') + n * 86400_000).toISOString().slice(0, 10)
const weekStart = (d: string) => addDays(d, -((new Date(d + 'T00:00:00Z').getUTCDay() + 6) % 7))
const monthStart = (d: string) => d.slice(0, 8) + '01'
const num = (n: number) => Number(n).toLocaleString('en-KE', { maximumFractionDigits: 3 })
const dayLabel = (d: string) => new Date(d + 'T00:00:00Z').toLocaleDateString('en-KE', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })
const input = 'h-12 rounded-lg border border-slate-500 bg-slate-900 px-3 text-lg'
const MEDAL = ['bg-amber-400 text-black', 'bg-slate-300 text-black', 'bg-orange-700 text-white']

// Manager / accountant: every waiter's sales for a period, ranked, with what each sold most.
export default function WaiterSales({ onDone }: { profile: Profile; onDone: () => void }) {
  const t0 = tradingDate()
  const [start, setStart] = useState(monthStart(t0)); const [end, setEnd] = useState(t0)
  const [data, setData] = useState<Data | null>(null)
  const [err, setErr] = useState(''); const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true); setErr('')
    const { data: d, error } = await supabase.rpc('waiter_performance', { p_start: start, p_end: end })
    setLoading(false)
    if (error) { setErr(error.message); setData(null); return }
    setData(d as Data)
  }, [start, end])
  useEffect(() => { load() }, [load])

  const presets: [string, string, string][] = [
    ['Today', t0, t0], ['Yesterday', addDays(t0, -1), addDays(t0, -1)], ['This week', weekStart(t0), t0],
    ['Last 7 days', addDays(t0, -6), t0], ['This month', monthStart(t0), t0],
    ['Last month', monthStart(addDays(monthStart(t0), -1)), addDays(monthStart(t0), -1)]]

  const csv = () => {
    if (!data) return
    const esc = (v: unknown) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s }
    const rows = [['Rank', 'Waiter', 'ID', 'Sales', 'Orders', 'Items', 'Days worked', 'Average order', 'Sold most'],
      ...data.waiters.map(w => [w.rank, w.waiter, w.staff_no, w.gross, w.orders, w.items, w.days_worked, w.avg_order ?? '',
        w.top_products.slice(0, 3).map(p => `${p.product} x${num(p.qty)}`).join('; ')])]
    const url = URL.createObjectURL(new Blob(['﻿' + rows.map(r => r.map(esc).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' }))
    const a = document.createElement('a'); a.href = url; a.download = `waiter-sales-${start}-to-${end}.csv`; a.click(); URL.revokeObjectURL(url)
  }

  const best = data?.waiters[0]
  const max = Math.max(1, ...(data?.waiters ?? []).map(w => Number(w.gross)))
  return (
    <div className="mx-auto max-w-4xl p-4">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <h2 className="mr-auto text-2xl font-bold md:text-3xl">Waiter sales</h2>
        {data && data.waiters.length > 0 && <Btn kind="ghost" className="!h-12 !px-4 !text-base" onClick={csv}>Download CSV</Btn>}
        <HomeBtn onClick={onDone} className="!h-12" />
      </div>
      <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl bg-slate-800 p-3">
        {presets.map(([l, a, b]) => (
          <button key={l} onClick={() => { setStart(a); setEnd(b) }}
            className={`h-12 rounded-lg px-4 text-lg font-semibold ${start === a && end === b ? 'bg-amber-500 text-on-accent' : 'bg-slate-700'}`}>{l}</button>))}
        <span className="text-lg md:ml-auto">From</span><input type="date" className={input} value={start} onChange={e => setStart(e.target.value)} />
        <span className="text-lg">to</span><input type="date" className={input} value={end} onChange={e => setEnd(e.target.value)} />
        <Btn kind="ghost" className="!h-12" onClick={load} disabled={loading}>{loading ? 'Loading…' : 'Refresh'}</Btn>
      </div>
      {err && <div className="mb-3 rounded-lg bg-red-700 p-3 text-lg font-semibold">{err}</div>}
      {!data && !err && <div className="text-xl text-slate-400">Loading…</div>}

      {data && (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-3">
            <div className="min-w-[180px] flex-1 rounded-xl bg-slate-800 p-4"><div className="text-base text-slate-300">Total sales</div>
              <div className="text-3xl font-bold tabular-nums">{kes(data.totals.gross)}</div>
              <div className="text-base text-slate-400">{data.totals.orders} orders · {data.totals.waiters} waiters</div></div>
            {best && <div className="min-w-[180px] flex-1 rounded-xl bg-slate-800 p-4"><div className="text-base text-slate-300">Best performer</div>
              <div className="text-3xl font-bold">{best.waiter}</div>
              <div className="text-base text-slate-400">{kes(best.gross)} · {best.orders} orders</div></div>}
            {data.top_products[0] && <div className="min-w-[180px] flex-1 rounded-xl bg-slate-800 p-4"><div className="text-base text-slate-300">Most sold</div>
              <div className="text-2xl font-bold">{data.top_products[0].product}</div>
              <div className="text-base text-slate-400">× {num(data.top_products[0].qty)}</div></div>}
          </div>

          <div className="rounded-xl bg-slate-800 p-4">
            <div className="mb-2 text-2xl font-bold">Waiters ranked by sales</div>
            {data.waiters.length === 0 ? <div className="text-xl text-slate-400">No sales in this period.</div> : (
              <div className="space-y-2">
                {data.waiters.map(w => (
                  <div key={w.waiter_id} className="rounded-lg bg-slate-900">
                    <button onClick={() => setOpen(open === w.waiter_id ? null : w.waiter_id)} className="flex w-full items-center gap-3 p-3 text-left">
                      <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-full text-lg font-bold ${MEDAL[w.rank - 1] ?? 'bg-slate-700'}`}>{w.rank}</span>
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-baseline gap-x-3">
                          <span className="text-xl font-semibold">{w.waiter}</span>
                          <span className="text-base text-slate-400">{w.orders} orders · {num(w.items)} items · {w.days_worked} {w.days_worked === 1 ? 'day' : 'days'}</span>
                        </span>
                        <span className="mt-1 block h-2 rounded bg-slate-700"><span className="block h-2 rounded bg-amber-500" style={{ width: `${(Number(w.gross) / max) * 100}%` }} /></span>
                      </span>
                      <span className="text-xl font-bold tabular-nums">{kes(w.gross)}</span>
                    </button>
                    {open === w.waiter_id && (
                      <div className="grid gap-4 border-t border-slate-700 p-3 md:grid-cols-2">
                        <div>
                          <div className="mb-1 text-lg font-semibold">Sold most</div>
                          {w.top_products.map(p => (
                            <div key={p.product} className="flex justify-between gap-2 border-b border-slate-800 py-1 text-lg last:border-0">
                              <span>{p.product}</span><span className="tabular-nums">× {num(p.qty)} · {kes(p.gross)}</span></div>))}
                        </div>
                        <div>
                          <div className="mb-1 text-lg font-semibold">Per day{w.avg_order ? ` (avg order ${kes(w.avg_order)})` : ''}</div>
                          {w.by_day.map(d => (
                            <div key={d.date} className="flex justify-between gap-2 border-b border-slate-800 py-1 text-lg last:border-0">
                              <span>{dayLabel(d.date)}</span><span className="tabular-nums">{kes(d.gross)}</span></div>))}
                        </div>
                      </div>)}
                  </div>))}
              </div>)}
          </div>

          <div className="rounded-xl bg-slate-800 p-4">
            <div className="mb-2 text-2xl font-bold">Best-selling drinks and food (all waiters)</div>
            {data.top_products.length === 0 ? <div className="text-xl text-slate-400">Nothing sold in this period.</div> : (
              <table className="w-full text-lg"><tbody>{data.top_products.map((p, i) => (
                <tr key={p.product} className="border-b border-slate-700 last:border-0">
                  <td className="py-2 pr-2 text-slate-400">{i + 1}</td><td className="py-2">{p.product}</td>
                  <td className="py-2 text-right font-semibold tabular-nums">× {num(p.qty)}</td>
                  <td className="py-2 text-right tabular-nums text-slate-300">{kes(p.gross)}</td></tr>))}</tbody></table>)}
          </div>
          <div className="text-base text-slate-400">Sales are credited to the person who took the order. Voided orders are not counted. A sale counts on the trading day it was made.</div>
        </div>)}
    </div>
  )
}
