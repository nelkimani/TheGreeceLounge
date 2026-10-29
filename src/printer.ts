// Direct USB printing from the browser (WebUSB) to a thermal receipt printer such as the Xprinter XP-80T.
// Needs HTTPS (the site already is) and Chrome or Edge. Each terminal pairs its own printer once; the
// browser remembers the permission. If the printer is not connected, or sending fails, we fall back to
// the normal browser print window so a receipt can always be produced.
// Printing only sends bytes to the printer. It never touches the server or records a payment.
import { useSyncExternalStore } from 'react'
import { encodeSlip, SlipData } from './escpos'

// Minimal WebUSB types (the TypeScript DOM library does not include them).
type UsbEndpoint = { endpointNumber: number; direction: 'in' | 'out'; type: string }
type UsbAlternate = { interfaceClass: number; endpoints: UsbEndpoint[] }
type UsbInterface = { interfaceNumber: number; alternates: UsbAlternate[] }
type UsbDevice = {
  opened: boolean; productName?: string; manufacturerName?: string
  configuration: { interfaces: UsbInterface[] } | null
  open(): Promise<void>; close(): Promise<void>
  selectConfiguration(n: number): Promise<void>
  claimInterface(n: number): Promise<void>
  transferOut(endpoint: number, data: BufferSource): Promise<{ status: string }>
}
type UsbApi = {
  getDevices(): Promise<UsbDevice[]>
  requestDevice(o: { filters: { classCode?: number }[] }): Promise<UsbDevice>
  addEventListener(type: 'connect' | 'disconnect', fn: () => void): void
}
const usb = (): UsbApi | undefined => (navigator as unknown as { usb?: UsbApi }).usb

export type PrinterState = {
  status: 'unsupported' | 'disconnected' | 'connecting' | 'connected'
  name?: string
  problem?: string
}

let state: PrinterState = { status: usb() ? 'disconnected' : 'unsupported' }
const listeners = new Set<() => void>()
const set = (s: PrinterState) => { state = s; listeners.forEach(l => l()) }

let dev: UsbDevice | null = null
let endpoint = 0

const WINDOWS_HINT =
  'Windows is holding this printer with its own driver. Swap it to the WinUSB driver (see TERMINAL_SETUP.md), then try again.'

// Find the interface that can take data: prefer the printer class (7), accept any with a bulk OUT endpoint.
function findOut(d: UsbDevice): { iface: number; ep: number } | null {
  const ifaces = d.configuration?.interfaces ?? []
  let fallback: { iface: number; ep: number } | null = null
  for (const i of ifaces) {
    for (const alt of i.alternates) {
      const out = alt.endpoints.find(e => e.direction === 'out' && e.type === 'bulk')
      if (!out) continue
      const hit = { iface: i.interfaceNumber, ep: out.endpointNumber }
      if (alt.interfaceClass === 7) return hit
      fallback = fallback ?? hit
    }
  }
  return fallback
}

async function open(d: UsbDevice) {
  if (!d.opened) await d.open()
  if (!d.configuration) await d.selectConfiguration(1)
  const found = findOut(d)
  if (!found) throw new Error('This USB device has no printing channel. Pick the printer, not another device.')
  await d.claimInterface(found.iface)
  dev = d; endpoint = found.ep
  set({ status: 'connected', name: d.productName || d.manufacturerName || 'USB printer' })
}

function explain(e: unknown): string {
  const err = e as { name?: string; message?: string }
  if (err?.name === 'NotFoundError') return ''            // person closed the picker: not a problem
  if (err?.name === 'SecurityError' || err?.name === 'NetworkError' || /claim|access denied/i.test(err?.message ?? ''))
    return WINDOWS_HINT
  return err?.message || 'Could not open the printer.'
}

/** Reconnect to a printer this browser was already allowed to use. Safe to call any time. */
export async function restorePrinter() {
  const api = usb()
  if (!api || state.status === 'connecting') return
  let last: unknown = null
  try {
    for (const d of await api.getDevices()) {
      try { await open(d); return } catch (e) { last = e }
    }
  } catch (e) { last = e }
  if (last) set({ status: 'disconnected', problem: explain(last) || undefined })
}

/** Ask the person to pick the printer. Must be called from a tap (browser rule). */
export async function connectPrinter(showAll = false) {
  const api = usb()
  if (!api) return
  set({ ...state, status: 'connecting', problem: undefined })
  try {
    await open(await api.requestDevice({ filters: showAll ? [] : [{ classCode: 7 }] }))
  } catch (e) {
    dev = null
    set({ status: 'disconnected', problem: explain(e) || undefined })
  }
}

async function send(bytes: Uint8Array) {
  if (!dev) throw new Error('Printer not connected.')
  for (let i = 0; i < bytes.length; i += 4096) {
    const r = await dev.transferOut(endpoint, bytes.slice(i, i + 4096))
    if (r.status !== 'ok') throw new Error('The printer did not accept the data.')
  }
}

/** Print a slip: straight to the USB printer if connected, otherwise the browser print window.
 *  Returns a short message for the screen. */
export async function printSlip(data: SlipData): Promise<string> {
  if (state.status === 'connected') {
    try {
      await send(encodeSlip(data))
      return 'Sent to the printer.'
    } catch {
      dev = null
      set({ status: 'disconnected', problem: 'The printer stopped responding. Check the cable and power, then connect it again.' })
      window.print()
      return 'Printer not responding, opened the print window instead.'
    }
  }
  window.print()
  return ''
}

const api = usb()
if (api) {
  api.addEventListener('disconnect', () => { dev = null; set({ status: 'disconnected' }) })
  api.addEventListener('connect', () => { void restorePrinter() })
  void restorePrinter()
}

const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l) } }
export const usePrinter = (): PrinterState => useSyncExternalStore(subscribe, () => state)
