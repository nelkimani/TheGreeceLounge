-- The Gliz Lounge POS — 018: GO-LIVE RESET (run ONCE, before real trading starts)
--
-- WHAT IT DOES
--   Erases every test transaction: tabs, orders, payments, receipts, stock movements and counts,
--   handovers, approvals, daily closes, goods receipts, supplier ledger/payments, expenses,
--   expense reports, shifts and the audit log. Receipt, ticket and audit numbers restart at 1.
--   Deletes the demo products (is_demo = true) and anything that points at them.
--   Sets every floor table back to "available".
--
-- WHAT IT KEEPS
--   Staff, roles, permissions, PINs, terminals, settings (VAT etc.), units, locations,
--   categories, suppliers, floor tables, and every product that is NOT flagged is_demo.
--
-- !! THIS CANNOT BE UNDONE. Take a backup first (Supabase > Database > Backups). !!
-- !! Never run this once real sales have been recorded.                          !!
--
-- HOW TO RUN
--   1. Supabase > SQL Editor > New query > paste this whole file.
--   2. In the first block below change  confirm text := 'NO'  to  confirm text := 'RESET'
--   3. Run. If anything fails, NOTHING is changed (it is one all-or-nothing block).
--   4. Run the CHECK query at the bottom: every count should be 0.
--   5. Then add your products, then opening stock (Bar stock > Add stock > Opening stock).

do $$
declare
  confirm text := 'NO';          -- <<< change to 'RESET' to allow the reset
  n_pay int; n_tabs int; n_mov int; n_demo int;
begin
  if confirm <> 'RESET' then
    raise exception 'Reset NOT run. Change confirm to ''RESET'' at the top of this block to proceed.';
  end if;

  select count(*) into n_pay  from payments;
  select count(*) into n_tabs from tabs;
  select count(*) into n_mov  from stock_movements;
  select count(*) into n_demo from products where is_demo;
  raise notice 'Clearing % payments, % tabs, % stock movements, % demo products', n_pay, n_tabs, n_mov, n_demo;

  -- 1. Transaction tables. Listed in ONE statement so foreign keys between them are satisfied.
  --    TRUNCATE skips the "append-only" row triggers, which is why this works where DELETE does not.
  --    No CASCADE on purpose: if a table was missed, Postgres refuses and nothing changes.
  truncate table
    order_item_events, order_items, orders, tab_adjustments, payments, mpesa_verifications,
    tabs, cash_handovers, daily_closes, approvals,
    stock_movements, stock_counts, requisition_lines, requisitions,
    goods_receipt_lines, goods_receipts, supplier_ledger, supplier_payments,
    expense_voids, expenses, report_items, expense_reports,
    shifts, audit_log
  restart identity;

  -- 2. Demo products and anything attached to them.
  delete from product_favourites where product_id in (select id from products where is_demo);
  delete from unit_conversions   where product_id in (select id from products where is_demo);
  delete from recipe_ingredients where ingredient_id in (select id from products where is_demo)
                                    or product_id    in (select id from products where is_demo);
  delete from recipes            where product_id in (select id from products where is_demo);
  delete from products           where is_demo;

  -- 3. Floor tables back to available.
  update floor_tables set status = 'available';

  -- 4. First line of the new audit trail.
  insert into audit_log(action, entity, entity_id, reason)
  values ('go_live.reset', 'system', null,
          format('Test data cleared: %s payments, %s tabs, %s stock movements, %s demo products', n_pay, n_tabs, n_mov, n_demo));
end $$;

-- ───────────── CHECK (run after the block above): every count should be 0 ─────────────
select
  (select count(*) from payments)        as payments,
  (select count(*) from tabs)            as tabs,
  (select count(*) from orders)          as orders,
  (select count(*) from stock_movements) as stock_movements,
  (select count(*) from products where is_demo) as demo_products,
  (select count(*) from products)        as real_products_kept,
  (select count(*) from staff)           as staff_kept;
