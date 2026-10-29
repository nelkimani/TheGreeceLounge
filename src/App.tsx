import { useEffect, useState } from 'react'
import { supabase, TERMINAL_CODE, Profile, can } from './supabase'
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
import { ORDER_IDLE_MS, STATION_IDLE_MS, TERMINAL_NAMES, listNotSent } from './lib'
import { useIdle } from './useIdle'
import { FeedbackHost, confirmDialog } from './feedback'
import ScreenKeyboard from './ScreenKeyboard'
import { Icon, IconName } from './icons'

type View = 'home' | 'waiter' | 'queue' | 'staff' | 'stock' | 'approvals' | 'handover' | 'recon' | 'purchasing' | 'expenses' | 'stockroom' | 'reports' | 'owner'
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
  useIdle(view === 'waiter' ? ORDER_IDLE_MS : STATION_IDLE_MS, lock, isTerminal && signedIn && view !== 'home' || (isTerminal && signedIn))

  const switchUser = async () => {
    const mine = profile ? listNotSent(profile.id).length : 0
    if (mine > 0 && !(await confirmDialog({
      title: 'Switch user?',
      message: `${mine} order(s) NOT SENT are saved for you. They stay saved and send when you sign in again.`,
      confirmText: 'Switch user',
    }))) return
    lock()
  }

  if (!ready) return null
  const home = () => setView('home')
  const stationPerms = profile
    ? ['kitchen', 'choma', 'bar'].filter(s => can(profile, 'station.' + s)) : []

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
      {signedIn && profile && view === 'home' && (() => {
        const q = (stations: string[]) => () => { setQueueStations(stations); setView('queue') }
        type T = { show: boolean; icon: IconName; label: string; go: () => void }
        const work: T[] = [
          { show: can(profile, 'tab.open'), icon: 'orders', label: 'Take orders', go: () => setView('waiter') },
          { show: stationPerms.includes('kitchen'), icon: 'kitchen', label: 'Kitchen queue', go: q(['kitchen']) },
          { show: stationPerms.includes('choma'), icon: 'choma', label: 'Choma queue', go: q(['choma']) },
          { show: stationPerms.includes('bar'), icon: 'bar', label: 'Bar queue', go: q(['bar']) },
          { show: stationPerms.length > 1, icon: 'queues', label: 'All queues', go: q(stationPerms) },
        ].filter(t => t.show)
        const manage: T[] = [
          { show: stationPerms.includes('bar') || can(profile, 'stock.view_all'), icon: 'stock', label: 'Bar stock', go: () => setView('stock') },
          { show: can(profile, 'approval.grant'), icon: 'approvals', label: 'Approvals', go: () => setView('approvals') },
          { show: can(profile, 'payment.record') && !can(profile, 'recon.view_all'), icon: 'cash', label: 'Hand in cash', go: () => setView('handover') },
          { show: can(profile, 'recon.view_all'), icon: 'recon', label: 'Reconciliation', go: () => setView('recon') },
          { show: can(profile, 'goods.receive') || can(profile, 'supplier.manage'), icon: 'purchasing', label: 'Purchasing', go: () => setView('purchasing') },
          { show: can(profile, 'expense.record'), icon: 'expenses', label: 'Cash expenses', go: () => setView('expenses') },
          { show: can(profile, 'stock.view_all') || stationPerms.includes('kitchen') || stationPerms.includes('choma'), icon: 'stockroom', label: 'Stock room', go: () => setView('stockroom') },
          { show: can(profile, 'report.view') || can(profile, 'report.build'), icon: 'reports', label: 'Reports & sign-off', go: () => setView('reports') },
          { show: can(profile, 'report.sales') || can(profile, 'report.profit'), icon: 'owner', label: 'Owner reports', go: () => setView('owner') },
          { show: can(profile, 'staff.manage'), icon: 'staff', label: 'Staff', go: () => setView('staff') },
        ].filter(t => t.show)
        const tile = (t: T, primary: boolean) => (
          <button key={t.label} onClick={t.go}
            className={`flex min-h-[6.5rem] flex-col items-start justify-between gap-3 rounded-2xl p-4 text-left text-xl font-semibold active:opacity-80 ${primary ? 'bg-amber-500 text-on-accent' : 'bg-slate-800 text-slate-100 ring-1 ring-slate-600'}`}>
            <Icon name={t.icon} className="h-9 w-9" />
            <span className="leading-tight">{t.label}</span>
          </button>
        )
        const grid = 'grid grid-cols-[repeat(auto-fill,minmax(11.5rem,1fr))] gap-3'
        return (
          <div className="mx-auto flex max-w-5xl flex-col gap-5 p-6">
            <h1 className="text-3xl font-bold">Hello, {profile.full_name}</h1>
            {work.length > 0 && <section><h2 className="mb-2 text-sm font-semibold uppercase tracking-wider text-slate-400">Work</h2><div className={grid}>{work.map(t => tile(t, true))}</div></section>}
            {manage.length > 0 && <section><h2 className="mb-2 text-sm font-semibold uppercase tracking-wider text-slate-400">Manage</h2><div className={grid}>{manage.map(t => tile(t, false))}</div></section>}
            {work.length === 0 && manage.length === 0 &&
              <div className="text-xl text-slate-300">No screens are available for your role yet.</div>}
          </div>
        )
      })()}
      {signedIn && profile && view === 'waiter' && <Waiter profile={profile} onDone={home} onLock={lock} />}
      {signedIn && profile && view === 'queue' && <Queue profile={profile} stations={queueStations} onDone={home} />}
      {signedIn && profile && view === 'stock' && <BarStock profile={profile} onDone={home} />}
      {signedIn && profile && view === 'approvals' && <Approvals onDone={home} />}
      {signedIn && profile && view === 'handover' && <Handover onDone={home} />}
      {signedIn && profile && view === 'recon' && <Recon profile={profile} onDone={home} />}
      {signedIn && profile && view === 'purchasing' && <Purchasing profile={profile} onDone={home} />}
      {signedIn && profile && view === 'expenses' && <Expenses profile={profile} onDone={home} />}
      {signedIn && profile && view === 'stockroom' && <StockRoom profile={profile} onDone={home} />}
      {signedIn && profile && view === 'reports' && <Reports profile={profile} onDone={home} />}
      {signedIn && profile && view === 'owner' && <OwnerReports profile={profile} onDone={home} />}
      {signedIn && profile && view === 'staff' && (
        <div><div className="p-3"><Btn kind="ghost" onClick={home}>← Home</Btn></div><StaffAdmin /></div>
      )}
    </div>
  )
}
