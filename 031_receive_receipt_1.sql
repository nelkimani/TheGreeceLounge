-- The Glizz Lounge POS — 031: record delivery "receipt_1.xlsx" (9 Nov 2026) into the STORE
-- Run in the Supabase SQL Editor ("Run without RLS" if asked). Needs 024 and 025 already run.
--
-- It does exactly what Purchasing > Upload delivery does for this sheet: 12 drinks, 254 units, cost KES 142,736.
-- Drinks already in the catalogue are matched by name (spaces, punctuation and capitals ignored, and "Viceroy Brandy 250ml"
-- also matches "Viceroy 250ml"); the others are added as new drinks. Selling prices from the sheet are set; Hennessy 1LT
-- has no selling price, so its current price (if any) is left alone and a new one stays unpriced.
--
-- TWO STEPS (nothing is changed on the first):
--   1. Run it as it is. It only CHECKS and prints, in the Messages/Results panel, which drinks matched which and which will be added.
--   2. Look it over. Then change  v_dry boolean := true  to  false  and run again to record the stock in the store.
-- Check the SUPPLIER and the DELIVERY NOTE number below first. A note number can be used once per supplier, so running it twice is safe.

do $$
declare
  v_dry        boolean := true;                 -- <<< change to false to RECORD the delivery
  v_supplier   text    := 'Cradle';             -- <<< supplier name (part of the name is enough)
  v_note_no    text    := 'RECEIPT-1';          -- <<< delivery note / receipt number
  v_key        text    := 'receipt_1-2026-11-09';
  v_sup uuid; v_staff uuid; r record; v_pid uuid; v_name text; v_lines jsonb := '[]'::jsonb; res jsonb; n int;
begin
  select count(*), min(id::text)::uuid into n, v_sup from suppliers where active and lower(name) like '%' || lower(btrim(v_supplier)) || '%';
  if n <> 1 then
    raise exception 'Found % suppliers matching "%". Active suppliers: %', n, v_supplier,
      (select string_agg(name, ', ') from suppliers where active);
  end if;

  select id into v_staff from staff where staff_no = 'M001' and active;
  if v_staff is null then
    select s.id into v_staff from staff s join staff_roles sr on sr.staff_id = s.id where sr.role_code = 'manager' and s.active order by s.created_at limit 1;
  end if;
  if v_staff is null then raise exception 'no manager found'; end if;
  -- Act as that manager for this one transaction (the delivery code checks permissions and records who did it).
  perform set_config('request.jwt.claim.sub', v_staff::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_staff, 'role', 'authenticated')::text, true);

  for r in
    select * from (values
      (2,  'Heineken Bottle 330ml',    'Beers',   'bottle', false, 24,  238, 350,  array['heinekenbottle330ml']),
      (3,  'Heineken Can 500ml',       'Beers',   'can',    false, 24,  250, 400,  array['heinekencan500ml']),
      (4,  'Heineken 0.0 Beer 330ml',  'Beers',   'bottle', false, 24,  230, 350,  array['heineken00beer330ml']),
      (5,  'Hunters Dry 330ml',        'Beers',   'bottle', false, 24,  210, 300,  array['huntersdry330ml']),
      (6,  'Savannah Cider',           'Beers',   'bottle', false, 24,  260, 350,  array['savannahcider']),
      (7,  'Hunters Choice 250ml',     'Brandy',  'bottle', true,  24,  317, 550,  array['hunterschoice250ml']),
      (8,  'Hunters Choice 350ml',     'Brandy',  'bottle', true,  12,  461, 750,  array['hunterschoice350ml']),
      (9,  'Hunters Choice 750ml',     'Brandy',  'bottle', true,  24,  974, 1500, array['hunterschoice750ml']),
      (10, 'Viceroy Brandy 250ml',     'Brandy',  'bottle', true,  24,  462, 650,  array['viceroybrandy250ml', 'viceroy250ml']),
      (11, 'Viceroy Brandy 375ml',     'Brandy',  'bottle', true,  24,  678, 1000, array['viceroybrandy375ml', 'viceroy375ml']),
      (12, 'Viceroy Brandy 750ml',     'Brandy',  'bottle', true,  24,  1287, 2000, array['viceroybrandy750ml', 'viceroy750ml']),
      (13, 'Hennessy 1LT',             'Cognac',  'bottle', true,  2,   9730, null, array['hennessy1lt'])
    ) as t(row, name, cat, unit, liquor, qty, cost, sell, keys)
  loop
    select id, name into v_pid, v_name from products
     where active and regexp_replace(lower(name), '[^a-z0-9]', '', 'g') = any (r.keys)
     order by array_position(r.keys, regexp_replace(lower(name), '[^a-z0-9]', '', 'g')) limit 1;
    if v_pid is null then raise notice 'ADD NEW   : % (%)', r.name, r.cat;
    else raise notice 'MATCHED    : % -> existing "%"', r.name, v_name; end if;
    v_lines := v_lines || jsonb_build_object('row', r.row, 'product_id', v_pid, 'name', r.name, 'category', r.cat,
               'unit', r.unit, 'liquor', r.liquor, 'qty', r.qty, 'unit_cost', r.cost, 'selling_price', r.sell);
    v_pid := null;
  end loop;

  res := receive_delivery_sheet(v_sup, v_note_no, 'Delivery receipt_1.xlsx, 9 Nov 2026', 'store', v_lines, v_key, v_dry);
  raise notice 'RESULT (%): %', case when v_dry then 'CHECK ONLY, nothing saved' else 'RECORDED into the store' end, res;
  if not coalesce((res->>'ok')::boolean, false) then raise exception 'Not recorded: %', res; end if;
end $$;

-- CHECK (after recording): the delivered drinks in the store
select p.name, coalesce(sum(case when b.location_id = loc('store') then b.qty_base end), 0) as store, p.selling_price
from products p left join stock_balance b on b.product_id = p.id
where regexp_replace(lower(p.name), '[^a-z0-9]', '', 'g') ~ '^(heineken|hunters|savannah|viceroy|hennessy1lt)'
group by p.name, p.selling_price order by p.name;
