import { useEffect, useRef, useState } from 'react'
import { supabase, Profile } from './supabase'
import { Btn, HomeBtn, Keypad } from './ui'
import { kes, uid } from './lib'

// Counter: redeem a gate pass. Type the 6-digit code, see what is left on it, enter the value of the drinks served and apply it.
// The value is booked against the waiter whose order it covers, so that waiter is not shown short when clearing.
type Found = { found: boolean; id?: string; code?: string; amount?: number; balance?: number; valid?: boolean; message: string }
type Person = { id: string; staff_no: string; full_name: string }
const input = 'h-14 rounded-lg border border-slate-500 bg-slate-900 px-3 text-xl'
const spaced = (c: string) => (c.length > 3 ? `${c.slice(0, 3)} ${c.slice(3)}` : c)

export default function RedeemPass({ profile, onDone }: { profile: Profile; onDone: () => void }) {
  const [code, setCode] = useState('')
  const [pass, setPass] = useState<Found | null>(null)
  const [amount, setAmount] = useState('')
  const [waiter, setWaiter] = useState(profile.id)
  const [people, setPeople] = useState<Person[]>([])
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(''); const [bad, setBad] = useState(false)
  const [done, setDone] = useState<{ used: number; balance: number } | null>(null)
  const key = useRef(uid())

  useEffect(() => { supabase.from('staff_directory').select('id, staff_no, full_name').order('full_name').then(({ data }) => setPeople((data ?? []) as Person[])) }, [])

  const reset = () => { setCode(''); setPass(null); setAmount(''); setNote(''); setMsg(''); setDone(null); key.current = uid() }
  const check = async (c: string) => {
    setBusy(true); setMsg(''); setDone(null)
    const { data, error } = await supabase.rpc('gate_lookup', { p_code: c })
    setBusy(false)
    if (error) { setMsg(error.message); setBad(true); setPass(null); return }
    const f = data as Found; setPass(f)
    if (f.found && f.valid) { setAmount(''); setMsg(''); } else { setMsg(f.message); setBad(true) }
  }
  const digit = (d: string) => { if (code.length >= 6 || pass || done) return; const c = code + d; setCode(c); if (c.length === 6) check(c) }

  const apply = async () => {
    if (busy || !pass?.valid) return
    const v = Number(amount)
    if (!v || v <= 0) { setMsg('Type the value of the drinks served.'); setBad(true); return }
    setBusy(true)
    const { data, error } = await supabase.rpc('gate_redeem', { p_code: code, p_amount: v, p_waiter: waiter, p_note: note || null, p_key: key.current })
    setBusy(false)
    if (error) { setMsg(error.message); setBad(true); return }
    const r = data as { used: number; balance: number }
    setDone(r); setPass(null); setMsg(''); key.current = uid()
  }

  const bal = Number(pass?.balance ?? 0)
  return (
    <div className="mx-auto max-w-xl space-y-4 p-4">
      <div className="flex items-center gap-3"><HomeBtn onClick={onDone} /><h2 className="text-3xl font-bold">Redeem gate pass</h2></div>

      {done ? (
        <div className="space-y-3 rounded-xl bg-green-800 p-5 text-center">
          <div className="text-3xl font-bold">Applied {kes(done.used)}</div>
          <div className="text-xl">{done.balance > 0 ? `${kes(done.balance)} is still left on the pass (code ${spaced(code)}). Give it back to the guest.` : 'The pass is fully used. Keep the slip.'}</div>
          <Btn onClick={reset} className="w-full">Next pass</Btn>
        </div>
      ) : (<>
        <div className="rounded-xl bg-slate-800 p-4 text-center">
          <div className="text-lg text-slate-300">Pass code</div>
          <div className="my-1 h-14 text-5xl font-bold tracking-widest tabular-nums">{spaced(code) || '— — —'}</div>
          {!pass && <div className="mx-auto max-w-xs"><Keypad onDigit={digit} onBack={() => { setCode(c => c.slice(0, -1)); setMsg('') }} onClear={reset} /></div>}
        </div>
        {msg && <div className={`rounded-lg p-3 text-xl font-semibold ${bad ? 'bg-red-700' : 'bg-green-800'}`}>{msg}</div>}
        {pass?.found && pass.valid && (
          <div className="space-y-3 rounded-xl bg-slate-800 p-4">
            <div className="text-center text-3xl font-bold text-green-400">Valid: {kes(bal)} left <span className="text-lg font-normal text-slate-300">of {kes(Number(pass.amount))}</span></div>
            <label className="block text-xl">Value of the drinks served (KES)
              <input className={input + ' mt-1 w-full'} inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value.replace(/[^0-9.]/g, ''))} placeholder="e.g. 250" /></label>
            <div className="flex flex-wrap gap-2">
              {[...new Set([100, 150, 200, 250, 300, 400].filter(x => x < bal).concat(bal))].map(v => (
                <button key={v} onClick={() => setAmount(String(v))} className={`h-12 rounded-lg px-4 text-lg font-semibold ${Number(amount) === v ? 'bg-amber-500 text-on-accent' : 'bg-slate-700'}`}>{v === bal ? `All ${kes(v)}` : kes(v)}</button>))}
            </div>
            <label className="block text-xl">Waiter whose order this covers
              <select className={input + ' mt-1 w-full'} value={waiter} onChange={e => setWaiter(e.target.value)}>
                {!people.some(p => p.id === profile.id) && <option value={profile.id}>Me ({profile.full_name})</option>}
                {people.map(p => <option key={p.id} value={p.id}>{p.full_name}{p.id === profile.id ? ' (me)' : ''}</option>)}
              </select></label>
            <input className={input + ' w-full'} placeholder="Note (optional): e.g. 2 Tusker" value={note} onChange={e => setNote(e.target.value)} />
            <div className="flex gap-2"><Btn disabled={busy || !Number(amount)} onClick={apply} className="flex-1">Apply to order</Btn><Btn kind="ghost" onClick={reset}>Cancel</Btn></div>
          </div>)}
        {pass && !pass.valid && <Btn kind="ghost" onClick={reset} className="w-full">Try another code</Btn>}
      </>)}
    </div>
  )
}
