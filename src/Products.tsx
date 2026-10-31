import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import { supabase, Profile } from './supabase'
import { Btn, HomeBtn } from './ui'
import { confirmDialog, toast } from './feedback'
import { kes } from './lib'

type Row = {
  id: string; sku: string; name: string; category: string | null; station: string; is_liquor: boolean
  base_unit: string; sale_unit: string | null; selling_price: number | null; purchase_cost: number | null
  reorder_level: number | null; available: boolean
}
type Edit = { sell: string; cost: string }
type Filter = 'all' | 'noprice' | 'hidden'
type Unit = { code: string; name: string }

const input = 'h-11 rounded-lg border border-slate-500 bg-slate-900 px-3 text-lg'
const STATIONS = [['bar', 'Bar'], ['kitchen', 'Kitchen'], ['choma', 'Choma'], ['none', 'No station (served at once)']]
const isMoney = (s: string) => /^\d{0,7}(\.\d{0,2})?$/.test(s)
const str = (n: number | null) => (n == null ? '' : String(n))
const num = (s: string) => (s.trim() === '' ? null : Number(s))

const blankNew = { name: '', category: '', station: 'bar', unit: 'bottle', liquor: false, price: '', cost: '', reorder: '' }

export default function Products({ onDone }: { profile: Profile; onDone: () => void }) {
  const [rows, setRows] = useState<Row[]>([])
  const [units, setUnits] = useState<Unit[]>([])
  const [edits, setEdits] = useState<Record<string, Edit>>({})
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [cat, setCat] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  const [adding, setAdding] = useState(false)
  const [nf, setNf] = useState(blankNew)
  const [editing, setEditing] = useState<{ id: string; name: string; category: string; reorder: string; available: boolean } | null>(null)

  const load = useCallback(async () => {
    const [p, u] = await Promise.all([supabase.rpc('list_products'), supabase.from('units').select('code, name').order('name')])
    if (p.error) setErr(p.error.message); else { setRows((p.data ?? []) as Row[]); setErr('') }
    if (u.data) setUnits(u.data as Unit[])
    setLoading(false)
  }, [])
  useEffect(() => { load() }, [load])

  const current = (r: Row): Edit => edits[r.id] ?? { sell: str(r.selling_price), cost: str(r.purchase_cost) }
  const setField = (r: Row, key: keyof Edit, value: string) => {
    if (!isMoney(value)) return
    const next = { ...current(r), [key]: value }
    setEdits(e => {
      const copy = { ...e }
      if (next.sell === str(r.selling_price) && next.cost === str(r.purchase_cost)) delete copy[r.id]
      else copy[r.id] = next
      return copy
    })
  }

  const dirty = Object.keys(edits).length
  const noPrice = rows.filter(r => r.selling_price == null).length
  const hidden = rows.filter(r => !r.available).length
  const categories = useMemo(() => [...new Set(rows.map(r => r.category).filter((c): c is string => !!c))].sort(), [rows])

  const shown = rows.filter(r => {
    const e = current(r)
    if (filter === 'noprice' && !(e.sell === '' || r.selling_price == null)) return false
    if (filter === 'hidden' && r.available) return false
    if (cat && r.category !== cat) return false
    const s = q.trim().toLowerCase()
    return !s || r.name.toLowerCase().includes(s) || r.sku.toLowerCase().includes(s) || (r.category ?? '').toLowerCase().includes(s)
  })

  const saveAll = async () => {
    if (saving || dirty === 0) return
    setSaving(true); setErr('')
    const payload = Object.entries(edits).map(([id, e]) => ({ id, selling_price: num(e.sell), purchase_cost: num(e.cost) }))
    const { data, error } = await supabase.rpc('set_product_prices', { p_rows: payload })
    if (error) { setErr(error.message); toast('Prices NOT saved', 'error') }
    else { toast(`Saved ${data} price change${data === 1 ? '' : 's'}`); setEdits({}); await load() }
    setSaving(false)
  }

  // Enter moves to the next selling-price box, so a whole list of prices can be typed in one go.
  const nextOnEnter = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return
    e.preventDefault()
    const boxes = Array.from(document.querySelectorAll<HTMLInputElement>('input[data-price]'))
    boxes[boxes.indexOf(e.currentTarget) + 1]?.focus()
  }

  const saveEdit = async () => {
    if (!editing || saving) return
    setSaving(true); setErr('')
    const { error } = await supabase.rpc('update_product', {
      p_id: editing.id, p_name: editing.name, p_category: editing.category,
      p_reorder: editing.reorder === '' ? 0 : Number(editing.reorder), p_available: editing.available })
    if (error) setErr(error.message)
    else { toast('Product updated'); setEditing(null); await load() }
    setSaving(false)
  }

  const toggleAvailable = async (r: Row) => {
    if (!r.available || await confirmDialog({
      title: `Hide ${r.name}?`,
      message: 'Waiters will no longer see it on the order screen. Stock and past sales are not affected. You can show it again any time.',
      confirmText: 'Hide' })) {
      const { error } = await supabase.rpc('update_product', {
        p_id: r.id, p_name: r.name, p_category: r.category ?? '', p_reorder: r.reorder_level ?? 0, p_available: !r.available })
      if (error) setErr(error.message); else { toast(r.available ? 'Hidden from waiters' : 'Visible to waiters'); await load() }
    }
  }

  const create = async () => {
    if (saving) return
    setSaving(true); setErr('')
    const { error } = await supabase.rpc('create_product', {
      p_name: nf.name, p_category: nf.category, p_station: nf.station, p_is_liquor: nf.liquor, p_unit: nf.unit,
      p_price: num(nf.price), p_cost: num(nf.cost), p_reorder: nf.reorder === '' ? 0 : Number(nf.reorder) })
    if (error) setErr(error.message)
    else { toast(`Added ${nf.name.trim()}${nf.price ? '' : ' (no price yet, so waiters cannot see it)'}`); setNf(blankNew); setAdding(false); await load() }
    setSaving(false)
  }

  if (loading) return <div className="p-6 text-xl text-slate-300">Loading products…</div>

  const chip = (label: string, on: boolean, click: () => void) => (
    <button onClick={click} className={`h-11 rounded-lg px-4 text-lg font-semibold ${on ? 'bg-amber-500 text-on-accent' : 'bg-slate-700'}`}>{label}</button>
  )

  return (
    <div className="mx-auto max-w-6xl p-4 pb-28">
      <div className="mb-3 flex items-center gap-3">
        <h2 className="mr-auto text-3xl font-bold">Products &amp; prices</h2>
        <HomeBtn onClick={onDone} className="!h-12" />
        <Btn kind={adding ? 'ghost' : 'primary'} className="!h-12" onClick={() => { setAdding(a => !a); setEditing(null); setErr('') }}>{adding ? 'Close' : '+ Add product'}</Btn>
      </div>
      <p className="mb-3 text-slate-300">Type prices straight into the boxes (press Enter to jump to the next one), then press <b>Save</b>.
        Waiters only see products that are priced and not hidden. Every change is recorded in the audit log.</p>
      {err && <div className="mb-3 rounded-lg bg-red-700 p-3 text-lg font-semibold">{err}</div>}

      {adding && (
        <div className="mb-4 grid gap-3 rounded-xl bg-slate-800 p-4 md:grid-cols-3">
          <input className={input + ' md:col-span-2'} placeholder="Product name (e.g. Tusker Lager 500ml)" value={nf.name} onChange={e => setNf({ ...nf, name: e.target.value })} />
          <input className={input} list="cat-list" placeholder="Category (pick or type a new one)" value={nf.category} onChange={e => setNf({ ...nf, category: e.target.value })} />
          <datalist id="cat-list">{categories.map(c => <option key={c} value={c} />)}</datalist>
          <select className={input} value={nf.station} onChange={e => setNf({ ...nf, station: e.target.value })}>{STATIONS.map(([c, n]) => <option key={c} value={c}>{n}</option>)}</select>
          <select className={input} value={nf.unit} onChange={e => setNf({ ...nf, unit: e.target.value })}>{units.map(u => <option key={u.code} value={u.code}>Sold by the {u.name.toLowerCase()}</option>)}</select>
          <label className="flex h-11 items-center gap-3 text-lg"><input type="checkbox" className="h-6 w-6" checked={nf.liquor} onChange={e => setNf({ ...nf, liquor: e.target.checked })} />Liquor (tracked in waiter custody)</label>
          <input className={input} inputMode="decimal" placeholder="Selling price (KES)" value={nf.price} onChange={e => isMoney(e.target.value) && setNf({ ...nf, price: e.target.value })} />
          <input className={input} inputMode="decimal" placeholder="Buying price (optional)" value={nf.cost} onChange={e => isMoney(e.target.value) && setNf({ ...nf, cost: e.target.value })} />
          <input className={input} inputMode="decimal" placeholder="Reorder level (optional)" value={nf.reorder} onChange={e => isMoney(e.target.value) && setNf({ ...nf, reorder: e.target.value })} />
          <div className="md:col-span-3 flex items-center gap-3">
            <Btn className="!h-12" onClick={create} disabled={saving || !nf.name.trim()}>Add product</Btn>
            <span className="text-sm text-slate-400">The station, unit and liquor setting cannot be changed later. Add opening stock afterwards in Bar stock.</span>
          </div>
        </div>
      )}

      {editing && (
        <div className="mb-4 grid gap-3 rounded-xl bg-slate-800 p-4 md:grid-cols-4">
          <input className={input + ' md:col-span-2'} value={editing.name} onChange={e => setEditing({ ...editing, name: e.target.value })} />
          <input className={input} list="cat-list" placeholder="Category" value={editing.category} onChange={e => setEditing({ ...editing, category: e.target.value })} />
          <datalist id="cat-list">{categories.map(c => <option key={c} value={c} />)}</datalist>
          <input className={input} inputMode="decimal" placeholder="Reorder level" value={editing.reorder} onChange={e => isMoney(e.target.value) && setEditing({ ...editing, reorder: e.target.value })} />
          <label className="flex h-11 items-center gap-3 text-lg md:col-span-2"><input type="checkbox" className="h-6 w-6" checked={editing.available} onChange={e => setEditing({ ...editing, available: e.target.checked })} />Show to waiters</label>
          <div className="flex gap-3 md:col-span-2"><Btn className="!h-12" onClick={saveEdit} disabled={saving || !editing.name.trim()}>Save changes</Btn><Btn kind="ghost" className="!h-12" onClick={() => setEditing(null)}>Cancel</Btn></div>
        </div>
      )}

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input className={input + ' w-72'} placeholder="Search name, code or category" value={q} onChange={e => setQ(e.target.value)} />
        {chip(`All (${rows.length})`, filter === 'all', () => setFilter('all'))}
        {chip(`Needs a price (${noPrice})`, filter === 'noprice', () => setFilter('noprice'))}
        {chip(`Hidden (${hidden})`, filter === 'hidden', () => setFilter('hidden'))}
        <select className={input} value={cat} onChange={e => setCat(e.target.value)}>
          <option value="">All categories</option>{categories.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>

      <div className="overflow-x-auto rounded-xl ring-1 ring-slate-700">
        <table className="w-full text-left text-lg">
          <thead className="bg-slate-800 text-sm uppercase tracking-wide text-slate-400">
            <tr><th className="p-3">Product</th><th>Sold by</th><th className="w-36">Buying price</th><th className="w-36">Selling price</th><th className="w-20">Margin</th><th>Status</th><th></th></tr>
          </thead>
          <tbody>
            {shown.length === 0 && <tr><td colSpan={7} className="p-6 text-center text-slate-400">No products match.</td></tr>}
            {shown.map((r, i) => {
              const e = current(r)
              const sell = num(e.sell), cost = num(e.cost)
              const margin = sell && cost != null && sell > 0 ? Math.round(((sell - cost) / sell) * 100) : null
              const changed = !!edits[r.id]
              return (
                <Fragment key={r.id}>
                  {(i === 0 || shown[i - 1].category !== r.category) && (
                    <tr key={'h' + r.id} className="bg-slate-900"><td colSpan={7} className="px-3 py-1 text-sm font-semibold uppercase tracking-wider text-amber-400">{r.category ?? 'No category'}</td></tr>
                  )}
                  <tr key={r.id} className={`border-t border-slate-700 ${changed ? 'bg-amber-500/10' : ''} ${r.available ? '' : 'opacity-60'}`}>
                    <td className="p-3"><div className="font-semibold">{r.name}</div><div className="text-xs text-slate-500">{r.sku}</div></td>
                    <td className="text-slate-300">{r.sale_unit ?? r.base_unit}</td>
                    <td><input className={input + ' w-32'} inputMode="decimal" placeholder="KES" value={e.cost} onChange={ev => setField(r, 'cost', ev.target.value)} aria-label={`Buying price of ${r.name}`} /></td>
                    <td><input data-price className={input + ' w-32 font-bold'} inputMode="decimal" placeholder="KES" value={e.sell} onKeyDown={nextOnEnter}
                               onChange={ev => setField(r, 'sell', ev.target.value)} aria-label={`Selling price of ${r.name}`} /></td>
                    <td className={margin != null && margin < 0 ? 'font-semibold text-red-400' : 'text-slate-300'}>{margin == null ? '–' : margin + '%'}</td>
                    <td className="text-sm">
                      {!r.available ? <span className="rounded bg-slate-600 px-2 py-1">Hidden</span>
                        : r.selling_price == null ? <span className="rounded bg-amber-600 px-2 py-1 text-on-accent">No price yet</span>
                        : <span className="text-green-400">{kes(r.selling_price)} live</span>}
                    </td>
                    <td className="whitespace-nowrap py-1 pr-2 text-right">
                      <button className="mr-2 h-11 rounded-lg bg-slate-700 px-3" onClick={() => { setAdding(false); setEditing({ id: r.id, name: r.name, category: r.category ?? '', reorder: str(r.reorder_level), available: r.available }) }}>Edit</button>
                      <button className="h-11 rounded-lg bg-slate-700 px-3" onClick={() => toggleAvailable(r)}>{r.available ? 'Hide' : 'Show'}</button>
                    </td>
                  </tr>
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>

      {dirty > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-20 flex items-center justify-center gap-4 border-t border-slate-600 bg-slate-900 p-3 shadow-lg">
          <span className="text-lg font-semibold">{dirty} unsaved change{dirty === 1 ? '' : 's'}</span>
          <Btn className="!h-12" onClick={saveAll} disabled={saving}>{saving ? 'Saving…' : `Save ${dirty} change${dirty === 1 ? '' : 's'}`}</Btn>
          <Btn kind="ghost" className="!h-12" onClick={() => setEdits({})} disabled={saving}>Discard</Btn>
        </div>
      )}
    </div>
  )
}
