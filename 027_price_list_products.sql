-- The Glizz Lounge POS — 027: add the drinks on the Product Price List (with purchase cost and selling price)
-- Run ONCE in the Supabase SQL Editor ("Run without RLS" if asked). Safe to run again.
--
-- For each line of the price list (29 drinks):
--   * a drink that is already in the app (same name, or the name in the last column) gets its selling price and
--     purchase cost updated; its name and stock are not touched
--   * a drink that is not in the app is added to the Bar with its category, unit, selling price and purchase cost
--     and 0 in stock (stock comes in through Purchasing > Upload delivery or an opening count)
-- Categories: Beers (cans and the "crates" list, which are priced per bottle), Cognac (Hennessy, Martell),
-- Soft drinks. Cans are counted in cans, everything else in bottles.

begin;

create temp table _price_list(name text, category text, unit text, sell numeric, cost numeric, existing_name text) on commit drop;
insert into _price_list values
  ('Balozi Can', 'Beers', 'can', 300, 199.17, null),
  ('Tusker Lite Can', 'Beers', 'can', 350, 242.7, null),
  ('T. Malt Can', 'Beers', 'can', 350, 241.88, null),
  ('Whitecap Can', 'Beers', 'can', 300, 216.86, null),
  ('Guinness Can', 'Beers', 'can', 300, 216.88, null),
  ('Tusker Can', 'Beers', 'can', 300, 199.88, null),
  ('Manyatta Can', 'Beers', 'can', 350, 240.28, null),
  ('Manyatta Pine & Mint', 'Beers', 'bottle', 300, 220.0, null),
  ('Snap Apple', 'Beers', 'bottle', 250, 159.4, null),
  ('Balozi', 'Beers', 'bottle', 250, 169.0, null),
  ('Pilsner Bold', 'Beers', 'bottle', 250, 169.2, null),
  ('Guinness Kubwa', 'Beers', 'bottle', 300, 204.4, null),
  ('Pineapple Punch', 'Beers', 'bottle', 250, 159.4, null),
  ('Smirnoff Black Ice', 'Beers', 'bottle', 250, 159.4, null),
  ('Pilsner Mfalme', 'Beers', 'bottle', 200, 118.04, null),
  ('Hennessy VS 1L', 'Cognac', 'bottle', 14000, 9730, 'Hennessy 1LT'),
  ('Hennessy VSOP 750ml', 'Cognac', 'bottle', 15000, 11399, 'Hennessy VSOP 750ML'),
  ('Hennessy VS 700ml', 'Cognac', 'bottle', 10000, 8395, null),
  ('Martell VS 750ml', 'Cognac', 'bottle', 10500, 5758, 'Martell VS 750ML'),
  ('Martell VSOP 750ml', 'Cognac', 'bottle', 13000, 8765, 'Martell VSOP 750ML'),
  ('Martell VS 1L', 'Cognac', 'bottle', 13500, 8940, 'Martell VS 1L'),
  ('Martell VSOP 1L', 'Cognac', 'bottle', 15000, 11350, 'Martell VSOP 1L'),
  ('Soda 300ml', 'Soft drinks', 'bottle', 100, 32.5, null),
  ('Water 1L', 'Soft drinks', 'bottle', 150, 33.3, null),
  ('Kingfisher Strawberry', 'Soft drinks', 'bottle', 300, 211.0, null),
  ('Predator', 'Soft drinks', 'bottle', 120, 54.17, null),
  ('Minute Maid 400ml', 'Soft drinks', 'bottle', 150, 70.83, null),
  ('Minute Maid 1L', 'Soft drinks', 'bottle', 300, 133.3, null),
  ('Keringet Sparkling 1L', 'Soft drinks', 'bottle', 200, 96.25, null);

insert into categories(name)
select distinct p.category from _price_list p
where not exists (select 1 from categories c where lower(c.name) = lower(p.category));

do $$
declare r record; v_id uuid; v_cat uuid; v_sku text; v_base text; i int; n_new int := 0; n_upd int := 0;
begin
  for r in select * from _price_list loop
    select id into v_id from products
     where active and lower(btrim(name)) in (lower(r.name), lower(coalesce(r.existing_name, r.name))) order by (lower(btrim(name)) = lower(coalesce(r.existing_name, r.name))) desc limit 1;
    if v_id is not null then
      update products set selling_price = r.sell, purchase_cost = r.cost where id = v_id and (selling_price is distinct from r.sell or purchase_cost is distinct from r.cost);
      if found then n_upd := n_upd + 1; end if;
    else
      select id into v_cat from categories where lower(name) = lower(r.category) limit 1;
      v_base := 'GL-' || trim(both '-' from regexp_replace(upper(btrim(r.name)), '[^A-Z0-9]+', '-', 'g'));
      v_sku := v_base; i := 1;
      while exists (select 1 from products where sku = v_sku) loop i := i + 1; v_sku := v_base || '-' || i; end loop;
      insert into products(sku, name, category_id, station, is_liquor, base_unit, sale_unit, selling_price, purchase_cost, reorder_level, is_demo)
      values (v_sku, r.name, v_cat, 'bar', r.category <> 'Soft drinks', r.unit, r.unit, r.sell, r.cost, 0, false);
      n_new := n_new + 1;
    end if;
  end loop;
  raise notice '% drink(s) added, % existing drink(s) updated', n_new, n_upd;
end $$;

commit;
