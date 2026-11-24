-- The Glizz Lounge POS — 053: whoever made an Issue-to-store / Issue-to-counter entry can correct it for 24 hours
-- Run in the Supabase SQL Editor after 052. Safe to run again. A manager can still edit any entry at any time.
-- Same corrections-not-rewrites rule as 052; a reason is required; everything is audited.

create or replace function edit_stock_entry(p_move uuid, p_new_qty numeric, p_reason text, p_key text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  m stock_movements; v_store uuid := loc('store'); v_bar uuid := loc('main_bar');
  net numeric; d numeric; have numeric; kind text; pname text;
begin
  if coalesce(btrim(p_key), '') = '' then raise exception 'missing key'; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'write why you are editing this entry'; end if;
  if exists (select 1 from stock_movements where idempotency_key = p_key) then
    return jsonb_build_object('ok', true, 'already_done', true);
  end if;
  if p_new_qty is null or p_new_qty < 0 or p_new_qty > 100000 then raise exception 'enter a quantity of 0 or more'; end if;
  select * into m from stock_movements where id = p_move for update;
  if not found then raise exception 'entry not found'; end if;
  -- a manager can edit any entry; the person who made it can correct it within 24 hours
  if not (has_permission('close.approve') or (has_permission('goods.receive') and m.actor_id = auth.uid() and m.at > now() - interval '24 hours')) then
    raise exception 'only a manager can edit this entry now (you can correct your own entries for 24 hours)'; end if;
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

notify pgrst, 'reload schema';
select (select count(*) from pg_proc where proname = 'edit_stock_entry') as function_found;
