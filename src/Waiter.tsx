import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase, TERMINAL_CODE, Profile, can } from './supabase'
import { AlphaKeys, Btn, HomeBtn } from './ui'
import { Icon } from './icons'
import { confirmDialog } from './feedback'
import { CartLine, Draft, LOCK_AFTER_SEND, QUICK_NOTES, bumpFreq, clearDraft, isNetworkError, kes, listNotSent, loadDraft, loadFreq, saveDraft, uid } from './lib'
import TabHub from './TabHub'
import Pay from './Pay'

type Table = { id: string; number: string; label: string | null }
type Card = {
  tab_id: string; table_number: string | null; customer_name: string | null; waiter_id: string
  waiter_name: string; status: string; bill_total: number; paid: number; balance: number; pending_total: number
}
type Product = { id: string; name: string; selling_price: number; station: string; category: { name: string } | null }
type ActiveTab = { id: string; label: string }
type TabItem = { item_id: string; product_name: string; qty: number; status: string }

const STATUS_TEXT: Record<string, string> = {
  new: 'Sent', accepted: 'Accepted', preparing: 'Preparing', ready: 'READY – collect', served: 'Served',
}

export default function Waiter({ profile, onDone, onLock }: { profile: Profile; onDone: () => void; onLock: () => void }) {
  const [tables, setTables] = useState<Table[]>([])
  const [cards, setCards] = useState<Card[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [active, setActive] = useState<ActiveTab | null>(null)
  const [screen, setScreen] = useState<'order' | 'hub' | 'pay'>('order')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [taken, setTaken] = useState<{ table_number: string | number; tab_id: string | null; waiter_id: string | null; waiter_name: string | null }[]>([])
  const [naming, setNaming] = useState(false)
  const [name, setName] = useState('')

  const load = useCallback(async () => {
    const [t, c, p, ts] = await Promise.all([
      supabase.from('floor_tables').select('id, number, label'),
      supabase.from('tab_cards').select('*'),
      supabase.from('products').select('id, name, selling_price, station, category:categories(name)')
        .eq('available', true).not('selling_price', 'is', null).order('name'),
      supabase.from('table_status').select('table_number, tab_id, waiter_id, waiter_name'),
    ])
    if (ts.data) setTaken(ts.data as { table_number: string | number; tab_id: string | null; waiter_id: string | null; waiter_name: string | null }[])
    if (t.data) setTables((t.data as Table[]).sort((a, b) => Number(a.number) - Number(b.number)))
    if (c.data) setCards(c.data as Card[])
    if (p.data) setProducts(p.data as unknown as Product[])
  }, [])

  useEffect(() => {
    load()
    const ch = supabase.channel('waiter-' + uid())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tabs' }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'order_items' }, load)
      .subscribe()
    const poll = setInterval(load, 15000)
    return () => { supabase.removeChannel(ch); clearInterval(poll) }
  }, [load])

  // Retry any NOT SENT orders for this person with their original idempotency key.
  const flushing = useRef(false)
  const flush = useCallback(async () => {
    if (flushing.current) return
    flushing.current = true
    for (const u of listNotSent(profile.id)) {
      const { error } = await supabase.rpc('submit_order', {
        p_tab: u.tab, p_items: u.draft.lines.map(l => ({ product_id: l.product_id, qty: l.qty, ...(l.notes ? { notes: l.notes } : {}) })),
        p_terminal: TERMINAL_CODE, p_key: u.draft.key })
      if (!error) clearDraft(profile.id, u.tab)
      else if (!isNetworkError(error)) saveDraft(profile.id, u.tab, { ...u.draft, state: 'editing' })  // server refused: let the person fix it
    }
    flushing.current = false
    load()
  }, [profile.id, load])
  useEffect(() => {
    flush()
    const t = setInterval(flush, 8000)
    window.addEventListener('online', flush)
    return () => { clearInterval(t); window.removeEventListener('online', flush) }
  }, [flush])

  const openTable = async (t: Table) => {
    if (busy) return
    setErr('')
    const card = cards.find(c => c.table_number === t.number)
    const other = taken.find(x => x.table_number === t.number && x.tab_id && x.waiter_id !== profile.id)
    if (other && !card) { setErr(`Table ${t.number} is being served by ${other.waiter_name ?? 'another waiter'}.`); return }
    if (card) { setScreen('hub'); setActive({ id: card.tab_id, label: `Table ${t.number}` }); return }
    setBusy(true)
    const { data, error } = await supabase.rpc('open_tab', { p_table: t.id, p_customer: null, p_key: uid() })
    setBusy(false)
    if (error) { setErr(error.message); return }
    setScreen('order')
    setActive({ id: (data as { id: string }).id, label: `Table ${t.number}` })
    load()
  }
  const openNamed = async () => {
    if (busy || !name.trim()) return
    setBusy(true); setErr('')
    const { data, error } = await supabase.rpc('open_tab', { p_table: null, p_customer: name.trim(), p_key: uid() })
    setBusy(false)
    if (error) { setErr(error.message); return }
    setScreen('order')
    setActive({ id: (data as { id: string }).id, label: name.trim() })
    setNaming(false); setName(''); load()
  }

  if (active && screen === 'hub') {
    return <TabHub profile={profile} tab={active} onOrder={() => setScreen('order')} onPay={() => setScreen('pay')}
      onBack={() => { setActive(null); load() }} />
  }
  if (active && screen === 'pay') {
    return <Pay profile={profile} tab={active} onBack={() => setScreen('hub')}
      onDone={() => { setActive(null); load() }} />
  }
  if (active) {
    return <OrderScreen profile={profile} tab={active} products={products}
      onBack={() => { setScreen('hub'); load() }} onSent={() => {
        if (can(profile, 'station.bar')) { setScreen('hub'); load(); return }   // bartender: stay on the tab to serve, pay, close
        setActive(null); load(); LOCK_AFTER_SEND ? onLock() : onDone() }} />
  }

  if (naming) {
    return (
      <div className="flex flex-col items-center gap-4 p-6">
        <h2 className="text-3xl font-bold">Takeaway / named tab</h2>
        <div className="h-btn w-[min(40rem,100%)] rounded-xl border-2 border-amber-500 bg-slate-800 px-4 text-3xl leading-[var(--btn-h)]">
          {name || <span className="text-xl text-slate-500">Customer name</span>}
        </div>
        <AlphaKeys withSpace onKey={k => setName(n => (n + k).slice(0, 30))}
          onBack={() => setName(n => n.slice(0, -1))} onClear={() => setName('')} />
        {err && <div className="rounded-lg bg-red-700 p-3 text-lg font-semibold">{err}</div>}
        <div className="flex gap-3">
          <Btn kind="ghost" onClick={() => { setNaming(false); setName('') }}>Cancel</Btn>
          <Btn onClick={openNamed} disabled={busy || !name.trim()}>Open tab</Btn>
        </div>
      </div>
    )
  }

  const named = cards.filter(c => !c.table_number)
  const BILL: Record<string, string> = { bill_requested: 'BILL', partially_paid: 'PART PAID' }
  const tabTile = (c: Card, title: string, key: string, onClick: () => void) => {
    const mine = c.waiter_id === profile.id
    return (
      <button key={key} onClick={onClick}
        className={`flex h-full flex-col justify-between rounded-xl p-3 text-left active:opacity-80 ${mine ? 'bg-amber-600 text-on-accent' : 'bg-slate-600'}`}>
        <span className="line-clamp-2 break-words text-2xl font-bold leading-tight">{title}</span>
        <div className="flex min-w-0 items-end justify-between gap-2">
          <div className="min-w-0">
            <div className="truncate text-base">{mine ? 'Your tab' : c.waiter_name}</div>
            <div className="text-lg font-semibold">{kes(c.balance + c.pending_total)}</div>
          </div>
          {BILL[c.status] && <span className="shrink-0 rounded bg-slate-900 px-2 py-0.5 text-xs font-bold tracking-wide text-slate-100">{BILL[c.status]}</span>}
        </div>
      </button>
    )
  }
  const dot = (cls: string) => <span className={`inline-block h-3 w-3 rounded-full ${cls}`} />
  return (
    <div className="p-4">
      <div className="mb-3 flex items-center gap-3">
        <h2 className="mr-auto text-3xl font-bold">Tables</h2>
        <HomeBtn onClick={onDone} />
        <Btn onClick={() => setNaming(true)}>+ Takeaway / named tab</Btn>
      </div>
      <div className="mb-3 flex flex-wrap gap-x-5 gap-y-1 text-base text-slate-300">
        <span className="flex items-center gap-2">{dot('bg-green-400')} Free</span>
        <span className="flex items-center gap-2">{dot('bg-amber-600')} Your tab</span>
        <span className="flex items-center gap-2">{dot('bg-slate-500')} Another waiter</span>
        <span className="flex items-center gap-2"><span className="rounded bg-slate-700 px-1.5 text-xs font-bold">BILL</span> Bill requested</span>
      </div>
      {err && <div className="mb-3 rounded-lg bg-red-700 p-3 text-lg font-semibold">{err}</div>}
      <div className="grid-tables">
        {tables.map(t => {
          const c = cards.find(x => x.table_number === t.number)
          const other = !c ? taken.find(x => x.table_number === t.number && x.tab_id) : undefined
          if (c) return tabTile(c, `Table ${t.number}`, t.id, () => openTable(t))
          return (
            <button key={t.id} onClick={() => openTable(t)}
              className={`flex h-full flex-col justify-between rounded-xl p-3 text-left active:opacity-80 ${other ? 'bg-slate-700 opacity-70' : 'border-2 border-green-400/60 bg-slate-800'}`}>
              <div className="text-2xl font-bold leading-tight">Table {t.number}</div>
              {other ? <div className="truncate text-base text-slate-300">In use · {other.waiter_name}</div>
                     : <div className="flex items-center gap-2 text-lg font-semibold text-green-400">{dot('bg-green-400')} Free</div>}
            </button>
          )
        })}
        {named.map(c => tabTile(c, c.customer_name ?? 'Tab', c.tab_id, () => { setScreen('hub'); setActive({ id: c.tab_id, label: c.customer_name ?? 'Tab' }) }))}
      </div>
    </div>
  )
}

function OrderScreen({ profile, tab, products, onBack, onSent }:
  { profile: Profile; tab: ActiveTab; products: Product[]; onBack: () => void; onSent: () => void }) {
  const initial = useMemo(() => loadDraft(profile.id, tab.id), [profile.id, tab.id])
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
  const [ticket, setTicket] = useState<number | null>(null)
  const [saved, setSaved] = useState(false)
  const [items, setItems] = useState<TabItem[]>([])

  const cats = useMemo(() => [...(topIds.length >= 4 ? [MINE] : []), 'All', ...Array.from(new Set(products.map(p => p.category?.name ?? 'Other')))], [products, topIds])
  const query = q.trim().toLowerCase()
  const shown = query ? products.filter(p => p.name.toLowerCase().includes(query))
    : cat === MINE ? topIds.map(id => products.find(p => p.id === id)!)
    : products.filter(p => cat === 'All' || (p.category?.name ?? 'Other') === cat)
  const inCart = new Map(lines.map(l => [l.product_id, l.qty]))
  const count = lines.reduce((s, l) => s + l.qty, 0)
  const total = lines.reduce((s, l) => s + l.price * l.qty, 0)

  const persist = (next: CartLine[], st: Draft['state'] = state) => {
    setLines(next)
    if (next.length === 0) clearDraft(profile.id, tab.id)
    else saveDraft(profile.id, tab.id, { key: key.current, lines: next, state: st })
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

  const loadItems = useCallback(async () => {
    const { data } = await supabase.from('station_queue')
      .select('item_id, product_name, qty, status').eq('tab_id', tab.id).order('created_at')
    if (data) setItems(data as TabItem[])
  }, [tab.id])
  useEffect(() => { loadItems(); const t = setInterval(loadItems, 5000); return () => clearInterval(t) }, [loadItems])

  const markServed = async (id: string) => {
    const { error } = await supabase.rpc('update_item_status', { p_item: id, p_status: 'served' })
    if (error) setErr(error.message)
    loadItems()
  }

  const send = async () => {
    if (sending || lines.length === 0) return          // in-flight lock: double taps do nothing
    setSending(true); setErr('')
    const { data, error } = await supabase.rpc('submit_order', {
      p_tab: tab.id, p_items: lines.map(l => ({ product_id: l.product_id, qty: l.qty, ...(l.notes ? { notes: l.notes } : {}) })),
      p_terminal: TERMINAL_CODE, p_key: key.current })
    if (error) {
      if (isNetworkError(error)) {
        saveDraft(profile.id, tab.id, { key: key.current, lines, state: 'not_sent' })
        setState('not_sent'); setSaved(true)
      } else setErr(error.message)
      setSending(false); return
    }
    clearDraft(profile.id, tab.id)
    setTicket((data as { ticket_no: number }).ticket_no)
    setTimeout(onSent, 2500)
  }

  if (ticket !== null) {
    return (
      <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-green-700 text-center">
        <div className="text-6xl font-bold">Order #{ticket} received</div>
        <div className="text-3xl">by Bar &amp; Kitchen · {tab.label}</div>
      </div>
    )
  }
  if (saved) {
    return (
      <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-6 bg-red-800 text-center">
        <div className="text-6xl font-bold">NOT SENT</div>
        <div className="max-w-2xl text-2xl">No connection. The order is saved on this screen and will send by itself when the network is back. Do not re-enter it.</div>
        <Btn onClick={onSent}>OK</Btn>
      </div>
    )
  }

  const btn = 'h-[3.75rem] w-full rounded-xl px-3 text-left text-xl font-semibold'
  const CHIP: Record<string, string> = {
    new: 'bg-amber-600 text-on-accent', accepted: 'bg-slate-600', preparing: 'bg-slate-600', ready: 'bg-green-700', served: 'bg-slate-700 text-slate-400',
  }
  const noteLine = lines.find(l => l.product_id === noteFor)
  return (
    <div className="order-layout fill-screen">
      <div className="flex flex-col gap-2 overflow-y-auto">
        <Btn kind="ghost" onClick={onBack} className="!h-[3.75rem]">← Tables</Btn>
        {cats.map(c => (
          <button key={c} onClick={() => { setCat(c); setQ('') }}
            className={`${btn} ${cat === c && !query ? 'bg-amber-500 text-on-accent' : 'bg-slate-700'}`}>{c}</button>
        ))}
      </div>

      <div className="flex min-h-0 flex-col gap-3">
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

      <div className="flex min-h-0 flex-col gap-2 overflow-hidden rounded-xl bg-slate-800 p-3">
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1 truncate text-2xl font-bold">{tab.label}</div>
          {lines.length > 0 && state !== 'not_sent' &&
            <button onClick={clearOrder} className="h-10 shrink-0 rounded-lg bg-slate-700 px-3 text-base font-semibold">Clear</button>}
        </div>
        {state === 'not_sent' && <div className="rounded bg-red-700 p-2 font-semibold">NOT SENT – waiting to retry</div>}
        <div className="flex-1 space-y-2 overflow-y-auto">
          <div className="flex items-center justify-between text-sm font-semibold uppercase tracking-wider text-slate-400">
            <span>New order</span><span>{count} item{count === 1 ? '' : 's'}</span>
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
          {items.length > 0 && <div className="border-t border-slate-600 pt-2 text-sm font-semibold uppercase tracking-wider text-slate-400">Already on this tab</div>}
          {items.map(i => (
            <div key={i.item_id} className={`flex items-center gap-2 rounded-lg p-1.5 ${i.status === 'ready' ? 'bg-green-800' : ''}`}>
              <div className="min-w-0 flex-1 text-base leading-tight">{i.qty} × {i.product_name}</div>
              {i.status === 'ready'
                ? <button className="h-12 shrink-0 rounded-lg bg-green-600 px-3 font-semibold" onClick={() => markServed(i.item_id)}>Served</button>
                : <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-sm font-semibold ${CHIP[i.status] ?? 'bg-slate-600'}`}>{STATUS_TEXT[i.status] ?? i.status}</span>}
            </div>
          ))}
        </div>
        {err && <div className="rounded bg-red-700 p-2 font-semibold">{err}</div>}
        <div className="flex items-baseline justify-between border-t border-slate-600 pt-2">
          <span className="text-lg text-slate-400">Total</span>
          <span className="text-4xl font-bold">{kes(total)}</span>
        </div>
        <Btn onClick={send} disabled={sending || lines.length === 0}>
          {sending ? 'Sending…' : state === 'not_sent' ? 'Retry send' : 'SEND ORDER'}
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
