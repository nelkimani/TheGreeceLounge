-- The Glizz Lounge POS — 037: corrections after the 10 Nov stock take was recorded
-- Run in the Supabase SQL Editor ("Run without RLS" if asked). Safe to run again.
--   * Savannah Cider  -> 48 in the store
--   * Balozi 250      -> 72 in the store
--   * T. Malt Can     -> deleted (switched off: hidden everywhere, history kept)
-- Stock is never edited: the difference is added as a 'count_adjust' movement with a stock count record.
-- A drink already at the right number is left alone; a drink with MORE than the target is listed and not touched.

do $$
declare
  v_staff uuid; v_store uuid := loc('store'); r record; bal numeric; v_p products; v_c stock_counts; why text := 'Stock take correction 10 Nov 2026';
begin
  select id into v_staff from staff where staff_no = 'M001' and active;
  if v_staff is null then
    select s.id into v_staff from staff s join staff_roles sr on sr.staff_id = s.id where sr.role_code = 'manager' and s.active order by s.created_at limit 1;
  end if;
  if v_staff is null then raise exception 'no manager found'; end if;
  perform set_config('request.jwt.claim.sub', v_staff::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_staff, 'role', 'authenticated')::text, true);

  for r in select * from (values ('Savannah Cider', 48), ('Balozi 250', 72)) as t(name, target) loop
    select * into v_p from products where active and regexp_replace(lower(name), '[^a-z0-9]', '', 'g') = regexp_replace(lower(r.name), '[^a-z0-9]', '', 'g') order by created_at limit 1;
    if not found then raise notice 'NOT FOUND: %', r.name; continue; end if;
    select coalesce(sum(qty_base), 0) into bal from stock_balance where product_id = v_p.id and location_id = v_store;
    if bal = r.target then raise notice '% already at % in the store: nothing to do.', r.name, r.target; continue; end if;
    if bal > r.target then raise notice '% has % in the store, MORE than %: not touched.', r.name, bal, r.target; continue; end if;
    insert into stock_counts(location_id, product_id, expected_qty, counted_qty, explanation, counted_by, business_date)
    values (v_store, v_p.id, bal, r.target, why, v_staff, business_date(now())) returning * into v_c;
    insert into stock_movements(product_id, from_location, to_location, qty_base, type, ref_table, ref_id, shift_id, actor_id, note)
    values (v_p.id, null, v_store, r.target - bal, 'count_adjust', 'stock_counts', v_c.id, null, v_staff, why);
    perform write_audit('stock.count', 'stock_counts', v_c.id::text, null, to_jsonb(v_c), why);
    raise notice '%: store was %, now %.', r.name, bal, r.target;
  end loop;

  update products set active = false where active and regexp_replace(lower(name), '[^a-z0-9]', '', 'g') = 'tmaltcan';
  if found then raise notice 'T. Malt Can switched off.'; else raise notice 'T. Malt Can: nothing to switch off (not found or already off).'; end if;
end $$;

select p.name, p.active, coalesce(sum(case when b.location_id = loc('store') then b.qty_base end), 0) as store
from products p left join stock_balance b on b.product_id = p.id
where regexp_replace(lower(p.name), '[^a-z0-9]', '', 'g') in ('savannahcider', 'balozi250', 'tmaltcan')
group by p.name, p.active order by p.name;
