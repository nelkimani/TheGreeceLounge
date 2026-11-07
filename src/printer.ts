// Direct printing from the browser to a thermal receipt printer, three ways:
//   USB        (WebUSB)        80mm Xprinter XP-80T on the terminals. The browser remembers the printer.
//   Bluetooth  (Web Bluetooth) 58mm handheld printers such as the P58E, from Chrome on Android. Pair once per
//                              visit: Chrome forgets Bluetooth printers when the page is reloaded.
//   RawBT app  (Android)       for printers that only do classic Bluetooth, which Chrome cannot talk to:
//                              the slip is handed to the free RawBT app, which prints it.
// Needs HTTPS (the site already is). If no printer is connected, or sending fails, we fall back to
// the normal browser print window so a receipt can always be produced.
// Printing only sends bytes to the printer. It never touches the server or records a payment.
import { useSyncExternalStore } from 'react'
import { COLS, COLS_58, encodeSlip, setPaperCols, SlipData } from './escpos'

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

// Minimal Web Bluetooth types.
type BtChar = { properties: { write: boolean; writeWithoutResponse: boolean }
  writeValueWithoutResponse(v: BufferSource): Promise<void>; writeValue(v: BufferSource): Promise<void> }
type BtService = { getCharacteristics(): Promise<BtChar[]> }
type BtServer = { connected: boolean; getPrimaryServices(): Promise<BtService[]>; disconnect(): void }
type BtDevice = { name?: string; gatt?: { connected: boolean; connect(): Promise<BtServer> }; addEventListener(t: 'gattserverdisconnected', f: () => void): void }
type BtApi = { requestDevice(o: { acceptAllDevices: true; optionalServices: string[] }): Promise<BtDevice> }
const bluetooth = (): BtApi | undefined => (navigator as unknown as { bluetooth?: BtApi }).bluetooth

// Services that cheap 58mm Bluetooth LE receipt printers use for printing (the P58E family and most clones).
const BT_SERVICES = [
  '000018f0-0000-1000-8000-00805f9b34fb', '0000ff00-0000-1000-8000-00805f9b34fb', '0000ffe0-0000-1000-8000-00805f9b34fb',
  '49535343-fe7d-4ae5-8fa9-9fafd205e455', 'e7810a71-73ae-499d-8c15-faa9aef0c3f2', '0000fee7-0000-1000-8000-00805f9b34fb',
  '00001101-0000-1000-8000-00805f9b34fb',
]

const isAndroid = /Android/i.test(navigator.userAgent)
const MODE_KEY = 'pos-printer-mode'
const savedMode = (): Mode | null => { try { const m = localStorage.getItem(MODE_KEY); return m === 'rawbt' ? 'rawbt' : null } catch { return null } }

export type Mode = 'usb' | 'bluetooth' | 'rawbt'
export type PrinterState = {
  status: 'unsupported' | 'disconnected' | 'connecting' | 'connected'
  mode?: Mode
  name?: string
  problem?: string
  can: { usb: boolean; bluetooth: boolean; rawbt: boolean }      // what this device can use
}

const can = { usb: !!usb(), bluetooth: !!bluetooth(), rawbt: isAndroid }
let state: PrinterState = { status: can.usb || can.bluetooth || can.rawbt ? 'disconnected' : 'unsupported', can }
const listeners = new Set<() => void>()
const set = (s: Omit<PrinterState, 'can'>) => { state = { ...s, can }; listeners.forEach(l => l()) }

let dev: UsbDevice | null = null
let endpoint = 0
let btDev: BtDevice | null = null
let btChar: BtChar | null = null
let rawbt = false

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
  btDev = null; btChar = null; rawbt = false; setPaperCols(COLS)
  set({ status: 'connected', mode: 'usb', name: d.productName || d.manufacturerName || 'USB printer' })
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
  if (savedMode() === 'rawbt' && !dev && !btChar) { enableRawbt(false); return }
  if (!api || state.status === 'connecting') return
  let last: unknown = null
  try {
    for (const d of await api.getDevices()) {
      try { await open(d); return } catch (e) { last = e }
    }
  } catch (e) { last = e }
  if (last) set({ status: 'disconnected', problem: explain(last) || undefined })
}

// ───────────── Bluetooth (BLE) ─────────────
async function btOpen(d: BtDevice) {
  const server = await d.gatt!.connect()
  let found: BtChar | null = null
  for (const svc of await server.getPrimaryServices()) {
    for (const c of await svc.getCharacteristics()) {
      if (c.properties.writeWithoutResponse || c.properties.write) { found = found ?? c; if (c.properties.writeWithoutResponse) found = c }
    }
  }
  if (!found) throw new Error('This Bluetooth device has nothing to print to. If it is the P58E, use the RawBT app option instead.')
  btChar = found; btDev = d; dev = null; rawbt = false
  setPaperCols(COLS_58)
  set({ status: 'connected', mode: 'bluetooth', name: d.name || 'Bluetooth printer' })
}

/** Ask the person to pick a Bluetooth printer (58mm handheld such as the P58E). Must be called from a tap. */
export async function connectBluetooth() {
  const api = bluetooth()
  if (!api) return
  set({ status: 'connecting', mode: 'bluetooth' })
  try {
    const d = await api.requestDevice({ acceptAllDevices: true, optionalServices: BT_SERVICES })
    d.addEventListener('gattserverdisconnected', () => { if (btDev === d) { btChar = null; set({ status: 'disconnected', problem: 'The Bluetooth printer disconnected. Check that it is on, then connect it again.' }) } })
    await btOpen(d)
  } catch (e) {
    btDev = null; btChar = null
    const err = e as { name?: string; message?: string }
    set({ status: 'disconnected', problem: err?.name === 'NotFoundError' ? undefined : (err?.message || 'Could not connect to the Bluetooth printer.') })
  }
}

// ───────────── RawBT app (Android) ─────────────
let rawQueue: Uint8Array[] = []
let rawTimer: ReturnType<typeof setTimeout> | null = null
function rawFlush() {
  rawTimer = null
  const total = rawQueue.reduce((n, b) => n + b.length, 0), all = new Uint8Array(total)
  let o = 0; for (const b of rawQueue) { all.set(b, o); o += b.length }
  rawQueue = []
  let bin = ''; for (let i = 0; i < all.length; i += 0x8000) bin += String.fromCharCode(...all.subarray(i, i + 0x8000))
  window.location.href = `intent:base64,${btoa(bin)}#Intent;scheme=rawbt;package=ru.a402d.rawbtprinter;end;`
}

/** Print through the free RawBT app. Slips sent close together are joined into one print job. */
export function enableRawbt(remember = true) {
  btDev = null; btChar = null; dev = null; rawbt = true
  setPaperCols(COLS_58)
  if (remember) { try { localStorage.setItem(MODE_KEY, 'rawbt') } catch { /* not remembered */ } }
  set({ status: 'connected', mode: 'rawbt', name: 'RawBT app' })
}

/** Forget the current printer so another can be chosen. */
export function disconnectPrinter() {
  try { btDev?.gatt?.connected && (btDev as unknown as { gatt: { disconnect(): void } }).gatt.disconnect() } catch { /* already gone */ }
  btDev = null; btChar = null; dev = null; rawbt = false
  try { localStorage.removeItem(MODE_KEY) } catch { /* ignore */ }
  setPaperCols(COLS)
  set({ status: 'disconnected' })
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

async function sendBluetooth(bytes: Uint8Array) {
  if (!btDev || !btChar) throw new Error('Printer not connected.')
  if (!btDev.gatt?.connected) await btOpen(btDev)                  // the printer went to sleep: reconnect without asking
  const c = btChar as BtChar
  for (let i = 0; i < bytes.length; i += 100) {
    const part = bytes.slice(i, i + 100)
    if (c.properties.writeWithoutResponse) await c.writeValueWithoutResponse(part); else await c.writeValue(part)
    await new Promise(r => setTimeout(r, 20))                       // small printers drop data if it comes too fast
  }
}

async function send(bytes: Uint8Array) {
  if (rawbt) { rawQueue.push(bytes); if (!rawTimer) rawTimer = setTimeout(rawFlush, 350); return }
  if (btChar) return sendBluetooth(bytes)
  if (!dev) throw new Error('Printer not connected.')
  for (let i = 0; i < bytes.length; i += 4096) {
    const r = await dev.transferOut(endpoint, bytes.slice(i, i + 4096))
    if (r.status !== 'ok') throw new Error('The printer did not accept the data.')
  }
}

// The printer stopped taking data: say so and let the person reconnect (a Bluetooth one keeps its pairing for a quiet retry).
function lost() {
  const bt = !!btChar
  if (!bt) dev = null
  btChar = null
  set({ status: 'disconnected', problem: bt ? 'The Bluetooth printer stopped responding. Check that it is on and close by, then connect it again.'
    : 'The printer stopped responding. Check the cable and power, then connect it again.' })
}

/** Print a slip: straight to the USB printer if connected, otherwise the browser print window.
 *  Returns a short message for the screen. */
export async function printSlip(data: SlipData): Promise<string> {
  if (state.status === 'connected') {
    try {
      await send(encodeSlip(data))
      return 'Sent to the printer.'
    } catch {
      lost()
      window.print()
      return 'Printer not responding, opened the print window instead.'
    }
  }
  window.print()
  return ''
}

/** Send raw bytes to the USB printer. Returns false (and prints nothing) when no printer is connected or it fails. */
export async function printBytes(bytes: Uint8Array): Promise<boolean> {
  if (state.status !== 'connected') return false
  try { await send(bytes); return true } catch {
    lost()
    return false
  }
}
export const printerConnected = () => state.status === 'connected'

const api = usb()
if (api) {
  api.addEventListener('disconnect', () => { if (dev) { dev = null; set({ status: 'disconnected' }) } })
  api.addEventListener('connect', () => { if (!btChar && !rawbt) void restorePrinter() })
}
void restorePrinter()

const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l) } }
export const usePrinter = (): PrinterState => useSyncExternalStore(subscribe, () => state)
