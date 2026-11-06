// Suggests which drink in the catalogue a name on a delivery sheet means, e.g.
// "Viceroy Brandy 750ML" -> VICEROY 750ML, "Heineken 0.0 Beer 330ml" -> HEINEKE ZERO.
// It only suggests: the screen shows every match and the person can change it.
// "sure" = same words and size, "check" = probably right but worth a look (different size, extra words), "none".

export type Candidate = { id: string; name: string }
export type Suggestion = { id: string | null; level: 'sure' | 'check' | 'none'; why: string }

const STOP = new Set(['with', 'cork', 'glass', 'all', 'flavours', 'flavors', 'bottle', 'spirit', 'irish', 'cream', 'energy', 'drink', 'beer', 'brandy', 'the', 'of'])
// The paper sheet writes "C CASK" for Cellar Cask and "SWT" for sweet; receipts spell them out.
const ALIAS: Record<string, string> = { swt: 'sweet', savannah: 'savanna', ltrs: 'l', cellar: 'c' }
const UNIT_ML: Record<string, number> = { ml: 1, cl: 10, l: 1000, lt: 1000, ltr: 1000, ltrs: 1000, litre: 1000, litres: 1000 }

type Parsed = { tokens: string[]; size: number | null }

export function parse(raw: string): Parsed {
  let s = raw.toLowerCase().replace(/\b0\.0\b/g, ' zero ')
  let size: number | null = null
  s = s.replace(/(\d+(?:\.\d+)?)\s*(ml|cl|ltrs|ltr|litres|litre|lt|l)(?![a-z])/g, (_, n: string, u: string) => {
    size ??= Math.round(Number(n) * UNIT_ML[u]); return ' '
  })
  const tokens = s.replace(/[^a-z0-9]+/g, ' ').split(' ').filter(Boolean)
    .map(t => ALIAS[t] ?? t).filter(t => !STOP.has(t))
  return { tokens, size }
}

function lev(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)])
  for (let j = 1; j <= b.length; j++) d[0][j] = j
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++)
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
  return d[a.length][b.length]
}
const same = (a: string, b: string) => a === b || (a.length >= 5 && b.length >= 5 && lev(a, b) <= 1)

// Joins two neighbouring words when together they equal a word on the other side ("red" + "bull" = "redbull").
function merge(a: string[], other: string[]): string[] {
  const out = [...a]
  for (let i = 0; i < out.length - 1; i++) {
    const joined = out[i] + out[i + 1]
    if (other.some(o => same(o, joined))) out.splice(i, 2, joined)
  }
  return out
}

function score(q: Parsed, c: Parsed): { dice: number; final: number; sizeDiffers: boolean } {
  const a = merge(q.tokens, c.tokens), b = merge(c.tokens, q.tokens)
  if (a.length === 0 || b.length === 0) return { dice: 0, final: 0, sizeDiffers: false }
  const used = new Set<number>(); let hit = 0
  for (const t of a) { const k = b.findIndex((u, i) => !used.has(i) && same(t, u)); if (k >= 0) { used.add(k); hit++ } }
  const dice = (2 * hit) / (a.length + b.length)
  let adj = 0, sizeDiffers = false
  if (q.size != null && c.size != null) {
    if (q.size === c.size) adj = 0.1
    else { sizeDiffers = true; adj = -0.15 - (Math.abs(q.size - c.size) / Math.max(q.size, c.size)) * 0.2 }
  }
  return { dice, final: dice + adj, sizeDiffers }
}

export function suggest(sheetName: string, products: Candidate[]): Suggestion {
  const q = parse(sheetName)
  let best: { p: Candidate; s: ReturnType<typeof score> } | null = null
  for (const p of products) {
    const s = score(q, parse(p.name))
    if (s.dice < 0.6) continue
    if (!best || s.final > best.s.final) best = { p, s }
  }
  if (!best) return { id: null, level: 'none', why: 'not in the catalogue' }
  if (best.s.sizeDiffers) return { id: best.p.id, level: 'check', why: 'different size' }
  if (best.s.final >= 0.9) return { id: best.p.id, level: 'sure', why: '' }
  return { id: best.p.id, level: 'check', why: 'name is not exact' }
}
