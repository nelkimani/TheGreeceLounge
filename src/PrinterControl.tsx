import { useState } from 'react'
import { connectBluetooth, connectPrinter, disconnectPrinter, enableRawbt, usePrinter } from './printer'
import { Btn } from './ui'

// Status line + the buttons to connect a printer, shown beside the Print buttons.
//   USB (terminals, 80mm): pair once, the browser remembers it.
//   Bluetooth (phones, 58mm handheld such as the P58E): pair each time the page is opened.
//   RawBT app (Android): for printers Chrome cannot reach directly; the slip is handed to the RawBT app.
export default function PrinterControl() {
  const p = usePrinter()
  const [all, setAll] = useState(false)

  if (p.status === 'unsupported') {
    return <div className="text-sm text-slate-400">Direct printing needs Chrome or Edge. Print uses the normal print window here.</div>
  }
  const how = p.mode === 'bluetooth' ? 'Bluetooth' : p.mode === 'rawbt' ? 'RawBT app' : 'USB'
  return (
    <div className="flex flex-col items-center gap-2 text-center">
      <div className="flex items-center gap-2 text-lg">
        <span className={`inline-block h-3 w-3 shrink-0 rounded-full ${p.status === 'connected' ? 'bg-green-500' : 'bg-slate-500'}`} />
        {p.status === 'connected' ? `Printer: ${p.name} (${how})`
          : p.status === 'connecting' ? 'Connecting printer…'
          : 'Printer not connected (Print opens the print window)'}
      </div>
      {p.status !== 'connected' && (
        <div className="flex flex-wrap justify-center gap-2">
          {p.can.bluetooth && <Btn kind="ghost" disabled={p.status === 'connecting'} onClick={connectBluetooth}>Connect Bluetooth printer</Btn>}
          {p.can.usb && <Btn kind="ghost" disabled={p.status === 'connecting'} onClick={() => connectPrinter(all)}>Connect USB printer</Btn>}
          {p.can.rawbt && <Btn kind="ghost" onClick={() => enableRawbt()}>Print with RawBT app</Btn>}
          {p.can.usb && p.problem && !all && <Btn kind="ghost" onClick={() => setAll(true)}>Show all USB devices</Btn>}
        </div>
      )}
      {p.status === 'connected' && p.mode !== 'usb' && (
        <button onClick={disconnectPrinter} className="text-sm text-slate-400 underline">Use a different printer</button>
      )}
      {p.mode === 'rawbt' && p.status === 'connected' && (
        <div className="max-w-md text-sm text-slate-400">Install the free RawBT app, pair the printer in RawBT once, then Print opens RawBT and prints.</div>
      )}
      {p.problem && <div className="max-w-md text-sm text-amber-400">{p.problem}</div>}
    </div>
  )
}
