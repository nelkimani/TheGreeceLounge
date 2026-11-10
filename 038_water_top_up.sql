-- The Glizz Lounge POS — 038: add 216 to Water 1L in the STORE (total 220)
-- Run in the Supabase SQL Editor ("Run without RLS" if asked).
-- It expects the store to hold 4 now (4 + 216 = 220). If the store holds something else it STOPS and tells you the
-- real figure, so you never end up with the wrong total. Safe to run again: once the total is 220 it does nothing.
-- Booked as a stock count + 'count_adjust' movement by manager M001 (or the first manager).

do $$
declare
  v_staff uuid; v_store uuid := loc('store'); v_p products; v_c stock_counts; bal numeric;
  v_add numeric := 216; v_expect numeric := 4; v_total numeric := 220; why text := 'Water 1L: 216 added (total 220)';
begin
  select id into v_staff from staff where staff_no = 'M001' and active;
  if v_staff is null then
    select s.id into v_staff from staff s join staff_roles sr on sr.staff_id = s.id where sr.role_code = 'manager' and s.active order by s.created_at limit 1;
  end if;
  if v_staff is null then raise exception 'no manager found'; end if;
  perform set_config('request.jwt.claim.sub', v_staff::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_staff, 'role', 'authenticated')::text, true);

  select * into v_p from products where active and regexp_replace(lower(name), '[^a-z0-9]', '', 'g') = 'water1l' order by created_at limit 1;
  if not found then raise exception 'Water 1L not found'; end if;
  select coalesce(sum(qty_base), 0) into bal from stock_balance where product_id = v_p.id and location_id = v_store;

  if bal = v_total then raise notice 'Water 1L is already at % in the store: nothing to do.', v_total; return; end if;
  if bal <> v_expect then
    raise exception 'Water 1L has % in the store, not the expected %. Nothing was changed. Tell me the figure you want and I will adjust the script.', bal, v_expect;
  end if;

  insert into stock_counts(location_id, product_id, expected_qty, counted_qty, explanation, counted_by, business_date)
  values (v_store, v_p.id, bal, v_total, why, v_staff, business_date(now())) returning * into v_c;
  insert into stock_movements(product_id, from_location, to_location, qty_base, type, ref_table, ref_id, shift_id, actor_id, note)
  values (v_p.id, null, v_store, v_add, 'count_adjust', 'stock_counts', v_c.id, null, v_staff, why);
  perform write_audit('stock.count', 'stock_counts', v_c.id::text, null, to_jsonb(v_c), why);
  raise notice 'Water 1L: store was %, now %.', bal, v_total;
end $$;

select p.name, coalesce(sum(case when b.location_id = loc('store') then b.qty_base end), 0) as store,
       coalesce(sum(case when b.location_id = loc('main_bar') then b.qty_base end), 0) as counter
from products p left join stock_balance b on b.product_id = p.id
where regexp_replace(lower(p.name), '[^a-z0-9]', '', 'g') = 'water1l' group by p.name;
