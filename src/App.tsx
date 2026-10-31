import { useEffect, useState } from 'react'
import { supabase, TERMINAL_CODE, Profile } from './supabase'
import { Btn, TopBar } from './ui'
import Login from './Login'
import StaffAdmin from './StaffAdmin'
import Waiter from './Waiter'
import Queue from './Queue'
import BarStock from './BarStock'
import Approvals from './Approvals'
import Handover from './Handover'
import Recon from './Recon'
import Purchasing from './Purchasing'
import Expenses from './Expenses'
import StockRoom from './StockRoom'
import Reports from './Reports'
import OwnerReports from './OwnerReports'
import Products from './Products'
import OfficeShell from './OfficeShell'
import { GROUPS, NavItem, View, navId, navItems } from './nav'
import { ORDER_IDLE_MS, STATION_IDLE_MS, TERMINAL_NAMES, listNotSent } from './lib'
import { useIdle } from './useIdle'
import { FeedbackHost, confirmDialog } from './feedback'
import ScreenKeyboard from './ScreenKeyboard'
import { Icon } from './icons'

const isTerminal = TERMINAL_CODE !== 'OFFICE'

export default function App() {
  const [ready, setReady] = useState(false)
  const [signedIn, setSignedIn] = useState(false)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [problem, setProblem] = useState('')
  const [view, setView] = useState<View>('home')
  const [queueStations, setQueueStations] = useState<string[]>([])
  const [unsent, setUnsent] = useState(0)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => { setSignedIn(!!data.session); setReady(true) })
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSignedIn(!!s))
    return () => sub.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!signedIn) { setProfile(null); setProblem(''); setView('home'); return }
    supabase.rpc('my_profile').then(({ data, error }) => {
      if (error || !data) { setProblem('This account is not set up as staff, or is inactive.'); return }
      setProfile(data as Profile)
    })
  }, [signedIn])

  useEffect(() => {
    const t = setInterval(() => setUnsent(listNotSent().length), 3000)
    setUnsent(listNotSent().length)
    return () => clearInterval(t)
  }, [])

  const lock = () => supabase.auth.signOut()
  // Terminals lock themselves: quickly while ordering, slowly on the kitchen/bar queues.
  useIdle(view === 'waiter' ? ORDER_IDLE_MS : STATION_IDLE_MS, lock, isTerminal && signedIn)

  const switchUser = async () => {
    const mine = profile ? listNotSent(profile.id).length : 0
    if (mine > 0 && !(await confirmDialog({
      title: isTerminal ? 'Switch user?' : 'Sign out?',
      message: `${mine} order(s) NOT SENT are saved for you. They stay saved and send when you sign in again.`,
      confirmText: isTerminal ? 'Switch user' : 'Sign out',
    }))) return
    lock()
  }

  if (!ready) return null
  const home = () => setView('home')
  const items = profile ? navItems(profile) : []
  const open = (it: NavItem | 'home') => {
    if (it === 'home') { setView('home'); return }
    setQueueStations(it.stations ?? [])
    setView(it.view)
  }

  // The tile home. Terminals: two blocks of big tiles. Office: tiles grouped like the sidebar, full width.
  const homeScreen = (p: Profile) => {
    const tile = (t: NavItem) => (
      <button key={t.id} onClick={() => open(t)}
        className={`flex min-h-[6.5rem] flex-col items-start justify-between gap-3 rounded-2xl p-4 text-left text-xl font-semibold active:opacity-80
          ${isTerminal ? '' : 'hover:brightness-110'} ${t.kind === 'work' ? 'bg-amber-500 text-on-accent' : 'bg-slate-800 text-slate-100 ring-1 ring-slate-600'}`}>
        <Icon name={t.icon} className="h-9 w-9" />
        <span className="leading-tight">{t.label}</span>
      </button>
    )
    const grid = 'grid grid-cols-[repeat(auto-fill,minmax(11.5rem,1fr))] gap-3'
    const heading = (s: string) => <h2 className="mb-2 text-sm font-semibold uppercase tracking-wider text-slate-400">{s}</h2>
    const work = items.filter(i => i.kind === 'work')
    const manage = items.filter(i => i.kind === 'manage')
    return (
      <div className={isTerminal ? 'mx-auto flex max-w-5xl flex-col gap-5 p-6' : 'flex flex-col gap-5 p-6'}>
        <h1 className="text-3xl font-bold">Hello, {p.full_name}</h1>
        {isTerminal ? (
          <>
            {work.length > 0 && <section>{heading('Work')}<div className={grid}>{work.map(tile)}</div></section>}
            {manage.length > 0 && <section>{heading('Manage')}<div className={grid}>{manage.map(tile)}</div></section>}
          </>
        ) : GROUPS.map(g => {
          const mine = items.filter(i => i.group === g.id)
          return mine.length > 0 && <section key={g.id}>{heading(g.label)}<div className={grid}>{mine.map(tile)}</div></section>
        })}
        {items.length === 0 && <div className="text-xl text-slate-300">No screens are available for your role yet.</div>}
      </div>
    )
  }

  const screen = (p: Profile) => (
    <>
      {view === 'home' && homeScreen(p)}
      {view === 'waiter' && <Waiter profile={p} onDone={home} onLock={lock} />}
      {view === 'queue' && <Queue profile={p} stations={queueStations} onDone={home} />}
      {view === 'stock' && <BarStock profile={p} onDone={home} />}
      {view === 'approvals' && <Approvals onDone={home} />}
      {view === 'handover' && <Handover onDone={home} />}
      {view === 'recon' && <Recon profile={p} onDone={home} />}
      {view === 'purchasing' && <Purchasing profile={p} onDone={home} />}
      {view === 'expenses' && <Expenses profile={p} onDone={home} />}
      {view === 'stockroom' && <StockRoom profile={p} onDone={home} />}
      {view === 'reports' && <Reports profile={p} onDone={home} />}
      {view === 'owner' && <OwnerReports profile={p} onDone={home} />}
      {view === 'products' && <Products profile={p} onDone={home} />}
      {view === 'staff' && (
        <div>
          {isTerminal && <div className="p-3"><Btn kind="ghost" onClick={home}>← Home</Btn></div>}
          <StaffAdmin />
        </div>
      )}
    </>
  )

  // Office computer and accountant's laptop get the sidebar layout once someone is signed in.
  if (!isTerminal && signedIn && profile) {
    return (
      <div className="h-full">
        <FeedbackHost />
        <OfficeShell profile={profile} items={items} activeId={navId(view, queueStations)}
                     onGo={open} onSignOut={switchUser} unsent={unsent}>
          {screen(profile)}
        </OfficeShell>
      </div>
    )
  }

  return (
    <div className="min-h-full">
      <FeedbackHost />
      {isTerminal && <ScreenKeyboard />}
      <TopBar terminal={TERMINAL_NAMES[TERMINAL_CODE] ?? TERMINAL_CODE} unsent={unsent}
              who={profile ? `${profile.full_name} (${profile.roles.join(', ')})` : undefined}
              onSignOut={signedIn ? switchUser : undefined} />
      {!signedIn && <Login />}
      {signedIn && problem && (
        <div className="p-8 text-xl">{problem}
          <div className="mt-4"><button className="h-14 rounded-xl bg-slate-700 px-6" onClick={lock}>Sign out</button></div>
        </div>
      )}
      {signedIn && profile && screen(profile)}
    </div>
  )
}
