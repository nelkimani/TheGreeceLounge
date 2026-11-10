-- The Glizz Lounge POS — 039: set two counts in the STORE
--   Caprice Sweet Red 1L   -> 0
--   Caprice Dry Red 1LTR   -> 8
-- Run in the Supabase SQL Editor ("Run without RLS" if asked). Safe to run again (a drink already at the number is skipped).
-- Each one is booked as a stock count + 'count_adjust' movement (up or down) by manager M001 (or the first manager),
-- reason "Count correction 10 Nov 2026". Nothing is deleted. The counter is not touched.

do $$
declare
  v_staff uuid; v_store uuid := loc('store'); r record; v_p products; v_c stock_counts; bal numeric; why text := 'Count correction 10 Nov 2026';
begin
  select id into v_staff from staff where staff_no = 'M001' and active;
  if v_staff is null then
    select s.id into v_staff from staff s join staff_roles sr on sr.staff_id = s.id where sr.role_code = 'manager' and s.active order by s.created_at limit 1;
  end if;
  if v_staff is null then raise exception 'no manager found'; end if;
  perform set_config('request.jwt.claim.sub', v_staff::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_staff, 'role', 'authenticated')::text, true);

  for r in select * from (values ('Caprice Sweet Red 1L', 0), ('Caprice Dry Red 1LTR', 8)) as t(name, target) loop
    select * into v_p from products where active and regexp_replace(lower(name), '[^a-z0-9]', '', 'g') = regexp_replace(lower(r.name), '[^a-z0-9]', '', 'g') order by created_at limit 1;
    if not found then raise notice 'NOT FOUND: %', r.name; continue; end if;
    select coalesce(sum(qty_base), 0) into bal from stock_balance where product_id = v_p.id and location_id = v_store;
    if bal = r.target then raise notice '% is already % in the store: nothing to do.', r.name, r.target; continue; end if;
    insert into stock_counts(location_id, product_id, expected_qty, counted_qty, explanation, counted_by, business_date)
    values (v_store, v_p.id, bal, r.target, why, v_staff, business_date(now())) returning * into v_c;
    if r.target > bal then
      insert into stock_movements(product_id, from_location, to_location, qty_base, type, ref_table, ref_id, shift_id, actor_id, note)
      values (v_p.id, null, v_store, r.target - bal, 'count_adjust', 'stock_counts', v_c.id, null, v_staff, why);
    else
      insert into stock_movements(product_id, from_location, to_location, qty_base, type, ref_table, ref_id, shift_id, actor_id, note)
      values (v_p.id, v_store, null, bal - r.target, 'count_adjust', 'stock_counts', v_c.id, null, v_staff, why);
    end if;
    perform write_audit('stock.count', 'stock_counts', v_c.id::text, null, to_jsonb(v_c), why);
    raise notice '%: store was %, now %.', r.name, bal, r.target;
  end loop;
end $$;

select p.name, coalesce(sum(case when b.location_id = loc('store') then b.qty_base end), 0) as store,
       coalesce(sum(case when b.location_id = loc('main_bar') then b.qty_base end), 0) as counter
from products p left join stock_balance b on b.product_id = p.id
where regexp_replace(lower(p.name), '[^a-z0-9]', '', 'g') in ('capricesweetred1l', 'capricedryred1ltr') group by p.name order by p.name;
