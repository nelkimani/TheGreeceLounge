import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase, Profile, can } from './supabase'
import { Btn, HomeBtn } from './ui'
import { kes, uid } from './lib'
import { tradingDate, formatTradingDate } from './tradingDay'
import { encodePass } from './escpos'
import { printBytes } from './printer'
import PrinterControl from './PrinterControl'

// Gate passes (manager): set the entry amount for the night, sell passes at the gate and print them on the handheld
// printer, and watch what was sold and redeemed. The counter redeems a pass by its 6-digit code (Redeem pass screen).
type Use = { amount: number; waiter: string; at: string }
type Pass = { id: string; code: string; amount: number; balance: number; status: 'active' | 'void'; method: 'cash' | 'mpesa'; mpesa_ref: string | null; sold_by: string; sold_at: string; uses: Use[] }
type Summary = { date: string; today: string; entry_amount: number | null; active: boolean; is_set: boolean; sold: number; cash: number; mpesa: number; collected: number; redeemed: number; unused: number; void: number; passes: Pass[] }
type Made = { id: string; code: string; amount: number; business_date: string }

const input = 'h-12 rounded-lg border border-slate-500 bg-slate-900 px-3 text-lg'
const hhmm = (iso: string) => new Date(iso).toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit' })
const spaced = (c: string) => `${c.slice(0, 3)} ${c.slice(3)}`

export default function GatePasses({ profile, onDone }: { profile: Profile; onDone: () => void }) {
  const canSetup = can(profile, 'close.approve')
  const [day, setDay] = useState(tradingDate())
  const [s, setS] = useState<Summary | null>(null)
  const [amount, setAmount] = useState('')
  const [qty, setQty] = useState(1)
  const [method, setMethod] = useState<'cash' | 'mpesa'>('cash')
  const [ref, setRef] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(''); const [bad, setBad] = useState(false)
  const [made, setMade] = useState<Made[]>([])
  const [cancel, setCancel] = useState<{ id: string; why: string } | null>(null)
  const key = useRef(uid())
  const isTonight = s ? day === s.today : day === tradingDate()

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc('gate_summary', { p_date: day })
    if (error) { setMsg(error.message); setBad(true); return }
    const d = data as Summary; setS(d)
    if (d.entry_amount && amount === '') setAmount(String(Number(d.entry_amount)))
  }, [day]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setS(null); setMade([]); load() }, [load])
  const say = (t: string, isBad = false) => { setMsg(t); setBad(isBad) }

  const saveAmount = async (active = true) => {
    if (busy) return; setBusy(true)
    const { error } = await supabase.rpc('gate_set_amount', { p_date: day, p_amount: Number(amount), p_active: active })
    setBusy(false)
    if (error) return say(error.message, true)
    say(active ? `Entry amount for tonight is KES ${Number(amount).toLocaleString('en-KE')}.` : 'Selling passes is switched off.'); load()
  }

  const print = async (m: Made, n: number, of: number, copy = false) =>
    printBytes(encodePass({ code: m.code, amount: m.amount, dateLabel: formatTradingDate(m.business_date), soldBy: profile.full_name, n, of, copy }))

  const sell = async () => {
    if (busy || !s?.is_set || !s.active) return
    if (method === 'mpesa' && !ref.trim()) return say('Type the M-Pesa code first.', true)
    setBusy(true)
    const { data, error } = await supabase.rpc('gate_sell', { p_qty: qty, p_method: method, p_ref: method === 'mpesa' ? ref.trim() : null, p_key: key.current })
    if (error) { setBusy(false); return say(error.message, true) }
    const list = data as Made[]
    setMade(list); key.current = uid(); setRef(''); setQty(1)
    let printed = 0
    for (let i = 0; i < list.length; i++) { if (await print(list[i], i + 1, list.length)) printed++; else break }
    setBusy(false)
    say(printed === list.length ? `${list.length} pass${list.length === 1 ? '' : 'es'} sold and printed.`
      : `${list.length} pass${list.length === 1 ? '' : 'es'} sold. The printer did not print: connect it below and press Reprint, or write the code on a slip.`, printed !== list.length)
    load()
  }

  const reprint = async (p: { id: string; code: string; amount: number }) => {
    const ok = await print({ ...p, business_date: day }, 1, 1, true)
    say(ok ? 'Reprinted.' : 'The printer is not connected.', !ok)
  }
  const doCancel = async () => {
    if (!cancel || busy) return; setBusy(true)
    const { error } = await supabase.rpc('gate_void', { p_id: cancel.id, p_reason: cancel.why })
    setBusy(false)
    if (error) return say(error.message, true)
    say('Pass cancelled.'); setCancel(null); load()
  }

  const price = Number(s?.entry_amount ?? 0)
  const ready = !!s?.is_set && s.active && isTonight
  const status = (p: Pass) => p.status === 'void' ? ['Cancelled', 'bg-slate-600']
    : p.balance <= 0 ? ['Used', 'bg-slate-600']
    : !isTonight ? ['Expired', 'bg-red-800']
    : p.balance < p.amount ? ['Part used', 'bg-amber-600 text-on-accent'] : ['Unused', 'bg-green-700']
  const card = (label: string, v: string, sub = '') => (
    <div className="rounded-xl bg-slate-800 p-3"><div className="text-base text-slate-300">{label}</div><div className="text-2xl font-bold tabular-nums">{v}</div>{sub && <div className="text-sm text-slate-400">{sub}</div>}</div>)

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-4">
      <div className="flex flex-wrap items-center gap-3"><HomeBtn onClick={onDone} /><h2 className="text-3xl font-bold">Gate passes</h2>
        <input type="date" className={input + ' ml-auto'} value={day} max={tradingDate()} onChange={e => setDay(e.target.value || tradingDate())} /></div>
      {msg && <div className={`rounded-lg p-3 text-lg font-semibold ${bad ? 'bg-red-700' : 'bg-green-800'}`}>{msg}</div>}

      {isTonight && canSetup && (
        <div className="rounded-xl bg-slate-800 p-4">
          <div className="mb-2 text-2xl font-bold">Entry amount for tonight</div>
          <div className="flex flex-wrap items-end gap-3">
            <label className="text-lg">KES (what a pass is worth in drinks)
              <input className={input + ' mt-1 block w-48'} inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value.replace(/[^0-9.]/g, ''))} placeholder="500" /></label>
            <Btn disabled={busy || !Number(amount)} onClick={() => saveAmount(true)}>{s?.is_set ? 'Update' : 'Set amount'}</Btn>
            {s?.is_set && s.active && <Btn kind="ghost" disabled={busy} onClick={() => saveAmount(false)}>Switch off</Btn>}
            {s?.is_set && !s.active && <span className="rounded bg-red-800 px-3 py-2 text-lg font-semibold">Switched off</span>}
          </div>
          <div className="mt-1 text-base text-slate-400">Passes already sold keep the amount they were sold at.</div>
        </div>)}

      {isTonight && (
        <div className="rounded-xl bg-slate-800 p-4">
          <div className="mb-2 text-2xl font-bold">Sell passes</div>
          {!ready ? <div className="text-xl text-amber-300">{canSetup ? 'Set tonight’s entry amount above to start selling.' : 'The manager has not set tonight’s entry amount.'}</div> : (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-xl">Guests</span>
                <Btn kind="ghost" className="!w-16 !px-0" onClick={() => setQty(q => Math.max(1, q - 1))}>−</Btn>
                <span className="w-14 text-center text-4xl font-bold tabular-nums">{qty}</span>
                <Btn kind="ghost" className="!w-16 !px-0" onClick={() => setQty(q => Math.min(50, q + 1))}>+</Btn>
                <span className="text-xl text-slate-300">× {kes(price)} =</span><span className="text-3xl font-bold tabular-nums text-amber-400">{kes(qty * price)}</span>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {(['cash', 'mpesa'] as const).map(m => (
                  <button key={m} onClick={() => setMethod(m)} className={`h-14 rounded-xl px-6 text-xl font-semibold ${method === m ? 'bg-amber-500 text-on-accent' : 'bg-slate-700'}`}>{m === 'cash' ? 'Cash' : 'M-Pesa'}</button>))}
                {method === 'mpesa' && <input className={input + ' w-64 uppercase'} placeholder="M-Pesa code" value={ref} onChange={e => setRef(e.target.value)} />}
              </div>
              <Btn disabled={busy} onClick={sell} className="w-full sm:w-auto">{busy ? 'Working…' : `Sell ${qty} pass${qty === 1 ? '' : 'es'} and print`}</Btn>
            </div>)}
          {made.length > 0 && (
            <div className="mt-4 rounded-lg bg-slate-900 p-3">
              <div className="mb-1 text-lg font-semibold text-slate-300">Just sold</div>
              <div className="flex flex-wrap gap-2">{made.map((m, i) => (
                <button key={m.id} onClick={() => reprint(m)} className="rounded-lg bg-slate-700 px-4 py-2 text-xl font-bold tabular-nums" title="Reprint">{spaced(m.code)} <span className="text-sm font-normal text-slate-300">#{i + 1} · reprint</span></button>))}</div>
            </div>)}
          <div className="mt-3"><PrinterControl /></div>
        </div>)}

      {s && (<>
        <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
          {card('Passes sold', String(s.sold), s.void > 0 ? `${s.void} cancelled` : '')}
          {card('Cash at the gate', kes(s.cash))}
          {card('M-Pesa at the gate', kes(s.mpesa))}
          {card('Collected', kes(s.collected))}
          {card('Used for drinks', kes(s.redeemed))}
          {card(isTonight ? 'Still unused' : 'Expired unused', kes(s.unused))}
        </div>
        <div className="rounded-xl bg-slate-800 p-3">
          <div className="mb-2 text-xl font-bold">Passes for {formatTradingDate(day)}</div>
          {s.passes.length === 0 && <div className="text-lg text-slate-400">No passes sold.</div>}
          <div className="space-y-2">
            {s.passes.map(p => { const [label, tone] = status(p); return (
              <div key={p.id} className="rounded-lg bg-slate-700 p-3">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="text-2xl font-bold tabular-nums">{spaced(p.code)}</span>
                  <span className={`rounded px-2 py-0.5 text-base font-semibold ${tone}`}>{label}</span>
                  <span className="text-lg text-slate-300">{kes(p.amount)} · {p.method === 'mpesa' ? `M-Pesa ${p.mpesa_ref ?? ''}` : 'Cash'} · {p.sold_by} {hhmm(p.sold_at)}</span>
                  <span className="ml-auto text-xl font-semibold tabular-nums">{p.status === 'active' ? `${kes(p.balance)} left` : ''}</span>
                </div>
                {p.uses.map((u, i) => <div key={i} className="mt-1 text-base text-slate-300">Used {kes(u.amount)} for {u.waiter} at {hhmm(u.at)}</div>)}
                {isTonight && p.status === 'active' && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Btn kind="ghost" className="!h-11 !text-base" onClick={() => reprint(p)}>Reprint</Btn>
                    {canSetup && p.uses.length === 0 && (cancel?.id === p.id ? (<>
                      <input className={input + ' min-w-0 flex-1'} placeholder="Why cancel?" value={cancel.why} onChange={e => setCancel({ id: p.id, why: e.target.value })} />
                      <Btn kind="danger" className="!h-11 !text-base" disabled={busy} onClick={doCancel}>Cancel pass</Btn>
                      <Btn kind="ghost" className="!h-11 !text-base" onClick={() => setCancel(null)}>Keep</Btn></>)
                      : <Btn kind="ghost" className="!h-11 !text-base" onClick={() => setCancel({ id: p.id, why: '' })}>Cancel…</Btn>)}
                  </div>)}
              </div>) })}
          </div>
        </div>
      </>)}
    </div>
  )
}
