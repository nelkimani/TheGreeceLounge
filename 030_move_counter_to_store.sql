-- The Glizz Lounge POS — 030: ONE-TIME go-live move: everything on the counter goes back to the store
-- Run in the Supabase SQL Editor ("Run without RLS" if asked), ONCE, before the first issue to the counter.
--
-- Why: until 028, opening stock and deliveries were booked straight onto the counter. The real stock sits in the
-- store, so this moves every drink's counter balance into the store and leaves the counter at 0. Then use
-- Stock > Issue to counter, drink by drink, for what is actually put on the counter. What is left over compared
-- with the physical count is what was sold over the weekend (record it with a stock count afterwards).
--
-- Nothing is deleted or edited: each drink gets one 'transfer' movement counter -> store, booked to the manager
-- M001 (or the first manager if there is no M001) and logged in the audit trail. Drinks with 0 or a negative
-- counter balance are not moved (negatives are listed so you can look at them).
-- Safe to run again: each drink can only be moved once (a repeat moves nothing).

do $$
declare
  v_actor uuid; v_bar uuid := loc('main_bar'); v_store uuid := loc('store');
  r record; n int := 0; units numeric := 0; neg int := 0;
begin
  select id into v_actor from staff where staff_no = 'M001' and active;
  if v_actor is null then
    select s.id into v_actor from staff s join staff_roles sr on sr.staff_id = s.id
     where sr.role_code = 'manager' and s.active order by s.created_at limit 1;
  end if;
  if v_actor is null then raise exception 'no manager found to book the move to'; end if;

  for r in
    select p.id, p.name, b.qty_base from stock_balance b join products p on p.id = b.product_id
     where b.location_id = v_bar and b.qty_base <> 0
  loop
    if r.qty_base < 0 then
      neg := neg + 1; raise notice 'NOT moved (negative on the counter): % = %', r.name, r.qty_base; continue;
    end if;
    insert into stock_movements(product_id, from_location, to_location, qty_base, type, shift_id, actor_id, idempotency_key, note)
    values (r.id, v_bar, v_store, r.qty_base, 'transfer', null, v_actor, 'golive-counter-to-store:' || r.id,
            'Go-live: counter stock moved to the store')
    on conflict (idempotency_key) do nothing;
    if found then n := n + 1; units := units + r.qty_base; end if;
  end loop;

  insert into audit_log(actor_id, action, entity, reason)
  select v_actor, 'stock.golive_counter_to_store', 'stock_movements',
         'Go-live: counter stock moved to the store (' || n || ' drinks, ' || units || ' units)'
  where n > 0;
  raise notice 'Moved % drinks (% units) from the counter to the store. % negative balances left alone.', n, units, neg;
end $$;

-- CHECK: the counter column should now be 0 for every drink.
select p.name,
       coalesce(sum(case when b.location_id = loc('main_bar') then b.qty_base end), 0) as counter,
       coalesce(sum(case when b.location_id = loc('store')    then b.qty_base end), 0) as store
from stock_balance b join products p on p.id = b.product_id
group by p.name order by p.name;
