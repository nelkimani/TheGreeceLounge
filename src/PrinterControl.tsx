import { useState } from 'react'
import { connectPrinter, usePrinter } from './printer'
import { Btn } from './ui'

// Small status line + "Connect printer" button, shown beside the Print buttons.
// Pairing needs a tap (browser rule); after that the browser remembers the printer on this terminal.
export default function PrinterControl() {
  const p = usePrinter()
  const [all, setAll] = useState(false)

  if (p.status === 'unsupported') {
    return <div className="text-sm text-slate-400">Direct printing needs Chrome or Edge. Print uses the normal print window here.</div>
  }
  return (
    <div className="flex flex-col items-center gap-2 text-center">
      <div className="flex items-center gap-2 text-lg">
        <span className={`inline-block h-3 w-3 rounded-full ${p.status === 'connected' ? 'bg-green-500' : 'bg-slate-500'}`} />
        {p.status === 'connected' ? `Printer: ${p.name}`
          : p.status === 'connecting' ? 'Connecting printer…'
          : 'Printer not connected (Print opens the print window)'}
      </div>
      {p.status !== 'connected' && (
        <div className="flex gap-2">
          <Btn kind="ghost" disabled={p.status === 'connecting'} onClick={() => connectPrinter(all)}>Connect printer</Btn>
          {p.problem && !all && <Btn kind="ghost" onClick={() => setAll(true)}>Show all USB devices</Btn>}
        </div>
      )}
      {p.problem && <div className="max-w-md text-sm text-amber-400">{p.problem}</div>}
    </div>
  )
}
