-- The Glizz Lounge POS — 026: clear the pending test tabs before going live
-- Run ONCE in the Supabase SQL Editor ("Run without RLS" if asked). One all-or-nothing block.
--
-- What it does, for every tab that is still open (open, bill requested, partly paid, reopened):
--   * cancels its items (reason "Cleared before go-live")
--   * puts the bar stock back for items that were already served (a stock entry is added that points to the
--     original one; nothing is deleted)
--   * closes the tab and sets its table back to available
-- What it does NOT touch: stock you loaded, deliveries, prices, products, staff, paid sales and their history.
-- It refuses to run if any of these tabs has a payment on it (money was taken: handle those by hand).

do $$
declare
  t record; r record; m stock_movements;
  v_actor uuid := (select staff_id from staff_roles where role_code = 'manager' order by 1 limit 1);
  n_tabs int := 0; n_items int := 0; n_back int := 0;
begin
  if v_actor is null then raise exception 'no manager account found'; end if;

  if exists (select 1 from payments p join tabs x on x.id = p.tab_id
             where x.status in ('open','bill_requested','partially_paid','reopened')) then
    raise exception 'A pending tab already has a payment on it. Do not clear it with this script.';
  end if;

  for t in select id, table_id from tabs where status in ('open','bill_requested','partially_paid','reopened') for update loop
    for r in select id, station from order_items where tab_id = t.id and status <> 'cancelled' loop
      update order_items set status = 'cancelled', cancel_reason = 'Cleared before go-live' where id = r.id;
      insert into order_item_events(item_id, status, actor_id) values (r.id, 'cancelled', v_actor);
      n_items := n_items + 1;
      if r.station = 'bar' then
        select * into m from stock_movements
         where ref_table = 'order_items' and ref_id = r.id and from_location is not null and to_location is null
         order by at limit 1;
        if found then
          insert into stock_movements(product_id, from_location, to_location, qty_base, type, ref_table, ref_id,
                                      actor_id, reverses_id, idempotency_key, note)
          values (m.product_id, null, loc('main_bar'), m.qty_base, 'count_adjust', 'order_items', r.id,
                  v_actor, m.id, 'golive-clear:' || r.id, 'Test tab cleared before go-live: stock put back')
          on conflict (idempotency_key) do nothing;
          n_back := n_back + 1;
        end if;
      end if;
    end loop;
    update tabs set status = 'settled', closed_at = now() where id = t.id;
    if t.table_id is not null then update floor_tables set status = 'available' where id = t.table_id; end if;
    n_tabs := n_tabs + 1;
  end loop;

  raise notice '% tab(s) cleared, % item(s) cancelled, % stock entr(ies) put back', n_tabs, n_items, n_back;
end $$;

-- Check (should return no rows):
-- select id, status from tabs where status in ('open','bill_requested','partially_paid','reopened');
