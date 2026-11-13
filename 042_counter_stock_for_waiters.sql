-- The Glizz Lounge POS — 042: let the selling screen know what is on the counter (for the "none on the counter" warning)
-- Run in the Supabase SQL Editor ("Run without RLS" if asked). Safe to run more than once. Read-only: it changes no stock.
-- Anyone who can open a tab (waiters, bartenders, managers) gets one number per bar drink: how many are on the COUNTER now.
-- The selling screen warns when a drink has none or fewer than the order needs. It never blocks the sale.

create or replace function counter_stock()
returns table (product_id uuid, on_hand numeric)
language sql stable security definer set search_path = public as $$
  select p.id, coalesce(b.qty_base, 0)
  from products p
  left join stock_balance b on b.product_id = p.id and b.location_id = loc('main_bar')
  where p.active and p.station = 'bar' and has_permission('tab.open')
$$;

revoke execute on function counter_stock() from public, anon;
grant execute on function counter_stock() to authenticated;
notify pgrst, 'reload schema';

select count(*) as counter_stock_function from pg_proc where proname = 'counter_stock';
