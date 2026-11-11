-- The Glizz Lounge POS — 040: Chrome Vodka 250ml on the COUNTER -> 72
-- The counter really holds 72 (only 8 were sold) but the system shows 64.
-- Run in the Supabase SQL Editor ("Run without RLS" if asked). Safe to run again (already 72 = skipped).
-- Booked as a stock count + 'count_adjust' movement by manager M001 (or the first manager), reason "Count correction 11 Nov 2026".
-- Nothing is deleted and the store is not touched.

do $$
declare
  v_staff uuid; v_bar uuid := loc('main_bar'); v_p products; v_c stock_counts; bal numeric; target numeric := 72;
  why text := 'Count correction 11 Nov 2026: counter holds 72, 8 sold';
begin
  select id into v_staff from staff where staff_no = 'M001' and active;
  if v_staff is null then
    select s.id into v_staff from staff s join staff_roles sr on sr.staff_id = s.id where sr.role_code = 'manager' and s.active order by s.created_at limit 1;
  end if;
  if v_staff is null then raise exception 'no manager found'; end if;
  perform set_config('request.jwt.claim.sub', v_staff::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_staff, 'role', 'authenticated')::text, true);

  select * into v_p from products where active and regexp_replace(lower(name), '[^a-z0-9]', '', 'g') = 'chromevodka250ml' order by created_at limit 1;
  if not found then raise exception 'Chrome Vodka 250ml not found'; end if;
  select coalesce(sum(qty_base), 0) into bal from stock_balance where product_id = v_p.id and location_id = v_bar;
  if bal = target then raise notice 'Counter is already %: nothing to do.', target; return; end if;

  insert into stock_counts(location_id, product_id, expected_qty, counted_qty, explanation, counted_by, business_date)
  values (v_bar, v_p.id, bal, target, why, v_staff, business_date(now())) returning * into v_c;
  if target > bal then
    insert into stock_movements(product_id, from_location, to_location, qty_base, type, ref_table, ref_id, shift_id, actor_id, note)
    values (v_p.id, null, v_bar, target - bal, 'count_adjust', 'stock_counts', v_c.id, null, v_staff, why);
  else
    insert into stock_movements(product_id, from_location, to_location, qty_base, type, ref_table, ref_id, shift_id, actor_id, note)
    values (v_p.id, v_bar, null, bal - target, 'count_adjust', 'stock_counts', v_c.id, null, v_staff, why);
  end if;
  perform write_audit('stock.count', 'stock_counts', v_c.id::text, null, to_jsonb(v_c), why);
  raise notice 'Chrome Vodka 250ml: counter was %, now %.', bal, target;
end $$;

select p.name, coalesce(sum(case when b.location_id = loc('store') then b.qty_base end), 0) as store,
       coalesce(sum(case when b.location_id = loc('main_bar') then b.qty_base end), 0) as counter
from products p left join stock_balance b on b.product_id = p.id
where regexp_replace(lower(p.name), '[^a-z0-9]', '', 'g') = 'chromevodka250ml' group by p.name;
