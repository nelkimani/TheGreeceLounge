-- The Glizz Lounge POS — 034: load the GLIZZ Lounge Ndagani food & drinks menu (Restaurant + Choma)
-- Run in the Supabase SQL Editor ("Run without RLS" if asked). Safe to run again.
--
-- 79 items. Restaurant items go to the KITCHEN station, "Mbuzi choma" to the CHOMA station. Prices are from the menu PDF.
-- Everyone who can take orders (waiters, bartenders, managers...) sees every active menu item with a price.
--
-- OVERRIDE of what is already in the system:
--   * an existing drink/dish with the same name (capitals, spaces and punctuation ignored, e.g. "Mukimo") is UPDATED to the
--     menu's price, category and station, and switched on;
--   * every other product on the CHOMA station that is not on this menu is switched OFF (hidden, history kept; the
--     Products & prices screen can switch it back on);
--   * everything else (all the drinks) is left alone.
-- Kitchen and choma items are not stock-counted: sales do not take them out of any stock balance.
-- Platter contents are not stored (the product list has no description field); the platters are sold at their price.

do $$
declare
  v_staff uuid; r record; v_p products; v_cat uuid; v_sku text; v_base text; i int; v_key text;
  n_new int := 0; n_upd int := 0; n_off int := 0; keys text[] := '{}';
begin
  select id into v_staff from staff where staff_no = 'M001' and active;
  if v_staff is null then
    select s.id into v_staff from staff s join staff_roles sr on sr.staff_id = s.id where sr.role_code = 'manager' and s.active order by s.created_at limit 1;
  end if;
  if v_staff is null then raise exception 'no manager found'; end if;
  perform set_config('request.jwt.claim.sub', v_staff::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_staff, 'role', 'authenticated')::text, true);
  insert into units(code, name) values ('portion', 'Portion') on conflict do nothing;

  for r in
    select * from (values
      ('African tea', 'Hot drinks', 'kitchen', 100),
      ('Black tea', 'Hot drinks', 'kitchen', 100),
      ('Spiced tea', 'Hot drinks', 'kitchen', 100),
      ('Special tea', 'Hot drinks', 'kitchen', 100),
      ('Black coffee', 'Hot drinks', 'kitchen', 100),
      ('White coffee', 'Hot drinks', 'kitchen', 100),
      ('Plain milk', 'Hot drinks', 'kitchen', 100),
      ('Chocolate / White', 'Hot drinks', 'kitchen', 100),
      ('Dawa', 'Hot drinks', 'kitchen', 200),
      ('Chapati', 'Snacks & breakfast', 'kitchen', 30),
      ('Chapati brown', 'Snacks & breakfast', 'kitchen', 50),
      ('Mandazi', 'Snacks & breakfast', 'kitchen', 30),
      ('Kebab', 'Snacks & breakfast', 'kitchen', 100),
      ('Donut', 'Snacks & breakfast', 'kitchen', 50),
      ('Croissant', 'Snacks & breakfast', 'kitchen', 100),
      ('Bhajia 1/2', 'Snacks & breakfast', 'kitchen', 100),
      ('Bhajia full', 'Snacks & breakfast', 'kitchen', 150),
      ('Bhajia full special', 'Snacks & breakfast', 'kitchen', 200),
      ('Sausage', 'Snacks & breakfast', 'kitchen', 60),
      ('Special sausage single', 'Snacks & breakfast', 'kitchen', 120),
      ('Special sausage double', 'Snacks & breakfast', 'kitchen', 170),
      ('Special samosa single', 'Snacks & breakfast', 'kitchen', 120),
      ('Special samosa double', 'Snacks & breakfast', 'kitchen', 170),
      ('Chips mayai', 'Snacks & breakfast', 'kitchen', 250),
      ('Chips masala', 'Snacks & breakfast', 'kitchen', 200),
      ('Chips', 'Snacks & breakfast', 'kitchen', 200),
      ('Potato wedges', 'Snacks & breakfast', 'kitchen', 200),
      ('Saute potatoes', 'Snacks & breakfast', 'kitchen', 200),
      ('Mash potatoes', 'Snacks & breakfast', 'kitchen', 200),
      ('Pancake', 'Snacks & breakfast', 'kitchen', 100),
      ('Bacon', 'Snacks & breakfast', 'kitchen', 150),
      ('Spanish omelette', 'Snacks & breakfast', 'kitchen', 150),
      ('Fried eggs', 'Snacks & breakfast', 'kitchen', 100),
      ('Scrambled eggs', 'Snacks & breakfast', 'kitchen', 150),
      ('Ugali', 'Accompaniments', 'kitchen', 50),
      ('Ugali brown', 'Accompaniments', 'kitchen', 100),
      ('Mukimo', 'Accompaniments', 'kitchen', 150),
      ('White rice', 'Accompaniments', 'kitchen', 150),
      ('Spaghetti', 'Accompaniments', 'kitchen', 150),
      ('Pilau', 'Accompaniments', 'kitchen', 200),
      ('Mashed potatoes', 'Accompaniments', 'kitchen', 200),
      ('Spaghetti saladato', 'Accompaniments', 'kitchen', 250),
      ('Rice saladato', 'Accompaniments', 'kitchen', 250),
      ('Fried rice', 'Accompaniments', 'kitchen', 250),
      ('Coconut rice', 'Accompaniments', 'kitchen', 250),
      ('Lyonnaise potatoes', 'Accompaniments', 'kitchen', 250),
      ('Beef 1/4 kg', 'Lunch & dinner', 'kitchen', 250),
      ('Beef 1/2 kg', 'Lunch & dinner', 'kitchen', 500),
      ('Beef 1 kg', 'Lunch & dinner', 'kitchen', 1000),
      ('Matumbo', 'Lunch & dinner', 'kitchen', 250),
      ('Green minji', 'Lunch & dinner', 'kitchen', 200),
      ('Beans steamed', 'Lunch & dinner', 'kitchen', 100),
      ('Coconut beans', 'Lunch & dinner', 'kitchen', 150),
      ('Full tilapia fish', 'Lunch & dinner', 'kitchen', 600),
      ('Fish fillet', 'Lunch & dinner', 'kitchen', 500),
      ('Fish fingers', 'Lunch & dinner', 'kitchen', 450),
      ('Biriani mbuzi/chicken', 'Lunch & dinner', 'kitchen', 500),
      ('Biriani beef', 'Lunch & dinner', 'kitchen', 500),
      ('Aleso', 'Lunch & dinner', 'kitchen', 700),
      ('Arosto', 'Lunch & dinner', 'kitchen', 700),
      ('Chicken soup', 'Lunch & dinner', 'kitchen', 350),
      ('Grilled chicken', 'Lunch & dinner', 'kitchen', 350),
      ('Mbuzi wet fry', 'Lunch & dinner', 'kitchen', 400),
      ('Omena', 'Lunch & dinner', 'kitchen', 200),
      ('Chicken full', 'Chicken', 'kitchen', 1400),
      ('Chicken half', 'Chicken', 'kitchen', 700),
      ('Chicken quarter', 'Chicken', 'kitchen', 350),
      ('Broiler full', 'Chicken', 'kitchen', 1100),
      ('Broiler half', 'Chicken', 'kitchen', 550),
      ('Broiler quarter', 'Chicken', 'kitchen', 275),
      ('Mbuzi choma 1 kg', 'Nyama choma', 'choma', 1000),
      ('Mbuzi choma 1/2 kg', 'Nyama choma', 'choma', 500),
      ('Greens', 'Vegetable corner', 'kitchen', 100),
      ('Cabbage', 'Vegetable corner', 'kitchen', 50),
      ('Kachumbari', 'Vegetable corner', 'kitchen', 50),
      ('Bone soup', 'Vegetable corner', 'kitchen', 50),
      ('Special Platter', 'Platters', 'kitchen', 3000),
      ('Full Platter', 'Platters', 'kitchen', 2800),
      ('Half Platter', 'Platters', 'kitchen', 2000)
    ) as t(name, cat, station, price)
  loop
    v_key := regexp_replace(lower(r.name), '[^a-z0-9]', '', 'g');
    keys := keys || v_key;
    insert into categories(name) values (r.cat) on conflict (name) do update set name = excluded.name returning id into v_cat;
    select * into v_p from products where active and regexp_replace(lower(name), '[^a-z0-9]', '', 'g') = v_key order by created_at limit 1;
    if found then
      update products set name = r.name, category_id = v_cat, station = r.station::station, selling_price = r.price,
                          available = true, is_demo = false where id = v_p.id;
      n_upd := n_upd + 1; raise notice 'UPDATED : % (was "%" at %)', r.name, v_p.name, v_p.selling_price;
    else
      v_base := 'GL-' || trim(both '-' from regexp_replace(upper(r.name), '[^A-Z0-9]+', '-', 'g'));
      v_sku := v_base; i := 1;
      while exists (select 1 from products where sku = v_sku) loop i := i + 1; v_sku := v_base || '-' || i; end loop;
      insert into products(sku, name, category_id, station, is_liquor, base_unit, sale_unit, selling_price, is_demo)
      values (v_sku, r.name, v_cat, r.station::station, false, 'portion', 'portion', r.price, false) returning * into v_p;
      perform write_audit('product.create', 'products', v_p.id::text, null, to_jsonb(v_p), 'Restaurant and choma menu load');
      n_new := n_new + 1;
    end if;
  end loop;

  for r in select id, name from products
            where active and station = 'choma' and not (regexp_replace(lower(name), '[^a-z0-9]', '', 'g') = any (keys))
  loop
    update products set active = false where id = r.id;
    n_off := n_off + 1; raise notice 'SWITCHED OFF (old choma item): %', r.name;
  end loop;

  perform write_audit('product.menu_load', 'products', null, null,
    jsonb_build_object('new', n_new, 'updated', n_upd, 'switched_off', n_off), 'Restaurant and choma menu load (GLIZZ Lounge Ndagani menu)');
  raise notice 'DONE: % new, % updated, % old choma items switched off.', n_new, n_upd, n_off;
end $$;

-- CHECK: the menu as the system now has it
select c.name as category, p.station, p.name, p.selling_price
from products p join categories c on c.id = p.category_id
where p.active and p.station in ('kitchen', 'choma') order by p.station, c.name, p.name;
