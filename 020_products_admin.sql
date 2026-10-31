-- The Gliz Lounge POS — 020: Products & prices screen (office)
-- Run in the Supabase SQL Editor after 019. Safe to run again.
--
-- Products can be READ by every signed-in account but never written directly. These functions are the
-- only way to change them. All need the existing 'catalogue.manage' permission (managers have it) and
-- every change is written to the audit log with the old and new values.
--
--   list_products()           everything the screen shows, including hidden products
--   set_product_prices(rows)  save many selling / buying prices in one go (all-or-nothing)
--   update_product(...)       rename, change category, reorder level, hide / show
--   create_product(...)       add a new product (sku is generated)
--
-- Station, liquor flag and units are NOT editable after creation on purpose: they drive stock custody
-- and queues, so changing them on a product that already has stock or sales would corrupt the records.

create or replace function list_products()
returns table (id uuid, sku text, name text, category text, station text, is_liquor boolean,
               base_unit text, sale_unit text, selling_price numeric, purchase_cost numeric,
               reorder_level numeric, available boolean)
language plpgsql stable security definer set search_path = public as $$
begin
  if not has_permission('catalogue.manage') then raise exception 'not permitted'; end if;
  return query
    select p.id, p.sku, p.name, c.name, p.station::text, p.is_liquor, p.base_unit, p.sale_unit,
           p.selling_price, p.purchase_cost, p.reorder_level, p.available
    from products p left join categories c on c.id = p.category_id
    where p.active
    order by c.name nulls last, p.name;
end $$;

-- p_rows: [{"id": "<uuid>", "selling_price": 350, "purchase_cost": 280}, ...]; null or missing = no price.
create or replace function set_product_prices(p_rows jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare r jsonb; v products; v_sell numeric; v_cost numeric; n int := 0;
begin
  if not has_permission('catalogue.manage') then raise exception 'not permitted'; end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then raise exception 'nothing to save'; end if;
  for r in select * from jsonb_array_elements(p_rows) loop
    select * into v from products where id = (r->>'id')::uuid and active for update;
    if not found then raise exception 'product not found'; end if;
    v_sell := nullif(r->>'selling_price', '')::numeric;
    v_cost := nullif(r->>'purchase_cost', '')::numeric;
    if v_sell < 0 or v_cost < 0 then raise exception 'price of % cannot be negative', v.name; end if;
    if v_sell is not distinct from v.selling_price and v_cost is not distinct from v.purchase_cost then continue; end if;
    update products set selling_price = v_sell, purchase_cost = v_cost where id = v.id;
    perform write_audit('product.price', 'products', v.id::text,
      jsonb_build_object('selling_price', v.selling_price, 'purchase_cost', v.purchase_cost),
      jsonb_build_object('selling_price', v_sell, 'purchase_cost', v_cost));
    n := n + 1;
  end loop;
  return n;
end $$;

create or replace function update_product(p_id uuid, p_name text, p_category text,
                                          p_reorder numeric, p_available boolean) returns products
language plpgsql security definer set search_path = public as $$
declare v products; v_new products; v_cat uuid;
begin
  if not has_permission('catalogue.manage') then raise exception 'not permitted'; end if;
  select * into v from products where id = p_id and active for update;
  if not found then raise exception 'product not found'; end if;
  if coalesce(btrim(p_name), '') = '' then raise exception 'name required'; end if;
  if p_reorder < 0 then raise exception 'reorder level cannot be negative'; end if;
  if exists (select 1 from products where lower(name) = lower(btrim(p_name)) and id <> p_id and active) then
    raise exception 'another product is already called %', btrim(p_name); end if;
  if nullif(btrim(p_category), '') is not null then
    insert into categories(name) values (btrim(p_category))
      on conflict (name) do update set name = excluded.name returning id into v_cat;
  end if;
  update products set name = btrim(p_name), category_id = v_cat, reorder_level = p_reorder,
                      available = coalesce(p_available, available)
   where id = p_id returning * into v_new;
  perform write_audit('product.update', 'products', p_id::text,
    jsonb_build_object('name', v.name, 'category_id', v.category_id, 'reorder_level', v.reorder_level, 'available', v.available),
    jsonb_build_object('name', v_new.name, 'category_id', v_new.category_id, 'reorder_level', v_new.reorder_level, 'available', v_new.available));
  return v_new;
end $$;

create or replace function create_product(p_name text, p_category text, p_station text, p_is_liquor boolean,
                                          p_unit text, p_price numeric, p_cost numeric, p_reorder numeric)
returns products
language plpgsql security definer set search_path = public as $$
declare v products; v_cat uuid; v_sku text; v_base text; i int := 1; v_station station;
begin
  if not has_permission('catalogue.manage') then raise exception 'not permitted'; end if;
  if coalesce(btrim(p_name), '') = '' then raise exception 'name required'; end if;
  if not exists (select 1 from units where code = p_unit) then raise exception 'unknown unit %', p_unit; end if;
  if p_price < 0 or p_cost < 0 or p_reorder < 0 then raise exception 'numbers cannot be negative'; end if;
  begin v_station := coalesce(nullif(p_station, ''), 'none')::station;
  exception when invalid_text_representation then raise exception 'unknown station %', p_station; end;
  if exists (select 1 from products where lower(name) = lower(btrim(p_name)) and active) then
    raise exception '% already exists', btrim(p_name); end if;
  if nullif(btrim(p_category), '') is not null then
    insert into categories(name) values (btrim(p_category))
      on conflict (name) do update set name = excluded.name returning id into v_cat;
  end if;
  v_base := 'GL-' || trim(both '-' from regexp_replace(upper(btrim(p_name)), '[^A-Z0-9]+', '-', 'g'));
  v_sku := v_base;
  while exists (select 1 from products where sku = v_sku) loop i := i + 1; v_sku := v_base || '-' || i; end loop;
  insert into products(sku, name, category_id, station, is_liquor, base_unit, sale_unit,
                       selling_price, purchase_cost, reorder_level, is_demo)
  values (v_sku, btrim(p_name), v_cat, v_station, coalesce(p_is_liquor, false), p_unit, p_unit,
          p_price, p_cost, p_reorder, false)
  returning * into v;
  perform write_audit('product.create', 'products', v.id::text, null, to_jsonb(v));
  return v;
end $$;

revoke execute on function list_products(), set_product_prices(jsonb),
  update_product(uuid, text, text, numeric, boolean),
  create_product(text, text, text, boolean, text, numeric, numeric, numeric) from public, anon;
grant execute on function list_products(), set_product_prices(jsonb),
  update_product(uuid, text, text, numeric, boolean),
  create_product(text, text, text, boolean, text, numeric, numeric, numeric) to authenticated;
