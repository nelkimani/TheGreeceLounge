// Small line icons (24x24, drawn with currentColor so they follow the theme).
const P: Record<string, string> = {
  orders: 'M8 4h8l1 2h2v14H5V6h2zM9 11h6M9 15h4',
  kitchen: 'M6 14h12v5a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2zM8 14a3.2 3.2 0 0 1 .8-6.2A3.6 3.6 0 0 1 15.2 8 3.2 3.2 0 0 1 16 14',
  choma: 'M12 3c1 3 4.5 5 4.5 9.2a4.5 4.5 0 0 1-9 0c0-2 1-3.2 2.2-4.2.2 1.2.8 1.9 1.6 2C11.2 8.2 10.8 5.6 12 3z',
  bar: 'M4 4h16l-8 9zM12 13v7M8 20h8',
  queues: 'M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01',
  stock: 'M3 8l9-5 9 5v8l-9 5-9-5zM3 8l9 5 9-5M12 13v8',
  approvals: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM8 12.2l3 3 5-6',
  cash: 'M3 6h18v12H3zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6.5 9.5v.01M17.5 14.5v.01',
  recon: 'M12 3v18M6 21h12M5 7h14M5 7l-3 7a3 3 0 0 0 6 0zM19 7l-3 7a3 3 0 0 0 6 0z',
  purchasing: 'M2 6h11v10H2zM13 10h4l4 3v3h-8zM6.5 20a1.8 1.8 0 1 0 0-3.6 1.8 1.8 0 0 0 0 3.6zM17.5 20a1.8 1.8 0 1 0 0-3.6 1.8 1.8 0 0 0 0 3.6z',
  expenses: 'M3 7a2 2 0 0 1 2-2h13v4M3 7v11a2 2 0 0 0 2 2h15V9H5a2 2 0 0 1-2-2zM16 14.5h.01',
  stockroom: 'M3 21V9l9-5 9 5v12M7 21v-7h10v7M7 17.5h10',
  reports: 'M4 21V10M10 21V4M16 21v-8M2 21h20',
  owner: 'M3 17l6-6 4 4 8-8M15 7h6v6',
  staff: 'M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 6.5M18 14a6 6 0 0 1 3.5 6',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4',
  note: 'M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13',
  star: 'M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z',
  close: 'M6 6l12 12M18 6L6 18',
  home: 'M3 11l9-8 9 8M5 9.5V20h14V9.5M10 20v-6h4v6',
  panel: 'M3 5h18v14H3zM9 5v14',
  products: 'M3 12V4h8l10 10-8 8zM7.5 8.5h.01',
  keyboard: 'M2 6h20v12H2zM6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10',
}
export type IconName = keyof typeof P
export const Icon = ({ name, className = 'h-8 w-8' }: { name: IconName; className?: string }) => (
  <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={P[name]} />
  </svg>
)
