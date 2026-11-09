-- The Glizz Lounge POS — 028: issue stock from the store to the counter
-- Run in the Supabase SQL Editor ("Run without RLS" if asked). Safe to run again.
--
-- How stock moves: drinks are received into the STORE (Purchasing). The manager or accountant issues part of
-- it to the COUNTER (the bar the waiters sell from). Sales take stock off the counter. When the counter runs
-- low they issue more.
--   issue_to_counter(lines, note, key)   moves stock store -> counter. All or nothing. Refuses to issue more than
--                                        the store has. Sending the same key twice never issues twice.
--   stock_overview()                     every bar drink with what is in the store and what is on the counter
--   issue_history(days)                  who issued what to the counter, and when
-- Needs goods.receive (manager and accountant) or stock.view_all.
-- p_lines: [{"product_id": "<uuid>", "qty": 12}, ...]

create or replace function issue_to_counter(p_lines jsonb, p_note text, p_key text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  r jsonb; v_pid uuid; v_qty numeric; v_store numeric; p products;
  errs jsonb := '[]'::jsonb; seen uuid[] := '{}'; n int := 0; v_units numeric := 0;
  v_from uuid := loc('store'); v_to uuid := loc('main_bar');
begin
  if not has_permission('goods.receive') then raise exception 'not permitted'; end if;
  if coalesce(btrim(p_key), '') = '' then raise exception 'missing key'; end if;
  if exists (select 1 from stock_movements where idempotency_key like p_key || ':%') then
    return jsonb_build_object('ok', true, 'already_issued', true);
  end if;
  if v_from is null or v_to is null then raise exception 'store or counter location is missing'; end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'choose the drinks to issue'; end if;
  if jsonb_array_length(p_lines) > 300 then raise exception 'too many lines (the limit is 300)'; end if;

  for r in select * from jsonb_array_elements(p_lines) loop
    begin v_pid := (r->>'product_id')::uuid; v_qty := (r->>'qty')::numeric;
    exception when others then errs := errs || jsonb_build_object('name', '', 'problem', 'a line is not valid'); continue; end;
    select * into p from products where id = v_pid and active;
    if not found then errs := errs || jsonb_build_object('name', '', 'problem', 'a drink was not found'); continue; end if;
    if v_qty is null or v_qty <= 0 then errs := errs || jsonb_build_object('name', p.name, 'problem', 'the quantity must be more than 0'); continue; end if;
    if v_pid = any (seen) then errs := errs || jsonb_build_object('name', p.name, 'problem', 'is listed twice'); continue; end if;
    seen := seen || v_pid;
    select coalesce(sum(case when to_location = v_from then qty_base else -qty_base end), 0) into v_store
      from stock_movements where product_id = v_pid and (to_location = v_from or from_location = v_from);
    if v_qty > v_store then
      errs := errs || jsonb_build_object('name', p.name, 'problem', 'only ' || trim(trailing '.' from trim(trailing '0' from v_store::text)) || ' in the store, you are issuing ' || v_qty);
    end if;
  end loop;
  if jsonb_array_length(errs) > 0 then return jsonb_build_object('ok', false, 'errors', errs); end if;

  for r in select * from jsonb_array_elements(p_lines) loop
    v_pid := (r->>'product_id')::uuid; v_qty := (r->>'qty')::numeric;
    insert into stock_movements(product_id, from_location, to_location, qty_base, type, shift_id, actor_id, idempotency_key, note)
    values (v_pid, v_from, v_to, v_qty, 'transfer', current_shift(), auth.uid(), p_key || ':' || v_pid, nullif(btrim(p_note), ''));
    n := n + 1; v_units := v_units + v_qty;
  end loop;
  return jsonb_build_object('ok', true, 'lines', n, 'units', v_units);
end $$;

create or replace function stock_overview()
returns table (product_id uuid, name text, category text, base_unit text, store_qty numeric, counter_qty numeric, reorder_level numeric)
language plpgsql stable security definer set search_path = public as $$
declare v_store uuid := loc('store'); v_bar uuid := loc('main_bar');
begin
  if not (has_permission('goods.receive') or has_permission('stock.view_all')) then raise exception 'not permitted'; end if;
  return query
    select p.id, p.name, c.name, p.base_unit,
           coalesce(sum(case when m.to_location = v_store then m.qty_base when m.from_location = v_store then -m.qty_base else 0 end), 0),
           coalesce(sum(case when m.to_location = v_bar then m.qty_base when m.from_location = v_bar then -m.qty_base else 0 end), 0),
           p.reorder_level
    from products p
    left join categories c on c.id = p.category_id
    left join stock_movements m on m.product_id = p.id and (m.to_location in (v_store, v_bar) or m.from_location in (v_store, v_bar))
    where p.active and p.station = 'bar'
    group by p.id, p.name, c.name, p.base_unit, p.reorder_level
    order by c.name nulls last, p.name;
end $$;

create or replace function issue_history(p_days int default 14)
returns table (at timestamptz, product text, qty numeric, base_unit text, issued_by text, note text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not (has_permission('goods.receive') or has_permission('stock.view_all')) then raise exception 'not permitted'; end if;
  return query
    select m.at, p.name, m.qty_base, p.base_unit, s.full_name, m.note
    from stock_movements m
    join products p on p.id = m.product_id
    left join staff s on s.id = m.actor_id
    where m.type = 'transfer' and m.from_location = loc('store') and m.to_location = loc('main_bar')
      and m.at > now() - make_interval(days => greatest(1, least(coalesce(p_days, 14), 366)))
    order by m.at desc, p.name;
end $$;

revoke execute on function issue_to_counter(jsonb, text, text), stock_overview(), issue_history(int) from public, anon;
grant execute on function issue_to_counter(jsonb, text, text), stock_overview(), issue_history(int) to authenticated;
