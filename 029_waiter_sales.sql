-- The Glizz Lounge POS — 029: waiter sales (my sales + waiter performance)
-- Run in the Supabase SQL Editor ("Run without RLS" if asked). Safe to run again. Read-only: changes no records.
--
--   my_sales(start, end)            a waiter sees ONLY their own sales: totals, per day, what they sold most
--   waiter_performance(start, end)  manager / accountant (report.sales): every waiter ranked, with what each sold most
--
-- Sales are the served lines of each sale (voided slips are excluded), dated by the trading day.

create or replace function my_sales(p_start date, p_end date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r jsonb;
begin
  if auth.uid() is null or not has_permission('tab.open') then raise exception 'not permitted'; end if;
  if p_start is null or p_end is null or p_end < p_start then raise exception 'choose a valid period'; end if;
  if p_end - p_start > 400 then raise exception 'choose a period of 400 days or less'; end if;

  with s as (select * from _sold_lines(p_start, p_end) where waiter_id = auth.uid()),
  by_day as (select sale_date as d, sum(line_total) as gross, count(distinct tab_id) as orders, sum(qty) as items
               from s group by 1),
  by_product as (select p.name, coalesce(c.name, 'Other') as category, sum(s.qty) as qty, sum(s.line_total) as gross
                   from s join products p on p.id = s.product_id left join categories c on c.id = p.category_id
                  group by p.id, p.name, c.name)
  select jsonb_build_object(
    'period', jsonb_build_object('start', p_start, 'end', p_end),
    'totals', jsonb_build_object('gross', coalesce((select sum(line_total) from s), 0),
                                 'orders', (select count(distinct tab_id) from s),
                                 'items', coalesce((select sum(qty) from s), 0)),
    'by_day', coalesce((select jsonb_agg(jsonb_build_object('date', d, 'gross', gross, 'orders', orders, 'items', items) order by d desc) from by_day), '[]'::jsonb),
    'top_products', coalesce((select jsonb_agg(jsonb_build_object('product', name, 'category', category, 'qty', qty, 'gross', gross) order by qty desc, name)
                                from (select * from by_product order by qty desc, name limit 15) x), '[]'::jsonb)
  ) into r;
  return r;
end $$;

create or replace function waiter_performance(p_start date, p_end date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r jsonb;
begin
  if not has_permission('report.sales') then raise exception 'not permitted'; end if;
  if p_start is null or p_end is null or p_end < p_start then raise exception 'choose a valid period'; end if;
  if p_end - p_start > 400 then raise exception 'choose a period of 400 days or less'; end if;

  with s as (select * from _sold_lines(p_start, p_end)),
  w as (select waiter_id, sum(line_total) as gross, count(distinct tab_id) as orders, sum(qty) as items,
               count(distinct sale_date) as days_worked
          from s group by 1),
  wp as (select s.waiter_id, p.name, sum(s.qty) as qty, sum(s.line_total) as gross,
                row_number() over (partition by s.waiter_id order by sum(s.qty) desc, p.name) as rn
           from s join products p on p.id = s.product_id group by s.waiter_id, p.id, p.name),
  wd as (select waiter_id, sale_date as d, sum(line_total) as gross from s group by 1, 2),
  ranked as (select w.*, st.full_name, st.staff_no, rank() over (order by w.gross desc) as pos
               from w join staff st on st.id = w.waiter_id),
  top_all as (select p.name, sum(s.qty) as qty, sum(s.line_total) as gross
                from s join products p on p.id = s.product_id group by p.id, p.name order by sum(s.qty) desc, p.name limit 10)
  select jsonb_build_object(
    'period', jsonb_build_object('start', p_start, 'end', p_end),
    'totals', jsonb_build_object('gross', coalesce((select sum(line_total) from s), 0),
                                 'orders', (select count(distinct tab_id) from s),
                                 'waiters', (select count(*) from w)),
    'waiters', coalesce((select jsonb_agg(jsonb_build_object(
        'rank', pos, 'waiter_id', waiter_id, 'waiter', full_name, 'staff_no', staff_no,
        'gross', gross, 'orders', orders, 'items', items, 'days_worked', days_worked,
        'avg_order', round(gross / nullif(orders, 0), 2),
        'top_products', coalesce((select jsonb_agg(jsonb_build_object('product', wp.name, 'qty', wp.qty, 'gross', wp.gross) order by wp.rn)
                                    from wp where wp.waiter_id = ranked.waiter_id and wp.rn <= 8), '[]'::jsonb),
        'by_day', coalesce((select jsonb_agg(jsonb_build_object('date', wd.d, 'gross', wd.gross) order by wd.d desc)
                              from wd where wd.waiter_id = ranked.waiter_id), '[]'::jsonb))
        order by gross desc, full_name) from ranked), '[]'::jsonb),
    'top_products', coalesce((select jsonb_agg(jsonb_build_object('product', name, 'qty', qty, 'gross', gross) order by qty desc, name) from top_all), '[]'::jsonb)
  ) into r;
  return r;
end $$;

revoke execute on function my_sales(date, date), waiter_performance(date, date) from public, anon;
grant execute on function my_sales(date, date), waiter_performance(date, date) to authenticated;
