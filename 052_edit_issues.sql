-- The Glizz Lounge POS — 052: EDIT an entry in "Issue to counter" and "Issue to store" (manager only, with a reason)
-- Run in the Supabase SQL Editor ("Run without RLS" if asked). Run after 028 and 051. Safe to run again.
--
-- HOW AN EDIT WORKS: stock history is never rewritten. An edit adds a CORRECTION movement for the difference, linked to the
-- original entry, with the reason, who did it and when (also in the audit log). History then shows the corrected quantity
-- and "was <original>". Setting the new quantity to 0 cancels the entry.
--   Issue to counter entry:  more -> moves the extra from the store to the counter (store must have it)
--                            less -> sends the difference back to the store (counter must still have it, so you cannot take back drinks already sold)
--   Issue to store entry:    more -> adds the extra to the store
--                            less -> removes the difference from the store (store must still have it)
--   Deliveries recorded in Purchasing / Upload delivery cannot be edited here (they belong to the supplier invoice).
--   edit_stock_entry(move_id, new_qty, reason, key)   needs close.approve (manager). Same key twice never edits twice.
--   issue_history / store_receipt_history             now also return the entry id, the corrected quantity and the original.

drop function if exists issue_history(int);
drop function if exists store_receipt_history(int);

create or replace function issue_history(p_days int default 14)
returns table (id uuid, product_id uuid, at timestamptz, product text, qty numeric, original_qty numeric, base_unit text, issued_by text, note text, edited boolean)
language plpgsql stable security definer set search_path = public as $$
begin
  if not (has_permission('goods.receive') or has_permission('stock.view_all')) then raise exception 'not permitted'; end if;
  return query
    select m.id, m.product_id, m.at, p.name,
           m.qty_base + coalesce((select sum(case when c.from_location = m.from_location then c.qty_base else -c.qty_base end)
                                    from stock_movements c where c.ref_table = 'stock_movements' and c.ref_id = m.id), 0),
           m.qty_base, p.base_unit, s.full_name, m.note,
           exists (select 1 from stock_movements c where c.ref_table = 'stock_movements' and c.ref_id = m.id)
    from stock_movements m
    join products p on p.id = m.product_id
    left join staff s on s.id = m.actor_id
    where m.type = 'transfer' and m.from_location = loc('store') and m.to_location = loc('main_bar') and m.ref_id is null
      and m.at > now() - make_interval(days => greatest(1, least(coalesce(p_days, 14), 366)))
    order by m.at desc, p.name;
end $$;

create or replace function store_receipt_history(p_days int default 14)
returns table (id uuid, product_id uuid, at timestamptz, product text, qty numeric, original_qty numeric, base_unit text, received_by text, note text, edited boolean)
language plpgsql stable security definer set search_path = public as $$
begin
  if not (has_permission('goods.receive') or has_permission('stock.view_all')) then raise exception 'not permitted'; end if;
  return query
    select m.id, m.product_id, m.at, p.name,
           m.qty_base + coalesce((select sum(case when c.to_location = m.to_location then c.qty_base else -c.qty_base end)
                                    from stock_movements c where c.ref_table = 'stock_movements' and c.ref_id = m.id), 0),
           m.qty_base, p.base_unit, s.full_name, m.note,
           exists (select 1 from stock_movements c where c.ref_table = 'stock_movements' and c.ref_id = m.id)
    from stock_movements m
    join products p on p.id = m.product_id
    left join staff s on s.id = m.actor_id
    where m.type = 'purchase' and m.from_location is null and m.to_location = loc('store') and m.ref_table is null
      and m.at > now() - make_interval(days => greatest(1, least(coalesce(p_days, 14), 366)))
    order by m.at desc, p.name;
end $$;

create or replace function edit_stock_entry(p_move uuid, p_new_qty numeric, p_reason text, p_key text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  m stock_movements; v_store uuid := loc('store'); v_bar uuid := loc('main_bar');
  net numeric; d numeric; have numeric; kind text; pname text;
begin
  if not has_permission('close.approve') then raise exception 'only a manager can edit an entry'; end if;
  if coalesce(btrim(p_key), '') = '' then raise exception 'missing key'; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'write why you are editing this entry'; end if;
  if exists (select 1 from stock_movements where idempotency_key = p_key) then
    return jsonb_build_object('ok', true, 'already_done', true);
  end if;
  if p_new_qty is null or p_new_qty < 0 or p_new_qty > 100000 then raise exception 'enter a quantity of 0 or more'; end if;
  select * into m from stock_movements where id = p_move for update;
  if not found then raise exception 'entry not found'; end if;
  if m.ref_id is not null then raise exception 'this entry cannot be edited'; end if;
  if m.type = 'transfer' and m.from_location = v_store and m.to_location = v_bar then kind := 'issue';
  elsif m.type = 'purchase' and m.from_location is null and m.to_location = v_store and m.ref_table is null then kind := 'receipt';
  else raise exception 'this entry cannot be edited here'; end if;
  select name into pname from products where id = m.product_id;

  if kind = 'issue' then
    select m.qty_base + coalesce(sum(case when c.from_location = v_store then c.qty_base else -c.qty_base end), 0) into net
      from stock_movements c where c.ref_table = 'stock_movements' and c.ref_id = m.id;
  else
    select m.qty_base + coalesce(sum(case when c.to_location = v_store then c.qty_base else -c.qty_base end), 0) into net
      from stock_movements c where c.ref_table = 'stock_movements' and c.ref_id = m.id;
  end if;
  d := round(p_new_qty, 3) - net;
  if d = 0 then raise exception 'the quantity is already %', net; end if;

  if kind = 'issue' then
    if d > 0 then
      select coalesce(sum(case when to_location = v_store then qty_base else -qty_base end), 0) into have
        from stock_movements where product_id = m.product_id and (to_location = v_store or from_location = v_store);
      if d > have then raise exception 'only % of % in the store, you need % more', have, pname, d; end if;
      insert into stock_movements(product_id, from_location, to_location, qty_base, type, ref_table, ref_id, shift_id, actor_id, idempotency_key, note)
      values (m.product_id, v_store, v_bar, d, 'transfer', 'stock_movements', m.id, current_shift(), auth.uid(), p_key, 'Edit: ' || btrim(p_reason));
    else
      select coalesce(sum(case when to_location = v_bar then qty_base else -qty_base end), 0) into have
        from stock_movements where product_id = m.product_id and (to_location = v_bar or from_location = v_bar);
      if -d > have then raise exception 'only % of % is left on the counter, you cannot take back %', have, pname, -d; end if;
      insert into stock_movements(product_id, from_location, to_location, qty_base, type, ref_table, ref_id, shift_id, actor_id, idempotency_key, note)
      values (m.product_id, v_bar, v_store, -d, 'transfer', 'stock_movements', m.id, current_shift(), auth.uid(), p_key, 'Edit: ' || btrim(p_reason));
    end if;
  else
    if d > 0 then
      insert into stock_movements(product_id, from_location, to_location, qty_base, type, ref_table, ref_id, shift_id, actor_id, idempotency_key, note)
      values (m.product_id, null, v_store, d, 'purchase', 'stock_movements', m.id, current_shift(), auth.uid(), p_key, 'Edit: ' || btrim(p_reason));
    else
      select coalesce(sum(case when to_location = v_store then qty_base else -qty_base end), 0) into have
        from stock_movements where product_id = m.product_id and (to_location = v_store or from_location = v_store);
      if -d > have then raise exception 'only % of % is in the store, you cannot take out %', have, pname, -d; end if;
      insert into stock_movements(product_id, from_location, to_location, qty_base, type, ref_table, ref_id, shift_id, actor_id, idempotency_key, note)
      values (m.product_id, v_store, null, -d, 'count_adjust', 'stock_movements', m.id, current_shift(), auth.uid(), p_key, 'Edit: ' || btrim(p_reason));
    end if;
  end if;
  perform write_audit('stock.edit_entry', 'stock_movements', m.id::text, jsonb_build_object('qty', net), jsonb_build_object('qty', round(p_new_qty, 3), 'kind', kind), p_reason);
  return jsonb_build_object('ok', true, 'was', net, 'now', round(p_new_qty, 3));
end $$;

revoke execute on function issue_history(int), store_receipt_history(int), edit_stock_entry(uuid, numeric, text, text) from public, anon;
grant execute on function issue_history(int), store_receipt_history(int), edit_stock_entry(uuid, numeric, text, text) to authenticated;
notify pgrst, 'reload schema';

select (select count(*) from pg_proc where proname in ('edit_stock_entry','issue_history','store_receipt_history')) as functions_found;
