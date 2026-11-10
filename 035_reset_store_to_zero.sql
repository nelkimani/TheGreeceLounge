-- The Glizz Lounge POS — 035: set every count in the STORE to 0
-- Run in the Supabase SQL Editor ("Run without RLS" if asked).
--
-- For every drink with something other than 0 in the store it records a stock count of 0 in the store (the system's
-- expected figure, counted 0) and a 'count_adjust' movement that brings the balance to exactly 0. Nothing is deleted:
-- the old deliveries stay in the history and the adjustment is booked to manager M001 (or the first manager), with the
-- reason below. The counter and the kitchen/choma stocks are NOT touched.
-- Afterwards the store is 0 everywhere: record the real counts with a delivery upload or a stock count.
-- NOTE: the profit report treats a count below the expected figure as a stock loss, so the day this runs will show the
-- reset as a loss in "Stock losses". Run it before you start, and ignore that day's loss figure.
-- Safe to run again: once the store is 0 there is nothing left to change.

do $$
declare
  v_staff uuid; v_store uuid := loc('store'); r record; v_c stock_counts; n int := 0; units numeric := 0;
  v_why text := 'Reset store to 0 before go-live recount';
begin
  select id into v_staff from staff where staff_no = 'M001' and active;
  if v_staff is null then
    select s.id into v_staff from staff s join staff_roles sr on sr.staff_id = s.id where sr.role_code = 'manager' and s.active order by s.created_at limit 1;
  end if;
  if v_staff is null then raise exception 'no manager found'; end if;
  perform set_config('request.jwt.claim.sub', v_staff::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_staff, 'role', 'authenticated')::text, true);

  for r in select b.product_id, p.name, b.qty_base from stock_balance b join products p on p.id = b.product_id
            where b.location_id = v_store and b.qty_base <> 0
  loop
    insert into stock_counts(location_id, product_id, expected_qty, counted_qty, explanation, counted_by, business_date)
    values (v_store, r.product_id, r.qty_base, 0, v_why, v_staff, business_date(now())) returning * into v_c;
    if r.qty_base > 0 then
      insert into stock_movements(product_id, from_location, to_location, qty_base, type, ref_table, ref_id, shift_id, actor_id, note)
      values (r.product_id, v_store, null, r.qty_base, 'count_adjust', 'stock_counts', v_c.id, null, v_staff, v_why);
    else
      insert into stock_movements(product_id, from_location, to_location, qty_base, type, ref_table, ref_id, shift_id, actor_id, note)
      values (r.product_id, null, v_store, -r.qty_base, 'count_adjust', 'stock_counts', v_c.id, null, v_staff, v_why);
    end if;
    perform write_audit('stock.count', 'stock_counts', v_c.id::text, null, to_jsonb(v_c), v_why);
    n := n + 1; units := units + r.qty_base;
  end loop;
  raise notice 'Store reset: % drinks set to 0 (% units taken off, net).', n, units;
end $$;

-- CHECK: the store column should be 0 for every drink
select p.name, coalesce(sum(case when b.location_id = loc('store') then b.qty_base end), 0) as store
from products p join stock_balance b on b.product_id = p.id
group by p.name having coalesce(sum(case when b.location_id = loc('store') then b.qty_base end), 0) <> 0 order by p.name;
