-- The Glizz Lounge POS — 033: add "Matchbox" (selling price KES 10, buying price KES 5) with 1,000 pieces on the COUNTER
-- Run in the Supabase SQL Editor ("Run without RLS" if asked). Safe to run again: it adds the drink once and the stock once.
-- Category "Cigarettes", unit "piece", Bar station. The 1,000 pieces are booked as opening stock straight onto the counter
-- (so waiters can sell them now); to keep some in the store, issue/return as you do for other drinks.

do $$
declare
  v_staff uuid; v_p products; v_bar uuid := loc('main_bar');
begin
  select id into v_staff from staff where staff_no = 'M001' and active;
  if v_staff is null then
    select s.id into v_staff from staff s join staff_roles sr on sr.staff_id = s.id where sr.role_code = 'manager' and s.active order by s.created_at limit 1;
  end if;
  if v_staff is null then raise exception 'no manager found'; end if;
  perform set_config('request.jwt.claim.sub', v_staff::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_staff, 'role', 'authenticated')::text, true);

  select * into v_p from products where lower(btrim(name)) = 'matchbox' and active order by created_at limit 1;
  if not found then
    v_p := create_product('Matchbox', 'Cigarettes', 'bar', false, 'piece', 10, 5, 0);
    raise notice 'Added Matchbox (price 10, cost 5)';
  else
    raise notice 'Matchbox already exists: left as it is';
  end if;

  insert into stock_movements(product_id, from_location, to_location, qty_base, type, shift_id, actor_id, idempotency_key, note)
  values (v_p.id, null, v_bar, 1000, 'opening', null, v_staff, 'opening-matchbox:' || v_p.id, 'Matchbox: 1,000 pieces on the counter')
  on conflict (idempotency_key) do nothing;
  if found then raise notice 'Booked 1,000 pieces onto the counter'; else raise notice 'The 1,000 pieces were already booked: nothing added'; end if;
end $$;

select p.name, p.selling_price,
       coalesce(sum(case when b.location_id = loc('main_bar') then b.qty_base end), 0) as counter,
       coalesce(sum(case when b.location_id = loc('store')    then b.qty_base end), 0) as store
from products p left join stock_balance b on b.product_id = p.id
where lower(p.name) = 'matchbox' group by p.name, p.selling_price;
