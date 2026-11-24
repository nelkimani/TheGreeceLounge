-- The Glizz Lounge POS — 051: "Issue to store" (new stock arrives in the STORE first, then is issued to the counter)
-- Run in the Supabase SQL Editor ("Run without RLS" if asked). Safe to run again. Run after 028.
--
-- FLOW: delivery -> Issue to store -> (store) -> Issue to counter -> (counter, what waiters sell from)
--   receive_to_store(lines, note, key)  adds quantities to the STORE. All or nothing. Same key twice never adds twice.
--                                       Needs goods.receive (manager, accountant). p_lines: [{"product_id": "<uuid>", "qty": 24}, ...]
--   store_receipt_history(days)         what was put into the store, by whom, when.
--   stock_in(...)                       (Bar stock > Add stock) a DELIVERY ("purchase") now lands in the store instead of the counter.
--                                       "Opening" stock (stock.adjust) still goes straight to the counter.
-- Costs/suppliers are not captured here: use Purchasing / Upload delivery when you want the prices paid recorded.

create or replace function receive_to_store(p_lines jsonb, p_note text, p_key text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  r jsonb; v_pid uuid; v_qty numeric; p products;
  errs jsonb := '[]'::jsonb; seen uuid[] := '{}'; n int := 0; v_units numeric := 0; v_to uuid := loc('store');
begin
  if not has_permission('goods.receive') then raise exception 'not permitted'; end if;
  if coalesce(btrim(p_key), '') = '' then raise exception 'missing key'; end if;
  if exists (select 1 from stock_movements where idempotency_key like p_key || ':%') then
    return jsonb_build_object('ok', true, 'already_received', true);
  end if;
  if v_to is null then raise exception 'store location is missing'; end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'choose the drinks to put in the store'; end if;
  if jsonb_array_length(p_lines) > 300 then raise exception 'too many lines (the limit is 300)'; end if;

  for r in select * from jsonb_array_elements(p_lines) loop
    begin v_pid := (r->>'product_id')::uuid; v_qty := (r->>'qty')::numeric;
    exception when others then errs := errs || jsonb_build_object('name', '', 'problem', 'a line is not valid'); continue; end;
    select * into p from products where id = v_pid and active;
    if not found then errs := errs || jsonb_build_object('name', '', 'problem', 'a drink was not found'); continue; end if;
    if v_qty is null or v_qty <= 0 then errs := errs || jsonb_build_object('name', p.name, 'problem', 'the quantity must be more than 0'); continue; end if;
    if v_qty > 100000 then errs := errs || jsonb_build_object('name', p.name, 'problem', 'the quantity is too large'); continue; end if;
    if v_pid = any (seen) then errs := errs || jsonb_build_object('name', p.name, 'problem', 'is listed twice'); continue; end if;
    seen := seen || v_pid;
  end loop;
  if jsonb_array_length(errs) > 0 then return jsonb_build_object('ok', false, 'errors', errs); end if;

  for r in select * from jsonb_array_elements(p_lines) loop
    v_pid := (r->>'product_id')::uuid; v_qty := (r->>'qty')::numeric;
    insert into stock_movements(product_id, from_location, to_location, qty_base, type, shift_id, actor_id, idempotency_key, note)
    values (v_pid, null, v_to, v_qty, 'purchase', current_shift(), auth.uid(), p_key || ':' || v_pid, coalesce(nullif(btrim(p_note), ''), 'Into the store'));
    n := n + 1; v_units := v_units + v_qty;
  end loop;
  perform write_audit('stock.to_store', 'stock_movements', p_key, null, jsonb_build_object('lines', n, 'units', v_units), p_note);
  return jsonb_build_object('ok', true, 'lines', n, 'units', v_units);
end $$;

create or replace function store_receipt_history(p_days int default 14)
returns table (at timestamptz, product text, qty numeric, base_unit text, received_by text, note text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not (has_permission('goods.receive') or has_permission('stock.view_all')) then raise exception 'not permitted'; end if;
  return query
    select m.at, p.name, m.qty_base, p.base_unit, s.full_name, m.note
    from stock_movements m
    join products p on p.id = m.product_id
    left join staff s on s.id = m.actor_id
    where m.type = 'purchase' and m.from_location is null and m.to_location = loc('store')
      and m.at > now() - make_interval(days => greatest(1, least(coalesce(p_days, 14), 366)))
    order by m.at desc, p.name;
end $$;

-- Bar stock > Add stock > Delivery: land it in the store, not on the counter
create or replace function stock_in(p_product uuid, p_qty numeric, p_type movement_type, p_note text, p_key text)
returns stock_movements language plpgsql security definer set search_path = public as $$
declare v stock_movements;
begin
  if p_type = 'opening' then
    if not has_permission('stock.adjust') then raise exception 'not permitted'; end if;
  elsif p_type = 'purchase' then
    if not has_permission('goods.receive') then raise exception 'not permitted'; end if;
  else raise exception 'stock in must be opening or purchase'; end if;
  select * into v from stock_movements where idempotency_key = p_key;
  if found then return v; end if;
  if p_qty is null or p_qty <= 0 then raise exception 'quantity must be positive'; end if;
  insert into stock_movements(product_id, from_location, to_location, qty_base, type, shift_id, actor_id, idempotency_key, note)
  values (p_product, null, case when p_type = 'purchase' then loc('store') else loc('main_bar') end, p_qty, p_type, current_shift(), auth.uid(), p_key, nullif(btrim(p_note), ''))
  returning * into v;
  perform write_audit('stock.in', 'stock_movements', v.id::text, null, to_jsonb(v));
  return v;
end $$;

revoke execute on function receive_to_store(jsonb, text, text), store_receipt_history(int) from public, anon;
grant execute on function receive_to_store(jsonb, text, text), store_receipt_history(int) to authenticated;
notify pgrst, 'reload schema';

select (select count(*) from pg_proc where proname in ('receive_to_store','store_receipt_history')) as functions_found;
