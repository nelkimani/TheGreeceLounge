import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase, Profile } from './supabase'
import { Btn, HomeBtn } from './ui'
import { kes } from './lib'
import { Card, Warn, Table, Row, Col, input, today, addDays, monthStart, weekStart, num, pct, n } from './OwnerReports'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Data = any

const STOCK_COLS: Col[] = [
  { key: 'category', label: 'Category' }, { key: 'product', label: 'Drink' },
  { key: 'bought', label: 'Bought', fmt: 'num' }, { key: 'sold', label: 'Sold', fmt: 'num' },
  { key: 'remaining', label: 'Left', fmt: 'num' }, { key: 'other', label: 'Lost / other', fmt: 'num' },
  { key: 'cost', label: 'Cost each', fmt: 'kes' }, { key: 'price', label: 'Price', fmt: 'kes' },
  { key: 'worth_bought', label: 'Worth bought', fmt: 'kes' }, { key: 'remaining_cost', label: 'Left at cost', fmt: 'kes' },
  { key: 'remaining_sell', label: 'Left at selling price', fmt: 'kes' }, { key: 'profit_remaining', label: 'Profit on what is left', fmt: 'kes' },
  { key: 'expected_total_profit', label: 'Profit if all bought sells', fmt: 'kes' },
]
const SOLD_COLS: Col[] = [
  { key: 'product', label: 'Drink' }, { key: 'qty_sold', label: 'Sold', fmt: 'num' }, { key: 'unit_cost', label: 'Cost each', fmt: 'kes' },
  { key: 'sales', label: 'Sales', fmt: 'kes' }, { key: 'cost', label: 'Cost', fmt: 'kes' }, { key: 'profit', label: 'Profit', fmt: 'kes' },
]
const sum = (rows: Row[], k: string) => rows.reduce((t, r) => t + n(r[k]), 0)

// Bookkeeping: what all the stock bought is worth, what is left, and the profit to expect (all time, as at today),
// then the profit and loss for any period. Same permission as the profit report, because it shows costs.
export default function Bookkeeping({ onDone }: { profile: Profile; onDone: () => void }) {
  const [book, setBook] = useState<Data>(null)
  const [pl, setPl] = useState<Data>(null)
  const [start, setStart] = useState(monthStart(today())); const [end, setEnd] = useState(today())
  const [err, setErr] = useState(''); const [plErr, setPlErr] = useState('')
  const [loading, setLoading] = useState(false)
  const [cat, setCat] = useState('All'); const [q, setQ] = useState('')
  const reqBook = useRef(0), reqPl = useRef(0)

  const loadBook = useCallback(async () => {
    const id = ++reqBook.current
    setLoading(true); setErr('')
    const { data, error } = await supabase.rpc('report_bookkeeping')
    if (id !== reqBook.current) return
    setLoading(false)
    if (error) { setErr(error.message); setBook(null); return }
    setBook(data)
  }, [])
  useEffect(() => { loadBook() }, [loadBook])

  const loadPl = useCallback(async () => {
    const id = ++reqPl.current
    if (!start || !end) return
    if (end < start) { setPlErr('The end date is before the start date.'); setPl(null); return }
    setPlErr(''); setPl(null)
    const { data, error } = await supabase.rpc('report_profit', { p_start: start, p_end: end })
    if (id !== reqPl.current) return
    if (error) { setPlErr(error.message); setPl(null); return }
    setPl(data)
  }, [start, end])
  useEffect(() => { loadPl() }, [loadPl])

  const allRows: Row[] = book?.rows ?? []
  // Only drinks that really have stock: anything at 0 or below is left out of the stock figures.
  const rows: Row[] = useMemo(() => allRows.filter(r => n(r.remaining) > 0), [allRows])
  const negNames = useMemo(() => new Set(allRows.filter(r => n(r.remaining) < 0).map(r => String(r.product))), [allRows])
  const cats = useMemo(() => ['All', ...Array.from(new Set(rows.map(r => String(r.category))))], [rows])
  const shown = useMemo(() => rows.filter(r =>
    (cat === 'All' || r.category === cat) && String(r.product).toLowerCase().includes(q.trim().toLowerCase())), [rows, cat, q])
  const t = book?.totals
  const stockCost = sum(rows, 'remaining_cost'), stockSell = sum(rows, 'remaining_sell'), stockUnits = sum(rows, 'remaining')

  // Drinks sold in the chosen dates, from the profit report's bar lines. Left out: nothing sold, and drinks whose stock is now negative.
  const soldRows: Row[] = useMemo(() => (pl?.bar_rows ?? [])
    .filter((r: Row) => n(r.qty_sold) > 0 && n(r.sales) > 0 && !negNames.has(String(r.product)))
    .map((r: Row) => ({ ...r, profit: r.cost == null ? null : n(r.sales) - n(r.cost) })), [pl, negNames])
  const soldSales = sum(soldRows, 'sales'), soldCost = sum(soldRows, 'cost'), soldProfit = soldSales - soldCost
  const soldExcluded = (pl?.bar_rows ?? []).filter((r: Row) => negNames.has(String(r.product)) && n(r.sales) > 0).map((r: Row) => String(r.product))

  const t0 = today()
  const presets: [string, string, string][] = [
    ['Today', t0, t0], ['This week', weekStart(t0), t0], ['Last 7 days', addDays(t0, -6), t0], ['This month', monthStart(t0), t0],
    ['Last month', monthStart(addDays(monthStart(t0), -1)), addDays(monthStart(t0), -1)]]

  const line = (label: string, v: number, o: { minus?: boolean; bold?: boolean; sub?: string; tone?: string } = {}) => (
    <div className={`flex items-baseline justify-between border-b border-slate-700 py-2 text-xl ${o.bold ? 'font-bold' : ''}`}>
      <span>{label}{o.sub && <span className="ml-2 text-base font-normal text-slate-400">{o.sub}</span>}</span>
      <span className={`tabular-nums ${o.tone ?? ''}`}>{o.minus ? (v !== 0 ? '− ' : '') + kes(Math.abs(v)) : kes(v)}</span>
    </div>)

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-4">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="mr-auto text-3xl font-bold">Bookkeeping</h2>
        <Btn kind="ghost" className="!h-12" onClick={() => { loadBook(); loadPl() }} disabled={loading}>{loading ? 'Loading…' : 'Refresh'}</Btn>
        <HomeBtn onClick={onDone} className="!h-12" />
      </div>
      {err && <div className="rounded-lg bg-red-700 p-3 text-lg font-semibold">{err}</div>}
      {!book && !err && <div className="text-xl text-slate-400">Loading…</div>}

      {book && t && (<>
        <div>
          <div className="mb-2 text-2xl font-bold">Key numbers <span className="text-base font-normal text-slate-400">drinks only; drinks at 0 or negative stock are left out</span></div>
          <div className="mb-2 text-lg font-semibold text-slate-300">Stock in the system now</div>
          <div className="flex flex-wrap gap-3">
            <Card label="Total cost of all drinks in the system" value={kes(stockCost)} sub={`${num(stockUnits)} units in ${rows.length} drinks, at cost`} />
            <Card label="Total sales value of drinks in the system" value={kes(stockSell)} sub="all of it sold at today's selling prices" />
            <Card label="Expected sales from this stock" value={kes(stockSell)} sub="what we expect to take in when it is sold" tone="good" />
            <Card label="Expected profit on this stock" value={kes(stockSell - stockCost)} sub="selling value − cost" tone={stockSell - stockCost < 0 ? 'bad' : 'good'} />
          </div>
          <div className="mb-2 mt-4 text-lg font-semibold text-slate-300">Drinks sold, {start} to {end}</div>
          {plErr && <div className="rounded-lg bg-red-700 p-3 text-lg font-semibold">{plErr}</div>}
          {!pl && !plErr && <div className="text-xl text-slate-400">Loading…</div>}
          {pl && <div className="flex flex-wrap gap-3">
            <Card label="Total sales of goods sold" value={kes(soldSales)} sub={`${soldRows.length} drinks, before discounts`} />
            <Card label="Total cost of goods sold" value={kes(soldCost)} sub="units sold × cost price" />
            <Card label="Profit realised" value={kes(soldProfit)} sub="sales − cost" tone={soldProfit < 0 ? 'bad' : 'good'} />
            <Card label="Sold + still expected" value={kes(soldSales + stockSell)} sub="sales in these dates + stock still to sell" />
          </div>}
          <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl bg-slate-800 p-3">
            <div className="mr-auto text-lg font-semibold">Choose the dates</div>
            {presets.map(([l, a, b]) => (
              <button key={l} onClick={() => { setStart(a); setEnd(b) }}
                className={`h-12 rounded-lg px-4 text-lg font-semibold ${start === a && end === b ? 'bg-amber-500 text-on-accent' : 'bg-slate-700'}`}>{l}</button>))}
            <span className="text-lg">From</span><input type="date" className={input} value={start} onChange={e => setStart(e.target.value)} />
            <span className="text-lg">to</span><input type="date" className={input} value={end} onChange={e => setEnd(e.target.value)} />
          </div>
          {soldExcluded.length > 0 && <div className="mt-2"><Warn><b>Left out of the sold figures (stock is negative)</b>: {soldExcluded.join(', ')}.</Warn></div>}
          {pl && <div className="mt-3 rounded-xl bg-slate-800 p-3"><Table title="Drinks sold in these dates" file={`bookkeeping-sold-${start}-${end}`} rows={soldRows} cols={SOLD_COLS}
            empty="No drinks sold in these dates."
            total={soldRows.length ? { product: `${soldRows.length} drinks`, qty_sold: sum(soldRows, 'qty_sold'), sales: soldSales, cost: soldCost, profit: soldProfit } : undefined} /></div>}
        </div>

        <div>
          <div className="mb-2 text-2xl font-bold">Stock position <span className="text-base font-normal text-slate-400">all time, as at {book.as_at}</span></div>
          <div className="flex flex-wrap gap-3">
            <Card label="Worth of all stock bought" value={kes(t.worth_bought)} sub={`${num(t.bought)} units, opening stock and deliveries, at cost`} />
            <Card label="Remaining stock" value={kes(stockCost)} sub={`${num(stockUnits)} units on hand, at cost`} />
            <Card label="Remaining at selling price" value={kes(stockSell)} sub="what it brings in if all sold at today's prices" />
            <Card label="Profit to expect on what is left" value={kes(sum(rows, 'profit_remaining'))} sub={`${pct(sum(rows, 'profit_remaining'), stockSell)} of its selling price`} tone={sum(rows, 'profit_remaining') < 0 ? 'bad' : 'good'} />
          </div>
          <div className="mt-3 flex flex-wrap gap-3">
            <Card label="Profit if all stock bought sells" value={kes(t.expected_total_profit)} sub="units bought × (price − cost)" tone={n(t.expected_total_profit) < 0 ? 'bad' : undefined} />
            <Card label="Estimated profit on stock sold" value={kes(t.profit_sold)} sub={`${num(t.sold)} units sold · exact figure in the period report below`} />
            <Card label="Lost, written off or other" value={kes(t.other_cost)} sub="wastage, breakage, free items, staff meals, count differences, at cost" tone={n(t.other_cost) > 0 ? 'warn' : undefined} />
          </div>
        </div>

        {book.flags.negative.length > 0 && <Warn><b>Negative stock</b> (more sold than received, so the book is wrong): {book.flags.negative.map((x: { product: string; qty: number }) => `${x.product} (${num(x.qty)})`).join(', ')}.</Warn>}
        {book.flags.no_cost.length > 0 && <Warn><b>No cost on record</b> for: {book.flags.no_cost.join(', ')}. They are counted as costing nothing, so worth and profit are wrong until a delivery or cost is recorded (Purchasing &gt; Upload delivery, or Products &amp; prices).</Warn>}
        {book.flags.no_price.length > 0 && <Warn><b>No selling price</b> for: {book.flags.no_price.join(', ')}. They add nothing to the selling-price and profit figures until a price is set in Products &amp; prices.</Warn>}
        {book.flags.mixed_unit.length > 0 && <Warn><b>Sold in a different unit from how it is stocked</b>: {book.flags.mixed_unit.join(', ')}. Their profit is left out because the price and cost are per different units.</Warn>}

        <div className="rounded-xl bg-slate-800 p-3">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            {cats.map(c => (
              <button key={c} onClick={() => setCat(c)} className={`h-11 rounded-full px-4 text-lg font-semibold ${cat === c ? 'bg-amber-500 text-on-accent' : 'bg-slate-700'}`}>{c}</button>))}
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search a drink" aria-label="Search a drink" className={`${input} ml-auto w-56`} />
          </div>
          <Table title={`Stock by drink${cat === 'All' ? '' : ' · ' + cat}`} file={`bookkeeping-stock-${book.as_at}`} rows={shown} cols={STOCK_COLS}
            empty="No drinks with stock."
            total={shown.length ? {
              category: 'Total', product: `${shown.length} drinks`, bought: sum(shown, 'bought'), sold: sum(shown, 'sold'), remaining: sum(shown, 'remaining'),
              other: sum(shown, 'other'), worth_bought: sum(shown, 'worth_bought'), remaining_cost: sum(shown, 'remaining_cost'),
              remaining_sell: sum(shown, 'remaining_sell'), profit_remaining: sum(shown, 'profit_remaining'), expected_total_profit: sum(shown, 'expected_total_profit'),
            } : undefined} />
          <div className="mt-2 text-base text-slate-400">Cost is the latest delivery price (else the cost in Products &amp; prices). Bought includes the opening stock you loaded. Left is the system's book quantity across store, bar, kitchen and waiters, not a physical count. Lost / other = bought − sold − left.</div>
        </div>
      </>)}

      <div className="flex flex-wrap items-center gap-2 rounded-xl bg-slate-800 p-3">
        <div className="mr-auto text-2xl font-bold">Profit and loss</div>
        {presets.map(([l, a, b]) => (
          <button key={l} onClick={() => { setStart(a); setEnd(b) }}
            className={`h-12 rounded-lg px-4 text-lg font-semibold ${start === a && end === b ? 'bg-amber-500 text-on-accent' : 'bg-slate-700'}`}>{l}</button>))}
        <span className="text-lg">From</span><input type="date" className={input} value={start} onChange={e => setStart(e.target.value)} />
        <span className="text-lg">to</span><input type="date" className={input} value={end} onChange={e => setEnd(e.target.value)} />
      </div>
      {plErr && <div className="rounded-lg bg-red-700 p-3 text-lg font-semibold">{plErr}</div>}
      {!pl && !plErr && <div className="text-xl text-slate-400">Loading…</div>}
      {pl && (() => {
        const s = pl.sales, c = pl.cost
        const gp = n(pl.gross_profit), net = n(s.net), res = n(pl.operating_result)
        return (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-3">
              <Card label="Net sales" value={kes(net)} />
              <Card label="Gross profit" value={kes(gp)} sub={`${pct(gp, net)} of net sales`} tone={gp < 0 ? 'bad' : undefined} />
              <Card label="Result for the period" value={kes(res)} sub="after losses and cash expenses" tone={res < 0 ? 'bad' : 'good'} />
            </div>
            {pl.flags.uncosted_products.length > 0 && <Warn><b>No cost on record</b> for: {pl.flags.uncosted_products.join(', ')}. Their cost is counted as zero in this period.</Warn>}
            <div className="rounded-xl bg-slate-800 p-4">
              {line('Sales (before adjustments)', n(s.gross))}
              {line('Adjustments (discounts, voids, free items)', n(s.adjustments), { minus: true })}
              {line('Net sales', net, { bold: true })}
              {line('Cost of bar sales', n(c.bar), { minus: true, sub: 'stock taken off the bar × cost' })}
              {line('Kitchen and choma stock used', n(c.food_used), { minus: true, sub: 'from stock counts' })}
              {line('Gross profit', gp, { bold: true, tone: gp < 0 ? 'text-red-400' : '' })}
              {line('Losses and giveaways', n(pl.losses_total), { minus: true, sub: 'wastage, breakage, free, staff meals, count differences' })}
              {line('Cash expenses', n(pl.expenses_total), { minus: true })}
              {line('Result for the period', res, { bold: true, tone: res < 0 ? 'text-red-400' : 'text-green-400' })}
              <div className="mt-2 text-base text-slate-400">The same figures as Owner reports &gt; Profit, so the two always agree. Payroll, rent and other items outside the till are not included.</div>
            </div>
          </div>)
      })()}
    </div>
  )
}
