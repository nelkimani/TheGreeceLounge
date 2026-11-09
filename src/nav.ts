import { Profile, can } from './supabase'
import type { IconName } from './icons'

export type View = 'home' | 'waiter' | 'myorders' | 'staff' | 'stock' | 'approvals' | 'recon' | 'purchasing' | 'expenses' | 'stockroom' | 'reports' | 'owner' | 'products' | 'stocksheet' | 'issue' | 'printsheet'

// The office sidebar groups screens by job. Terminals ignore groups and use `kind` for the tile home.
export type Group = 'sales' | 'stock' | 'money' | 'reports' | 'admin'
export const GROUPS: { id: Group; label: string }[] = [
  { id: 'sales', label: 'Sales' },
  { id: 'stock', label: 'Stock' },
  { id: 'money', label: 'Money' },
  { id: 'reports', label: 'Reports' },
  { id: 'admin', label: 'Admin' },
]

export type NavItem = {
  id: string              // unique key; also what "current screen" is compared against
  view: View
  icon: IconName
  label: string
  group: Group
  kind: 'work' | 'manage' // terminal tile home: amber "Work" tiles vs grey "Manage" tiles
}

export const navId = (view: View) => view

// One list drives both the terminals' tile home and the office sidebar, so the two can never disagree
// about who may open what. Array order is the order tiles / sidebar items appear in.
// Stations (bar, choma zone, restaurant) no longer have a queue screen: they serve from the printed captain order.
export function navItems(profile: Profile): NavItem[] {
  const stationPerms = ['kitchen', 'choma', 'bar'].filter(s => can(profile, 'station.' + s))
  const item = (view: View, icon: IconName, label: string, group: Group, kind: NavItem['kind'], show: boolean) =>
    ({ show, it: { id: navId(view), view, icon, label, group, kind } as NavItem })

  return [
    item('waiter', 'orders', 'Take orders', 'sales', 'work', can(profile, 'tab.open')),
    item('myorders', 'orders', 'My orders', 'sales', 'work', can(profile, 'tab.open')),

    item('stock', 'stock', 'Bar stock', 'stock', 'manage', stationPerms.includes('bar') || can(profile, 'stock.view_all')),
    item('issue', 'stockroom', 'Issue to counter', 'stock', 'manage', can(profile, 'goods.receive')),
    item('stocksheet', 'sheet', 'Stock sheet', 'stock', 'manage', can(profile, 'stock.import')),
    item('printsheet', 'sheet', 'Print stock sheet', 'stock', 'manage', can(profile, 'catalogue.manage')),
    item('approvals', 'approvals', 'Approvals', 'money', 'manage', can(profile, 'approval.grant')),
    item('recon', 'recon', 'Reconciliation', 'money', 'manage', can(profile, 'recon.view_all')),
    item('purchasing', 'purchasing', 'Purchasing', 'stock', 'manage', can(profile, 'goods.receive') || can(profile, 'supplier.manage')),
    item('expenses', 'expenses', 'Cash expenses', 'money', 'manage', can(profile, 'expense.record')),
    item('stockroom', 'stockroom', 'Stock room', 'stock', 'manage',
      can(profile, 'stock.view_all') || stationPerms.includes('kitchen') || stationPerms.includes('choma')),
    item('reports', 'reports', 'Reports & sign-off', 'reports', 'manage', can(profile, 'report.view') || can(profile, 'report.build')),
    item('owner', 'owner', 'Owner reports', 'reports', 'manage', can(profile, 'report.sales') || can(profile, 'report.profit')),
    item('products', 'products', 'Products & prices', 'admin', 'manage', can(profile, 'catalogue.manage')),
    item('staff', 'staff', 'Staff', 'admin', 'manage', can(profile, 'staff.manage')),
  ].filter(x => x.show).map(x => x.it)
}
