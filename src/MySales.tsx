import { useCallback, useEffect, useState } from 'react'
import { supabase, Profile } from './supabase'
import { HomeBtn } from './ui'
import { kes } from './lib'
import { tradingDate } from './tradingDay'

type Period = 'today' | 'week' | 'month'
type Day = { date: string; gross: number; orders: number; items: number }
type Top = { product: string; category: string; qty: number; gross: number }
type Data = { totals: { gross: number; orders: number; items: number }; by_day: Day[]; top_products: Top[] }

const addDays = (d: string, n: number) => new Date(Date.parse(d + 'T00:00:00Z') + n * 86400_000).toISOString().slice(0, 10)
const weekStart = (d: string) => addDays(d, -((new Date(d + 'T00:00:00Z').getUTCDay() + 6) % 7))   // Monday
const monthStart = (d: string) => d.slice(0, 8) + '01'
const dayLabel = (d: string) => new Date(d + 'T00:00:00Z').toLocaleDateString('en-KE', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })
const num = (n: number) => Number(n).toLocaleString('en-KE', { maximumFractionDigits: 3 })
const LABEL: Record<Period, string> = { today: 'Today', week: 'This week', month: 'This month' }

// A waiter's own sales: today, this week (from Monday) and this month. Only their own sales are ever returned.
export default function MySales({ profile, onDone }: { profile: Profile; onDone: () => void }) {
  const [period, setPeriod] = useState<Period>('today')
  const [data, setData] = useState<Partial<Record<Period, Data>>>({})
  const [err, setErr] = useState('')
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    const t = tradingDate()
    const ranges: Record<Period, string> = { today: t, week: weekStart(t), month: monthStart(t) }
    setLoading(true); setErr('')
    const res = await Promise.all((Object.keys(ranges) as Period[]).map(async p => {
      const { data: d, error } = await supabase.rpc('my_sales', { p_start: ranges[p], p_end: t })
      return [p, d as Data | null, error?.message ?? ''] as const
    }))
    setLoading(false)
    const next: Partial<Record<Period, Data>> = {}
    for (const [p, d, e] of res) { if (e) { setErr(e); return } if (d) next[p] = d }
    setData(next)
  }, [])
  useEffect(() => { load(); const i = setInterval(load, 30000); return () => clearInterval(i) }, [load])

  const cur = data[period]
  return (
    <div className="mx-auto max-w-3xl p-4">
      <div className="mb-3 flex items-center gap-3">
        <h2 className="mr-auto text-2xl font-bold md:text-3xl">My sales</h2>
        <button onClick={load} disabled={loading} className="h-12 rounded-lg bg-slate-700 px-4 text-lg font-semibold">{loading ? 'Loading…' : 'Refresh'}</button>
        <HomeBtn onClick={onDone} className="!h-12" />
      </div>
      <div className="mb-1 text-base text-slate-400">{profile.full_name}</div>
      {err && <div className="mb-3 rounded-lg bg-red-700 p-3 text-lg font-semibold">{err}</div>}

      <div className="mb-4 grid grid-cols-3 gap-2">
        {(Object.keys(LABEL) as Period[]).map(p => (
          <button key={p} onClick={() => setPeriod(p)}
            className={`rounded-xl p-3 text-left ${period === p ? 'bg-amber-500 text-on-accent' : 'bg-slate-800'}`}>
            <div className="text-base font-semibold">{LABEL[p]}</div>
            <div className="text-xl font-bold tabular-nums md:text-2xl">{data[p] ? kes(data[p]!.totals.gross) : '…'}</div>
            <div className="text-sm opacity-80">{data[p] ? `${data[p]!.totals.orders} orders` : ''}</div>
          </button>))}
      </div>

      {cur && (
        <div className="space-y-4">
          <div className="rounded-xl bg-slate-800 p-4">
            <div className="text-lg text-slate-300">{LABEL[period]}</div>
            <div className="text-4xl font-bold tabular-nums">{kes(cur.totals.gross)}</div>
            <div className="text-lg text-slate-300">{cur.totals.orders} orders · {num(cur.totals.items)} items sold
              {cur.totals.orders > 0 && ` · ${kes(cur.totals.gross / cur.totals.orders)} average order`}</div>
          </div>

          {period !== 'today' && (
            <div className="rounded-xl bg-slate-800 p-4">
              <div className="mb-2 text-xl font-bold">Per day</div>
              {cur.by_day.length === 0 ? <div className="text-lg text-slate-400">No sales yet.</div> : (
                <table className="w-full text-lg">
                  <tbody>{cur.by_day.map(r => (
                    <tr key={r.date} className="border-b border-slate-700 last:border-0">
                      <td className="py-2">{dayLabel(r.date)}</td>
                      <td className="py-2 text-right text-slate-300">{r.orders} orders</td>
                      <td className="py-2 text-right font-semibold tabular-nums">{kes(r.gross)}</td>
                    </tr>))}</tbody>
                </table>)}
            </div>)}

          <div className="rounded-xl bg-slate-800 p-4">
            <div className="mb-2 text-xl font-bold">What I sold most</div>
            {cur.top_products.length === 0 ? <div className="text-lg text-slate-400">Nothing sold yet.</div> : (
              <table className="w-full text-lg">
                <tbody>{cur.top_products.map((r, i) => (
                  <tr key={r.product} className="border-b border-slate-700 last:border-0">
                    <td className="py-2 pr-2 text-slate-400">{i + 1}</td>
                    <td className="py-2">{r.product}</td>
                    <td className="py-2 text-right font-semibold tabular-nums">× {num(r.qty)}</td>
                    <td className="py-2 text-right tabular-nums text-slate-300">{kes(r.gross)}</td>
                  </tr>))}</tbody>
              </table>)}
          </div>
          <div className="text-base text-slate-400">Voided orders are not counted. A sale counts on the trading day it was made (the day rolls over at 5 am).</div>
        </div>)}
      {!cur && !err && <div className="text-xl text-slate-400">Loading…</div>}
    </div>
  )
}
