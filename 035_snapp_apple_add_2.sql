-- The Glizz Lounge POS — 035: add 2 pieces to "Snap Apple" so the stock goes from 48 to 50
-- Run in the Supabase SQL Editor ("Run without RLS" if asked). Safe to run again: the 2 pieces are added once.
--
-- What it does:
--   * finds the active drink whose name is "Snap Apple" / "Snapp Apple" (spaces, punctuation and capitals ignored)
--   * checks the stock on hand is exactly 48 (if it is not, it stops and tells you what it found; nothing is changed)
--   * adds 2 pieces as a stock-count adjustment, in the place that already holds the stock (the store or the counter)
-- It does not touch prices, other drinks or any sales.

do $$
declare
  v_expected numeric := 48;   -- <<< the stock you expect to have now
  v_add      numeric := 2;    -- <<< pieces to add (48 + 2 = 50)
  v_staff uuid; v_p products; v_have numeric; v_loc uuid; v_loc_name text; v_key text; n int;
begin
  select id into v_staff from staff where staff_no = 'M001' and active;
  if v_staff is null then
    select s.id into v_staff from staff s join staff_roles sr on sr.staff_id = s.id where sr.role_code = 'manager' and s.active order by s.created_at limit 1;
  end if;
  if v_staff is null then raise exception 'no manager found'; end if;
  perform set_config('request.jwt.claim.sub', v_staff::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_staff, 'role', 'authenticated')::text, true);

  select count(*) into n from products where active and regexp_replace(lower(name), '[^a-z0-9]', '', 'g') ~ '^snapp?apple';
  if n = 0 then
    raise exception 'No active drink called Snap Apple. Active drinks with "snap" in the name: %',
      coalesce((select string_agg(name, ', ') from products where active and lower(name) like '%snap%'), '(none)');
  elsif n > 1 then
    raise exception 'More than one drink matches Snap Apple: %. Make the name match above more specific.',
      (select string_agg(name, ', ') from products where active and regexp_replace(lower(name), '[^a-z0-9]', '', 'g') ~ '^snapp?apple');
  end if;

  select * into v_p from products where active and regexp_replace(lower(name), '[^a-z0-9]', '', 'g') ~ '^snapp?apple';

  v_key := 'snapp-apple-add-2:' || v_p.id;
  if exists (select 1 from stock_movements where idempotency_key = v_key) then
    raise notice '% : the % pieces were already added, nothing changed', v_p.name, v_add;
    return;
  end if;

  select coalesce(sum(qty_base), 0) into v_have from stock_balance where product_id = v_p.id;
  if v_have <> v_expected then
    raise exception '% has % in stock, not %. Nothing was changed.', v_p.name, v_have, v_expected;
  end if;

  -- Add to the main place that already holds the stock (store or counter); the counter if there is none yet.
  select b.location_id, l.name into v_loc, v_loc_name
  from stock_balance b join locations l on l.id = b.location_id
  where b.product_id = v_p.id and b.qty_base > 0 and l.custodian_id is null
  order by b.qty_base desc limit 1;
  if v_loc is null then v_loc := loc('main_bar'); v_loc_name := 'main bar'; end if;

  insert into stock_movements(product_id, from_location, to_location, qty_base, type, shift_id, actor_id, idempotency_key, note)
  values (v_p.id, null, v_loc, v_add, 'count_adjust', null, v_staff, v_key, v_p.name || ': added ' || v_add || ' pieces (' || v_expected || ' to ' || (v_expected + v_add) || ')');

  raise notice '% : added % pieces to % (% -> %)', v_p.name, v_add, v_loc_name, v_expected, v_expected + v_add;
end $$;

-- CHECK: Snap Apple should now show 50 in total
select p.name, l.name as location, b.qty_base
from products p join stock_balance b on b.product_id = p.id join locations l on l.id = b.location_id
where regexp_replace(lower(p.name), '[^a-z0-9]', '', 'g') ~ '^snapp?apple' and b.qty_base <> 0
order by p.name, l.name;
