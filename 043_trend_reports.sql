-- The Glizz Lounge POS — 043: trend reports (weekly / monthly profit, best and worst drinks, waiters whose shortages repeat)
-- Run in the Supabase SQL Editor ("Run without RLS" if asked). Safe to run more than once. Read-only: nothing is changed.
--  report_trends(start, end)          needs report.profit (accountant)  - the profit trends and drink rankings
--  waiter_shortage_report(start, end) needs recon.view_all (manager, accountant) - repeat shortages from the "Waiters" clearing tab
-- Profit here is DRINKS ONLY: bar sales minus the cost of the drinks sold (same cost rule as Bookkeeping: latest delivery cost,
-- else the product's cost; drinks with no cost count as 0 and are counted in "no cost" so the screen can warn).

create or replace function report_trends(p_start date, p_end date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r jsonb;
begin
  if not has_permission('report.profit') then raise exception 'not permitted'; end if;
  if p_start is null or p_end is null or p_end < p_start then raise exception 'choose a valid period'; end if;
  if p_end - p_start > 800 then raise exception 'choose a period of 800 days or less'; end if;

  with s as (select sl.sale_date as d, sl.product_id, sl.qty, sl.line_total, p.station::text as st
               from _sold_lines(p_start, p_end) sl join products p on p.id = sl.product_id),
  mv as (select business_date(m.at) as d, m.product_id, sum(m.qty_base) as qty
           from stock_movements m join products p on p.id = m.product_id
          where m.type in ('tab_sale', 'direct_sale') and p.station = 'bar' and business_date(m.at) between p_start and p_end
          group by 1, 2),
  mvc as (select mv.d, mv.product_id, mv.qty, _unit_cost(mv.product_id, p_end) as uc from mv),
  sd as (select d, sum(line_total) as gross, coalesce(sum(line_total) filter (where st = 'bar'), 0) as bar_sales from s group by d),
  cd as (select d, sum(qty * coalesce(uc, 0)) as cost, sum(qty) as units, coalesce(sum(qty) filter (where uc is null), 0) as nocost from mvc group by d),
  days as (select coalesce(sd.d, cd.d) as d, coalesce(sd.gross, 0) as gross, coalesce(sd.bar_sales, 0) as bar_sales,
                  coalesce(cd.cost, 0) as cost, coalesce(cd.units, 0) as units, coalesce(cd.nocost, 0) as nocost
             from sd full join cd on cd.d = sd.d),
  wk as (select date_trunc('week', d)::date as k, sum(gross) as gross, sum(bar_sales) as bar_sales, sum(cost) as cost, sum(units) as units, sum(nocost) as nocost, count(*) as days from days group by 1),
  mo as (select date_trunc('month', d)::date as k, sum(gross) as gross, sum(bar_sales) as bar_sales, sum(cost) as cost, sum(units) as units, sum(nocost) as nocost, count(*) as days from days group by 1),
  bar_sold as (select product_id, sum(qty) as qty, sum(line_total) as sales from s where st = 'bar' group by 1),
  bar_cost as (select product_id, sum(qty) as qty_base, max(uc) as uc from mvc group by 1),
  dr as (select p.id, p.name, c.name as category, coalesce(bs.qty, 0) as qty, coalesce(bs.sales, 0) as sales, bc.uc,
                round(coalesce(bc.qty_base, 0) * coalesce(bc.uc, 0), 2) as cost
           from products p left join categories c on c.id = p.category_id
           left join bar_sold bs on bs.product_id = p.id left join bar_cost bc on bc.product_id = p.id
          where bs.product_id is not null or bc.product_id is not null),
  idle as (select p.name, c.name as category, p.selling_price, sum(b.qty_base) as on_hand
             from products p left join categories c on c.id = p.category_id
             join stock_balance b on b.product_id = p.id and b.location_id in (loc('main_bar'), loc('store'))
            where p.active and p.station = 'bar'
              and not exists (select 1 from bar_sold x where x.product_id = p.id)
            group by p.id, p.name, c.name, p.selling_price having sum(b.qty_base) > 0)
  select jsonb_build_object(
    'period', jsonb_build_object('start', p_start, 'end', p_end),
    'weekly', coalesce((select jsonb_agg(jsonb_build_object('start', k, 'days', days, 'gross', gross, 'bar_sales', bar_sales, 'cost', cost,
                          'profit', bar_sales - cost, 'units', units, 'no_cost_units', nocost) order by k) from wk), '[]'::jsonb),
    'monthly', coalesce((select jsonb_agg(jsonb_build_object('start', k, 'days', days, 'gross', gross, 'bar_sales', bar_sales, 'cost', cost,
                          'profit', bar_sales - cost, 'units', units, 'no_cost_units', nocost) order by k) from mo), '[]'::jsonb),
    'drinks', coalesce((select jsonb_agg(jsonb_build_object('product', name, 'category', category, 'qty', qty, 'sales', sales,
                          'unit_cost', uc, 'cost', case when uc is null then null else cost end,
                          'profit', case when uc is null then null else sales - cost end,
                          'margin_pct', case when uc is null or sales = 0 then null else round((sales - cost) / sales * 100, 1) end)
                          order by sales desc, name) from dr), '[]'::jsonb),
    'idle', coalesce((select jsonb_agg(jsonb_build_object('product', name, 'category', category, 'price', selling_price, 'on_hand', on_hand) order by on_hand desc, name) from idle), '[]'::jsonb)
  ) into r;
  return r;
end $$;

create or replace function waiter_shortage_report(p_start date, p_end date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r jsonb;
begin
  if not has_permission('recon.view_all') then raise exception 'not permitted'; end if;
  if p_start is null or p_end is null or p_end < p_start then raise exception 'choose a valid period'; end if;
  if p_end - p_start > 800 then raise exception 'choose a period of 800 days or less'; end if;

  with w as (select ws.*, s.full_name, s.staff_no from waiter_settlements ws join staff s on s.id = ws.waiter_id
              where ws.business_date between p_start and p_end),
  agg as (select waiter_id, full_name, staff_no, count(*) as days_cleared,
                 count(*) filter (where variance > 0) as days_short, count(*) filter (where variance < 0) as days_over,
                 coalesce(sum(variance) filter (where variance > 0), 0) as total_short,
                 coalesce(-sum(variance) filter (where variance < 0), 0) as total_over,
                 sum(variance) as net, sum(sales_total) as sales,
                 max(business_date) filter (where variance > 0) as last_short
            from w group by 1, 2, 3)
  select jsonb_build_object(
    'period', jsonb_build_object('start', p_start, 'end', p_end),
    'waiters', coalesce((select jsonb_agg(jsonb_build_object(
        'waiter', a.full_name, 'staff_no', a.staff_no, 'days_cleared', a.days_cleared, 'days_short', a.days_short, 'days_over', a.days_over,
        'total_short', a.total_short, 'total_over', a.total_over, 'net', a.net, 'sales', a.sales,
        'short_pct', case when a.sales > 0 then round(a.total_short / a.sales * 100, 2) end,
        'last_short', a.last_short, 'repeat', a.days_short >= 2,
        'recent', coalesce((select jsonb_agg(jsonb_build_object('date', x.business_date, 'amount', x.variance, 'notes', x.notes) order by x.business_date desc)
                              from (select * from w where w.waiter_id = a.waiter_id and w.variance > 0 order by business_date desc limit 5) x), '[]'::jsonb))
        order by (a.days_short >= 2) desc, a.days_short desc, a.total_short desc, a.full_name) from agg a), '[]'::jsonb)
  ) into r;
  return r;
end $$;

revoke execute on function report_trends(date, date), waiter_shortage_report(date, date) from public, anon;
grant execute on function report_trends(date, date), waiter_shortage_report(date, date) to authenticated;
notify pgrst, 'reload schema';

select count(*) as functions_found from pg_proc where proname in ('report_trends', 'waiter_shortage_report');
