// Reads the filled "Stock sheet" tab of the Excel template (columns A to D) without any library.
// An .xlsx file is a zip of XML files, so this opens the zip, reads the shared strings and the sheet,
// and returns one row per drink. Only the four input columns are read; the formulas are ignored.
//
// Needs DecompressionStream (all current Chrome, Edge, Firefox and Safari 16.4+).

export type SheetRow = { row: number; category: string; name: string; price: number | null; qty: number | null }
export type ReadResult = { rows: SheetRow[]; problems: string[] }

export const SHEET_NAME = 'Stock sheet'
const MAX_ROWS = 2000

const utf8 = new TextDecoder()

// ───────────── zip ─────────────
type Entry = { method: number; compSize: number; offset: number }

function readDirectory(buf: Uint8Array): Map<string, Entry> {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  let eocd = -1
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break }
  }
  if (eocd < 0) throw new Error('This is not an Excel (.xlsx) file.')
  const count = dv.getUint16(eocd + 10, true)
  let p = dv.getUint32(eocd + 16, true)
  const out = new Map<string, Entry>()
  for (let n = 0; n < count; n++) {
    if (p + 46 > buf.length || dv.getUint32(p, true) !== 0x02014b50) throw new Error('The Excel file looks damaged.')
    const nameLen = dv.getUint16(p + 28, true), extraLen = dv.getUint16(p + 30, true), commentLen = dv.getUint16(p + 32, true)
    out.set(utf8.decode(buf.subarray(p + 46, p + 46 + nameLen)), {
      method: dv.getUint16(p + 10, true), compSize: dv.getUint32(p + 20, true), offset: dv.getUint32(p + 42, true),
    })
    p += 46 + nameLen + extraLen + commentLen
  }
  return out
}

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data.slice()]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

async function readText(buf: Uint8Array, dir: Map<string, Entry>, name: string): Promise<string | null> {
  const e = dir.get(name)
  if (!e) return null
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  if (dv.getUint32(e.offset, true) !== 0x04034b50) throw new Error('The Excel file looks damaged.')
  const start = e.offset + 30 + dv.getUint16(e.offset + 26, true) + dv.getUint16(e.offset + 28, true)
  const raw = buf.subarray(start, start + e.compSize)
  if (e.method === 0) return utf8.decode(raw)
  if (e.method === 8) return utf8.decode(await inflateRaw(raw))
  throw new Error('This Excel file uses a compression type that is not supported. Save it again as .xlsx from Excel.')
}

// ───────────── xml ─────────────
const unescapeXml = (s: string) =>
  s.replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
   .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
   .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')

const attrs = (s: string) => {
  const o: Record<string, string> = {}
  for (const m of s.matchAll(/([\w:.-]+)="([^"]*)"/g)) o[m[1]] = unescapeXml(m[2])
  return o
}

const textOf = (xml: string) => {
  const clean = xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '')
  let s = ''
  for (const m of clean.matchAll(/<t\b[^>]*?>([\s\S]*?)<\/t>/g)) s += m[1]
  return unescapeXml(s)
}

function sharedStrings(xml: string | null): string[] {
  if (!xml) return []
  const out: string[] = []
  for (const m of xml.matchAll(/<si\b[^>]*?(?:\/>|>([\s\S]*?)<\/si>)/g)) out.push(textOf(m[1] ?? ''))
  return out
}

async function findSheetXml(buf: Uint8Array, dir: Map<string, Entry>, wanted: string | null): Promise<string> {
  const wb = await readText(buf, dir, 'xl/workbook.xml')
  const rels = await readText(buf, dir, 'xl/_rels/workbook.xml.rels')
  if (!wb || !rels) throw new Error('This is not an Excel (.xlsx) file.')
  let rid = ''
  for (const m of wb.matchAll(/<sheet\b([^>]*?)\/?>/g)) {
    const a = attrs(m[1])
    if (!rid && (wanted === null || a.name === wanted)) { rid = Object.entries(a).find(([k]) => /(^|:)id$/.test(k) && k !== 'sheetId')?.[1] ?? '' }
  }
  if (!rid) throw new Error(wanted === null ? 'The Excel file has no sheet in it.' : `The tab called "${wanted}" was not found. Please use the sheet downloaded from the app and do not rename its tabs.`)
  let target = ''
  for (const m of rels.matchAll(/<Relationship\b([^>]*?)\/?>/g)) {
    const a = attrs(m[1])
    if (a.Id === rid) target = a.Target
  }
  if (!target) throw new Error('The Excel file looks damaged.')
  const path = target.startsWith('/') ? target.slice(1) : 'xl/' + target
  const xml = await readText(buf, dir, path)
  if (!xml) throw new Error('The Excel file looks damaged.')
  return xml
}

export type Cell = string | number | boolean | null

// Returns rows -> column letter -> value, for the given single-letter columns only (default A to D).
function readCells(sheetXml: string, strings: string[], cols = 'ABCD'): Map<number, Record<string, Cell>> {
  const rows = new Map<number, Record<string, Cell>>()
  for (const m of sheetXml.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
    const a = attrs(m[1])
    const ref = /^([A-Z]+)(\d+)$/.exec(a.r ?? '')
    if (!ref || ref[1].length !== 1 || !cols.includes(ref[1])) continue
    const inner = m[2] ?? ''
    const v = /<v\b[^>]*?>([\s\S]*?)<\/v>/.exec(inner)?.[1]
    let val: Cell = null
    if (a.t === 'inlineStr') val = textOf(inner)
    else if (v === undefined) val = null
    else if (a.t === 's') val = strings[Number(v)] ?? null
    else if (a.t === 'str') val = unescapeXml(v)
    else if (a.t === 'b') val = v === '1'
    else if (a.t === 'e') val = null
    else { const n = Number(v); val = Number.isFinite(n) ? n : null }
    const r = Number(ref[2])
    const row = rows.get(r) ?? {}
    row[ref[1]] = val
    rows.set(r, row)
  }
  return rows
}

// ───────────── the sheet ─────────────
const clean = (v: Cell) => (v == null ? '' : String(v)).replace(/\s+/g, ' ').trim()

function toNumber(v: Cell, what: string, where: string, problems: string[]): number | null {
  if (v == null || v === '') return null
  const n = typeof v === 'number' ? v : Number(String(v).replace(/,/g, '').trim())
  if (typeof v === 'string' && v.trim() === '') return null
  if (!Number.isFinite(n)) { problems.push(`${where}: ${what} "${String(v)}" is not a number.`); return null }
  if (n < 0) { problems.push(`${where}: ${what} cannot be negative.`); return null }
  if (n > 1_000_000) { problems.push(`${where}: ${what} ${n} is too large. Is it a typing mistake?`); return null }
  return Math.round(n * 1000) / 1000
}

// Cell values of one sheet (the first sheet when sheetName is null), columns given as letters, e.g. 'ABCDEFGH'.
export async function readSheetCells(file: ArrayBuffer, sheetName: string | null, cols: string): Promise<Map<number, Record<string, Cell>>> {
  const buf = new Uint8Array(file)
  const dir = readDirectory(buf)
  const strings = sharedStrings(await readText(buf, dir, 'xl/sharedStrings.xml'))
  return readCells(await findSheetXml(buf, dir, sheetName), strings, cols)
}

export const cleanText = (v: Cell) => (v == null ? '' : String(v)).replace(/\s+/g, ' ').trim()

export async function readStockSheet(file: ArrayBuffer): Promise<ReadResult> {
  const cells = await readSheetCells(file, SHEET_NAME, 'ABCD')

  const problems: string[] = []
  const lines = [...cells.keys()].sort((a, b) => a - b)
  const header = lines.find(r => {
    const c = cells.get(r)!
    return clean(c.A).toLowerCase() === 'category' && clean(c.B).toLowerCase() === 'product'
  })
  if (header === undefined) {
    throw new Error('The columns "Category" and "Product" were not found. Please use the sheet downloaded from the app and keep its first columns as they are.')
  }

  const rows: SheetRow[] = []
  const seen = new Map<string, number>()
  for (const r of lines.filter(x => x > header)) {
    const c = cells.get(r)!
    const name = clean(c.B), category = clean(c.A)
    const where = `Row ${r}${name ? ` (${name})` : ''}`
    const qty = toNumber(c.D ?? null, 'Opening stock', where, problems)
    const price = toNumber(c.C ?? null, 'Price', where, problems)
    if (!name) {
      if (category || qty != null || price != null) problems.push(`Row ${r}: there is a ${category ? 'category' : 'number'} but no product name.`)
      continue
    }
    if (!category) { problems.push(`${where}: the Category is empty.`); continue }
    const key = name.toLowerCase()
    if (seen.has(key)) { problems.push(`${where}: this product is already listed on row ${seen.get(key)}.`); continue }
    seen.set(key, r)
    rows.push({ row: r, category, name, price, qty })
  }
  if (rows.length === 0) problems.push('No products were found on the sheet.')
  if (rows.length > MAX_ROWS) throw new Error(`The sheet has more than ${MAX_ROWS} products. Please split it.`)
  return { rows, problems }
}
