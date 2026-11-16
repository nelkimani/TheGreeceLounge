-- The Glizz Lounge POS — 036: merge "AMARULA 750ML" into "Amarula Cream 750ml" (they are the same drink)
-- Run in the Supabase SQL Editor ("Run without RLS" if asked). Safe to run again: it merges once, then does nothing.
--
-- What it does:
--   * finds the two drinks by name (spaces, punctuation and capitals ignored)
--   * checks the stock of the two added together is exactly 4 (if not, it stops and tells you; nothing is changed)
--   * moves the stock of AMARULA 750ML onto Amarula Cream 750ml, in the same place it is now (store, counter, ...).
--     Stock records can never be edited or deleted, so this is done with two new entries per place (out of one, into the other);
--     the old drink's history stays as it was, and everything is logged in the audit trail
--   * fills in the selling price / cost on Amarula Cream 750ml from the old drink ONLY if it has none, and copies any unit conversions it lacks
--   * switches AMARULA 750ML off (hidden from the stock screen and from waiters). Nothing is deleted

do $$
declare
  v_expected numeric := 4;   -- <<< total you expect for the two drinks together
  v_staff uuid; v_new products; v_old products; v_total numeric; r record; n int; v_moved numeric := 0;
begin
  select id into v_staff from staff where staff_no = 'M001' and active;
  if v_staff is null then
    select s.id into v_staff from staff s join staff_roles sr on sr.staff_id = s.id where sr.role_code = 'manager' and s.active order by s.created_at limit 1;
  end if;
  if v_staff is null then raise exception 'no manager found'; end if;
  perform set_config('request.jwt.claim.sub', v_staff::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_staff, 'role', 'authenticated')::text, true);

  select count(*) into n from products where active and regexp_replace(lower(name), '[^a-z0-9]', '', 'g') = 'amarulacream750ml';
  if n <> 1 then
    raise exception 'Expected one active "Amarula Cream 750ml", found %. Active Amarula drinks: %', n,
      coalesce((select string_agg(name, ', ') from products where active and lower(name) like '%amarula%'), '(none)');
  end if;
  select * into v_new from products where active and regexp_replace(lower(name), '[^a-z0-9]', '', 'g') = 'amarulacream750ml';

  select * into v_old from products where regexp_replace(lower(name), '[^a-z0-9]', '', 'g') = 'amarula750ml'
   order by active desc, created_at limit 1;
  if not found then
    raise exception 'No drink called AMARULA 750ML found. Amarula drinks: %',
      coalesce((select string_agg(name || case when active then '' else ' (off)' end, ', ') from products where lower(name) like '%amarula%'), '(none)');
  end if;

  if not v_old.active then
    raise notice 'AMARULA 750ML is already switched off (merged earlier): nothing changed';
    return;
  end if;

  select coalesce(sum(qty_base), 0) into v_total from stock_balance where product_id in (v_new.id, v_old.id);
  if v_total <> v_expected then
    raise exception 'Amarula Cream 750ml + AMARULA 750ML add up to %, not %. Nothing was changed.', v_total, v_expected;
  end if;

  -- 1. Move the stock, place by place.
  for r in select location_id, qty_base from stock_balance where product_id = v_old.id and qty_base <> 0 loop
    if r.qty_base > 0 then
      insert into stock_movements(product_id, from_location, to_location, qty_base, type, actor_id, idempotency_key, note)
      values (v_old.id, r.location_id, null, r.qty_base, 'count_adjust', v_staff, 'merge-out:' || v_old.id || ':' || r.location_id,
              'Merged into ' || v_new.name || ': stock moved across');
      insert into stock_movements(product_id, from_location, to_location, qty_base, type, actor_id, idempotency_key, note)
      values (v_new.id, null, r.location_id, r.qty_base, 'count_adjust', v_staff, 'merge-in:' || v_new.id || ':' || v_old.id || ':' || r.location_id,
              'Merged from ' || v_old.name || ': stock moved across');
    else  -- the old drink was short here: carry the shortage over so the total stays right
      insert into stock_movements(product_id, from_location, to_location, qty_base, type, actor_id, idempotency_key, note)
      values (v_old.id, null, r.location_id, -r.qty_base, 'count_adjust', v_staff, 'merge-out:' || v_old.id || ':' || r.location_id,
              'Merged into ' || v_new.name || ': shortage moved across');
      insert into stock_movements(product_id, from_location, to_location, qty_base, type, actor_id, idempotency_key, note)
      values (v_new.id, r.location_id, null, -r.qty_base, 'count_adjust', v_staff, 'merge-in:' || v_new.id || ':' || v_old.id || ':' || r.location_id,
              'Merged from ' || v_old.name || ': shortage moved across');
    end if;
    v_moved := v_moved + r.qty_base;
  end loop;

  -- 2. Prices: only fill gaps, never overwrite what Amarula Cream 750ml already has.
  update products set selling_price = coalesce(selling_price, v_old.selling_price),
                      purchase_cost = coalesce(purchase_cost, v_old.purchase_cost),
                      reorder_level = coalesce(reorder_level, v_old.reorder_level)
   where id = v_new.id;

  -- 3. Unit conversions the old drink had and the new one lacks; recipes that used the old drink as an ingredient; favourites.
  insert into unit_conversions(product_id, from_unit, to_unit, factor)
  select v_new.id, from_unit, to_unit, factor from unit_conversions where product_id = v_old.id
  on conflict do nothing;
  update recipe_ingredients ri set ingredient_id = v_new.id
   where ri.ingredient_id = v_old.id
     and not exists (select 1 from recipe_ingredients x where x.product_id = ri.product_id and x.ingredient_id = v_new.id);
  delete from product_favourites where product_id = v_old.id;

  -- 4. Switch the old drink off (nothing is deleted; its past sales and deliveries stay under its name).
  update products set active = false, available = false where id = v_old.id;

  perform write_audit('product.merge', 'products', v_old.id::text, to_jsonb(v_old), to_jsonb(v_new),
                      'Merged ' || v_old.name || ' into ' || v_new.name);

  raise notice 'Merged % into %: % pieces moved, total now %', v_old.name, v_new.name, v_moved, v_total;
end $$;

-- CHECK: Amarula Cream 750ml should show the total (4); AMARULA 750ML should be off with nothing left
select p.name, p.active, l.name as location, b.qty_base
from products p left join stock_balance b on b.product_id = p.id and b.qty_base <> 0 left join locations l on l.id = b.location_id
where regexp_replace(lower(p.name), '[^a-z0-9]', '', 'g') in ('amarulacream750ml', 'amarula750ml')
order by p.active desc, p.name, l.name;
