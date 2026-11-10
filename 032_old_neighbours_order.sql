-- The Glizz Lounge POS — 032: record the "Old Neighbours" order into the STORE and the product list
-- Run in the Supabase SQL Editor ("Run without RLS" if asked). Needs 024 already run.
--
-- 30 drinks, 90 units, cost KES 250,815. Singleton 18Y is left out (the sheet says "Not stocked").
-- ASSUMES the whole order has arrived as listed. Change a quantity below if something was short-delivered.
-- Drinks already in the catalogue are matched by name (spaces, punctuation and capitals ignored); the others are
-- added as new drinks (Bar station, unit "bottle"). The sheet has NO selling prices: new drinks are added without
-- one and stay hidden from waiters until you set the price in Products & prices. Existing prices are not touched.
-- The stock goes into the STORE. The counter stays at 0: use Stock > Issue to counter when drinks go on the counter.
--
-- TWO STEPS (nothing is changed on the first):
--   1. Run it as it is. It only CHECKS and prints which drinks matched and which will be added.
--   2. Check them. Then change  v_dry boolean := true  to  false  and run again to record it.
-- A delivery note number can be used once per supplier, so running it twice is safe.

do $$
declare
  v_dry        boolean := true;                      -- <<< change to false to RECORD the order
  v_supplier   text    := 'Old Neighbours';          -- created if it does not exist yet
  v_note_no    text    := 'OLD-NEIGHBOURS-1';        -- <<< delivery note / invoice number
  v_key        text    := 'old-neighbours-order-2026-11';
  v_sup uuid; v_staff uuid; r record; v_pid uuid; v_name text; v_lines jsonb := '[]'::jsonb; res jsonb;
begin
  select id into v_staff from staff where staff_no = 'M001' and active;
  if v_staff is null then
    select s.id into v_staff from staff s join staff_roles sr on sr.staff_id = s.id where sr.role_code = 'manager' and s.active order by s.created_at limit 1;
  end if;
  if v_staff is null then raise exception 'no manager found'; end if;
  perform set_config('request.jwt.claim.sub', v_staff::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_staff, 'role', 'authenticated')::text, true);

  select id into v_sup from suppliers where active and lower(name) like '%' || lower(btrim(v_supplier)) || '%' limit 1;
  if v_sup is null then
    if v_dry then raise notice 'SUPPLIER "%" does not exist yet: it will be created when you record.', v_supplier;
    else insert into suppliers(name, kind) values (v_supplier, 'drinks') returning id into v_sup; end if;
  end if;

  for r in
    select * from (values
      (2, 'Astral Blanco 750ml', 'Liquor', 3, 2500, array['astralblanco750ml']),
      (3, 'Baileys 750ml', 'Liquor', 3, 2250, array['baileys750ml', 'baileysirishcream750ml']),
      (4, 'Baileys 1L', 'Liquor', 3, 2916, array['baileys1l', 'baileys1ltr']),
      (5, 'Bulleit Bourbon 700ml', 'Whiskey', 2, 3167, array['bulleitbourbon700ml', 'bulleit700ml']),
      (6, 'Casamigos Blanco 750ml', 'Liquor', 2, 6101, array['casamigosblanco750ml']),
      (7, 'Don Julio Blanco 750ml', 'Liquor', 3, 7084, array['donjulioblanco750ml']),
      (8, 'Don Julio Rpsdo 750ml', 'Liquor', 3, 7749, array['donjulioreposado750ml', 'donjuliorpsdo750ml']),
      (9, 'Gilbeys Berry 750ml', 'Gin', 2, 820, array['gilbeysberry750ml']),
      (10, 'Gordons Dry Gin 1L', 'Gin', 2, 2375, array['gordonsdrygin1l', 'gordons1ltr']),
      (11, 'Gordons Dry Gin 750ml', 'Gin', 2, 2000, array['gordonsdrygin750ml', 'gordons750ml']),
      (12, 'Gordons Dry Gin 350ml', 'Gin', 5, 1052, array['gordonsdrygin350ml', 'gordons350ml']),
      (13, 'Gordons Lemon 700ml', 'Gin', 2, 2109, array['gordonslemon700ml']),
      (14, 'Johnnie Walker Black 375ml', 'Whiskey', 5, 1793, array['johnniewalkerblack375ml']),
      (15, 'Johnnie Walker Black 750ml', 'Whiskey', 8, 3371, array['johnniewalkerblack750ml']),
      (16, 'Johnnie Walker Black 1L', 'Whiskey', 6, 4075, array['johnniewalkerblack1l', 'johnniewalkerblack1ltr']),
      (17, 'Johnnie Walker Double Black 1L', 'Whiskey', 2, 5875, array['johnniewalkerdoubleblack1l', 'johnniewalkerdoubleblack1ltr']),
      (18, 'Johnnie Walker Red 375ml', 'Whiskey', 5, 889, array['johnniewalkerred375ml']),
      (19, 'Johnnie Walker Red 750ml', 'Whiskey', 6, 1875, array['johnniewalkerred750ml']),
      (20, 'Johnnie Walker Red 1L', 'Whiskey', 6, 2237, array['johnniewalkerred1l', 'johnniewalkerred1ltr']),
      (21, 'J&B 1L', 'Whiskey', 2, 2242, array['jb1l', 'jb1ltr']),
      (22, 'Roe & Co Whiskey', 'Whiskey', 1, 4000, array['roecowhiskey', 'roeco']),
      (23, 'Singleton 12Y', 'Whiskey', 1, 5375, array['singleton12y', 'singleton12yrs']),
      (24, 'Singleton 15Y', 'Whiskey', 1, 6583, array['singleton15y', 'singleton15yrs']),
      (25, 'Smirnoff Gold', 'Vodka', 2, 1650, array['smirnoffgold', 'smirnoffgold750ml']),
      (26, 'Smirnoff Vanilla 700ml', 'Vodka', 2, 1650, array['smirnoffvanilla700ml']),
      (27, 'Smirnoff Spicy Tamarind 750ml', 'Vodka', 3, 1758, array['smirnoffspicytamarind750ml']),
      (28, 'Smirnoff Red 350ml', 'Vodka', 5, 603, array['smirnoffred350ml']),
      (29, 'Tanqueray Sevilla 700ml', 'Gin', 1, 3333, array['tanqueraysevilla700ml']),
      (30, 'Tanqueray Rangpur 700ml', 'Gin', 1, 2500, array['tanquerayrangpur700ml']),
      (31, 'Tanqueray BR 700ml', 'Gin', 1, 2500, array['tanqueraybr700ml'])
    ) as t(row, name, cat, qty, cost, keys)
  loop
    select id, name into v_pid, v_name from products
     where active and regexp_replace(lower(name), '[^a-z0-9]', '', 'g') = any (r.keys)
     order by array_position(r.keys, regexp_replace(lower(name), '[^a-z0-9]', '', 'g')) limit 1;
    if v_pid is null then raise notice 'ADD NEW   : % (%)', r.name, r.cat;
    else raise notice 'MATCHED   : % -> existing "%"', r.name, v_name; end if;
    v_lines := v_lines || jsonb_build_object('row', r.row, 'product_id', v_pid, 'name', r.name, 'category', r.cat,
               'unit', 'bottle', 'liquor', true, 'qty', r.qty, 'unit_cost', r.cost, 'selling_price', null);
    v_pid := null;
  end loop;

  if v_dry and v_sup is null then
    raise notice 'CHECK ONLY: the supplier is missing, so the full check runs after the supplier exists. Set v_dry to false to record.';
    return;
  end if;
  res := receive_delivery_sheet(v_sup, v_note_no, 'Old Neighbours order, Nov 2026', 'store', v_lines, v_key, v_dry);
  raise notice 'RESULT (%): %', case when v_dry then 'CHECK ONLY, nothing saved' else 'RECORDED into the store' end, res;
  if not coalesce((res->>'ok')::boolean, false) then raise exception 'Not recorded: %', res; end if;
end $$;

-- CHECK (after recording): store quantity and price of these drinks
select p.name, coalesce(sum(case when b.location_id = loc('store') then b.qty_base end), 0) as store, p.selling_price
from products p left join stock_balance b on b.product_id = p.id
where regexp_replace(lower(p.name), '[^a-z0-9]', '', 'g') ~ '^(astral|baileys|bulleit|casamigos|donjulio|gilbeysberry|gordons|johnniewalker|jb1|roe|singleton|smirnoff|tanqueray)'
group by p.name, p.selling_price order by p.name;
