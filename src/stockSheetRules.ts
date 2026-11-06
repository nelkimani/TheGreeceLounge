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

// Best guess of the category for a drink that is not in the catalogue yet, from words in its name
// (same categories as the upstairs counter stock list). The person can always change it.
const GUESS: [RegExp, string][] = [
  [/\b(cask|wine|rosso|sangria|champagne|moet|belaire|four cousins|4th street|drostdy|caprice|casa ?buena|robertson|mikado)\b/i, 'Wines'],
  [/\b(hennessy|martell?|courvoisier|cognac)\b/i, 'Cognac'],
  [/\b(brandy|viceroy|hunters choice|richot)\b/i, 'Brandy'],
  [/\b(gin|tanqueray|gordons?|gilbeys?|chrome|zafiro|caribia)\b/i, 'Gin'],
  [/\b(vodka|smirnoff|absolut)\b/i, 'Vodka'],
  [/\b(rum|bacardi|captain morgan|county|malibu|old monk|kc)\b/i, 'Rum'],
  [/\b(whisk(e)?y|jameson|grants?|jack daniels?|johnnie|walker|william lawsons?|john barr|chivas|ballantines?|glenfiddich|singleton|southern comfort|vat 69|bond 7|famous grouse)\b/i, 'Whiskey'],
  [/\b(sambuca|zappa)\b/i, 'Sambuca'],
  [/\b(martini|vermouth)\b/i, 'Martin'],
  [/\b(beer|lager|cider|tusker|heineken|guinness|guiness|balozi|snapp|savanna|pilsner|whitecap|hunters (gold|dry))\b/i, 'Beers'],
  [/\b(juice|soda|water|redbull|red bull|energy|monster|tonic|lime|lemon|delmonte|minute maid|peptang|keringet|predator|shark)\b/i, 'Soft drinks'],
  [/\b(cigarette|lyft|rothmans|sportsman)\b/i, 'Cigarettes'],
  [/\b(amarula|baileys|jagermeister|tequila|liqueur|cream|khalua|kahlua|sheridans?|curacao|cuervo|don julio|tia maria|peppermint)\b/i, 'Liquor'],
]
export function guessCategory(name: string, categories: string[]): string {
  const hit = GUESS.find(([re]) => re.test(name))?.[1]
  if (!hit) return ''
  return categories.find(c => c.toLowerCase() === hit.toLowerCase()) ?? ''
}
