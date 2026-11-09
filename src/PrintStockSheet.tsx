import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import { supabase, Profile } from './supabase'
import { Btn, HomeBtn } from './ui'
import PrinterControl from './PrinterControl'
import { printBytes } from './printer'
import { encodeStockSheet, stockSheetLines, StockSheetData } from './escpos'

// Manager: print the daily stock sheet on the 80mm printer. Pick the date and the categories; the sheet has one
// block per drink (name, price, blanks for Opening, Issued, Count) to fill in by hand. Optionally the Opening
// number is filled in from the system.

type Prod = { id: string; name: string; category: string | null; station: string; selling_price: number | null }
type Stock = { product_id: string; on_hand: number }

const ORDER = ['Beers', 'Brandy', 'Cigarettes', 'Cognac', 'Gin', 'Liquor', 'Martin', 'Others', 'Rum', 'Sambuca', 'Soft drinks', 'Tots', 'Vodka', 'Whiskey', 'Wine on glass', 'Wines']
const rank = (c: string) => { const i = ORDER.findIndex(o => o.toLowerCase() === c.toLowerCase()); return i < 0 ? 999 : i }
const today = () => new Date().toLocaleDateString('en-CA')
const label = (iso: string) => {
  const d = new Date(iso + 'T12:00:00')
  return `${d.toLocaleDateString('en-GB', { weekday: 'short' })} ${d.getDate()} ${d.toLocaleDateString('en-GB', { month: 'short' })} ${d.getFullYear()}`
}

export default function PrintStockSheet({ onDone }: { profile: Profile; onDone: () => void }) {
  const [prods, setProds] = useState<Prod[]>([])
  const [stock, setStock] = useState<Map<string, number>>(new Map())
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [date, setDate] = useState(today())
  const [withOpening, setWithOpening] = useState(false)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState('')

  const load = useCallback(async () => {
    const [p, s] = await Promise.all([supabase.rpc('list_products'), supabase.from('bar_stock').select('product_id, on_hand')])
    if (p.error) { setErr(p.error.message); setLoading(false); return }
    const rows = ((p.data ?? []) as Prod[]).filter(x => x.station === 'bar')
    setProds(rows)
    setPicked(new Set(rows.map(r => r.category ?? 'No category')))
    setStock(new Map(((s.data ?? []) as Stock[]).map(r => [r.product_id, Number(r.on_hand)])))
    setLoading(false)
  }, [])
  useEffect(() => { load() }, [load])

  const cats = useMemo(() => {
    const m = new Map<string, number>()
    for (const p of prods) { const c = p.category ?? 'No category'; m.set(c, (m.get(c) ?? 0) + 1) }
    return [...m.entries()].sort((a, b) => rank(a[0]) - rank(b[0]) || a[0].localeCompare(b[0]))
  }, [prods])

  const data: StockSheetData = useMemo(() => ({
    dateLabel: label(date),
    sections: cats.filter(([c]) => picked.has(c)).map(([c]) => ({
      category: c,
      items: prods.filter(p => (p.category ?? 'No category') === c).sort((a, b) => a.name.localeCompare(b.name))
        .map(p => ({ name: p.name, price: p.selling_price, opening: withOpening ? Math.max(0, stock.get(p.id) ?? 0) : null })),
    })),
  }), [cats, picked, prods, date, withOpening, stock])
  const count = data.sections.reduce((n, s) => n + s.items.length, 0)
  const lines = useMemo(() => stockSheetLines(data), [data])

  const toggle = (c: string) => setPicked(s => { const n = new Set(s); if (n.has(c)) n.delete(c); else n.add(c); return n })

  const print = async () => {
    setMsg('')
    if (await printBytes(encodeStockSheet(data))) { setMsg('Sent to the printer.'); return }
    window.print()
  }

  // A4: the print window shows only the A4 table (see index.css, html[data-print="a4"]).
  const printA4 = () => {
    setMsg('')
    const root = document.documentElement
    const page = document.createElement('style')                     // the printer pages are 80mm wide; this one print is A4
    page.textContent = '@page { size: A4; margin: 10mm }'
    document.head.appendChild(page)
    const done = () => { delete root.dataset.print; page.remove(); window.removeEventListener('afterprint', done) }
    root.dataset.print = 'a4'
    window.addEventListener('afterprint', done)
    window.print()
  }

  return (
    <div className="mx-auto max-w-4xl p-4 pb-16">
      <div className="mb-3 flex items-center gap-3">
        <h2 className="mr-auto text-3xl font-bold">Print stock sheet</h2>
        <HomeBtn onClick={onDone} className="!h-12" />
      </div>
      {err && <div className="mb-3 rounded-lg bg-red-700 p-3 text-lg font-semibold">{err}</div>}
      {loading ? <div className="text-slate-400">Loading drinks…</div> : (
        <div className="grid gap-4 md:grid-cols-[1fr_20rem]">
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-4">
              <label className="flex items-center gap-2 text-lg">Date
                <input type="date" value={date} onChange={e => setDate(e.target.value || today())} className="h-12 rounded-lg border border-slate-500 bg-slate-900 px-3 text-lg" /></label>
              <label className="flex items-center gap-2 text-lg">
                <input type="checkbox" className="h-6 w-6" checked={withOpening} onChange={e => setWithOpening(e.target.checked)} />
                Fill Opening stock from the system</label>
            </div>
            <div>
              <div className="mb-2 flex items-center gap-3">
                <h3 className="mr-auto text-xl font-bold">Categories to print</h3>
                <Btn kind="ghost" onClick={() => setPicked(new Set(cats.map(c => c[0])))} className="!h-10">All</Btn>
                <Btn kind="ghost" onClick={() => setPicked(new Set())} className="!h-10">None</Btn>
              </div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {cats.map(([c, n]) => (
                  <label key={c} className={`flex h-12 cursor-pointer items-center gap-3 rounded-lg px-3 text-lg ${picked.has(c) ? 'bg-amber-500 text-on-accent' : 'bg-slate-700'}`}>
                    <input type="checkbox" className="h-6 w-6" checked={picked.has(c)} onChange={() => toggle(c)} />
                    <span className="flex-1 truncate">{c}</span><span className="tabular-nums opacity-80">{n}</span>
                  </label>))}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Btn onClick={print} disabled={count === 0}>Print {count} drink{count === 1 ? '' : 's'} (80mm)</Btn>
              <Btn kind="ghost" onClick={printA4} disabled={count === 0}>Print on A4</Btn>
              {msg && <span className="text-green-400">{msg}</span>}
            </div>
            <PrinterControl />
          </div>
          <div>
            <h3 className="mb-2 text-xl font-bold">Preview (80mm)</h3>
            <div className="max-h-[70vh] overflow-y-auto rounded-lg border border-slate-600 bg-white p-2 text-black">
              <div id="receipt" className="mx-auto w-[72mm] min-w-[72mm] bg-white font-mono text-[10px] leading-tight text-black">
                {lines.map((l, i) => (
                  <pre key={i} className={`m-0 whitespace-pre font-mono ${l.k === 'title' ? 'text-center text-[12px] font-bold' : l.k === 'name' ? 'font-bold' : l.k === 'cat' ? 'bg-black font-bold text-white' : ''}`}>{l.t || ' '}</pre>))}
              </div>
            </div>
          </div>
        </div>)}

      {/* The A4 version of the sheet. Hidden on screen; only this is printed when "Print on A4" is pressed. */}
      <div id="a4sheet" className="hidden bg-white text-black">
        <h1 style={{ textAlign: 'center', fontSize: '18pt', fontWeight: 700, margin: 0 }}>THE GLIZZ LOUNGE — STOCK SHEET</h1>
        <div style={{ fontSize: '10pt', margin: '3mm 0' }}>Counted by: ______________________ &nbsp;&nbsp; Checked by: ______________________</div>
        <table>
          <thead><tr><th style={{ width: '38%', textAlign: 'left' }}>Product</th><th>Price (KES)</th><th>Opening stock</th><th>Issued from store</th><th>Stock take<br />{data.dateLabel}</th></tr></thead>
          <tbody>
            {data.sections.map(sec => (
              <Fragment key={sec.category}>
                <tr className="cat"><td colSpan={5}>{sec.category.toUpperCase()}</td></tr>
                {sec.items.map(it => (
                  <tr key={sec.category + it.name}>
                    <td style={{ textAlign: 'left' }}>{it.name}</td>
                    <td style={{ textAlign: 'right' }}>{it.price == null ? '' : it.price.toLocaleString('en-KE')}</td>
                    <td style={{ textAlign: 'center' }}>{it.opening == null ? '' : Math.round(it.opening * 1000) / 1000}</td><td></td><td></td>
                  </tr>))}
              </Fragment>))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
