// Reads a supplier delivery sheet (Excel) into lines: drink name, quantity, cost each and selling price.
// It looks for the header row by the words in it, so the columns can be in any order:
//   name:     "Item Name", "Item", "Product", "Description"
//   quantity: "Qty", "Quantity"
//   cost:     "Price", "Cost", "Unit price", "Unit cost"        (what you paid per unit)
//   selling:  a column with "Selling" or "Handwritten" in its title, e.g. "Selling Price (handwritten)"
//             (optional; a column that also says Qty, Total or Profit is not the selling price)
// Totals, notes and empty rows are skipped. Formulas are never read, only the typed numbers.

import { readSheetCells, cleanText, type Cell } from './stockSheetReader'

export type DeliveryRow = { row: number; name: string; qty: number; cost: number; sell: number | null }
export type DeliveryRead = { rows: DeliveryRow[]; problems: string[] }

const COLS = 'ABCDEFGHIJ'

function num(v: Cell, what: string, where: string, problems: string[]): number | null {
  if (v == null || (typeof v === 'string' && v.trim() === '')) return null
  const n = typeof v === 'number' ? v : Number(String(v).replace(/,/g, '').trim())
  if (!Number.isFinite(n)) { problems.push(`${where}: ${what} "${String(v)}" is not a number.`); return null }
  if (n < 0) { problems.push(`${where}: ${what} cannot be negative.`); return null }
  if (n > 10_000_000) { problems.push(`${where}: ${what} ${n} is too large. Is it a typing mistake?`); return null }
  return Math.round(n * 100) / 100
}

export async function readDeliverySheet(file: ArrayBuffer): Promise<DeliveryRead> {
  const cells = await readSheetCells(file, null, COLS)
  const lines = [...cells.keys()].sort((a, b) => a - b)

  let header = -1
  const col: { name?: string; qty?: string; cost?: string; sell?: string } = {}
  for (const r of lines.slice(0, 20)) {
    const found: typeof col = {}
    for (const [letter, v] of Object.entries(cells.get(r)!)) {
      const t = cleanText(v).toLowerCase()
      if (!t) continue
      if (/^(item|product|description|drink)/.test(t)) found.name ??= letter
      else if (/^(qty|quantity)/.test(t)) found.qty ??= letter
      else if (/^(unit )?(price|cost)( per unit| each)?$/.test(t)) found.cost ??= letter
      else if (/(selling|handwritten)/.test(t) && !/(qty|total|profit)/.test(t)) found.sell ??= letter
    }
    if (found.name && found.qty && found.cost) { header = r; Object.assign(col, found); break }
  }
  if (header < 0) {
    throw new Error('This does not look like a delivery sheet. It needs a heading row with "Item Name", "Qty" and "Price" (the price you paid for each unit).')
  }

  const problems: string[] = []
  const rows: DeliveryRow[] = []
  for (const r of lines.filter(x => x > header)) {
    const c = cells.get(r)!
    const name = cleanText(c[col.name!])
    if (!name || /^(total|notes?)\b/i.test(name)) continue
    const where = `Row ${r} (${name})`
    const qty = num(c[col.qty!] ?? null, 'Qty', where, problems)
    const cost = num(c[col.cost!] ?? null, 'Price', where, problems)
    const sell = col.sell ? num(c[col.sell] ?? null, 'Selling price', where, problems) : null
    if (qty == null || cost == null) {
      // A long sentence with no numbers is a note, not a drink.
      if (qty == null && cost == null && name.length > 40) continue
      if (!problems.some(p => p.startsWith(where))) problems.push(`${where}: the Qty or the Price is empty.`)
      continue
    }
    if (qty <= 0) { problems.push(`${where}: the Qty must be more than 0.`); continue }
    rows.push({ row: r, name, qty, cost, sell })
  }
  if (rows.length === 0 && problems.length === 0) problems.push('No drinks were found on the sheet.')
  return { rows, problems }
}
