import { ReactNode } from 'react'
import { kes } from './lib'
import type { SlipRow } from './escpos'

export type BillLine = {
  item_id: string; product_name: string; qty: number; unit_price: number; line_total: number; status: string
}
export type CardRow = {
  tab_id: string; table_number: string | null; customer_name: string | null; waiter_name: string; waiter_id?: string
  status: string; bill_total: number; paid: number; balance: number; pending_total: number
}
export type PaymentRow = {
  id: string; receipt_no: number; method: 'cash' | 'mpesa'; amount: number; mpesa_code: string | null
  tendered_amount: number | null; change_given: number | null; entered_at: string
}

const row = 'flex justify-between gap-2'

// 80mm slip (72mm printable width). On screen it previews as white paper; Print shows only this block.
export function Slip({ heading, notReceipt, label, waiter, lines, total, children }:
  { heading: string; notReceipt?: boolean; label: string; waiter: string; lines: BillLine[]; total: number; children?: ReactNode }) {
  return (
    <div id="receipt" className="mx-auto w-[72mm] min-w-[72mm] bg-white p-2 font-mono text-[12px] leading-snug text-black">
      <div className="text-center text-base font-bold">THE GREECE LOUNGE</div>
      <div className="text-center">CHUKA-NDAGANI</div>
      <div className="text-center">{heading}</div>
      {notReceipt && <div className="my-1 border border-black text-center font-bold">NOT A RECEIPT</div>}
      <div>{label} · {waiter}</div>
      <div>{new Date().toLocaleString('en-KE')}</div>
      <hr className="my-1 border-black" />
      {lines.map(l => (
        <div key={l.item_id} className={row}>
          <span>{Number(l.qty)} x {l.product_name}{l.status !== 'served' ? ' *' : ''}</span>
          <span>{Number(l.line_total).toLocaleString('en-KE')}</span>
        </div>
      ))}
      {lines.some(l => l.status !== 'served') && <div>* not yet served</div>}
      <hr className="my-1 border-black" />
      <div className={`${row} text-xs font-bold`}><span>TOTAL</span><span>{kes(total)}</span></div>
      {children}
    </div>
  )
}

// The payment block under the total. One list feeds both the on-screen slip and the USB printer.
export function paymentRows(p: PaymentRow, remaining: number): SlipRow[] {
  const rows: SlipRow[] = [
    { left: `Receipt #${p.receipt_no}`, right: p.method === 'cash' ? 'CASH' : 'M-PESA' },
    { left: 'Paid', right: kes(p.amount) },
  ]
  if (p.method === 'cash' && p.tendered_amount != null) {
    rows.push({ left: 'Cash given', right: kes(p.tendered_amount) }, { left: 'Change', right: kes(p.change_given) })
  }
  if (p.mpesa_code) rows.push({ left: 'M-Pesa code', right: p.mpesa_code })
  rows.push({ left: 'Balance', right: kes(remaining), bold: true })
  return rows
}

export function PaymentLines({ p, remaining }: { p: PaymentRow; remaining: number }) {
  return (
    <div className="mt-1 border-t border-black pt-1">
      {paymentRows(p, remaining).map((r, i) => (
        <div key={i} className={`${row}${r.bold ? ' font-bold' : ''}`}><span>{r.left}</span><span>{r.right}</span></div>
      ))}
      <div className="mt-1 text-center">Thank you</div>
    </div>
  )
}
