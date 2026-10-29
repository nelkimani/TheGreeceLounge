-- Greece Lounge POS — 017: a bartender serves a bar item in ONE tap (no Accept / Start / Ready steps).
-- Run in the Supabase SQL Editor after 016. Safe to run twice.
-- One call does everything the old four steps did: claims the item for the bartender, marks it served,
-- takes the stock out of the bar once, and settles the tab if nothing else is owed or unserved.

create or replace function serve_bar_item(p_item uuid, p_terminal text) returns order_items
language plpgsql security definer set search_path = public as $$
declare v order_items; t uuid;
begin
  select * into v from order_items where id = p_item for update;     -- the second screen waits, then sees "already served"
  if not found then raise exception 'item not found'; end if;
  if v.station <> 'bar' then raise exception 'not a bar item'; end if;
  if not has_permission('station.bar') then raise exception 'not permitted'; end if;
  if v.status = 'cancelled' then raise exception 'item was cancelled'; end if;
  if v.status = 'served' then raise exception 'already served'; end if;
  select id into t from terminals where code = p_terminal;
  update order_items set status = 'served',
         claimed_by = coalesce(claimed_by, auth.uid()),
         claimed_terminal = coalesce(claimed_terminal, t),
         claimed_at = coalesce(claimed_at, now())
   where id = p_item returning * into v;
  insert into order_item_events(item_id, status, actor_id) values (p_item, 'served', auth.uid());
  perform deduct_for_item(p_item);                                    -- stock leaves the bar once, even if retried
  perform settle_if_clear(v.tab_id);
  return v;
end $$;

revoke execute on function serve_bar_item(uuid, text) from public, anon;
grant execute on function serve_bar_item(uuid, text) to authenticated;
