-- The Glizz Lounge POS — 037: set the COUNTER to the stock count of 16 Nov 2026 (stock_count_full.pdf)
-- Run in the Supabase SQL Editor ("Run without RLS" if asked). Needs the drinks to exist already.
--
-- What it does: for each counted drink it compares the sheet with what the system says is on the counter, and books the
-- DIFFERENCE as a stock-count adjustment (extra pieces added, or missing pieces taken off) so the counter ends up
-- exactly as counted. It only touches the COUNTER: the store is not changed. Drinks not on the sheet are not touched.
--   * A dash "-" on the sheet means "not counted / none listed": that drink is left as it is (its current counter
--     quantity is printed so you can decide). Matchbox and "Can difference" are in this group.
--   * Drinks are matched by name (spaces, punctuation and capitals ignored; 1lt = 1l = 1ltr). Any sheet line with no
--     matching drink is listed as UNMATCHED. Nothing is recorded while there are unmatched lines.
-- Safe to run again: a drink already adjusted by this script is skipped.
--
-- TWO STEPS (nothing is changed on the first):
--   1. Run it as it is. It only CHECKS and prints (Messages/Results panel) every change it WOULD make and any problems.
--   2. Look it over. Then change  v_dry boolean := true  to  false  and run again to record.

do $$
declare
  v_dry boolean := true;                      -- <<< change to false to RECORD the counts
  v_date text := '2026-11-16';
  v_staff uuid; v_bar uuid := loc('main_bar'); r record; v_pid uuid; v_cnt int; v_cur numeric; v_diff numeric; v_pname text;
  n_up int := 0; n_down int := 0; n_same int := 0; n_skip int := 0; n_bad int := 0; n_units_up numeric := 0; n_units_down numeric := 0;
  v_seen uuid[] := '{}';
begin
  select id into v_staff from staff where staff_no = 'M001' and active;
  if v_staff is null then
    select s.id into v_staff from staff s join staff_roles sr on sr.staff_id = s.id where sr.role_code = 'manager' and s.active order by s.created_at limit 1;
  end if;
  if v_staff is null then raise exception 'no manager found'; end if;
  if v_bar is null then raise exception 'counter location is missing'; end if;
  perform set_config('request.jwt.claim.sub', v_staff::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_staff, 'role', 'authenticated')::text, true);

  create temp table _plan(pid uuid, pname text, cur numeric, cnt numeric, diff numeric) on commit drop;

  for r in
    select name, qty, extra_keys, regexp_replace(regexp_replace(lower(name), '([0-9])(ltr|lt)', '\1l', 'g'), '[^a-z0-9]', '', 'g') as k
    from (values
      ('Balozi', 59, array[]::text[]),
      ('Balozi Can', 24, array[]::text[]),
      ('Guarana Can', 22, array[]::text[]),
      ('Guinness Can', 20, array[]::text[]),
      ('Guinness Kubwa', 27, array[]::text[]),
      ('Heineken 0.0 330ml', 19, array['heineken00beer330ml','heineken00330ml']::text[]),
      ('Heineken Bottle 330ml', 17, array[]::text[]),
      ('Heineken Can', 14, array['heinekencan500ml']::text[]),
      ('Hunters Gold/Dry 330ml', 18, array['huntersdry330ml','huntersgold330ml','huntersgolddry330ml']::text[]),
      ('KO Cider', 23, array[]::text[]),
      ('Manyatta Can', 2, array[]::text[]),
      ('Manyatta Pine and Mint', 55, array['manyattapineandmint','manyattapinemint']::text[]),
      ('Pilsner Bold', 30, array[]::text[]),
      ('Pilsner Mfalme', 37, array[]::text[]),
      ('Pineapple Punch', 24, array[]::text[]),
      ('Punch Can', 59, array[]::text[]),
      ('Savannah Cider', 20, array['savannahcider330ml']::text[]),
      ('Smirnoff Black Ice', 26, array[]::text[]),
      ('Smirnoff Raspberry 300ml Bottle', 43, array['smirnoffraspberry300ml']::text[]),
      ('Smirnoff Raspberry Can', 42, array[]::text[]),
      ('Snapp Apple', 50, array['snapapple']::text[]),
      ('Snapp Can', 47, array['snapcan']::text[]),
      ('Tusker Can', 13, array[]::text[]),
      ('Tusker Cider', 12, array[]::text[]),
      ('Tusker Lager', 112, array[]::text[]),
      ('Tusker Lite 330ml', 33, array['tuskerlite']::text[]),
      ('Tusker Lite Can', 28, array[]::text[]),
      ('Tusker Malt 330ml', 44, array['tuskermalt']::text[]),
      ('Tusker Malt Can', 12, array[]::text[]),
      ('White Cap Can', 24, array['whitecapcan']::text[]),
      ('White Cap Lager', 45, array['whitecap','whitecaplager']::text[]),
      ('Smirnoff Black Ice Can', 19, array[]::text[]),
      ('Godons Can', 12, array['gordonscan','gordonsdrygincan']::text[]),
      ('Hunters Choice 250ml', 6, array[]::text[]),
      ('Hunters Choice 350ml', 23, array[]::text[]),
      ('Hunters Choice 750ml', 18, array[]::text[]),
      ('Richot 250ml', 39, array[]::text[]),
      ('Richot 750ml', 7, array[]::text[]),
      ('Viceroy 250ml', 12, array['viceroybrandy250ml']::text[]),
      ('Viceroy 375ml', 13, array['viceroybrandy375ml']::text[]),
      ('Viceroy 750ml', 11, array['viceroybrandy750ml']::text[]),
      ('Matchbox', null, array[]::text[]),
      ('Can difference', null, array[]::text[]),
      ('Hennessy 1lt', null, array[]::text[]),
      ('Hennessy VS 700ml', 1, array['hennessyvs70cl']::text[]),
      ('Hennessy VSOP 750ml', 2, array['hennessyvsop70cl']::text[]),
      ('Hennessy', null, array[]::text[]),
      ('Martell VS 1lt', null, array[]::text[]),
      ('Martell VS 750ml', 2, array[]::text[]),
      ('Martell VSOP 1lt', 1, array[]::text[]),
      ('Martell VSOP 750ml', 2, array[]::text[]),
      ('Chrome Gin 250ml', null, array[]::text[]),
      ('Chrome Gin 750ml', 12, array[]::text[]),
      ('Gilbeys 250ml', 71, array[]::text[]),
      ('Gilbeys 350ml', 3, array[]::text[]),
      ('Gilbeys 750ml', 8, array[]::text[]),
      ('Gilbeys Berry 750ml', 2, array[]::text[]),
      ('Gordons 1lt', 2, array['gordonsdrygin1l']::text[]),
      ('Gordons 350ml', 5, array['gordonsdrygin350ml']::text[]),
      ('Gordons Dry Gin 750ml', 2, array['gordons750ml']::text[]),
      ('Gordons Lemon 700ml', 2, array[]::text[]),
      ('Tanqueray BR 700ml', 1, array[]::text[]),
      ('Tanqueray Rangpur 700ml', 1, array[]::text[]),
      ('Tanqueray Sevilla 700ml', 1, array[]::text[]),
      ('Amarula Cream 375ml', null, array['amarula375ml']::text[]),
      ('Amarula Cream 750ml', 3, array[]::text[]),
      ('Astral Blanco 750ml', 3, array[]::text[]),
      ('Baileys 1lt', 3, array['baileys1l']::text[]),
      ('Baileys Irish Cream 750ml', 5, array['baileys750ml']::text[]),
      ('Camino Tequila 750ml', 3, array['caminotequila750ml']::text[]),
      ('Cazamigos Blanco 750ml', 2, array['casamigosblanco750ml']::text[]),
      ('Don Julio Blanco 750ml', 3, array[]::text[]),
      ('Don Julio Reposado 750ml', 3, array['donjuliorpsdo750ml']::text[]),
      ('Jagermeister 1lt with cork', 3, array['jagermeister1l','jagermeister1lwithcork']::text[]),
      ('Jagermeister 750ml with cork', 4, array['jagermeister750ml']::text[]),
      ('V&A 250ml', 50, array['vanda250ml']::text[]),
      ('V&A 750ml', 15, array['vanda750ml']::text[]),
      ('Captain Morgan 250ml', 63, array[]::text[]),
      ('Captain Morgan 750ml', 12, array[]::text[]),
      ('Captain Muckpit 250ml', 38, array[]::text[]),
      ('Captain Muckpit 750ml', 6, array[]::text[]),
      ('County Spirit 250ml', 9, array[]::text[]),
      ('County Spirit 750ml', 13, array[]::text[]),
      ('KC Lemon/Ginger 250ml', 44, array['kclemon250ml','kcginger250ml','kclemonginger250ml']::text[]),
      ('KC Lemon/Ginger 750ml', 15, array['kclemon750ml','kcginger750ml']::text[]),
      ('KC Pineapple 250ml', 14, array[]::text[]),
      ('KC Pineapple 750ml', 12, array[]::text[]),
      ('KC Smooth 250ml', 61, array[]::text[]),
      ('KC Smooth 750ml', 5, array[]::text[]),
      ('Delmonte Apple 1lt', 10, array['delmonteapple1l']::text[]),
      ('Keringet Sparkling 1lt', 10, array['keringetsparkling1l']::text[]),
      ('Keringet 1lt', 11, array['keringet1l']::text[]),
      ('Kingfisher Strawberry', 20, array[]::text[]),
      ('Minute Maid 1lt', 22, array['minutemaid1l']::text[]),
      ('Minute Maid 400ml', 35, array[]::text[]),
      ('Peptang Lime 700ml', 3, array['peptanglime700ml']::text[]),
      ('Predator', 28, array[]::text[]),
      ('Red Bull', 28, array['redbullcan']::text[]),
      ('Monster', null, array[]::text[]),
      ('Lemonade', 19, array[]::text[]),
      ('Soda 300ml', 100, array['soda']::text[]),
      ('Mineral Water 1lt', 9, array['mineralwater1l']::text[]),
      ('Chrome Lemon 250ml', 40, array[]::text[]),
      ('Chrome Vodka 250ml', 69, array[]::text[]),
      ('Chrome Vodka 750ml', 23, array[]::text[]),
      ('Smirnoff Gold', 2, array[]::text[]),
      ('Smirnoff Red 250ml', 39, array[]::text[]),
      ('Smirnoff Red 350ml', 2, array[]::text[]),
      ('Smirnoff Red 750ml', 7, array[]::text[]),
      ('Smirnoff Spicy Tamarind 750ml', 3, array[]::text[]),
      ('Smirnoff Vanilla 700ml', 2, array[]::text[]),
      ('Black & White 375ml', 22, array['blacknwhite375ml']::text[]),
      ('Black & White 750ml', 4, array['blacknwhite750ml']::text[]),
      ('Black & White 1lt', null, array['blacknwhite1l']::text[]),
      ('Bond 7 250ml', 6, array[]::text[]),
      ('Bond 7 350ml', 9, array[]::text[]),
      ('Bond 7 750ml', 7, array[]::text[]),
      ('Bullet Bourbon 700ml', 2, array['bulleitbourbon700ml']::text[]),
      ('Grants with glass 1lt', 3, array['grants1l']::text[]),
      ('Grants with glass 750ml', null, array['grants750ml']::text[]),
      ('Grants 350ml', null, array[]::text[]),
      ('J&B 1lt', 2, array['jandb1l','jb1l']::text[]),
      ('Jack Daniels 1lt', 2, array['jackdaniels1l']::text[]),
      ('Jack Daniels 750ml', 2, array[]::text[]),
      ('Jameson 1lt', 1, array['jameson1l']::text[]),
      ('Jameson 750ml', 2, array[]::text[]),
      ('John Barr Black 1lt', 4, array['johnbarrblack1l']::text[]),
      ('John Barr Black 750ml', null, array[]::text[]),
      ('Johnnie Walker Black 1lt', 1, array[]::text[]),
      ('Johnnie Walker Black 375ml', 5, array[]::text[]),
      ('Johnnie Walker Black 750ml', 7, array[]::text[]),
      ('Johnnie Walker Double Black 1lt', 2, array[]::text[]),
      ('Johnnie Walker Red 1lt', 5, array[]::text[]),
      ('Johnnie Walker Red 375ml', 5, array[]::text[]),
      ('Johnnie Walker Red 750ml', 5, array[]::text[]),
      ('Roe & Co Whiskey', 1, array['roeandcowhiskey','roecowhiskey']::text[]),
      ('Singleton 12 yrs', null, array['singleton12y']::text[]),
      ('Singleton 15 yrs', 1, array['singleton15y']::text[]),
      ('Southern Comfort 70cl', 2, array[]::text[]),
      ('VAT 69 350ml', 20, array['vat69350ml']::text[]),
      ('VAT 69 750ml', 5, array[]::text[]),
      ('Williamson Lawson 1lt', 3, array['williamsonlawson1l']::text[]),
      ('Williamson Lawson 750ml', 3, array[]::text[]),
      ('Fourth Street Sweet Red 750ml', 3, array[]::text[]),
      ('Fourth Street Sweet White 750ml', 4, array[]::text[]),
      ('Caprice Dry Red 1lt', 6, array[]::text[]),
      ('Caprice Dry White 1lt', 4, array[]::text[]),
      ('Caprice Sweet Red 1lt', 3, array[]::text[]),
      ('Caprice Sweet White 1lt', 3, array[]::text[]),
      ('Casa Buena Red 1lt', 4, array[]::text[]),
      ('Casa Buena White 1lt', 4, array[]::text[]),
      ('Cellar Cask Red 750ml', 3, array[]::text[]),
      ('Cellar Cask White 750ml', 3, array[]::text[]),
      ('Drostdy Hof Sweet Red 750ml', 4, array['drostdyhofsweetred750ml']::text[]),
      ('Four Cousins Red 750ml', 3, array[]::text[]),
      ('Four Cousins White 750ml', 4, array[]::text[]),
      ('Robertson Red 750ml', 4, array[]::text[]),
      ('Robertson White 750ml', 4, array[]::text[]),
      ('Ross Nobile 750ml', 3, array[]::text[]),
      ('Kane Extra 250ml', 40, array[]::text[]),
      ('Kane Extra 750ml', 11, array[]::text[]),
      ('Liberty 250ml', 10, array[]::text[]),
      ('Liberty 750ml', null, array[]::text[]),
      ('McDowell''s 750ml', 10, array['mcdowells750ml']::text[]),
      ('Origin 250ml', 35, array[]::text[]),
      ('Origin 750ml', 10, array[]::text[]),
      ('Triple Ace 250ml', 38, array[]::text[]),
      ('Triple Ace 750ml', 12, array[]::text[])
    ) as t(name, qty, extra_keys)
  loop
    select count(*), min(id::text)::uuid, min(name) into v_cnt, v_pid, v_pname from products
     where active and regexp_replace(regexp_replace(lower(name), '([0-9])(ltr|lt)', '\1l', 'g'), '[^a-z0-9]', '', 'g') = any (array[r.k] || r.extra_keys);
    if v_cnt = 0 then
      raise notice 'UNMATCHED  : "%" (counted %) has no drink with that name', r.name, coalesce(r.qty::text, '-'); n_bad := n_bad + 1; continue;
    elsif v_cnt > 1 then
      raise notice 'AMBIGUOUS  : "%" matches % drinks, make the name more specific', r.name, v_cnt; n_bad := n_bad + 1; continue;
    end if;
    if v_pid = any (v_seen) then
      raise notice 'DUPLICATE  : "%" resolves to "%" which is already on the sheet', r.name, v_pname; n_bad := n_bad + 1; continue;
    end if;
    v_seen := v_seen || v_pid;

    select coalesce(sum(qty_base), 0) into v_cur from stock_balance where product_id = v_pid and location_id = v_bar;
    if r.qty is null then
      raise notice 'LEFT AS IS : % (sheet "-"), counter has %', v_pname, v_cur; n_skip := n_skip + 1; continue;
    end if;
    v_diff := r.qty - v_cur;
    if v_diff = 0 then n_same := n_same + 1; continue; end if;
    insert into _plan values (v_pid, v_pname, v_cur, r.qty, v_diff);
    raise notice '% : % -> % (%)', rpad(v_pname, 34), v_cur, r.qty, case when v_diff > 0 then '+' else '' end || v_diff;
    if v_diff > 0 then n_up := n_up + 1; n_units_up := n_units_up + v_diff; else n_down := n_down + 1; n_units_down := n_units_down - v_diff; end if;
  end loop;

  raise notice '---- % drinks already right, % left as is ("-"), % to add to (% pieces), % to take off (% pieces), % problem line(s)',
    n_same, n_skip, n_up, n_units_up, n_down, n_units_down, n_bad;

  if v_dry then
    raise notice 'CHECK ONLY, nothing saved. Set v_dry to false to record.';
    return;
  end if;
  if n_bad > 0 then raise exception 'Not recorded: % sheet line(s) could not be matched (see the messages above). Fix them first.', n_bad; end if;

  for r in select * from _plan loop
    if r.diff > 0 then
      insert into stock_movements(product_id, from_location, to_location, qty_base, type, shift_id, actor_id, idempotency_key, note)
      values (r.pid, null, v_bar, r.diff, 'count_adjust', null, v_staff, 'counter-count-' || v_date || ':' || r.pid,
              'Counter stock count ' || v_date || ': ' || r.cur || ' to ' || r.cnt) on conflict (idempotency_key) do nothing;
    else
      insert into stock_movements(product_id, from_location, to_location, qty_base, type, shift_id, actor_id, idempotency_key, note)
      values (r.pid, v_bar, null, -r.diff, 'count_adjust', null, v_staff, 'counter-count-' || v_date || ':' || r.pid,
              'Counter stock count ' || v_date || ': ' || r.cur || ' to ' || r.cnt) on conflict (idempotency_key) do nothing;
    end if;
  end loop;
  perform write_audit('stock.count', 'stock_movements', 'counter-count-' || v_date, null,
                      jsonb_build_object('added', n_up, 'removed', n_down, 'unchanged', n_same, 'left_as_is', n_skip), 'Counter stock count ' || v_date);
  raise notice 'RECORDED: % drinks added to, % taken off. The counter now matches the sheet.', n_up, n_down;
end $$;
