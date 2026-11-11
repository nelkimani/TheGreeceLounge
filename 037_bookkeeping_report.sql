-- The Glizz Lounge POS — 037: Bookkeeping report (read-only; it changes no data)
-- Run in the Supabase SQL Editor ("Run without RLS" if asked). Safe to run more than once.
--
-- Adds report_bookkeeping(): for every product, all-time, as at today:
--   bought      = opening stock + everything received/purchased (units)
--   sold        = units sold through the POS, less units put back by voided slips
--   remaining   = what the system says is on hand now (store, bar, kitchen, with waiters; NOT the wastage bin)
--   other       = bought - sold - remaining: wastage, breakage, free items, staff meals, count differences
--   cost        = latest delivery price (else the product's stored cost), per unit
--   price       = selling price, only when the sale unit is the same as the stock unit
--   worth_bought, remaining_cost, remaining_sell, profit_remaining, expected_total_profit, profit_sold
-- plus totals and flags (no cost, no price, negative stock, unit mismatch).
-- Same permission as the profit report (report.profit), because it shows costs.
-- The screen shows profit and loss for a chosen period by calling the existing report_profit(); this function
-- is only the stock side.

create or replace function report_bookkeeping() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r jsonb;
begin
  if not has_permission('report.profit') then raise exception 'not permitted'; end if;

  with mv as (
    select product_id,
           sum(qty_base) filter (where type in ('opening', 'purchase')) as bought,
           sum(case when type in ('tab_sale', 'direct_sale') then qty_base
                    when type = 'approved_return' and ref_table = 'order_items' then -qty_base
                    else 0 end) as sold
    from stock_movements group by product_id),
  rem as (
    select b.product_id, sum(b.qty_base) as remaining
    from stock_balance b join locations l on l.id = b.location_id
    where l.kind <> 'wastage' group by b.product_id),
  base as (
    select p.id, p.name, coalesce(c.name, 'No category') as category, p.base_unit as unit,
           coalesce(mv.bought, 0) as bought, coalesce(mv.sold, 0) as sold, coalesce(rem.remaining, 0) as remaining,
           _unit_cost(p.id, business_date(now())) as cost,
           case when p.sale_unit is null or p.sale_unit = p.base_unit then p.selling_price end as price,
           (p.sale_unit is not null and p.sale_unit <> p.base_unit) as mixed
    from products p
    left join categories c on c.id = p.category_id
    left join mv on mv.product_id = p.id
    left join rem on rem.product_id = p.id
    where p.active and not p.is_demo
      and (coalesce(mv.bought, 0) <> 0 or coalesce(rem.remaining, 0) <> 0 or coalesce(mv.sold, 0) <> 0)),
  calc as (
    select b.*,
           b.bought - b.sold - b.remaining as other,
           round(b.bought * coalesce(b.cost, 0), 2)    as worth_bought,
           round(b.remaining * coalesce(b.cost, 0), 2) as remaining_cost,
           round(b.remaining * coalesce(b.price, 0), 2) as remaining_sell,
           case when b.cost is not null and b.price is not null then round(b.remaining * (b.price - b.cost), 2) end as profit_remaining,
           case when b.cost is not null and b.price is not null then round(b.bought * (b.price - b.cost), 2) end    as expected_total_profit,
           case when b.cost is not null and b.price is not null then round(b.sold * (b.price - b.cost), 2) end      as profit_sold
    from base b)
  select jsonb_build_object(
    'as_at', business_date(now()),
    'rows', coalesce((select jsonb_agg(jsonb_build_object(
        'product', name, 'category', category, 'unit', unit, 'bought', bought, 'sold', sold, 'remaining', remaining,
        'other', other, 'cost', cost, 'price', price, 'worth_bought', worth_bought, 'remaining_cost', remaining_cost,
        'remaining_sell', remaining_sell, 'profit_remaining', profit_remaining,
        'expected_total_profit', expected_total_profit, 'profit_sold', profit_sold) order by category, name) from calc), '[]'::jsonb),
    'totals', (select jsonb_build_object(
        'bought', coalesce(sum(bought), 0), 'sold', coalesce(sum(sold), 0), 'remaining', coalesce(sum(remaining), 0),
        'worth_bought', coalesce(sum(worth_bought), 0), 'remaining_cost', coalesce(sum(remaining_cost), 0),
        'remaining_sell', coalesce(sum(remaining_sell), 0), 'profit_remaining', coalesce(sum(profit_remaining), 0),
        'expected_total_profit', coalesce(sum(expected_total_profit), 0), 'profit_sold', coalesce(sum(profit_sold), 0),
        'other_cost', coalesce(sum(round(other * coalesce(cost, 0), 2)), 0)) from calc),
    'flags', jsonb_build_object(
        'no_cost',  coalesce((select jsonb_agg(name order by name) from calc where cost is null and (bought <> 0 or remaining <> 0)), '[]'::jsonb),
        'no_price', coalesce((select jsonb_agg(name order by name) from calc where price is null and not mixed and (bought <> 0 or remaining <> 0)), '[]'::jsonb),
        'mixed_unit', coalesce((select jsonb_agg(name order by name) from calc where mixed), '[]'::jsonb),
        'negative', coalesce((select jsonb_agg(jsonb_build_object('product', name, 'qty', remaining) order by name) from calc where remaining < 0), '[]'::jsonb))
  ) into r;
  return r;
end $$;

revoke execute on function report_bookkeeping() from public, anon;
grant execute on function report_bookkeeping() to authenticated;

-- CHECK: the function exists (it needs a signed-in manager to run, so open the Bookkeeping screen to see the numbers)
select proname, pg_get_function_identity_arguments(oid) as args from pg_proc where proname = 'report_bookkeeping';
