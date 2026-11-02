// A sent order ("sale") and how it prints: one customer receipt plus one captain order per station.
import { encodeCaptain, encodeSlip } from './escpos'
import { printBytes } from './printer'
import type { BillLine } from './Receipt'

export type Station = 'bar' | 'choma' | 'restaurant'
export const STATION_LABEL: Record<Station, string> = { bar: 'Bar', choma: 'Choma zone', restaurant: 'Restaurant' }

// Same rule as slip_station() in the database: drinks, all meat, everything else.
export const stationOf = (s: string): Station => (s === 'bar' ? 'bar' : s === 'choma' ? 'choma' : 'restaurant')

export type SaleLine = { qty: number; name: string; price: number; notes?: string | null }
export type SaleSlip = { id: string; slip_no: number; station: Station; lines: SaleLine[]; voided?: boolean }
export type Sale = {
  order_id: string; order_no: number; created_at: string; waiter: string; label: string
  total: number; slips: SaleSlip[]
}

export const liveSlips = (s: Sale) => s.slips.filter(x => !x.voided)

export function receiptLines(s: Sale): BillLine[] {
  return liveSlips(s).flatMap(sl => sl.lines.map((l, i) => ({
    item_id: `${sl.id}-${i}`, product_name: l.name, qty: l.qty, unit_price: l.price,
    line_total: l.qty * l.price, status: 'served',
  })))
}
export const receiptTotal = (s: Sale) => receiptLines(s).reduce((t, l) => t + Number(l.line_total), 0)

export function receiptBytes(s: Sale, copy = false): Uint8Array {
  return encodeSlip({
    heading: `Receipt #${s.order_no}${copy ? ' (COPY)' : ''}`, label: s.label, waiter: s.waiter,
    lines: receiptLines(s), total: receiptTotal(s), footer: 'Thank you',
  }, new Date(s.created_at))
}

export function slipBytes(s: Sale, sl: SaleSlip, copy = false): Uint8Array {
  return encodeCaptain({
    station: sl.station, slipNo: sl.slip_no, orderNo: s.order_no, label: s.label, waiter: s.waiter,
    lines: sl.lines, copy, voided: !!sl.voided,
  }, new Date(s.created_at))
}

/** Customer receipt first, then each station's captain order. Stops at the first failure. */
export async function printSale(s: Sale): Promise<{ ok: boolean }> {
  if (!(await printBytes(receiptBytes(s)))) return { ok: false }
  for (const sl of liveSlips(s)) if (!(await printBytes(slipBytes(s, sl)))) return { ok: false }
  return { ok: true }
}
