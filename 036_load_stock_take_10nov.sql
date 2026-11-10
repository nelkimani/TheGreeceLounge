-- The Glizz Lounge POS — 036: load the 10 Nov 2026 stock take (Main stock sheet) into the STORE
-- Run in the Supabase SQL Editor ("Run without RLS" if asked). Run 035_reset_store_and_counter.sql FIRST (store must be 0).
--
-- 151 drinks, 3797 units, read from the handwritten "Open:" column of the printed stock sheet (Main_stock_10112026.pdf).
-- Each drink is matched to the drink already in the system by name (capitals, spaces and punctuation ignored) and gets an
-- 'opening' stock movement into the STORE. Prices and categories are NOT changed. The counter stays at 0.
-- The only drinks added if missing are "Chrome Gin 250ml" (written by hand on the sheet) and "Liberty 250ml" (the sheet
-- says 750ml, you confirmed it is 250ml): they are added WITHOUT a selling price (Liberty takes the category of Liberty 750ml).
-- A drink whose store is not at 0 is skipped and listed (run 035 first); a drink that cannot be found is listed too.
--
-- T. Malt Can is DELETED (switched off). NOT loaded on purpose (crossed out or blank on the sheet): Tusker 500ml, Hennesy (crossed out), Hennessy 1LT (blank).
-- Southern Comfort is loaded onto the system drink "Southern Comfort 70cl" (you said 750ml: rename it in Products if needed).
--
-- TWO STEPS (nothing is changed on the first): run as it is to CHECK; change  v_dry boolean := true  to  false  to RECORD.
-- Safe to run again: a drink already loaded is skipped.

do $$
declare
  v_dry boolean := true;                      -- <<< change to false to RECORD the stock
  v_staff uuid; r record; v_p products; v_cat uuid; v_sku text; v_base text; i int;
  n_ok int := 0; units numeric := 0; n_new int := 0; bal numeric;
  not_found text[] := '{}'; not_zero text[] := '{}'; already text[] := '{}';
begin
  select id into v_staff from staff where staff_no = 'M001' and active;
  if v_staff is null then
    select s.id into v_staff from staff s join staff_roles sr on sr.staff_id = s.id where sr.role_code = 'manager' and s.active order by s.created_at limit 1;
  end if;
  if v_staff is null then raise exception 'no manager found'; end if;
  perform set_config('request.jwt.claim.sub', v_staff::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_staff, 'role', 'authenticated')::text, true);

  for r in
    select * from (values
      ('Balozi 250', 72),
      ('Balozi Can', 24),
      ('Guarana Can', 48),
      ('Guinness Can', 24),
      ('Guinness Kubwa', 96),
      ('Heineken 0.0 Beer 330ml', 24),
      ('Heineken Bottle 330ml', 24),
      ('Heineken Can 500ml', 24),
      ('Hunters Dry 330ml', 24),
      ('KO CIDER', 24),
      ('Manyatta Can', 96),
      ('Manyatta Pine & Mint', 48),
      ('Pilsner Bold', 48),
      ('Pilsner Mfalme', 24),
      ('Pineapple Punch', 72),
      ('Punch Can', 48),
      ('Savannah Cider', 48),
      ('Smirnoff Black Ice', 48),
      ('Smirnoff Raspberry 300ml Bottle', 50),
      ('Smirnoff Raspberry Can', 48),
      ('Snap Apple', 48),
      ('Snapp Can', 48),
      ('Tusker Can', 24),
      ('Tusker Cider', 72),
      ('Tusker Lager', 96),
      ('Tusker Lite 330ml', 48),
      ('Tusker Lite Can', 48),
      ('Tusker Malt 330ml', 48),
      ('Tusker Malt Can', 12),
      ('Whitecap Can', 24),
      ('Whitecap Lager', 120),
      ('Hunters Choice 250ml', 24),
      ('Hunters Choice 350ml', 36),
      ('Hunters Choice 750ml', 60),
      ('Richot 250ml', 40),
      ('Richot 750ml', 12),
      ('Viceroy Brandy 250ml', 24),
      ('Viceroy Brandy 375ml', 24),
      ('Viceroy Brandy 750ML', 60),
      ('Hennessy VS 700ml', 2),
      ('Hennessy VSOP 750ML', 2),
      ('Martell VS 1L', 2),
      ('Martell VS 750ML', 2),
      ('Martell VSOP 1L', 1),
      ('Martell VSOP 750ML', 2),
      ('Chrome Gin 750ml', 12),
      ('Chrome Gin 250ml', 40),
      ('Gilbeys 250ml', 80),
      ('Gilbeys 750ml', 12),
      ('Gilbeys Berry 750ml', 2),
      ('Gordons Dry Gin 1L', 2),
      ('Gordons Dry Gin 350ml', 5),
      ('Gordons Dry Gin 750ml', 2),
      ('Gordons Lemon 700ml', 2),
      ('Tanqueray BR 700ml', 1),
      ('Tanqueray Rangpur 700ml', 1),
      ('Tanqueray Sevilla 700ml', 1),
      ('Amarula Cream 375ml', 2),
      ('Amarula Cream 750ml', 2),
      ('Astral Blanco 750ml', 3),
      ('Baileys 1L', 3),
      ('Baileys Irish Cream 750ML', 5),
      ('Camino Tequila 750ml', 3),
      ('Casamigos Blanco 750ml', 2),
      ('Don Julio Blanco 750ml', 3),
      ('Don Julio Rpsdo 750ml', 3),
      ('Jagermeister 1L with Cork', 4),
      ('Jagermeister with Cork 700ML', 4),
      ('V&A 250ml', 40),
      ('V&A 750ml', 12),
      ('Captain Morgan 250ml', 80),
      ('Captain Morgan 750ml', 12),
      ('Captain Muckpit 250ml', 40),
      ('Captain Muckpit 750ml', 12),
      ('County Spirit 250ML', 12),
      ('County Spirit 750ML', 12),
      ('KC Lemon 250ml', 80),
      ('KC Lemon 750ml', 12),
      ('KC PP 250ml', 80),
      ('KC PP 750ml', 12),
      ('KC Smooth 250ml', 80),
      ('KC Smooth 750ml', 12),
      ('Delmonte All Flavours 1L', 48),
      ('Keringet Sparkling 1L', 12),
      ('Kingfisher Strawberry', 24),
      ('Minute Maid 1L', 36),
      ('Minute Maid 400ml', 36),
      ('Peptang Lime 700ml', 4),
      ('Predator', 72),
      ('Red Bull Energy Drink', 24),
      ('Soda 300ml', 408),
      ('Water 1L', 24),
      ('Chrome Lemon 250ml', 40),
      ('Chrome Vodka 250ml', 80),
      ('Chrome Vodka 750ml', 48),
      ('Smirnoff Gold', 2),
      ('Smirnoff Red 250ml', 40),
      ('Smirnoff Red 350ml', 5),
      ('Smirnoff Red 750ml', 12),
      ('Smirnoff Spicy Tamarind 750ml', 3),
      ('Smirnoff Vanilla 700ml', 2),
      ('Black & White 375ml', 24),
      ('Bulleit Bourbon 700ml', 2),
      ('Grants with Glass 1 Litre', 5),
      ('Grants with Glass 750ML', 6),
      ('J&B 1L', 2),
      ('Jack Daniels 1LTR', 4),
      ('Jack Daniels 750ml', 4),
      ('Jameson 1LTR', 1),
      ('Jameson 750ML', 3),
      ('John Barr Black 1L', 4),
      ('John Barr Black 750ML', 2),
      ('Johnnie Walker Black 1L', 6),
      ('Johnnie Walker Black 375ml', 5),
      ('Johnnie Walker Black 750ml', 8),
      ('Johnnie Walker Double Black 1L', 2),
      ('Johnnie Walker Red 1L', 6),
      ('Johnnie Walker Red 375ml', 5),
      ('Johnnie Walker Red 750ml', 6),
      ('Roe & Co Whiskey', 1),
      ('Singleton 12Y', 1),
      ('Singleton 15Y', 1),
      ('Vat 69 350ml', 24),
      ('Vat 69 750ml', 24),
      ('William Lawson 1ltr', 3),
      ('William Lawson 750ML', 3),
      ('4th Street Sweet Red 750ML', 6),
      ('4th Street Sweet White 750ML', 4),
      ('Caprice Dry Red 1LTR', 4),
      ('Caprice Dry White 1LTR', 4),
      ('Caprice Sweet Red 1L', 4),
      ('Caprice Sweet White 1L', 4),
      ('Casa Buena Red 1LTR', 4),
      ('Casa Buena White 1LTR', 4),
      ('Cellar Cask Red 750ML', 4),
      ('Cellar Cask White 750ML', 2),
      ('Drostdy Hof Sweet Red 750ML', 4),
      ('Four Cousins Red 750ML', 4),
      ('Four Cousins White 750ML', 4),
      ('Robertson Red 750ml', 4),
      ('Robertson White 750ML', 4),
      ('Rosso Nobile 750ML', 4),
      ('Kane 250ml', 40),
      ('Kane 750ml', 12),
      ('McDowell''s 750ml', 10),
      ('Orijin 250ml', 40),
      ('Orijin 750ml', 12),
      ('Triple Ace 250ml', 40),
      ('Triple Ace 750ml', 12),
      ('Southern Comfort 70cl', 2),
      ('Liberty 250ml', 10)
    ) as t(name, qty)
  loop
    select * into v_p from products where active and regexp_replace(lower(name), '[^a-z0-9]', '', 'g') = regexp_replace(lower(r.name), '[^a-z0-9]', '', 'g')
     order by created_at limit 1;
    if not found then
      if r.name in ('Chrome Gin 250ml', 'Liberty 250ml') then
        if v_dry then raise notice 'ADD NEW   : % (no selling price)', r.name; n_new := n_new + 1;
        else
          if r.name = 'Liberty 250ml' then
            select category_id into v_cat from products where active and regexp_replace(lower(name), '[^a-z0-9]', '', 'g') = 'liberty750ml' limit 1;
            if v_cat is null then select id into v_cat from categories where name = 'Spirits'; end if;
            if v_cat is null then insert into categories(name) values ('Spirits') returning id into v_cat; end if;
          else
            select id into v_cat from categories where name = 'Gin';
            if v_cat is null then insert into categories(name) values ('Gin') returning id into v_cat; end if;
          end if;
          v_base := 'GL-' || trim(both '-' from regexp_replace(upper(r.name), '[^A-Z0-9]+', '-', 'g'));
          v_sku := v_base; i := 1;
          while exists (select 1 from products where sku = v_sku) loop i := i + 1; v_sku := v_base || '-' || i; end loop;
          insert into products(sku, name, category_id, station, is_liquor, base_unit, sale_unit, is_demo)
          values (v_sku, r.name, v_cat, 'bar', true, 'bottle', 'bottle', false) returning * into v_p;
          perform write_audit('product.create', 'products', v_p.id::text, null, to_jsonb(v_p), 'Stock take 10 Nov 2026');
          n_new := n_new + 1;
        end if;
      else
        not_found := not_found || r.name; continue;
      end if;
    end if;

    if v_p.id is null then n_ok := n_ok + 1; units := units + r.qty; continue; end if;   -- dry run, new drink
    select coalesce(sum(qty_base), 0) into bal from stock_balance where product_id = v_p.id and location_id = loc('store');
    if exists (select 1 from stock_movements where idempotency_key = 'stocktake-2026-11-10:' || v_p.id) then already := already || r.name; continue; end if;
    if bal <> 0 then not_zero := not_zero || (r.name || ' (store ' || bal || ')'); continue; end if;
    if not v_dry then
      insert into stock_movements(product_id, from_location, to_location, qty_base, type, shift_id, actor_id, idempotency_key, note)
      values (v_p.id, null, loc('store'), r.qty, 'opening', null, v_staff, 'stocktake-2026-11-10:' || v_p.id, 'Stock take 10 Nov 2026 (Main stock sheet)');
    end if;
    n_ok := n_ok + 1; units := units + r.qty;
  end loop;

  -- "Delete T Malt": the drink "T. Malt Can" is switched off (hidden everywhere; a product with history cannot be erased).
  if not v_dry then
    update products set active = false where active and regexp_replace(lower(name), '[^a-z0-9]', '', 'g') = 'tmaltcan';
    if found then raise notice 'T. Malt Can switched off (deleted from the lists).'; end if;
  else
    if exists (select 1 from products where active and regexp_replace(lower(name), '[^a-z0-9]', '', 'g') = 'tmaltcan') then
      raise notice 'T. Malt Can will be switched off (deleted from the lists).'; end if;
  end if;

  if not v_dry then
    perform write_audit('stock.stocktake_load', 'stock_movements', null, null,
      jsonb_build_object('drinks', n_ok, 'units', units, 'new', n_new), 'Stock take 10 Nov 2026 loaded into the store');
  end if;
  raise notice '% : % drinks, % units into the store, % new drink(s).', case when v_dry then 'CHECK ONLY (nothing saved)' else 'RECORDED' end, n_ok, units, n_new;
  if array_length(not_found, 1) > 0 then raise notice 'NOT FOUND in the system (not loaded): %', array_to_string(not_found, '; '); end if;
  if array_length(not_zero, 1) > 0 then raise notice 'STORE NOT AT 0, skipped (run 035 first): %', array_to_string(not_zero, '; '); end if;
  if array_length(already, 1) > 0 then raise notice 'ALREADY LOADED, skipped: %', array_to_string(already, '; '); end if;
end $$;

-- CHECK (after recording): store quantity per drink
select p.name, coalesce(sum(case when b.location_id = loc('store') then b.qty_base end), 0) as store,
       coalesce(sum(case when b.location_id = loc('main_bar') then b.qty_base end), 0) as counter, p.selling_price
from products p join stock_balance b on b.product_id = p.id
group by p.name, p.selling_price having coalesce(sum(case when b.location_id = loc('store') then b.qty_base end), 0) <> 0
order by p.name;
