// Turns a receipt into raw ESC/POS bytes for an 80mm thermal printer (Xprinter XP-80T and the
// many Epson-compatible models). 80mm paper, Font A = 48 characters per line.
// Pure functions: no browser APIs, so the output can be checked without a printer.
import type { BillLine } from './Receipt'

export const COLS = 48

export type SlipRow = { left: string; right?: string; bold?: boolean }
export type SlipData = {
  heading: string
  notReceipt?: boolean
  label: string
  waiter: string
  lines: BillLine[]
  total: number
  rows?: SlipRow[]        // extra rows under the total (payment, balance, ...)
  footer?: string         // centred last line, e.g. "Thank you"
}

const ESC = 0x1b, GS = 0x1d, LF = 0x0a

// The printer only understands plain ASCII here. Anything else becomes a safe lookalike or "?".
const clean = (s: string) =>
  s.replace(/[·•]/g, '-').replace(/[–—]/g, '-').replace(/[‘’]/g, "'").replace(/[“”]/g, '"')
   .replace(/\s/g, ' ').replace(/[^\x20-\x7e]/g, '?')

const money = (n: number) => Number(n).toLocaleString('en-KE')

// Wrap text to a width, breaking on spaces where possible.
function wrap(text: string, width: number): string[] {
  const out: string[] = []
  let line = ''
  for (const word of text.split(' ')) {
    let w = word
    while (w.length > width) {            // a single very long word
      if (line) { out.push(line); line = '' }
      out.push(w.slice(0, width)); w = w.slice(width)
    }
    if (!line) line = w
    else if (line.length + 1 + w.length <= width) line += ' ' + w
    else { out.push(line); line = w }
  }
  if (line) out.push(line)
  return out.length ? out : ['']
}

// "left ........ right", with the left side wrapped so the right side always fits on the last line.
export function twoColumn(left: string, right = '', cols = COLS): string[] {
  left = clean(left); right = clean(right)
  if (!right) return wrap(left, cols)
  const room = cols - right.length - 1
  if (room < 8) return [...wrap(left, cols), right.padStart(cols)]
  const parts = wrap(left, room)
  const last = parts.pop() as string
  return [...parts, last + ' '.repeat(cols - last.length - right.length) + right]
}

export function encodeSlip(d: SlipData, now: Date = new Date()): Uint8Array {
  const bytes: number[] = []
  const raw = (...b: number[]) => bytes.push(...b)
  const text = (s: string) => { for (const ch of s) bytes.push(ch.charCodeAt(0)) }
  const line = (s = '') => { text(s); raw(LF) }
  const align = (n: 0 | 1 | 2) => raw(ESC, 0x61, n)          // 0 left, 1 centre, 2 right
  const bold = (on: boolean) => raw(ESC, 0x45, on ? 1 : 0)
  const size = (n: number) => raw(GS, 0x21, n)               // 0x00 normal, 0x11 double width+height
  const rule = (ch = '-') => line(ch.repeat(COLS))

  raw(ESC, 0x40)                                             // reset the printer
  align(1); bold(true); size(0x11); line('THE GREECE LOUNGE'); size(0x00); bold(false)
  line('CHUKA-NDAGANI')
  line(clean(d.heading))
  if (d.notReceipt) { bold(true); rule('='); line('NOT A RECEIPT'); rule('='); bold(false) }
  align(0)
  for (const l of twoColumn(`${d.label} - ${d.waiter}`)) line(l)
  line(clean(now.toLocaleString('en-KE')))
  rule()

  for (const l of d.lines) {
    const name = `${Number(l.qty)} x ${l.product_name}${l.status !== 'served' ? ' *' : ''}`
    for (const t of twoColumn(name, money(l.line_total))) line(t)
  }
  if (d.lines.some(l => l.status !== 'served')) line('* not yet served')
  rule()

  bold(true); size(0x01)                                     // double height only: still fits 48 columns
  for (const t of twoColumn('TOTAL', `KES ${money(d.total)}`, COLS)) line(t)
  size(0x00); bold(false)

  for (const r of d.rows ?? []) {
    bold(!!r.bold)
    for (const t of twoColumn(r.left, r.right)) line(t)
  }
  bold(false)
  if (d.footer) { align(1); line(); line(clean(d.footer)); align(0) }
  align(1); line(); line('Powered by Mvule Technologies'); align(0)

  raw(ESC, 0x64, 5)                                          // feed 5 lines past the print head
  raw(GS, 0x56, 0x01)                                        // partial cut (ignored if no cutter)
  return Uint8Array.from(bytes)
}
