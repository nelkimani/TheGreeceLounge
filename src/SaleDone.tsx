import { useEffect, useRef, useState } from 'react'
import { supabase } from './supabase'
import { Btn } from './ui'
import PrinterControl from './PrinterControl'
import { printBytes, printerConnected } from './printer'
import { Sale, STATION_LABEL, liveSlips, printSale, receiptBytes, slipBytes } from './sale'
import { ReceiptPreview, SlipPreview } from './SalePreview'

// Shown after SEND (and for reprints). The customer receipt and every captain order print on THIS terminal;
// the waiter carries each captain order to its station. Printing only prints: it never records a second sale.
export default function SaleDone({ sale, onDone, reprint = false, hideReceipt = false }:
  { sale: Sale; onDone: () => void; reprint?: boolean; hideReceipt?: boolean }) {
  const slips = hideReceipt ? sale.slips : liveSlips(sale)
  const [sel, setSel] = useState<string>(hideReceipt ? (slips[0]?.id ?? 'receipt') : 'receipt')
  const [msg, setMsg] = useState('')
  // A second print of the same paper is a reprint and is logged against the order.
  const printed = useRef<Set<string>>(new Set(reprint ? ['receipt', ...sale.slips.map(s => s.id)] : []))
  const auto = useRef(false)

  useEffect(() => {
    if (reprint || auto.current) return
    auto.current = true
    if (!printerConnected()) { setMsg('Printer not connected. Connect it below, or print each one with the print window.'); return }
    printSale(sale).then(r => {
      if (r.ok) { ['receipt', ...liveSlips(sale).map(s => s.id)].forEach(id => printed.current.add(id)); setMsg('Receipt and captain orders sent to the printer.') }
      else setMsg('The printer did not take everything. Use Print this to print each one again.')
    })
  }, [sale, reprint])

  const printOne = async (id: string) => {
    const again = printed.current.has(id)
    if (again) await supabase.rpc('log_reprint', { p_order: sale.order_id, p_captain: id === 'receipt' ? null : id })
    const slip = slips.find(s => s.id === id)
    const bytes = id === 'receipt' ? receiptBytes(sale, again) : slip ? slipBytes(sale, slip, again) : null
    if (!bytes) return
    if (await printBytes(bytes)) setMsg('Sent to the printer.')
    else { setSel(id); setMsg('Printer not connected: opened the print window.'); setTimeout(() => window.print(), 80) }
    printed.current.add(id)
  }
  const printAll = async () => {
    for (const id of [...(hideReceipt ? [] : ['receipt']), ...slips.map(s => s.id)]) await printOne(id)
  }

  const chip = (id: string, label: string) => (
    <button key={id} onClick={() => setSel(id)}
      className={`h-14 rounded-xl px-4 text-lg font-semibold ${sel === id ? 'bg-amber-500 text-on-accent' : 'bg-slate-700'}`}>{label}</button>
  )
  const slip = slips.find(s => s.id === sel)

  return (
    <div className="flex flex-col items-center gap-3 p-4">
      <div className="rounded-xl bg-green-700 px-8 py-3 text-center text-3xl font-bold">
        {reprint ? `Order #${sale.order_no}` : `Order #${sale.order_no} sent`}
      </div>
      {!reprint && (
        <div className="max-w-2xl text-center text-xl text-slate-200">
          Take each captain order to its station: {liveSlips(sale).map(s => STATION_LABEL[s.station]).join(', ')}.
        </div>
      )}
      <div className="flex flex-wrap justify-center gap-2">
        {!hideReceipt && chip('receipt', 'Customer receipt')}
        {slips.map(s => chip(s.id, `${STATION_LABEL[s.station]}${s.voided ? ' VOID' : ''}`))}
      </div>
      {sel === 'receipt' && !hideReceipt ? <ReceiptPreview sale={sale} /> : slip ? <SlipPreview sale={sale} slip={slip} /> : null}
      {msg && <div className="max-w-xl text-center text-lg text-slate-300">{msg}</div>}
      <div className="flex flex-wrap justify-center gap-3">
        <Btn kind="ghost" onClick={() => printOne(sel)}>Print this</Btn>
        <Btn kind="ghost" onClick={printAll}>Print all</Btn>
        <Btn onClick={onDone}>Done</Btn>
      </div>
      <PrinterControl />
      <div className="text-sm text-slate-400">Printing only prints. It never records the sale a second time.</div>
    </div>
  )
}
