import { Profile, can } from './supabase'
import type { IconName } from './icons'

export type View = 'home' | 'waiter' | 'queue' | 'staff' | 'stock' | 'approvals' | 'handover' | 'recon' | 'purchasing' | 'expenses' | 'stockroom' | 'reports' | 'owner' | 'products'

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
  stations?: string[]     // only for queue screens
  icon: IconName
  label: string
  group: Group
  kind: 'work' | 'manage' // terminal tile home: amber "Work" tiles vs grey "Manage" tiles
}

export const navId = (view: View, stations: string[] = []) => (view === 'queue' ? 'queue:' + stations.join(',') : view)

// One list drives both the terminals' tile home and the office sidebar, so the two can never disagree
// about who may open what. Array order is the order tiles / sidebar items appear in.
export function navItems(profile: Profile): NavItem[] {
  const stationPerms = ['kitchen', 'choma', 'bar'].filter(s => can(profile, 'station.' + s))
  const item = (view: View, icon: IconName, label: string, group: Group, kind: NavItem['kind'], show: boolean, stations?: string[]) =>
    ({ show, it: { id: navId(view, stations), view, stations, icon, label, group, kind } as NavItem })

  // Order here is the order of the terminals' tile home (unchanged from before the office shell);
  // the office sidebar shows the same items, split into groups.
  return [
    item('waiter', 'orders', 'Take orders', 'sales', 'work', can(profile, 'tab.open')),
    item('queue', 'kitchen', 'Kitchen queue', 'sales', 'work', stationPerms.includes('kitchen'), ['kitchen']),
    item('queue', 'choma', 'Choma queue', 'sales', 'work', stationPerms.includes('choma'), ['choma']),
    item('queue', 'bar', 'Bar queue', 'sales', 'work', stationPerms.includes('bar'), ['bar']),
    item('queue', 'queues', 'All queues', 'sales', 'work', stationPerms.length > 1, stationPerms),

    item('stock', 'stock', 'Bar stock', 'stock', 'manage', stationPerms.includes('bar') || can(profile, 'stock.view_all')),
    item('approvals', 'approvals', 'Approvals', 'money', 'manage', can(profile, 'approval.grant')),
    item('handover', 'cash', 'Hand in cash', 'money', 'manage', can(profile, 'payment.record') && !can(profile, 'recon.view_all')),
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
