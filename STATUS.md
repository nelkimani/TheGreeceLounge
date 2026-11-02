# The Glizz Lounge POS — Project status

Last updated: 2 Nov 2026

## Where we are
- Phases 0 to 6 built (foundation, ordering, stock, reconciliation, purchasing, owner reports).
- **2 Nov 2026: workflow change to captain orders (migration 022 + app).** The old queue, payment and cash hand-in screens are gone from the app.
- Next: run 022 in Supabase, test on the three terminals, then the UI polish pass and Phase 7.

## How a sale works now
1. The waiter picks a table (or Takeaway / Bar sale), keys the order and taps SEND & PRINT.
2. The system records the sale at that moment and prints, on that terminal: one **customer receipt** (everything) and one **captain order** per station: **Bar** (drinks), **Choma zone** (all meat: wet fry, dry fry, choma), **Restaurant** (everything else, e.g. ugali).
3. The waiter carries each captain order to its station. Stations serve from the paper; nobody signs in to press Serve.
4. Bar stock drops automatically when the order is sent. A bartender can sell directly (Bar sale) and also gets a captain order for reconciliation.
5. No cash / M-Pesa / split is recorded in the system. Waiters keep their own book of M-Pesa codes.
6. Wrong or cancelled order: waiter taps Void in **My orders** and gives a reason, a manager approves in **Approvals**, bar stock goes back, and the waiter prints the **VOID slip** for the station. A manager voiding does it at once.
7. Day end: the accountant ticks off the collected captain orders in **Reconciliation** (anything not ticked is an exception), then counts the bar in **Bar stock**.
8. Owner reports still show who sold what and when: **Owner reports > Sales log**, plus the existing sales, profit and stock reports.

**Station routing uses each product's station.** Meat products must have station "Choma"; kitchen and no-station products print on the Restaurant slip. Check this in Products & prices.

## Decisions made
| Decision | Value |
|---|---|
| Stack | React + TypeScript + Vite + Tailwind, Supabase (Postgres, Auth, Edge Functions, Realtime) |
| Trading-day rollover | 05:00 Africa/Nairobi |
| Payments when offline | Blocked (online only) |
| Billable trigger | Lines bill when SERVED (food and drinks) |
| Liquor custody deducted | When served |
| Bartender collects payments | Off by default (per-person override) |
| VAT / service charge | Unset until rates are confirmed |
| Terminals | T1 Kitchen+Choma, T2 Bar A, T3 Bar B; manager/accountant use the office browser |
| Staff sign-in | Terminals: staff ID + 6-digit PIN. Office: email + password (MFA to add later) |
| Staff IDs | Upper-case, case-insensitive (W001, B001, K001, C001, A001) |
| Station "none" products | Recorded as served immediately (nothing to prepare) |
| Auto-lock | 30 s idle on order screens, 5 min on kitchen/choma/bar queues, and after Send |

## Supabase project
- URL: https://panjzmitobrqmqzdpkvb.supabase.co
- Manager account: staff ID M001 (office login with email + password)
- Secrets (service-role key, database password) are never put in the app or in chat.

## SQL files (run in this order in the Supabase SQL Editor)
| File | Status | Purpose |
|---|---|---|
| 001_foundation.sql | Run | Tables, ledgers, views, payment RPC, baseline RLS |
| 002_phase1.sql | Run | Permissions and roles seed, PIN functions, terminals, demo tables, catalogue import RPC |
| 003_rls_reads.sql | Run | RLS everywhere, read policies, safe views |
| 004_profile_rpcs.sql | Run | my_profile, list_staff, set_staff_active |
| 005_phase2_ordering.sql | Run | open_tab, submit_order, claim_item, update_item_status, station_queue, tab_cards, Realtime |
| 006_demo_catalogue.sql | Run | 11 fake products across bar, choma, kitchen (all flagged is_demo) |
| 018_go_live_reset.sql | NOT run yet | One-time go-live reset: clears test sales/stock/audit data and demo products. Back up first; set confirm to RESET to run |
| 019_load_catalogue_and_opening_stock.sql | NOT run yet | Loads the 38 real products (no prices yet) and opening stock from the 02/10/2026 delivery sheet. Run after 018; safe to re-run |
| 020_products_admin.sql | NOT run yet | Database functions behind the Products & prices screen (list, save prices, rename/hide, add product). Needs catalogue.manage |
| 021_tables_30.sql | NOT run yet | Replaces the 12 demo tables with the real 30 tables (1 to 30). Safe to re-run |
| 022_captain_orders.sql | NOT run yet | Captain-order workflow: submit_sale, captain_orders, voids, slip reconciliation, sales log report. Run after 021. Safe to re-run. Close any old open tabs first |

## App (repo root)
- Office login and terminal PIN login; home shows only the buttons each role may use
- Take orders: tables / takeaway / bar sale, product grid, notes, SEND & PRINT (double-tap protection, offline NOT SENT retry that prints when back online)
- My orders: today's orders, reprint receipt or slips, ask for a void, print VOID slip
- Approvals (manager): stock-outs and order voids
- Reconciliation: captain orders tick-off and day close
- Bar stock, Stock room, Purchasing, Cash expenses, Reports & sign-off, Owner reports (with Sales log), Products & prices, Staff

## Known limits and open items
- The old payment, queue and cash hand-in database functions are kept (unused) so old test data stays readable. The app no longer calls them.
- Cash/M-Pesa views in the database stay empty from now on; the Cash, M-Pesa & credit owner report is hidden.
- A table that still has an OLD open tab (from before 022) cannot take a new order until a manager closes that tab.
- Captain orders print at the waiter's terminal only (decided). If the printer is not connected, each slip can be printed through the browser print window one at a time.
- NOT SENT retries only run while that waiter is signed in.
- Cancelling an accepted item needs the approval flow (Phase 3/4).
- Item notes, favourites ordering and the bar direct-sale screen are not built yet.
- Products & prices screen (office, Admin group) is built: edit prices, rename, hide, add. The CSV/Excel catalogue import screen is still not built (the import RPC exists).
- Two npm audit warnings to review in Phase 7.
- Three shared terminals will bottleneck on a busy night; a fourth device is advised.
- Real catalogue, prices, opening stock and staff list are needed before the Phase 4 pilot.
- Testing two people at once needs separate browser profiles or an incognito window.

## Later
Phase 7 production readiness · UI polish pass
