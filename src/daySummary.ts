// Day summary for filing: every waiter with what they sold, cash handed over, M-Pesa from the till phone and the
// difference. Printed on A4 (or saved as PDF from the print window) or downloaded as a CSV for Excel.

export type SummarySale = { name: string; qty: number; total: number }
export type SummarySettle = { cash: number; mpesa: number; variance: number; notes: string | null; cleared_at: string; cleared_by: string }
export type SummaryWaiter = { name: string; staff_no: string; orders: number; sales: number; products: SummarySale[]; settlement: SummarySettle | null }

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string))
const money = (n: number) => Number(n ?? 0).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const qtyFmt = (n: number) => Number(n ?? 0).toLocaleString('en-KE', { maximumFractionDigits: 3 })
const dateLabel = (iso: string) => new Date(iso + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
const hhmm = (iso: string) => new Date(iso).toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit' })
const vlabel = (v: number) => (v > 0 ? 'Short ' : v < 0 ? 'Over ' : 'Balanced') + (v === 0 ? '' : money(Math.abs(v)))

export function summaryTotals(ws: SummaryWaiter[]) {
  const done = ws.filter(w => w.settlement)
  return {
    sales: ws.reduce((t, w) => t + Number(w.sales), 0),
    cash: done.reduce((t, w) => t + Number(w.settlement!.cash), 0),
    mpesa: done.reduce((t, w) => t + Number(w.settlement!.mpesa), 0),
    variance: done.reduce((t, w) => t + Number(w.settlement!.variance), 0),
    cleared: done.length, total: ws.length,
  }
}

function productTotals(ws: SummaryWaiter[]) {
  const m = new Map<string, SummarySale>()
  for (const w of ws) for (const p of w.products) {
    const x = m.get(p.name) ?? { name: p.name, qty: 0, total: 0 }
    x.qty += Number(p.qty); x.total += Number(p.total); m.set(p.name, x)
  }
  return [...m.values()].sort((a, b) => b.total - a.total || a.name.localeCompare(b.name))
}

export function buildDaySummaryHtml(date: string, all: SummaryWaiter[], printedBy: string): string {
  const ws = all.filter(w => w.orders > 0 || w.settlement)
  const t = summaryTotals(ws)
  const open = ws.filter(w => !w.settlement)
  const prods = productTotals(ws)
  const rows = ws.map(w => {
    const s = w.settlement
    return `<tr><td>${esc(w.name)} <span class="m">${esc(w.staff_no)}</span></td><td class="r">${w.orders}</td><td class="r">${money(w.sales)}</td>` +
      (s ? `<td class="r">${money(s.cash)}</td><td class="r">${money(s.mpesa)}</td><td class="r ${s.variance > 0 ? 'bad' : ''}">${esc(vlabel(Number(s.variance)))}</td>` +
           `<td>${esc(s.notes ?? '')}<div class="m">${esc(s.cleared_by)} ${hhmm(s.cleared_at)}</div></td>`
         : `<td colspan="4" class="bad"><b>NOT CLEARED</b></td>`) + `</tr>`
  }).join('')
  const detail = ws.map(w => `
    <div class="blk"><h3>${esc(w.name)} <span class="m">${esc(w.staff_no)} · ${w.orders} order${w.orders === 1 ? '' : 's'}</span><span class="r">KES ${money(w.sales)}</span></h3>
    <table class="d">${w.products.map(p => `<tr><td>${esc(p.name)}</td><td class="r q">× ${qtyFmt(p.qty)}</td><td class="r">${money(p.total)}</td></tr>`).join('')}</table></div>`).join('')
  return `<!doctype html><html><head><meta charset="utf-8"><title>Day summary ${esc(date)}</title><style>
  @page { size: A4; margin: 14mm; }
  * { box-sizing: border-box; }
  body { font: 11pt/1.35 Arial, Helvetica, sans-serif; color: #000; background: #fff; margin: 0; }
  h1 { font-size: 18pt; margin: 0; } h2 { font-size: 13pt; margin: 14px 0 4px; border-bottom: 1.5px solid #000; } h3 { font-size: 11pt; margin: 0 0 2px; display: flex; gap: 8px; align-items: baseline; }
  h3 .r { margin-left: auto; } .m { color: #555; font-weight: normal; font-size: 9pt; } .r { text-align: right; } .q { width: 60px; }
  table { width: 100%; border-collapse: collapse; } th, td { padding: 3px 5px; border-bottom: 0.5px solid #999; vertical-align: top; } th { text-align: left; font-size: 9.5pt; border-bottom: 1.5px solid #000; }
  th.r { text-align: right; } .tot td { font-weight: bold; border-top: 1.5px solid #000; border-bottom: none; }
  .head { display: flex; justify-content: space-between; align-items: flex-end; margin-bottom: 6px; }
  .cards { display: grid; grid-template-columns: repeat(5, 1fr); gap: 6px; margin: 8px 0; } .cards div { border: 1px solid #000; padding: 5px 7px; font-size: 9pt; } .cards b { display: block; font-size: 12pt; }
  .bad { color: #b00000; } .warn { border: 2px solid #b00000; padding: 5px 8px; margin: 6px 0; font-weight: bold; color: #b00000; }
  .blk { break-inside: avoid; margin-bottom: 8px; } .d td { padding: 1px 5px; font-size: 10pt; } .d td:first-child { width: 62%; } .d td.q { width: 14%; }
  .sig { display: flex; gap: 30px; margin-top: 28px; } .sig div { flex: 1; border-top: 1px solid #000; padding-top: 3px; font-size: 9pt; }
  </style></head><body>
  <div class="head"><div><h1>THE GLIZZ LOUNGE</h1><div>Day summary · <b>${esc(dateLabel(date))}</b></div></div>
    <div class="m r">Printed ${esc(new Date().toLocaleString('en-KE', { dateStyle: 'medium', timeStyle: 'short' }))}<br>by ${esc(printedBy)}</div></div>
  <div class="cards"><div>Sales (not voided)<b>${money(t.sales)}</b></div><div>Cash handed in<b>${money(t.cash)}</b></div>
    <div>M-Pesa (till phone)<b>${money(t.mpesa)}</b></div><div>Cash + M-Pesa<b>${money(t.cash + t.mpesa)}</b></div>
    <div>${t.variance > 0 ? 'Short' : t.variance < 0 ? 'Over' : 'Balanced'}<b class="${t.variance > 0 ? 'bad' : ''}">${money(Math.abs(t.variance))}</b></div></div>
  ${open.length ? `<div class="warn">${open.length} of ${ws.length} waiters NOT cleared: ${esc(open.map(w => w.name).join(', '))}. Totals above cover cleared waiters only (sales cover everyone).</div>` : ''}
  <h2>Waiters</h2>
  <table><tr><th>Waiter</th><th class="r">Orders</th><th class="r">Sales</th><th class="r">Cash</th><th class="r">M-Pesa</th><th class="r">Result</th><th>Note / cleared by</th></tr>
  ${rows}<tr class="tot"><td>Total (${t.cleared} of ${t.total} cleared)</td><td class="r">${ws.reduce((n, w) => n + Number(w.orders), 0)}</td><td class="r">${money(t.sales)}</td><td class="r">${money(t.cash)}</td><td class="r">${money(t.mpesa)}</td><td class="r">${esc(vlabel(t.variance))}</td><td></td></tr></table>
  <h2>Everything sold</h2>
  <table class="d">${prods.map(p => `<tr><td>${esc(p.name)}</td><td class="r q">× ${qtyFmt(p.qty)}</td><td class="r">${money(p.total)}</td></tr>`).join('')}
  <tr class="tot"><td>Total</td><td class="r q">× ${qtyFmt(prods.reduce((n, p) => n + p.qty, 0))}</td><td class="r">${money(t.sales)}</td></tr></table>
  <h2>What each waiter sold</h2>${detail}
  <div class="sig"><div>Prepared by (accountant)</div><div>Approved by (manager)</div><div>Date</div></div>
  </body></html>`
}

// Prints from a hidden frame (no pop-up window). In the print window choose "Save as PDF" to download it instead.
export function printHtml(html: string) {
  const f = document.createElement('iframe')
  f.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0'
  document.body.appendChild(f)
  const d = f.contentDocument!
  d.open(); d.write(html); d.close()
  const go = () => { try { f.contentWindow!.focus(); f.contentWindow!.print() } finally { setTimeout(() => f.remove(), 60_000) } }
  setTimeout(go, 300)
}

export function downloadDaySummaryCsv(date: string, all: SummaryWaiter[]) {
  const ws = all.filter(w => w.orders > 0 || w.settlement)
  const q = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`
  const lines: string[] = [['Waiter', 'Staff no', 'Orders', 'Sales', 'Cash handed in', 'M-Pesa', 'Short(+)/Over(-)', 'Status', 'Note', 'Cleared by'].map(q).join(',')]
  for (const w of ws) {
    const s = w.settlement
    lines.push([w.name, w.staff_no, w.orders, w.sales, s?.cash ?? '', s?.mpesa ?? '', s?.variance ?? '', s ? 'Cleared' : 'NOT CLEARED', s?.notes ?? '', s?.cleared_by ?? ''].map(q).join(','))
  }
  lines.push('', ['Waiter', 'Product', 'Qty', 'Amount'].map(q).join(','))
  for (const w of ws) for (const p of w.products) lines.push([w.name, p.name, p.qty, p.total].map(q).join(','))
  const url = URL.createObjectURL(new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a'); a.href = url; a.download = `day-summary-${date}.csv`; a.click(); URL.revokeObjectURL(url)
}
