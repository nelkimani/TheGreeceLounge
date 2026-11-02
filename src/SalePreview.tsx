// On-screen paper preview of a receipt or captain order. Id "receipt" is what the browser print window prints
// when no USB printer is connected.
import { Sale, SaleSlip, STATION_LABEL, receiptLines, receiptTotal } from './sale'
import { kes } from './lib'

const row = 'flex justify-between gap-2'
const head = (s: Sale) => (
  <>
    <div className="text-center text-base font-bold">THE GLIZZ LOUNGE</div>
    <div className="text-center">CHUKA-NDAGANI</div>
    <div>{s.label} · {s.waiter}</div>
    <div>{new Date(s.created_at).toLocaleString('en-KE')}</div>
    <hr className="my-1 border-black" />
  </>
)

export function ReceiptPreview({ sale }: { sale: Sale }) {
  return (
    <div id="receipt" className="mx-auto w-[72mm] min-w-[72mm] bg-white p-2 font-mono text-[12px] leading-snug text-black">
      {head(sale)}
      <div className="text-center">Receipt #{sale.order_no}</div>
      {receiptLines(sale).map(l => (
        <div key={l.item_id} className={row}><span>{Number(l.qty)} x {l.product_name}</span><span>{Number(l.line_total).toLocaleString('en-KE')}</span></div>
      ))}
      <hr className="my-1 border-black" />
      <div className={`${row} text-xs font-bold`}><span>TOTAL</span><span>{kes(receiptTotal(sale))}</span></div>
      <div className="mt-1 text-center">Thank you</div>
      <div className="text-center text-[10px]">Powered by Mvule Technologies</div>
    </div>
  )
}

export function SlipPreview({ sale, slip }: { sale: Sale; slip: SaleSlip }) {
  return (
    <div id="receipt" className="mx-auto w-[72mm] min-w-[72mm] bg-white p-2 font-mono text-[12px] leading-snug text-black">
      <div className="text-center text-lg font-bold">{STATION_LABEL[slip.station].toUpperCase()}</div>
      <div className="text-center font-bold">{slip.voided ? '*** VOID *** CANCELLED - DO NOT SERVE' : 'CAPTAIN ORDER'}</div>
      <hr className="my-1 border-black" />
      <div className={row}><span>Slip #{slip.slip_no}</span><span>Order #{sale.order_no}</span></div>
      <div>Waiter: {sale.waiter}</div>
      <div>For: {sale.label}</div>
      <div>{new Date(sale.created_at).toLocaleString('en-KE')}</div>
      <hr className="my-1 border-black" />
      {slip.lines.map((l, i) => (
        <div key={i} className="text-sm font-bold"><div>{Number(l.qty)} x {l.name}</div>{l.notes && <div className="pl-3 text-xs">! {l.notes}</div>}</div>
      ))}
    </div>
  )
}
