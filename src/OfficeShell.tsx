import { ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import { Profile, can } from './supabase'
import { Icon, IconName } from './icons'
import { useTheme } from './device'
import { GROUPS, NavItem } from './nav'
import { DAY_STATUS, formatTradingDate, useTradingDay } from './tradingDay'
import { SHORTCUTS, dialogOpen, isTyping } from './keys'

// Office layout (17" office computer and the accountant's laptop): sidebar grouped by job,
// a top bar with the trading date and day status, and content that uses the full width.
// Terminals never render this; they keep the tile home screen.

const SIDEBAR_KEY = 'pos-sidebar'
const readCollapsed = () => { try { return localStorage.getItem(SIDEBAR_KEY) === 'collapsed' } catch { return false } }

type Props = {
  profile: Profile
  items: NavItem[]
  activeId: string
  onGo: (item: NavItem | 'home') => void
  onSignOut: () => void
  unsent: number
  children: ReactNode
}

export default function OfficeShell({ profile, items, activeId, onGo, onSignOut, unsent, children }: Props) {
  const [collapsed, setCollapsed] = useState(readCollapsed)
  const [palette, setPalette] = useState(false)
  const [help, setHelp] = useState(false)
  const main = useRef<HTMLElement>(null)

  const toggleSidebar = () => setCollapsed(c => {
    try { localStorage.setItem(SIDEBAR_KEY, c ? 'expanded' : 'collapsed') } catch { /* not remembered */ }
    return !c
  })

  // After a screen change, put the keyboard in the content, not back at the top of the sidebar.
  const first = useRef(true)
  useEffect(() => {
    if (first.current) { first.current = false; return }
    main.current?.focus({ preventScroll: true })
  }, [activeId])

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey
      if (mod && e.key.toLowerCase() === 'k') { e.preventDefault(); setHelp(false); setPalette(p => !p); return }
      if (e.altKey || mod || isTyping(e.target) || dialogOpen()) return
      if (e.key === '/') { e.preventDefault(); setPalette(true) }
      else if (e.key === '?') { e.preventDefault(); setHelp(true) }
      else if (e.key === '[') { e.preventDefault(); toggleSidebar() }
    }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [])

  const go = (it: NavItem | 'home') => { setPalette(false); onGo(it) }

  return (
    <div className="flex h-full min-h-0 bg-slate-900">
      <a href="#office-main" onClick={e => { e.preventDefault(); main.current?.focus() }}
         className="sr-only z-[70] rounded-lg bg-amber-500 px-4 py-2 font-semibold text-on-accent focus:not-sr-only focus:fixed focus:left-2 focus:top-2">
        Skip to content
      </a>
      <Sidebar items={items} activeId={activeId} collapsed={collapsed} onToggle={toggleSidebar} onGo={go} onPalette={() => setPalette(true)} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Header profile={profile} unsent={unsent} onSignOut={onSignOut} onHelp={() => setHelp(true)} />
        <main id="office-main" ref={main} tabIndex={-1} className="office-main min-h-0 flex-1 overflow-y-auto focus:outline-none">
          {children}
        </main>
      </div>
      {palette && <Palette items={items} activeId={activeId} onGo={go} onClose={() => setPalette(false)} />}
      {help && <Help onClose={() => setHelp(false)} />}
    </div>
  )
}

/* ───────────────────────── sidebar ───────────────────────── */

function Sidebar({ items, activeId, collapsed, onToggle, onGo, onPalette }:
  { items: NavItem[]; activeId: string; collapsed: boolean; onToggle: () => void; onGo: (i: NavItem | 'home') => void; onPalette: () => void }) {
  const nav = useRef<HTMLElement>(null)

  // Up / Down move through the sidebar; Tab still walks it item by item.
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    const all = Array.from(nav.current?.querySelectorAll<HTMLButtonElement>('button[data-nav]') ?? [])
    const i = all.indexOf(document.activeElement as HTMLButtonElement)
    if (i < 0) return
    e.preventDefault()
    all[(i + (e.key === 'ArrowDown' ? 1 : -1) + all.length) % all.length]?.focus()
  }

  const row = (id: string, icon: IconName, label: string, go: () => void) => {
    const active = id === activeId
    return (
      <button key={id} data-nav onClick={go} title={collapsed ? label : undefined} aria-label={label}
        aria-current={active ? 'page' : undefined}
        className={`flex h-10 w-full items-center gap-3 rounded-lg px-3 text-left text-base font-medium
          ${active ? 'bg-amber-500 text-on-accent' : 'text-slate-200 hover:bg-slate-700'} ${collapsed ? 'justify-center px-0' : ''}`}>
        <Icon name={icon} className="h-5 w-5 shrink-0" />
        {!collapsed && <span className="truncate">{label}</span>}
      </button>
    )
  }

  return (
    <aside className={`flex shrink-0 flex-col border-r border-slate-700 bg-slate-800 ${collapsed ? 'w-[4.25rem]' : 'w-[15rem]'}`}>
      <div className="flex h-topbar shrink-0 items-center gap-2 border-b border-slate-700 px-3">
        {!collapsed && <div className="min-w-0 flex-1 truncate text-base font-bold leading-tight">The Gliz Lounge<div className="text-xs font-normal text-slate-400">Point of sale</div></div>}
        <button onClick={onToggle} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg hover:bg-slate-700"
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} title={`${collapsed ? 'Expand' : 'Collapse'} sidebar ( [ )`}>
          <Icon name="panel" className="h-5 w-5" />
        </button>
      </div>

      <nav ref={nav} onKeyDown={onKey} aria-label="Screens" className="min-h-0 flex-1 overflow-y-auto p-2">
        {row('home', 'home', 'Home', () => onGo('home'))}
        {GROUPS.map(g => {
          const mine = items.filter(i => i.group === g.id)
          if (mine.length === 0) return null
          return (
            <div key={g.id} className="mt-3" role="group" aria-label={g.label}>
              {collapsed
                ? <div className="mx-2 mb-1 border-t border-slate-700" />
                : <div className="mb-1 px-3 text-xs font-semibold uppercase tracking-wider text-slate-400">{g.label}</div>}
              {mine.map(i => row(i.id, i.icon, i.label, () => onGo(i)))}
            </div>
          )
        })}
      </nav>

      <div className="shrink-0 border-t border-slate-700 p-2">
        <button onClick={onPalette} title="Go to any screen (Ctrl + K)" aria-label="Go to any screen"
          className={`flex h-10 w-full items-center gap-3 rounded-lg px-3 text-sm text-slate-300 hover:bg-slate-700 ${collapsed ? 'justify-center px-0' : ''}`}>
          <Icon name="search" className="h-5 w-5 shrink-0" />
          {!collapsed && <><span className="flex-1 text-left">Go to…</span><kbd className="rounded bg-slate-900 px-1.5 py-0.5 text-xs">Ctrl K</kbd></>}
        </button>
      </div>
    </aside>
  )
}

/* ───────────────────────── top bar ───────────────────────── */

function Header({ profile, unsent, onSignOut, onHelp }: { profile: Profile; unsent: number; onSignOut: () => void; onHelp: () => void }) {
  const { date, status } = useTradingDay(can(profile, 'recon.view_all'))
  const [now, setNow] = useState(new Date())
  const [online, setOnline] = useState(navigator.onLine)
  const [theme, toggleTheme] = useTheme()
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000)
    const on = () => setOnline(true), off = () => setOnline(false)
    window.addEventListener('online', on); window.addEventListener('offline', off)
    return () => { clearInterval(t); window.removeEventListener('online', on); window.removeEventListener('offline', off) }
  }, [])

  // Between midnight and 05:00 the trading day is still "yesterday"; say so, so nobody is confused.
  const calendarToday = new Date(now.getTime() + 3 * 3600_000).toISOString().slice(0, 10)
  const spillover = date !== calendarToday
  const s = status === 'loading' || status === 'unknown' ? null : DAY_STATUS[status]
  const control = 'flex h-9 shrink-0 items-center justify-center rounded-lg bg-slate-700 px-3 text-sm font-semibold hover:bg-slate-600'

  return (
    <header className="flex h-topbar shrink-0 items-center gap-3 border-b border-slate-700 bg-slate-800 px-4 text-base">
      <div className="min-w-0">
        <div className="truncate font-semibold leading-tight">{formatTradingDate(date)}</div>
        <div className="truncate text-xs leading-tight text-slate-400">
          {spillover ? 'Still last night’s trading day (it changes at 05:00)' : 'Trading day'}
        </div>
      </div>
      {s && <span title={s.hint} className={`shrink-0 whitespace-nowrap rounded-full px-3 py-1 text-sm font-semibold ${s.tone}`}>Day: {s.label}</span>}
      {status === 'loading' && <span className="shrink-0 text-sm text-slate-400">Checking day…</span>}
      <span className="flex-1" />
      {unsent > 0 && <span className="shrink-0 whitespace-nowrap rounded bg-red-700 px-3 py-1 font-semibold">NOT SENT: {unsent}</span>}
      <span className={`shrink-0 whitespace-nowrap rounded px-3 py-1 text-sm font-semibold ${online ? 'bg-green-700' : 'bg-red-700'}`}>
        {online ? '● Online' : '● OFFLINE'}
      </span>
      <span className="shrink-0 tabular-nums">{now.toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit' })}</span>
      <button onClick={onHelp} className={control} aria-label="Keyboard shortcuts" title="Keyboard shortcuts ( ? )"><Icon name="keyboard" className="h-5 w-5" /></button>
      <button onClick={toggleTheme} className={control} aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}>
        {theme === 'dark' ? 'Light' : 'Dark'}
      </button>
      <div className="hidden min-w-0 text-right leading-tight lg:block">
        <div className="truncate font-semibold">{profile.full_name}</div>
        <div className="truncate text-xs text-slate-400">{profile.roles.join(', ')}</div>
      </div>
      <button onClick={onSignOut} className={control}>Sign out</button>
    </header>
  )
}

/* ───────────────────────── Ctrl + K: go to any screen ───────────────────────── */

function Palette({ items, activeId, onGo, onClose }: { items: NavItem[]; activeId: string; onGo: (i: NavItem | 'home') => void; onClose: () => void }) {
  const [q, setQ] = useState('')
  const [sel, setSel] = useState(0)
  const list = useMemo(() => {
    const all: { key: string; label: string; group: string; target: NavItem | 'home' }[] = [
      { key: 'home', label: 'Home', group: '', target: 'home' },
      ...items.map(i => ({ key: i.id, label: i.label, group: GROUPS.find(g => g.id === i.group)?.label ?? '', target: i as NavItem | 'home' })),
    ]
    const t = q.trim().toLowerCase()
    return t ? all.filter(x => (x.label + ' ' + x.group).toLowerCase().includes(t)) : all
  }, [items, q])
  useEffect(() => setSel(0), [q])

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose() }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setSel(s => Math.min(s + 1, list.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSel(s => Math.max(s - 1, 0)) }
    else if (e.key === 'Enter') { e.preventDefault(); const x = list[sel]; if (x) onGo(x.target) }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center bg-black/60 p-4 pt-[12vh]" role="dialog" aria-modal="true" aria-label="Go to a screen"
         onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="w-[min(32rem,94vw)] overflow-hidden rounded-2xl bg-slate-800 shadow-xl" onKeyDown={onKey}>
        <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Go to… (type a screen name)"
          aria-label="Search screens" className="h-12 w-full border-b border-slate-700 bg-slate-800 px-4 text-lg outline-none" />
        <ul className="max-h-[50vh] overflow-y-auto p-2" role="listbox">
          {list.length === 0 && <li className="px-3 py-4 text-slate-400">No screen matches “{q}”.</li>}
          {list.map((x, i) => (
            <li key={x.key} role="option" aria-selected={i === sel}>
              <button tabIndex={-1} onMouseEnter={() => setSel(i)} onClick={() => onGo(x.target)}
                className={`flex h-10 w-full items-center gap-3 rounded-lg px-3 text-left text-base ${i === sel ? 'bg-amber-500 text-on-accent' : 'hover:bg-slate-700'}`}>
                <span className="flex-1 truncate font-medium">{x.label}</span>
                {x.group && <span className={`text-xs ${i === sel ? '' : 'text-slate-400'}`}>{x.group}</span>}
                {x.key === activeId && <span className="text-xs">• here</span>}
              </button>
            </li>
          ))}
        </ul>
        <div className="border-t border-slate-700 px-4 py-2 text-xs text-slate-400">↑ ↓ to choose · Enter to open · Esc to close</div>
      </div>
    </div>
  )
}

/* ───────────────────────── ? : shortcut list ───────────────────────── */

function Help({ onClose }: { onClose: () => void }) {
  const btn = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    btn.current?.focus()
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape' || e.key === 'Enter') { e.preventDefault(); onClose() } }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [onClose])
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-label="Keyboard shortcuts"
         onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="flex w-[min(34rem,94vw)] flex-col gap-4 rounded-2xl bg-slate-800 p-6">
        <h2 className="text-2xl font-bold">Keyboard shortcuts</h2>
        <dl className="flex flex-col gap-2">
          {SHORTCUTS.map(s => (
            <div key={s.what} className="flex items-baseline gap-3">
              <dt className="flex w-28 shrink-0 gap-1">{s.keys.map(k => <kbd key={k} className="rounded bg-slate-900 px-2 py-0.5 text-sm font-semibold">{k}</kbd>)}</dt>
              <dd className="text-slate-300">{s.what}</dd>
            </div>
          ))}
        </dl>
        <button ref={btn} onClick={onClose} className="h-btn rounded-xl bg-amber-500 px-6 text-lg font-semibold text-on-accent">Close</button>
      </div>
    </div>
  )
}
