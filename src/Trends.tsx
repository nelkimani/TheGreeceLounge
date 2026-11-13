import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase, Profile, can } from './supabase'
import { Btn, HomeBtn } from './ui'
import { kes } from './lib'
import { Table, Col, Row, input, today, addDays, weekStart, monthStart, num, n } from './OwnerReports'

// Trends: weekly and monthly profit (drinks), best and worst drinks, and waiters whose shortages repeat.
// Profit is drinks only: bar sales minus the cost of the drinks sold. Drinks with no cost recorded count as 0 cost.

type Bucket = { start: string; days: number; gross: number; bar_sales: number; cost: number; profit: number; units: number; no_cost_units: number }
type Drink = { product: string; category: string | null; qty: number; sales: number; unit_cost: number | null; cost: number | null; profit: number | null; margin_pct: number | null }
type Idle = { product: string; category: string | null; price: number | null; on_hand: number }
type Trend = { weekly: Bucket[]; monthly: Bucket[]; drinks: Drink[]; idle: Idle[] }
type Waiter = { waiter: string; staff_no: string; days_cleared: number; days_short: number; days_over: number; total_short: number; total_over: number; net: number; sales: number; short_pct: number | null; last_short: string | null; repeat: boolean; recent: { date: string; amount: number; notes: string | null }[] }

const wkLabel = (s: string) => { const a = new Date(s + 'T12:00:00'), b = new Date(addDays(s, 6) + 'T12:00:00')
  const f = (d: Date) => `${d.getDate()} ${d.toLocaleDateString('en-GB', { month: 'short' })}`; return `${f(a)} – ${f(b)}` }
const moLabel = (s: string) => new Date(s + 'T12:00:00').toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
const dayLabel = (s: string) => new Date(s + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })

function Bars({ title, rows, label }: { title: string; rows: Bucket[]; label: (s: string) => string }) {
  const max = Math.max(1, ...rows.map(r => Math.abs(n(r.profit))))
  const table: Row[] = rows.map((r, i) => {
    const prev = i > 0 ? n(rows[i - 1].profit) : null
    const chg = prev === null || prev === 0 ? '—' : `${n(r.profit) - prev >= 0 ? '+' : ''}${(((n(r.profit) - prev) / Math.abs(prev)) * 100).toFixed(0)}%`
    return { period: label(r.start), days: r.days, units: r.units, sales: r.bar_sales, cost: r.cost, profit: r.profit, change: chg }
  })
  const cols: Col[] = [{ key: 'period', label: title }, { key: 'days', label: 'Days with sales', fmt: 'num' }, { key: 'units', label: 'Units', fmt: 'num' },
    { key: 'sales', label: 'Drink sales', fmt: 'kes' }, { key: 'cost', label: 'Cost', fmt: 'kes' }, { key: 'profit', label: 'Profit', fmt: 'kes' }, { key: 'change', label: 'vs previous', fmt: 'pct' }]
  return (
    <div className="space-y-3">
      {rows.length > 0 && (
        <div className="rounded-xl bg-slate-800 p-4">
          <div className="mb-2 text-2xl font-bold">{title} profit</div>
          <div className="space-y-1.5">
            {rows.map(r => (
              <div key={r.start} className="flex items-center gap-2">
                <div className="w-36 shrink-0 text-base text-slate-300 sm:w-44">{label(r.start)}</div>
                <div className="h-6 flex-1 rounded bg-slate-900">
                  <div className={`h-6 rounded ${n(r.profit) < 0 ? 'bg-red-600' : 'bg-green-600'}`} style={{ width: `${Math.max(1, (Math.abs(n(r.profit)) / max) * 100)}%` }} />
                </div>
                <div className={`w-32 shrink-0 text-right text-lg font-semibold tabular-nums ${n(r.profit) < 0 ? 'text-red-400' : ''}`}>{kes(r.profit)}</div>
              </div>))}
          </div>
        </div>)}
      <Table title={`${title} figures`} file={`trend-${title.toLowerCase()}`} cols={cols} rows={table} empty="No sales in this period." />
    </div>
  )
}

export default function Trends({ profile, onDone }: { profile: Profile; onDone: () => void }) {
  const canProfit = can(profile, 'report.profit'), canWaiters = can(profile, 'recon.view_all')
  const [start, setStart] = useState(weekStart(addDays(today(), -77)))     // 12 weeks, from a Monday
  const [end, setEnd] = useState(today())
  const [data, setData] = useState<Trend | null>(null)
  const [wt, setWt] = useState<Waiter[] | null>(null)
  const [err, setErr] = useState('')
  const [wErr, setWErr] = useState('')
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true); setErr(''); setWErr('')
    if (canProfit) {
      const { data: d, error } = await supabase.rpc('report_trends', { p_start: start, p_end: end })
      if (error) { setErr(error.message); setData(null) } else setData(d as Trend)
    }
    if (canWaiters) {
      const { data: d, error } = await supabase.rpc('waiter_shortage_report', { p_start: start, p_end: end })
      if (error) { setWErr(error.message); setWt(null) } else setWt((d as { waiters: Waiter[] }).waiters)
    }
    setLoading(false)
  }, [start, end, canProfit, canWaiters])
  useEffect(() => { load() }, [load])

  const t = today()
  const presets: [string, string, string][] = [
    ['Last 8 weeks', weekStart(addDays(t, -49)), t], ['Last 12 weeks', weekStart(addDays(t, -77)), t],
    ['Last 3 months', monthStart(addDays(monthStart(t), -62)), t], ['Last 6 months', monthStart(addDays(monthStart(t), -155)), t],
    ['This year', t.slice(0, 4) + '-01-01', t]]

  const drinks = data?.drinks ?? []
  const costed = useMemo(() => drinks.filter(d => d.profit !== null && n(d.qty) > 0), [drinks])
  const best = useMemo(() => [...costed].sort((a, b) => n(b.profit) - n(a.profit)).slice(0, 10), [costed])
  const worst = useMemo(() => [...costed].sort((a, b) => n(a.profit) - n(b.profit)).slice(0, 10), [costed])
  const sellers = useMemo(() => [...drinks].sort((a, b) => n(b.qty) - n(a.qty)).slice(0, 10), [drinks])
  const noCost = drinks.filter(d => d.profit === null)
  const dCols: Col[] = [{ key: 'product', label: 'Drink' }, { key: 'qty', label: 'Sold', fmt: 'num' }, { key: 'sales', label: 'Sales', fmt: 'kes' },
    { key: 'cost', label: 'Cost', fmt: 'kes' }, { key: 'profit', label: 'Profit', fmt: 'kes' }, { key: 'margin', label: 'Margin', fmt: 'pct' }]
  const dRows = (xs: Drink[]): Row[] => xs.map(d => ({ product: d.product, qty: d.qty, sales: d.sales, cost: d.cost, profit: d.profit, margin: d.margin_pct === null ? '—' : `${d.margin_pct}%` }))
  const totals = (xs: Bucket[]) => xs.reduce((a, b) => ({ sales: a.sales + n(b.bar_sales), cost: a.cost + n(b.cost) }), { sales: 0, cost: 0 })
  const tot = totals(data?.weekly ?? [])
  const noCostUnits = (data?.weekly ?? []).reduce((a, b) => a + n(b.no_cost_units), 0)

  const repeaters = (wt ?? []).filter(w => w.repeat)
  const wRows: Row[] = (wt ?? []).map(w => ({ waiter: `${w.waiter} (${w.staff_no})${w.repeat ? ' ⚠' : ''}`, cleared: w.days_cleared, short_days: w.days_short,
    short: w.total_short, over: w.total_over, pct: w.short_pct === null ? '—' : `${w.short_pct}%`, last: w.last_short ? dayLabel(w.last_short) : '—' }))
  const wCols: Col[] = [{ key: 'waiter', label: 'Waiter' }, { key: 'cleared', label: 'Days cleared', fmt: 'num' }, { key: 'short_days', label: 'Days short', fmt: 'num' },
    { key: 'short', label: 'Total short', fmt: 'kes' }, { key: 'over', label: 'Total over', fmt: 'kes' }, { key: 'pct', label: 'Short % of sales', fmt: 'pct' }, { key: 'last', label: 'Last short' }]

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-4">
      <div className="flex flex-wrap items-center gap-3"><HomeBtn onClick={onDone} /><h2 className="text-3xl font-bold">Trends</h2></div>
      <div className="flex flex-wrap items-center gap-2 rounded-xl bg-slate-800 p-3">
        {presets.map(([l, a, b]) => (
          <button key={l} onClick={() => { setStart(a); setEnd(b) }}
            className={`h-12 rounded-lg px-4 text-lg font-semibold ${start === a && end === b ? 'bg-amber-500 text-on-accent' : 'bg-slate-700'}`}>{l}</button>))}
        <span className="text-lg">From</span><input type="date" className={input} value={start} onChange={e => setStart(e.target.value)} />
        <span className="text-lg">to</span><input type="date" className={input} value={end} onChange={e => setEnd(e.target.value)} />
        <Btn kind="ghost" className="!h-12" onClick={load} disabled={loading}>{loading ? 'Loading…' : 'Refresh'}</Btn>
      </div>

      {canProfit && err && <div className="rounded-lg bg-red-700 p-3 text-lg font-semibold">{err}</div>}
      {canProfit && data && (<>
        <div className="grid gap-2 sm:grid-cols-3">
          <div className="rounded-xl bg-slate-800 p-3"><div className="text-base text-slate-300">Drink sales</div><div className="text-2xl font-bold tabular-nums">{kes(tot.sales)}</div></div>
          <div className="rounded-xl bg-slate-800 p-3"><div className="text-base text-slate-300">Cost of drinks sold</div><div className="text-2xl font-bold tabular-nums">{kes(tot.cost)}</div></div>
          <div className="rounded-xl bg-slate-800 p-3"><div className="text-base text-slate-300">Profit</div><div className={`text-2xl font-bold tabular-nums ${tot.sales - tot.cost < 0 ? 'text-red-400' : 'text-green-400'}`}>{kes(tot.sales - tot.cost)}</div></div>
        </div>
        {noCostUnits > 0 && <div className="rounded-lg bg-amber-700 p-3 text-lg font-semibold">{num(noCostUnits)} units sold ({noCost.length} drinks) have no cost recorded, so profit is overstated until their cost prices are loaded.</div>}
        <Bars title="Weekly" rows={data.weekly} label={wkLabel} />
        <Bars title="Monthly" rows={data.monthly} label={moLabel} />
        <Table title="Best drinks (most profit)" file="best-drinks" cols={dCols} rows={dRows(best)} empty="No drinks with a recorded cost were sold." />
        <Table title="Worst drinks (least profit)" file="worst-drinks" cols={dCols} rows={dRows(worst)} empty="No drinks with a recorded cost were sold." />
        <Table title="Best sellers (most units)" file="best-sellers" cols={dCols} rows={dRows(sellers)} />
        <Table title="In stock but not sold in this period" file="not-sold" empty="Every drink in stock sold at least once."
          cols={[{ key: 'product', label: 'Drink' }, { key: 'category', label: 'Category' }, { key: 'on_hand', label: 'In stock', fmt: 'num' }, { key: 'price', label: 'Price', fmt: 'kes' }]}
          rows={(data.idle ?? []).map(i => ({ product: i.product, category: i.category ?? '—', on_hand: i.on_hand, price: i.price }))} />
      </>)}

      {canWaiters && (<div className="space-y-3">
        <div className="text-2xl font-bold">Waiters: shortages</div>
        {wErr && <div className="rounded-lg bg-red-700 p-3 text-lg font-semibold">{wErr}</div>}
        {wt && repeaters.length > 0 && <div className="rounded-lg bg-red-800 p-3 text-lg font-semibold">Short on 2 or more days: {repeaters.map(w => `${w.waiter} (${w.days_short} days, ${kes(w.total_short)})`).join('; ')}.</div>}
        {wt && repeaters.length === 0 && wt.length > 0 && <div className="rounded-lg bg-green-800 p-3 text-lg font-semibold">No waiter has been short on 2 or more days in this period.</div>}
        {wt && <Table title="Cash and M-Pesa against sales, per waiter" file="waiter-shortages" cols={wCols} rows={wRows}
          empty="No waiters cleared in this period yet. This fills in as you clear waiters on the Reconciliation > Waiters tab." />}
        {wt && wt.filter(w => w.recent.length > 0).map(w => (
          <div key={w.staff_no} className="rounded-xl bg-slate-800 p-3">
            <button className="flex w-full items-center gap-3 text-left text-xl font-semibold" onClick={() => setOpen(open === w.staff_no ? null : w.staff_no)}>
              <span>{w.waiter} {w.repeat && <span className="rounded bg-red-700 px-2 py-0.5 text-base">repeat</span>}</span>
              <span className="ml-auto text-slate-300">{w.recent.length} recent short day{w.recent.length === 1 ? '' : 's'} {open === w.staff_no ? '▲' : '▼'}</span></button>
            {open === w.staff_no && (
              <table className="mt-2 w-full text-lg"><tbody>
                {w.recent.map(r => <tr key={r.date} className="border-b border-slate-700"><td className="py-1">{dayLabel(r.date)}</td><td className="text-right tabular-nums text-red-400">{kes(r.amount)}</td><td className="pl-4 text-slate-300">{r.notes ?? ''}</td></tr>)}
              </tbody></table>)}
          </div>))}
      </div>)}
      {!canProfit && !canWaiters && <div className="text-xl text-slate-400">You do not have access to these reports.</div>}
    </div>
  )
}
