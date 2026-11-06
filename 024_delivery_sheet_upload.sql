-- The Glizz Lounge POS — 024: upload a supplier delivery from Excel
-- Run in the Supabase SQL Editor after 023. Safe to run again.
--
-- Purchasing > Upload delivery reads an Excel delivery sheet (item, quantity, cost each, selling price)
-- and calls receive_delivery_sheet(). It does in ONE step, all or nothing:
--   * adds any drink that is not in the catalogue yet (Bar station), with its selling price and cost
--   * records the whole delivery through receive_goods(): stock in, cost per drink, supplier invoice
--   * sets the selling price of drinks that already exist when the sheet has a price for them
--     (a line with no selling price leaves the current price as it is)
-- With p_dry_run = true nothing is saved: it only checks the lines and reports problems and possible repeats
-- (the same drink, quantity and cost already received from the same supplier in the last 30 days).
-- Sending the same p_key twice never records the delivery twice. The delivery note number can be used only
-- once per supplier (existing rule), which also stops the same note being loaded twice.
-- Needs goods.receive. Adding drinks or changing selling prices also needs catalogue.manage.
--
-- p_lines: [{"row": 2, "product_id": "<uuid>" or null, "name": "Jameson 1LTR", "category": "Whiskey",
--            "unit": "bottle", "liquor": true, "qty": 4, "unit_cost": 3690, "selling_price": 5000 or null}, ...]
-- With product_id null the drink is added as new (name, category, unit and liquor are used).
-- p_location: main_bar | store | kitchen | choma

create or replace function receive_delivery_sheet(p_supplier uuid, p_note_no text, p_note text, p_location text,
                                                  p_lines jsonb, p_key text, p_dry_run boolean default true)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  r jsonb; n int := 0; v_row int; v_pid uuid; v_name text; v_cat text; v_unit text; v_liquor boolean;
  v_qty numeric; v_cost numeric; v_sell numeric; v_cur products;
  errs jsonb := '[]'::jsonb; repeats jsonb := '[]'::jsonb; rec_lines jsonb := '[]'::jsonb;
  seen_ids uuid[] := '{}'; seen_names text[] := '{}';
  c_new int := 0; c_price int := 0; c_units numeric := 0; v_total numeric := 0;
  g goods_receipts; v_made products; needs_catalogue boolean := false;
begin
  if not has_permission('goods.receive') then raise exception 'not permitted'; end if;
  select * into g from goods_receipts where idempotency_key = p_key;
  if found then
    return jsonb_build_object('ok', true, 'already_recorded', true, 'receipt_no', g.receipt_no, 'total', g.total_cost);
  end if;
  if not exists (select 1 from suppliers where id = p_supplier and active) then raise exception 'choose a supplier'; end if;
  if coalesce(btrim(p_note_no), '') = '' then raise exception 'enter the delivery note number'; end if;
  if p_location not in ('main_bar', 'store', 'kitchen', 'choma') then raise exception 'choose where the stock goes'; end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'there are no items on this delivery'; end if;
  if jsonb_array_length(p_lines) > 500 then raise exception 'too many lines (the limit is 500)'; end if;
  if exists (select 1 from goods_receipts where supplier_id = p_supplier and lower(delivery_note) = lower(btrim(p_note_no))) then
    raise exception 'Delivery note % was already recorded for this supplier', btrim(p_note_no); end if;

  -- Pass 1: check every line. Nothing is written here.
  for r in select * from jsonb_array_elements(p_lines) loop
    n := n + 1;
    begin
      v_row  := coalesce(nullif(r->>'row', '')::int, n);
      v_pid  := nullif(r->>'product_id', '')::uuid;
      v_qty  := (r->>'qty')::numeric;
      v_cost := (r->>'unit_cost')::numeric;
      v_sell := nullif(r->>'selling_price', '')::numeric;
    exception when others then
      errs := errs || jsonb_build_object('row', n, 'name', r->>'name', 'problem', 'a number on this line is not valid');
      continue;
    end;
    v_name := regexp_replace(btrim(coalesce(r->>'name', '')), '\s+', ' ', 'g');
    v_cat  := regexp_replace(btrim(coalesce(r->>'category', '')), '\s+', ' ', 'g');
    v_unit := coalesce(r->>'unit', '');
    if v_qty is null or v_qty <= 0 then errs := errs || jsonb_build_object('row', v_row, 'name', v_name, 'problem', 'the quantity must be more than 0'); end if;
    if v_cost is null or v_cost < 0 then errs := errs || jsonb_build_object('row', v_row, 'name', v_name, 'problem', 'the cost is missing or negative'); end if;
    if v_sell < 0 then errs := errs || jsonb_build_object('row', v_row, 'name', v_name, 'problem', 'the selling price cannot be negative'); end if;
    if v_sell is not null then needs_catalogue := true; end if;

    if v_pid is not null then
      select * into v_cur from products where id = v_pid and active;
      if not found then
        errs := errs || jsonb_build_object('row', v_row, 'name', v_name, 'problem', 'the chosen drink was not found');
      else
        if v_pid = any (seen_ids) then
          errs := errs || jsonb_build_object('row', v_row, 'name', v_name, 'problem', v_cur.name || ' is already on another line of this delivery');
        end if;
        seen_ids := seen_ids || v_pid;
        if v_qty > 0 and v_cost >= 0 and exists (
             select 1 from goods_receipt_lines l join goods_receipts gr on gr.id = l.receipt_id
             where l.product_id = v_pid and gr.supplier_id = p_supplier and l.qty_base = v_qty and l.unit_cost = v_cost
               and gr.created_at > now() - interval '30 days') then
          repeats := repeats || to_jsonb(v_cur.name);
        end if;
      end if;
    else
      needs_catalogue := true;
      if v_name = '' then errs := errs || jsonb_build_object('row', v_row, 'name', v_name, 'problem', 'the new drink has no name');
      elsif exists (select 1 from products where lower(btrim(name)) = lower(v_name) and active) then
        errs := errs || jsonb_build_object('row', v_row, 'name', v_name, 'problem', 'a drink with this name already exists: choose it instead of adding it');
      elsif lower(v_name) = any (seen_names) then
        errs := errs || jsonb_build_object('row', v_row, 'name', v_name, 'problem', 'this new drink is listed twice');
      end if;
      seen_names := seen_names || lower(v_name);
      if v_cat = '' then errs := errs || jsonb_build_object('row', v_row, 'name', v_name, 'problem', 'choose a category for the new drink'); end if;
      if not exists (select 1 from units where code = v_unit) then
        errs := errs || jsonb_build_object('row', v_row, 'name', v_name, 'problem', 'unknown unit ' || v_unit); end if;
      c_new := c_new + 1;
    end if;
    c_units := c_units + coalesce(v_qty, 0);
    v_total := v_total + coalesce(v_qty, 0) * coalesce(v_cost, 0);
  end loop;

  if needs_catalogue and not has_permission('catalogue.manage') then
    errs := errs || jsonb_build_object('row', 0, 'name', '', 'problem',
      'adding new drinks or changing selling prices needs the Products & prices permission: ask a manager');
  end if;
  if jsonb_array_length(errs) > 0 then
    return jsonb_build_object('ok', false, 'dry_run', p_dry_run, 'errors', errs);
  end if;
  if p_dry_run then
    return jsonb_build_object('ok', true, 'dry_run', true, 'lines', n, 'new_drinks', c_new, 'units', c_units,
                              'total', round(v_total, 2), 'repeats', repeats);
  end if;

  -- Pass 2: add new drinks, receive the stock, then set selling prices.
  n := 0;
  for r in select * from jsonb_array_elements(p_lines) loop
    n := n + 1;
    v_pid  := nullif(r->>'product_id', '')::uuid;
    v_qty  := (r->>'qty')::numeric;
    v_cost := (r->>'unit_cost')::numeric;
    v_sell := nullif(r->>'selling_price', '')::numeric;
    if v_pid is null then
      v_made := create_product(regexp_replace(btrim(r->>'name'), '\s+', ' ', 'g'),
                               regexp_replace(btrim(r->>'category'), '\s+', ' ', 'g'),
                               'bar', coalesce((r->>'liquor')::boolean, false), r->>'unit', v_sell, v_cost, 0);
      v_pid := v_made.id;
    end if;
    rec_lines := rec_lines || jsonb_build_object('product_id', v_pid, 'location', p_location, 'qty', v_qty, 'unit_cost', v_cost);
  end loop;

  g := receive_goods(p_supplier, p_note_no, p_note, rec_lines, p_key);

  n := 0;
  for r in select * from jsonb_array_elements(p_lines) loop
    n := n + 1;
    if nullif(r->>'product_id', '') is null then continue; end if;      -- new drinks already got their price
    v_sell := nullif(r->>'selling_price', '')::numeric;
    if v_sell is null then continue; end if;
    select * into v_cur from products where id = (r->>'product_id')::uuid;
    if v_cur.selling_price is distinct from v_sell then
      update products set selling_price = v_sell where id = v_cur.id;
      perform write_audit('product.price', 'products', v_cur.id::text,
        jsonb_build_object('selling_price', v_cur.selling_price), jsonb_build_object('selling_price', v_sell),
        'Delivery sheet upload, note ' || btrim(p_note_no));
      c_price := c_price + 1;
    end if;
  end loop;

  return jsonb_build_object('ok', true, 'dry_run', false, 'receipt_no', g.receipt_no, 'lines', jsonb_array_length(p_lines),
                            'new_drinks', c_new, 'prices_changed', c_price, 'units', c_units, 'total', g.total_cost, 'repeats', repeats);
end $$;

revoke execute on function receive_delivery_sheet(uuid, text, text, text, jsonb, text, boolean) from public, anon;
grant execute on function receive_delivery_sheet(uuid, text, text, text, jsonb, text, boolean) to authenticated;
