-- The Glizz Lounge POS — 041: clear each waiter at day end (cash handed in + M-Pesa from the till phone)
-- Run in the Supabase SQL Editor ("Run without RLS" if asked). Safe to run more than once. Nothing existing is changed or dropped.
--
-- The Reconciliation screen gets a "Waiters" tab. For the chosen day it lists every waiter with what they sold,
-- the accountant types the cash handed over and the waiter's M-Pesa total (read from the till phone after every
-- M-Pesa code has been confirmed by hand), and clears the waiter. Voided orders are not counted.
--   variance = sales - cash - M-Pesa      (+ = short, - = over). A reason is required when it is not 0.
-- A cleared waiter can be re-opened by a manager (reason required) if something was keyed wrongly.
-- Reading needs recon.view_all; clearing needs handover.receive (accountant, manager); re-opening needs close.approve (manager).
-- A day that is approved and locked cannot be changed. Every clear and re-open is written to the audit log.

create table if not exists waiter_settlements (
  id uuid primary key default gen_random_uuid(),
  waiter_id uuid not null references staff(id),
  business_date date not null,
  sales_total numeric(14,2) not null,
  cash_handed numeric(14,2) not null check (cash_handed >= 0),
  mpesa_total numeric(14,2) not null check (mpesa_total >= 0),
  variance numeric(14,2) not null,
  mpesa_confirmed boolean not null,
  notes text,
  cleared_by uuid not null references staff(id),
  cleared_at timestamptz not null default now(),
  unique (waiter_id, business_date));
alter table waiter_settlements enable row level security;       -- no policies: read only through the function below

-- What a waiter sold on a day (not voided), as one row per product
create or replace function _waiter_sales(p_date date)
returns table (waiter_id uuid, product_id uuid, product text, qty numeric, total numeric, orders bigint)
language sql stable security definer set search_path = public as $$
  select c.waiter_id, i.product_id, p.name, sum(i.qty), sum(i.qty * i.unit_price), count(distinct c.order_id)
  from order_items i
  join captain_orders c on c.id = i.captain_order_id
  join products p on p.id = i.product_id
  where c.business_date = p_date and c.voided_at is null
  group by c.waiter_id, i.product_id, p.name
$$;

create or replace function waiter_settlement_sheet(p_date date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r jsonb;
begin
  if not has_permission('recon.view_all') then raise exception 'not permitted'; end if;
  with sl as (select * from _waiter_sales(p_date)),
  ord as (select c.waiter_id, count(distinct c.order_id) as n from captain_orders c
           where c.business_date = p_date and c.voided_at is null group by 1),
  tot as (select waiter_id, sum(total) as t from sl group by 1),
  people as (
    select s.id, s.full_name, s.staff_no from staff s
     where (s.active and exists (select 1 from staff_roles sr where sr.staff_id = s.id and sr.role_code = 'waiter'))
        or exists (select 1 from sl where sl.waiter_id = s.id)
        or exists (select 1 from waiter_settlements w where w.waiter_id = s.id and w.business_date = p_date)),
  w as (
    select pe.id, pe.full_name, pe.staff_no, coalesce(o.n, 0) as orders, coalesce(t.t, 0) as sales,
           coalesce((select jsonb_agg(jsonb_build_object('name', sl.product, 'qty', sl.qty, 'total', sl.total) order by sl.total desc, sl.product)
                       from sl where sl.waiter_id = pe.id), '[]'::jsonb) as products,
           (select jsonb_build_object('cash', x.cash_handed, 'mpesa', x.mpesa_total, 'variance', x.variance, 'notes', x.notes,
                                      'sales_at_clearing', x.sales_total, 'cleared_at', x.cleared_at, 'cleared_by', cb.full_name,
                                      'mpesa_confirmed', x.mpesa_confirmed)
              from waiter_settlements x join staff cb on cb.id = x.cleared_by
             where x.waiter_id = pe.id and x.business_date = p_date) as settlement
    from people pe left join ord o on o.waiter_id = pe.id left join tot t on t.waiter_id = pe.id)
  select jsonb_build_object(
    'date', p_date,
    'locked', day_locked(p_date),
    'waiters', coalesce((select jsonb_agg(jsonb_build_object(
        'waiter_id', id, 'name', full_name, 'staff_no', staff_no, 'orders', orders, 'sales', sales,
        'products', products, 'settlement', settlement) order by (settlement is not null), sales desc, full_name) from w), '[]'::jsonb)
  ) into r;
  return r;
end $$;

create or replace function settle_waiter(p_waiter uuid, p_date date, p_cash numeric, p_mpesa numeric, p_confirmed boolean, p_notes text)
returns waiter_settlements language plpgsql security definer set search_path = public as $$
declare v waiter_settlements; sales numeric; diff numeric; cash numeric := coalesce(p_cash, 0); mp numeric := coalesce(p_mpesa, 0);
begin
  if not has_permission('handover.receive') then raise exception 'not permitted'; end if;
  if p_waiter = auth.uid() then raise exception 'you cannot clear yourself'; end if;
  if p_date is null or p_date > business_date(now()) then raise exception 'choose a valid day'; end if;
  if day_locked(p_date) then raise exception 'This day is already closed and approved'; end if;
  if not exists (select 1 from staff where id = p_waiter) then raise exception 'staff member not found'; end if;
  if cash < 0 or mp < 0 then raise exception 'amounts cannot be negative'; end if;
  if mp > 0 and not coalesce(p_confirmed, false) then
    raise exception 'Tick that every M-Pesa code has been confirmed before clearing'; end if;
  if exists (select 1 from waiter_settlements where waiter_id = p_waiter and business_date = p_date) then
    raise exception 'This waiter is already cleared for this day. A manager can re-open them.'; end if;
  select coalesce(sum(total), 0) into sales from _waiter_sales(p_date) where waiter_id = p_waiter;
  diff := sales - cash - mp;
  if diff <> 0 and coalesce(btrim(p_notes), '') = '' then
    raise exception 'Cash + M-Pesa differs from sales by KES % (positive = short) - write the reason', diff; end if;
  insert into waiter_settlements(waiter_id, business_date, sales_total, cash_handed, mpesa_total, variance, mpesa_confirmed, notes, cleared_by)
  values (p_waiter, p_date, sales, cash, mp, diff, coalesce(p_confirmed, false), nullif(btrim(p_notes), ''), auth.uid())
  returning * into v;
  perform write_audit('waiter.clear', 'waiter_settlements', v.id::text, null, to_jsonb(v), p_notes);
  return v;
end $$;

create or replace function reopen_waiter(p_waiter uuid, p_date date, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare v waiter_settlements;
begin
  if not has_permission('close.approve') then raise exception 'not permitted'; end if;
  if day_locked(p_date) then raise exception 'This day is already closed and approved'; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'write why you are re-opening'; end if;
  select * into v from waiter_settlements where waiter_id = p_waiter and business_date = p_date for update;
  if not found then raise exception 'this waiter is not cleared for that day'; end if;
  delete from waiter_settlements where id = v.id;
  perform write_audit('waiter.reopen', 'waiter_settlements', v.id::text, to_jsonb(v), null, p_reason);
end $$;

revoke execute on function _waiter_sales(date), waiter_settlement_sheet(date),
  settle_waiter(uuid, date, numeric, numeric, boolean, text), reopen_waiter(uuid, date, text) from public, anon;
grant execute on function waiter_settlement_sheet(date), settle_waiter(uuid, date, numeric, numeric, boolean, text),
  reopen_waiter(uuid, date, text) to authenticated;

-- CHECK: the four objects exist (the sheet needs a signed-in accountant or manager, so open Reconciliation > Waiters to see it)
select (select count(*) from pg_proc where proname in ('_waiter_sales', 'waiter_settlement_sheet', 'settle_waiter', 'reopen_waiter')) as functions_found,
       to_regclass('public.waiter_settlements') is not null as table_found;
