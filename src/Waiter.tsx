import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase, TERMINAL_CODE, Profile, can } from './supabase'
import { AlphaKeys, Btn, HomeBtn } from './ui'
import { Icon } from './icons'
import { confirmDialog, toast } from './feedback'
import { CartLine, Draft, LOCK_AFTER_SEND, QUICK_NOTES, bumpFreq, clearDraft, isNetworkError, kes, listNotSent, loadDraft, loadFreq, saveDraft, uid } from './lib'
import { STATION_LABEL, Sale, Station, printSale, stationOf } from './sale'
import SaleDone from './SaleDone'

type Table = { id: string; number: string; label: string | null }
type Product = { id: string; name: string; selling_price: number; station: string; category: { name: string } | null }
// Who the sale is for. A table, or a name (takeaway / bar sale). Tables are only a label now: nothing stays "open".
type Target = { table: Table | null; customer: string | null; label: string; draftKey: string }

export default function Waiter({ profile, onDone, onLock }: { profile: Profile; onDone: () => void; onLock: () => void }) {
  const [tables, setTables] = useState<Table[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [target, setTarget] = useState<Target | null>(null)
  const [sale, setSale] = useState<Sale | null>(null)
  const [naming, setNaming] = useState(false)
  const [name, setName] = useState('')

  const load = useCallback(async () => {
    const [t, p] = await Promise.all([
      supabase.from('floor_tables').select('id, number, label'),
      supabase.from('products').select('id, name, selling_price, station, category:categories(name)')
        .eq('available', true).not('selling_price', 'is', null).order('name'),
    ])
    if (t.data) setTables((t.data as Table[]).sort((a, b) => Number(a.number) - Number(b.number)))
    if (p.data) setProducts(p.data as unknown as Product[])
  }, [])
  useEffect(() => { load() }, [load])

  // Retry any NOT SENT orders for this person with their original key (a retry can never make a second sale).
  const flushing = useRef(false)
  const flush = useCallback(async () => {
    if (flushing.current) return
    flushing.current = true
    for (const u of listNotSent(profile.id)) {
      const { data, error } = await supabase.rpc('submit_sale', {
        p_table: u.draft.table ?? null, p_customer: u.draft.customer ?? null,
        p_items: u.draft.lines.map(l => ({ product_id: l.product_id, qty: l.qty, ...(l.notes ? { notes: l.notes } : {}) })),
        p_terminal: TERMINAL_CODE, p_key: u.draft.key })
      if (!error) {
        clearDraft(profile.id, u.tab)
        const s = data as Sale
        const r = await printSale(s)
        toast(r.ok ? `Order #${s.order_no} sent and printed.` : `Order #${s.order_no} sent. Print it from My orders.`, r.ok ? 'ok' : 'info')
      } else if (!isNetworkError(error)) saveDraft(profile.id, u.tab, { ...u.draft, state: 'editing' })  // server refused: let the person fix it
    }
    flushing.current = false
  }, [profile.id])
  useEffect(() => {
    flush()
    const t = setInterval(flush, 8000)
    window.addEventListener('online', flush)
    return () => { clearInterval(t); window.removeEventListener('online', flush) }
  }, [flush])

  if (sale) {
    return <SaleDone sale={sale} onDone={() => { setSale(null); setTarget(null); if (LOCK_AFTER_SEND) onLock(); else onDone() }} />
  }
  if (target) {
    return <OrderScreen profile={profile} target={target} products={products}
      onBack={() => setTarget(null)} onSent={s => setSale(s)} onSavedOffline={() => { setTarget(null); LOCK_AFTER_SEND ? onLock() : onDone() }} />
  }

  if (naming) {
    const go = () => { const n = name.trim(); if (n) { setTarget({ table: null, customer: n, label: n, draftKey: 'named' }); setNaming(false); setName('') } }
    return (
      <div className="flex flex-col items-center gap-4 p-6">
        <h2 className="text-3xl font-bold">Takeaway / named sale</h2>
        <div className="h-btn w-[min(40rem,100%)] rounded-xl border-2 border-amber-500 bg-slate-800 px-4 text-3xl leading-[var(--btn-h)]">
          {name || <span className="text-xl text-slate-500">Customer name</span>}
        </div>
        <AlphaKeys withSpace onKey={k => setName(n => (n + k).slice(0, 30))}
          onBack={() => setName(n => n.slice(0, -1))} onClear={() => setName('')} />
        <div className="flex gap-3">
          <Btn kind="ghost" onClick={() => { setNaming(false); setName('') }}>Cancel</Btn>
          <Btn onClick={go} disabled={!name.trim()}>Start order</Btn>
        </div>
      </div>
    )
  }

  return (
    <div className="p-4">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <h2 className="mr-auto text-3xl font-bold">Which table?</h2>
        <HomeBtn onClick={onDone} />
        {can(profile, 'bar.direct_sale') && <Btn kind="ghost" onClick={() => setTarget({ table: null, customer: 'Bar sale', label: 'Bar sale', draftKey: 'bar' })}>Bar sale</Btn>}
        <Btn onClick={() => setNaming(true)}>+ Takeaway / named</Btn>
      </div>
      <div className="grid-tables">
        {tables.map(t => (
          <button key={t.id} onClick={() => setTarget({ table: t, customer: null, label: `Table ${t.number}`, draftKey: t.id })}
            className="flex h-full flex-col justify-between rounded-xl border-2 border-green-400/60 bg-slate-800 p-3 text-left active:opacity-80">
            <div className="text-2xl font-bold leading-tight">Table {t.number}</div>
          </button>
        ))}
      </div>
    </div>
  )
}

function OrderScreen({ profile, target, products, onBack, onSent, onSavedOffline }:
  { profile: Profile; target: Target; products: Product[]; onBack: () => void; onSent: (s: Sale) => void; onSavedOffline: () => void }) {
  const initial = useMemo(() => loadDraft(profile.id, target.draftKey), [profile.id, target.draftKey])
  const [lines, setLines] = useState<CartLine[]>(initial?.lines ?? [])
  const [state, setState] = useState<Draft['state']>(initial?.state ?? 'editing')
  const key = useRef(initial?.key ?? uid())
  const MINE = '★ Mine'
  const freq = useMemo(() => loadFreq(profile.id), [profile.id])      // this waiter's most-used products, counted on this device
  const topIds = useMemo(() => Object.entries(freq).sort((a, b) => b[1] - a[1]).map(e => e[0])
    .filter(id => products.some(p => p.id === id)).slice(0, 12), [freq, products])
  const [cat, setCat] = useState(topIds.length >= 4 ? MINE : 'All')
  const [q, setQ] = useState('')
  const [noteFor, setNoteFor] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const [err, setErr] = useState('')
  const [saved, setSaved] = useState(false)
  const [cartOpen, setCartOpen] = useState(false)      // phones: the order is a full-screen sheet opened from the bottom bar

  const cats = useMemo(() => [...(topIds.length >= 4 ? [MINE] : []), 'All', ...Array.from(new Set(products.map(p => p.category?.name ?? 'Other')))], [products, topIds])
  const query = q.trim().toLowerCase()
  const shown = query ? products.filter(p => p.name.toLowerCase().includes(query))
    : cat === MINE ? topIds.map(id => products.find(p => p.id === id)!)
    : products.filter(p => cat === 'All' || (p.category?.name ?? 'Other') === cat)
  const inCart = new Map(lines.map(l => [l.product_id, l.qty]))
  const count = lines.reduce((s, l) => s + l.qty, 0)
  const total = lines.reduce((s, l) => s + l.price * l.qty, 0)
  // Which captain orders this order will print
  const slipCount = new Map<Station, number>()
  for (const l of lines) {
    const st = stationOf(products.find(p => p.id === l.product_id)?.station ?? 'none')
    slipCount.set(st, (slipCount.get(st) ?? 0) + l.qty)
  }

  const persist = (next: CartLine[], st: Draft['state'] = state) => {
    setLines(next)
    if (next.length === 0) clearDraft(profile.id, target.draftKey)
    else saveDraft(profile.id, target.draftKey, { key: key.current, lines: next, state: st, table: target.table?.id ?? null, customer: target.customer })
  }
  const add = (p: Product) => {
    if (state === 'not_sent') return
    const i = lines.findIndex(l => l.product_id === p.id)
    persist(i >= 0 ? lines.map((l, j) => j === i ? { ...l, qty: l.qty + 1 } : l)
                   : [...lines, { product_id: p.id, name: p.name, price: Number(p.selling_price), qty: 1 }])
    bumpFreq(profile.id, p.id)
  }
  const setNote = (id: string, notes: string) => {
    persist(lines.map(l => l.product_id === id ? { ...l, notes: notes || undefined } : l)); setNoteFor(null)
  }
  const clearOrder = async () => {
    if (await confirmDialog({ title: 'Clear this order?', message: 'All items not yet sent will be removed.', confirmText: 'Clear order', danger: true })) persist([])
  }
  const step = (id: string, d: number) => {
    if (state === 'not_sent') return
    persist(lines.map(l => l.product_id === id ? { ...l, qty: l.qty + d } : l).filter(l => l.qty > 0))
  }

  const send = async () => {
    if (sending || lines.length === 0) return          // in-flight lock: double taps do nothing
    setSending(true); setErr('')
    const { data, error } = await supabase.rpc('submit_sale', {
      p_table: target.table?.id ?? null, p_customer: target.customer,
      p_items: lines.map(l => ({ product_id: l.product_id, qty: l.qty, ...(l.notes ? { notes: l.notes } : {}) })),
      p_terminal: TERMINAL_CODE, p_key: key.current })
    if (error) {
      if (isNetworkError(error)) {
        saveDraft(profile.id, target.draftKey, { key: key.current, lines, state: 'not_sent', table: target.table?.id ?? null, customer: target.customer })
        setState('not_sent'); setSaved(true)
      } else setErr(error.message)
      setSending(false); return
    }
    clearDraft(profile.id, target.draftKey)
    onSent(data as Sale)
  }

  if (saved) {
    return (
      <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-6 bg-red-800 text-center">
        <div className="text-6xl font-bold">NOT SENT</div>
        <div className="max-w-2xl text-2xl">No connection. The order is saved on this screen and will send and print by itself when the network is back. Do not re-enter it.</div>
        <Btn onClick={onSavedOffline}>OK</Btn>
      </div>
    )
  }

  const btn = 'h-[3.75rem] w-full rounded-xl px-3 text-left text-xl font-semibold'
  const noteLine = lines.find(l => l.product_id === noteFor)
  return (
    <div className="order-layout fill-screen max-md:flex max-md:flex-col max-md:gap-2 max-md:p-2">
      <div className="flex flex-col gap-2 overflow-y-auto max-md:shrink-0 max-md:flex-row max-md:overflow-x-auto max-md:overflow-y-hidden max-md:pb-1">
        <Btn kind="ghost" onClick={onBack} className="!h-[3.75rem] max-md:!h-11 max-md:shrink-0 max-md:whitespace-nowrap max-md:!px-4 max-md:!text-base">← Tables</Btn>
        {cats.map(c => (
          <button key={c} onClick={() => { setCat(c); setQ('') }}
            className={`${btn} max-md:!h-11 max-md:!w-auto max-md:shrink-0 max-md:whitespace-nowrap max-md:!px-4 max-md:!text-base ${cat === c && !query ? 'bg-amber-500 text-on-accent' : 'bg-slate-700'}`}>{c}</button>
        ))}
      </div>

      <div className="flex min-h-0 flex-col gap-3 max-md:flex-1 max-md:gap-2">
        <div className="relative">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"><Icon name="search" className="h-6 w-6" /></span>
          <input type="search" value={q} onChange={e => setQ(e.target.value)} placeholder="Search products" aria-label="Search products"
            autoComplete="off" className="h-[3.25rem] w-full rounded-xl border-2 border-slate-600 bg-slate-800 pl-11 pr-14 text-xl" />
          {q && <button onClick={() => setQ('')} aria-label="Clear search"
            className="absolute right-1 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-lg bg-slate-700"><Icon name="close" className="h-5 w-5" /></button>}
        </div>
        <div className="grid-products min-h-0 flex-1 overflow-y-auto">
          {shown.length === 0 && <div className="col-span-full pt-8 text-center text-xl text-slate-400">{query ? `No products match "${q.trim()}"` : 'No products here yet'}</div>}
          {shown.map(p => {
            const n = inCart.get(p.id) ?? 0
            return (
              <button key={p.id} onClick={() => add(p)}
                className={`relative rounded-xl bg-slate-700 p-2 text-left transition-transform active:scale-[0.97] active:bg-slate-500 ${n ? 'ring-2 ring-amber-500' : ''}`}>
                <div className="line-clamp-2 pr-6 text-lg font-semibold leading-tight">{p.name}</div>
                <div className="text-amber-400">{kes(p.selling_price)}</div>
                {n > 0 && <span className="absolute right-1.5 top-1.5 flex h-7 min-w-[1.75rem] items-center justify-center rounded-full bg-amber-500 px-1.5 text-sm font-bold text-on-accent">{n}</span>}
              </button>
            )
          })}
        </div>
      </div>

      <button onClick={() => setCartOpen(true)} aria-label="View the order"
        className={`flex h-16 shrink-0 items-center justify-between gap-3 rounded-xl px-4 text-left md:hidden ${count > 0 ? 'bg-amber-500 text-on-accent' : 'bg-slate-700 text-slate-300'}`}>
        <span className="text-lg font-semibold">{count > 0 ? `View order · ${count} item${count === 1 ? '' : 's'}` : 'No items yet'}</span>
        <span className="text-2xl font-bold">{kes(total)}</span>
      </button>

      <div className={`flex min-h-0 flex-col gap-2 overflow-hidden rounded-xl bg-slate-800 p-3 max-md:fixed max-md:inset-0 max-md:z-50 max-md:rounded-none ${cartOpen ? '' : 'max-md:hidden'}`}>
        <button onClick={() => setCartOpen(false)} className="h-12 shrink-0 rounded-lg bg-slate-700 text-lg font-semibold md:hidden">← Back to products</button>
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1 truncate text-2xl font-bold">{target.label}</div>
          {lines.length > 0 && state !== 'not_sent' &&
            <button onClick={clearOrder} className="h-10 shrink-0 rounded-lg bg-slate-700 px-3 text-base font-semibold">Clear</button>}
        </div>
        {state === 'not_sent' && <div className="rounded bg-red-700 p-2 font-semibold">NOT SENT – waiting to retry</div>}
        <div className="flex-1 space-y-2 overflow-y-auto">
          <div className="flex items-center justify-between text-sm font-semibold uppercase tracking-wider text-slate-400">
            <span>Order</span><span>{count} item{count === 1 ? '' : 's'}</span>
          </div>
          {lines.length === 0 && <div className="rounded-lg border-2 border-dashed border-slate-600 p-4 text-center text-lg text-slate-400">Tap a product to add it</div>}
          {lines.map(l => (
            <div key={l.product_id} className="rounded-xl bg-slate-900/50 p-2">
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1 text-lg font-semibold leading-tight">{l.name}</div>
                <div className="shrink-0 text-lg font-semibold">{kes(l.price * l.qty)}</div>
              </div>
              <div className="text-sm text-slate-400">{kes(l.price)} each</div>
              {l.notes && <div className="mt-1 rounded bg-amber-950 px-2 py-1 text-base text-amber-300">{l.notes}</div>}
              <div className="mt-2 flex items-center gap-1.5">
                <button aria-label={`Less ${l.name}`} className="h-12 w-12 rounded-lg bg-slate-600 text-3xl" onClick={() => step(l.product_id, -1)}>−</button>
                <span className="w-8 text-center text-2xl font-bold">{l.qty}</span>
                <button aria-label={`More ${l.name}`} className="h-12 w-12 rounded-lg bg-slate-600 text-3xl" onClick={() => step(l.product_id, 1)}>+</button>
                <span className="flex-1" />
                <button aria-label={`Add note to ${l.name}`} className={`flex h-12 w-12 items-center justify-center rounded-lg ${l.notes ? 'bg-amber-500 text-on-accent' : 'bg-slate-600'}`} onClick={() => setNoteFor(l.product_id)}><Icon name="note" className="h-6 w-6" /></button>
                <button aria-label={`Remove ${l.name}`} className="flex h-12 w-12 items-center justify-center rounded-lg bg-slate-600" onClick={() => step(l.product_id, -l.qty)}><Icon name="trash" className="h-6 w-6" /></button>
              </div>
            </div>
          ))}
        </div>
        {err && <div className="rounded bg-red-700 p-2 font-semibold">{err}</div>}
        {slipCount.size > 0 && (
          <div className="text-base text-slate-300">Prints: customer receipt + {Array.from(slipCount.keys()).map(s => STATION_LABEL[s]).join(' + ')} captain order{slipCount.size > 1 ? 's' : ''}</div>
        )}
        <div className="flex items-baseline justify-between border-t border-slate-600 pt-2">
          <span className="text-lg text-slate-400">Total</span>
          <span className="text-4xl font-bold">{kes(total)}</span>
        </div>
        <Btn onClick={send} disabled={sending || lines.length === 0}>
          {sending ? 'Sending…' : state === 'not_sent' ? 'Retry send' : 'SEND & PRINT'}
        </Btn>
      </div>
      {noteLine && <NoteSheet name={noteLine.name} initial={noteLine.notes ?? ''} onSave={t => setNote(noteLine.product_id, t)} onClose={() => setNoteFor(null)} />}
    </div>
  )
}

// One-tap quick notes (No ice, Well done ...) plus a free-text box that uses the on-screen keyboard.
function NoteSheet({ name, initial, onSave, onClose }: { name: string; initial: string; onSave: (t: string) => void; onClose: () => void }) {
  const [text, setText] = useState(initial)
  const parts = text.split(',').map(s => s.trim()).filter(Boolean)
  const toggle = (n: string) => setText((parts.includes(n) ? parts.filter(p => p !== n) : [...parts, n]).join(', '))
  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center bg-black/60 p-4 pt-6" role="dialog" aria-modal="true" aria-label="Item note">
      <div className="flex w-[min(40rem,96vw)] flex-col gap-3 rounded-2xl bg-slate-800 p-5">
        <h2 className="text-2xl font-bold">Note for {name}</h2>
        <div className="flex flex-wrap gap-2">
          {QUICK_NOTES.map(n => (
            <button key={n} onClick={() => toggle(n)}
              className={`h-12 rounded-full px-4 text-lg font-semibold ${parts.includes(n) ? 'bg-amber-500 text-on-accent' : 'bg-slate-700'}`}>{n}</button>
          ))}
        </div>
        <input value={text} maxLength={80} onChange={e => setText(e.target.value)} placeholder="Or type a note" aria-label="Note"
          className="h-[3.25rem] rounded-xl border-2 border-slate-600 bg-slate-900 px-3 text-xl" />
        <div className="flex gap-3">
          <Btn kind="ghost" className="flex-1" onClick={onClose}>Cancel</Btn>
          <Btn className="flex-1" onClick={() => onSave(text.trim())}>Save note</Btn>
        </div>
      </div>
    </div>
  )
}
