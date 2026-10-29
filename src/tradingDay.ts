import { useCallback, useEffect, useState } from 'react'
import { supabase } from './supabase'

// The trading day rolls over at 05:00 Nairobi (UTC+3), which is 02:00 UTC, so subtracting 2 hours
// from the UTC clock gives the trading date no matter what time zone the computer is set to.
export const tradingDate = () => new Date(Date.now() - 2 * 3600_000).toISOString().slice(0, 10)

export const formatTradingDate = (d: string) =>
  new Date(d + 'T00:00:00Z').toLocaleDateString('en-KE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })

export type DayStatus = 'loading' | 'unknown' | 'open' | 'provisional' | 'submitted' | 'returned' | 'closed'

export const DAY_STATUS: Record<Exclude<DayStatus, 'loading' | 'unknown'>, { label: string; tone: string; hint: string }> = {
  open:        { label: 'Open',                 tone: 'bg-green-700',                   hint: 'Trading is under way. The day has not been closed.' },
  provisional: { label: 'Provisional close',    tone: 'bg-amber-500 text-on-accent',    hint: 'A provisional close was submitted; it still needs a final close.' },
  submitted:   { label: 'Close awaiting approval', tone: 'bg-amber-500 text-on-accent', hint: 'The day close was submitted and is waiting for approval.' },
  returned:    { label: 'Close returned',       tone: 'bg-red-700',                     hint: 'The day close was returned for correction.' },
  closed:      { label: 'Closed',               tone: 'bg-slate-600',                   hint: 'The day is closed and approved. No more changes can be made to it.' },
}

const fromRow = (status: string | null | undefined): DayStatus =>
  status === 'approved' ? 'closed'
  : status === 'submitted' ? 'submitted'
  : status === 'returned' ? 'returned'
  : status === 'provisional' ? 'provisional'
  : 'open'

// Today's trading date and whether the day is open or closed.
// Only people who may see reconciliation can read the day-close record, so for everyone else the
// status stays 'unknown' and the top bar simply shows the date.
export function useTradingDay(canSeeClose: boolean) {
  const [date, setDate] = useState(tradingDate())
  const [status, setStatus] = useState<DayStatus>(canSeeClose ? 'loading' : 'unknown')

  const refresh = useCallback(async () => {
    const d = tradingDate()
    setDate(d)
    if (!canSeeClose) return
    const { data, error } = await supabase.from('daily_closes').select('status')
      .eq('business_date', d).is('shift_id', null).maybeSingle()
    if (error) { setStatus(s => (s === 'loading' ? 'unknown' : s)); return }   // offline: keep what we last knew
    setStatus(fromRow(data?.status))
  }, [canSeeClose])

  useEffect(() => {
    refresh()
    const t = setInterval(refresh, 60_000)
    const onFocus = () => refresh()
    window.addEventListener('focus', onFocus)
    window.addEventListener('online', onFocus)
    return () => { clearInterval(t); window.removeEventListener('focus', onFocus); window.removeEventListener('online', onFocus) }
  }, [refresh])

  return { date, status, refresh }
}
