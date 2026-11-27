-- The Glizz Lounge POS — 027: ZERO THE STORE AND THE COUNTER (main bar)
--
-- WHAT IT DOES
--   Sets the stock of EVERY product to 0 in the Store and in the Main Bar (the upstairs counter).
--   The stock ledger is append-only, so nothing is deleted: for each product that has a
--   non-zero balance in either place, one 'count_adjust' entry is posted that brings it to exactly 0
--   (positive balance -> removed; negative balance -> added back). History, sales, payments are untouched.
--
-- WHAT IT KEEPS
--   Products, prices, recipes, tabs, orders, payments, waiter-held stock, kitchen/choma/wastage stock.
--
-- HOW TO RUN
--   1. Supabase > SQL Editor > New query > paste this whole file.
--   2. (Optional) run the PREVIEW query at the bottom first to see what will change.
--   3. In the block below change  confirm text := 'NO'  to  confirm text := 'ZERO'
--   4. Run. It is all-or-nothing. Safe to run twice (the second run finds nothing to adjust).
--   5. Run the CHECK query at the bottom: it should return no rows.
--   6. Then enter the real counts (Bar stock > Add stock > Opening stock).
--
-- Because it only adds entries, you can undo it by posting the opposite entries, but it is far
-- easier to take a backup first (Supabase > Database > Backups).

do $$
declare
  confirm text := 'NO';          -- <<< change to 'ZERO' to allow the reset
  v_actor uuid := (select staff_id from staff_roles where role_code = 'manager' order by 1 limit 1);
  v_stamp text := to_char(now(), 'YYYYMMDDHH24MISS');
  r record; n int := 0;
begin
  if confirm <> 'ZERO' then
    raise exception 'Not run. Change confirm to ''ZERO'' at the top of this block to proceed.';
  end if;
  if v_actor is null then raise exception 'no manager account found'; end if;

  for r in
    select b.product_id, b.location_id, b.qty_base
    from stock_balance b
    join locations l on l.id = b.location_id
    where l.kind in ('main_bar', 'store') and l.custodian_id is null
      and b.qty_base <> 0
  loop
    insert into stock_movements(product_id, from_location, to_location, qty_base, type,
                                actor_id, idempotency_key, note)
    values (
      r.product_id,
      case when r.qty_base > 0 then r.location_id end,   -- leaves the location
      case when r.qty_base < 0 then r.location_id end,   -- put back (was negative)
      abs(r.qty_base), 'count_adjust', v_actor,
      'zero-' || v_stamp || ':' || r.location_id || ':' || r.product_id,
      'Store and counter reset to 0');
    n := n + 1;
  end loop;

  insert into audit_log(action, entity, entity_id, reason)
  values ('stock.zero_store_and_counter', 'system', null,
          format('Store and main bar stock set to 0 (%s adjustment entries)', n));

  raise notice '% adjustment entr(ies) posted', n;
end $$;

-- ───────────── PREVIEW (run BEFORE the block above) ─────────────
-- select l.name as location, p.name as product, b.qty_base as current_qty
-- from stock_balance b join locations l on l.id = b.location_id join products p on p.id = b.product_id
-- where l.kind in ('main_bar','store') and l.custodian_id is null and b.qty_base <> 0
-- order by l.name, p.name;

-- ───────────── CHECK (run AFTER): should return no rows ─────────────
select l.name as location, p.name as product, b.qty_base
from stock_balance b join locations l on l.id = b.location_id join products p on p.id = b.product_id
where l.kind in ('main_bar','store') and l.custodian_id is null and b.qty_base <> 0;
