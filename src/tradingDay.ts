import { useCallback, useEffect, useState } from 'react'
import { supabase } from './supabase'

// Fallback only: the trading day is closed BY HAND (migration 047). Until the database answers (or if that migration has not been
// run yet) we use the automatic rule: it rolls over at 08:00 Nairobi (UTC+3), matching business_settings.day_rollover_hour (migration 045).
// Subtracting (rollover hour - 3) hours from the UTC clock gives the trading date no matter what time zone the computer is set to.
export const ROLLOVER_HOUR = 8
export const ROLLOVER_LABEL = String(ROLLOVER_HOUR).padStart(2, '0') + ':00'
export const tradingShift = (d = new Date()) => new Date(d.getTime() - (ROLLOVER_HOUR - 3) * 3600_000)
const fallbackDate = () => tradingShift().toISOString().slice(0, 10)

type Open = { date: string; openedAt: string | null }
let open: Open | null = null
const listeners = new Set<() => void>()

export const tradingDate = () => open?.date ?? fallbackDate()
export const tradingDayOpenedAt = () => open?.openedAt ?? null

/** Ask the database which trading day is open now. Safe to call often; screens update when the answer changes. */
export async function refreshTradingDay(): Promise<void> {
  const { data, error } = await supabase.rpc('current_trading_day')
  if (error || !data) return
  const d = data as { date?: string; opened_at?: string | null }
  if (!d.date) return
  const next = { date: d.date, openedAt: d.opened_at ?? null }
  const changed = !open || open.date !== next.date || open.openedAt !== next.openedAt
  open = next
  if (changed) listeners.forEach(l => l())
}

/** Keeps the open day fresh while signed in (terminals included), so nobody keeps selling into a day that was just ended. */
export function useTradingDayRefresh(active: boolean) {
  useEffect(() => {
    if (!active) return
    void refreshTradingDay()
    const t = setInterval(() => { void refreshTradingDay() }, 60_000)
    const on = () => { void refreshTradingDay() }
    window.addEventListener('focus', on); window.addEventListener('online', on)
    return () => { clearInterval(t); window.removeEventListener('focus', on); window.removeEventListener('online', on) }
  }, [active])
}

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

// The open trading date and whether the day is open or closed.
// Only people who may see reconciliation can read the day-close record, so for everyone else the
// status stays 'unknown' and the top bar simply shows the date.
export function useTradingDay(canSeeClose: boolean) {
  const [date, setDate] = useState(tradingDate())
  const [openedAt, setOpenedAt] = useState<string | null>(tradingDayOpenedAt())
  const [status, setStatus] = useState<DayStatus>(canSeeClose ? 'loading' : 'unknown')

  const refresh = useCallback(async () => {
    await refreshTradingDay()
    const d = tradingDate()
    setDate(d); setOpenedAt(tradingDayOpenedAt())
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
    const onChange = () => { setDate(tradingDate()); setOpenedAt(tradingDayOpenedAt()) }
    listeners.add(onChange)
    window.addEventListener('focus', onFocus)
    window.addEventListener('online', onFocus)
    return () => { clearInterval(t); listeners.delete(onChange); window.removeEventListener('focus', onFocus); window.removeEventListener('online', onFocus) }
  }, [refresh])

  return { date, openedAt, status, refresh }
}
