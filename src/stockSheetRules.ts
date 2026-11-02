// How a row of the stock sheet becomes a product in the catalogue.
// (The drink list itself lives in tools/stock_sheet_products.json and is built into the Excel template.)

// Sheet categories whose products are NOT liquor. Everything else on the sheet is liquor.
const NOT_LIQUOR = new Set(['CIGARETTES', 'OTHERS', 'SOFT DRINKS'])
export const isLiquorCategory = (category: string) => !NOT_LIQUOR.has(category.trim().toUpperCase())

export type SheetUnit = 'bottle' | 'can' | 'tot' | 'portion' | 'piece'

// What one counted unit is: cans are 'can', tots are 'tot', wine by the glass is a 'portion',
// cigarettes and other counter items are 'piece', and everything else is a 'bottle'.
export function unitFor(category: string, name: string): SheetUnit {
  const c = category.trim().toUpperCase()
  if (/\bCAN\b/i.test(name)) return 'can'
  if (c === 'TOTS') return 'tot'
  if (c === 'WINE ON GLASS') return 'portion'
  if (c === 'CIGARETTES' || c === 'OTHERS') return 'piece'
  return 'bottle'
}

// "BEERS" -> "Beers", "WINE ON GLASS" -> "Wine on glass". Categories typed in mixed case are kept as typed.
export const categoryName = (c: string) => {
  const t = c.trim().replace(/\s+/g, ' ')
  return t === t.toUpperCase() ? t.charAt(0) + t.slice(1).toLowerCase() : t
}
