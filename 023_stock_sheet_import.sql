-- The Glizz Lounge POS — 023: stock sheet upload (the first stock take)
-- Run in the Supabase SQL Editor after 022. Safe to run again.
--
-- The accountant downloads the Excel stock sheet from the app, types the opening count of each drink and
-- uploads it. import_stock_sheet(rows, dry_run) then:
--   * ADDS a drink that is not in the catalogue yet (Bar station, unit from the sheet, selling price if the
--     sheet has one; a drink with no price stays hidden from waiters until Products & prices sets one)
--   * leaves a drink that is already in the catalogue exactly as it is (matched on name, capitals ignored)
--   * records OPENING STOCK into the Main Bar, once per drink: a drink that already has opening stock is
--     skipped and listed, so uploading twice can never double the stock
--   * is all-or-nothing: if any row is wrong nothing is saved and every problem is listed
--   * with dry_run = true only checks and reports; nothing is saved
-- Needs the new permission stock.import (given to manager and accountant). People already signed in must
-- sign out and in again to receive it.
--
-- p_rows: [{"row": 6, "category": "Beers", "name": "BALOZI", "unit": "bottle", "liquor": true,
--           "qty": 24, "price": 280}, ...]   (qty and price may be null)
-- If 019_load_catalogue_and_opening_stock.sql has been run, drinks of the same name are matched, not duplicated;
-- drinks with different spellings (e.g. "KC Smooth 250ml" and "K C SMOOTH 250ML") would be two products.

insert into permissions(code, description)
values ('stock.import', 'Upload the stock sheet: add drinks and load opening stock')
on conflict do nothing;

insert into role_permissions(role_code, permission_code)
values ('manager', 'stock.import'), ('accountant', 'stock.import')
on conflict do nothing;

insert into units(code, name)
values ('bottle', 'Bottle'), ('can', 'Can'), ('tot', 'Tot'), ('portion', 'Portion'), ('piece', 'Piece')
on conflict do nothing;

create or replace function import_stock_sheet(p_rows jsonb, p_dry_run boolean default true)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  r jsonb; n int := 0; v_row int;
  v_name text; v_cat text; v_unit text; v_liquor boolean; v_qty numeric; v_price numeric;
  v_prod products; v_catid uuid; v_sku text; v_base text; i int; v_bar uuid; v_has_open boolean;
  errs jsonb := '[]'::jsonb; skipped jsonb := '[]'::jsonb; seen text[] := '{}';
  c_new int := 0; c_old int := 0; c_open int := 0; c_units numeric := 0;
begin
  if not has_permission('stock.import') then raise exception 'not permitted'; end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    raise exception 'the sheet has no products'; end if;
  if jsonb_array_length(p_rows) > 2000 then raise exception 'too many rows (the limit is 2000)'; end if;
  v_bar := loc('main_bar');
  if v_bar is null then raise exception 'the Main Bar location is missing'; end if;

  -- Pass 1: check every row. Nothing is written here.
  for r in select * from jsonb_array_elements(p_rows) loop
    n := n + 1;
    v_name := regexp_replace(btrim(coalesce(r->>'name', '')), '\s+', ' ', 'g');
    v_cat  := regexp_replace(btrim(coalesce(r->>'category', '')), '\s+', ' ', 'g');
    v_unit := coalesce(r->>'unit', '');
    begin
      v_row := coalesce(nullif(r->>'row', '')::int, n);
      v_qty := nullif(r->>'qty', '')::numeric;
      v_price := nullif(r->>'price', '')::numeric;
    exception when others then
      errs := errs || jsonb_build_object('row', n, 'name', v_name, 'problem', 'a quantity or price is not a number');
      continue;
    end;
    if v_name = '' then
      errs := errs || jsonb_build_object('row', v_row, 'name', v_name, 'problem', 'the product name is empty');
    elsif lower(v_name) = any (seen) then
      errs := errs || jsonb_build_object('row', v_row, 'name', v_name, 'problem', 'this product is listed twice');
    end if;
    seen := seen || lower(v_name);
    if v_cat = '' then errs := errs || jsonb_build_object('row', v_row, 'name', v_name, 'problem', 'the category is empty'); end if;
    if v_unit not in ('bottle', 'can', 'tot', 'portion', 'piece') then
      errs := errs || jsonb_build_object('row', v_row, 'name', v_name, 'problem', 'unknown unit ' || v_unit); end if;
    if v_qty < 0 then errs := errs || jsonb_build_object('row', v_row, 'name', v_name, 'problem', 'the opening stock cannot be negative'); end if;
    if v_price < 0 then errs := errs || jsonb_build_object('row', v_row, 'name', v_name, 'problem', 'the price cannot be negative'); end if;
  end loop;

  if jsonb_array_length(errs) > 0 then
    return jsonb_build_object('ok', false, 'dry_run', p_dry_run, 'errors', errs);
  end if;

  -- Pass 2: add missing drinks and record opening stock (or just count them, on a dry run).
  for r in select * from jsonb_array_elements(p_rows) loop
    v_name   := regexp_replace(btrim(r->>'name'), '\s+', ' ', 'g');
    v_cat    := regexp_replace(btrim(r->>'category'), '\s+', ' ', 'g');
    v_unit   := r->>'unit';
    v_liquor := coalesce((r->>'liquor')::boolean, false);
    v_qty    := nullif(r->>'qty', '')::numeric;
    v_price  := nullif(r->>'price', '')::numeric;
    v_has_open := false;

    select * into v_prod from products where lower(btrim(name)) = lower(v_name) and active order by created_at limit 1;
    if found then
      c_old := c_old + 1;
      select exists (select 1 from stock_movements where product_id = v_prod.id and type = 'opening') into v_has_open;
    else
      c_new := c_new + 1;
      if not p_dry_run then
        insert into categories(name) values (v_cat)
          on conflict (name) do update set name = excluded.name returning id into v_catid;
        v_base := 'GL-' || trim(both '-' from regexp_replace(upper(v_name), '[^A-Z0-9]+', '-', 'g'));
        v_sku := v_base; i := 1;
        while exists (select 1 from products where sku = v_sku) loop i := i + 1; v_sku := v_base || '-' || i; end loop;
        insert into products(sku, name, category_id, station, is_liquor, base_unit, sale_unit, selling_price, is_demo)
        values (v_sku, v_name, v_catid, 'bar', v_liquor, v_unit, v_unit, v_price, false)
        returning * into v_prod;
        perform write_audit('product.create', 'products', v_prod.id::text, null, to_jsonb(v_prod), 'Stock sheet upload');
      end if;
    end if;

    if v_qty is not null and v_qty > 0 then
      if v_has_open then
        skipped := skipped || to_jsonb(v_name);
      else
        c_open := c_open + 1;
        c_units := c_units + v_qty;
        if not p_dry_run then
          insert into stock_movements(product_id, from_location, to_location, qty_base, type, shift_id, actor_id, idempotency_key, note)
          values (v_prod.id, null, v_bar, v_qty, 'opening', current_shift(), auth.uid(),
                  'opening:' || v_prod.id, 'Opening stock - first stock take (sheet upload)')
          on conflict (idempotency_key) do nothing;
        end if;
      end if;
    end if;
  end loop;

  if not p_dry_run then
    perform write_audit('stock.sheet_import', 'stock_movements', null, null,
      jsonb_build_object('new_products', c_new, 'existing_products', c_old, 'opening_lines', c_open,
                         'opening_units', c_units, 'skipped_opening', skipped),
      'Stock sheet upload (first stock take)');
  end if;

  return jsonb_build_object('ok', true, 'dry_run', p_dry_run, 'new_products', c_new, 'existing_products', c_old,
                            'opening_lines', c_open, 'opening_units', c_units, 'skipped_opening', skipped);
end $$;

revoke execute on function import_stock_sheet(jsonb, boolean) from public, anon;
grant execute on function import_stock_sheet(jsonb, boolean) to authenticated;
