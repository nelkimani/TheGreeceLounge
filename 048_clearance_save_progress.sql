-- The Glizz Lounge POS — 048: clearing a waiter gets two buttons: SAVE (keep the progress) and CLEAR (finish)
-- Run in the Supabase SQL Editor ("Run without RLS" if asked). Run after 041, 044 (manager self-clear) and 046. Safe to run more than once.
--
-- WHY
--   A waiter often brings the money bit by bit on the same day. SAVE records what has been received so far (cash, M-Pesa total,
--   the tick, a note) without clearing the waiter. Open the waiter again later, the saved amounts are there, type the new totals
--   and SAVE again, or CLEAR when everything is in. CLEAR works exactly as before (reason required if it does not balance).
--
-- WHAT IT DOES
--   waiter_settlement_drafts   one saved-progress row per waiter per day.
--   save_waiter_progress(...)  saves or updates it. Needs handover.receive (accountant, manager). Not allowed on a day that is
--                              approved and locked, for a waiter who is already cleared, or for yourself (unless you are a manager). Written to the audit log.
--   waiter_settlement_sheet    (041) each waiter now also carries "draft" (what was saved, by whom, when).
--   settle_waiter              (041) clearing removes the saved progress.
--   reopen_waiter              (041) re-opening a cleared waiter puts the cleared amounts back as saved progress, so nobody retypes them.
--
-- WHAT STAYS THE SAME
--   The cleared record, the difference rule, the manager-only self-clearing rule (044), the audit trail and the day summary. Saved progress is NOT a clearance:
--   the waiter still counts as "not cleared" on the day close until CLEAR is pressed.

create table if not exists waiter_settlement_drafts (
  waiter_id uuid not null references staff(id),
  business_date date not null,
  cash_handed numeric(14,2) not null default 0 check (cash_handed >= 0),
  mpesa_total numeric(14,2) not null default 0 check (mpesa_total >= 0),
  mpesa_confirmed boolean not null default false,
  notes text,
  saved_by uuid not null references staff(id),
  saved_at timestamptz not null default now(),
  primary key (waiter_id, business_date));
alter table waiter_settlement_drafts enable row level security;       -- no policies: read only through the functions

create or replace function save_waiter_progress(p_waiter uuid, p_date date, p_cash numeric, p_mpesa numeric, p_confirmed boolean, p_notes text)
returns waiter_settlement_drafts language plpgsql security definer set search_path = public as $$
declare v waiter_settlement_drafts; cash numeric := coalesce(p_cash, 0); mp numeric := coalesce(p_mpesa, 0);
begin
  if not has_permission('handover.receive') then raise exception 'not permitted'; end if;
  if p_waiter = auth.uid() and not has_permission('close.approve') then raise exception 'only a manager can clear their own sales'; end if;
  if p_date is null or p_date > business_date(now()) then raise exception 'choose a valid day'; end if;
  if day_locked(p_date) then raise exception 'This day is already closed and approved'; end if;
  if not exists (select 1 from staff where id = p_waiter) then raise exception 'staff member not found'; end if;
  if cash < 0 or mp < 0 then raise exception 'amounts cannot be negative'; end if;
  if exists (select 1 from waiter_settlements where waiter_id = p_waiter and business_date = p_date) then
    raise exception 'This waiter is already cleared for this day. A manager can re-open them.'; end if;
  insert into waiter_settlement_drafts(waiter_id, business_date, cash_handed, mpesa_total, mpesa_confirmed, notes, saved_by, saved_at)
  values (p_waiter, p_date, cash, mp, coalesce(p_confirmed, false), nullif(btrim(p_notes), ''), auth.uid(), now())
  on conflict (waiter_id, business_date) do update
     set cash_handed = excluded.cash_handed, mpesa_total = excluded.mpesa_total, mpesa_confirmed = excluded.mpesa_confirmed,
         notes = excluded.notes, saved_by = excluded.saved_by, saved_at = excluded.saved_at
  returning * into v;
  perform write_audit('waiter.save', 'waiter_settlement_drafts', p_waiter::text || ':' || p_date::text, null, to_jsonb(v), p_notes);
  return v;
end $$;

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
        or exists (select 1 from waiter_settlements w where w.waiter_id = s.id and w.business_date = p_date)
        or exists (select 1 from waiter_settlement_drafts d where d.waiter_id = s.id and d.business_date = p_date)),
  w as (
    select pe.id, pe.full_name, pe.staff_no, coalesce(o.n, 0) as orders, coalesce(t.t, 0) as sales,
           coalesce((select jsonb_agg(jsonb_build_object('name', sl.product, 'qty', sl.qty, 'total', sl.total) order by sl.total desc, sl.product)
                       from sl where sl.waiter_id = pe.id), '[]'::jsonb) as products,
           (select jsonb_build_object('cash', x.cash_handed, 'mpesa', x.mpesa_total, 'variance', x.variance, 'notes', x.notes,
                                      'sales_at_clearing', x.sales_total, 'cleared_at', x.cleared_at, 'cleared_by', cb.full_name,
                                      'mpesa_confirmed', x.mpesa_confirmed)
              from waiter_settlements x join staff cb on cb.id = x.cleared_by
             where x.waiter_id = pe.id and x.business_date = p_date) as settlement,
           (select jsonb_build_object('cash', d.cash_handed, 'mpesa', d.mpesa_total, 'notes', d.notes,
                                      'mpesa_confirmed', d.mpesa_confirmed, 'saved_at', d.saved_at, 'saved_by', sb.full_name)
              from waiter_settlement_drafts d join staff sb on sb.id = d.saved_by
             where d.waiter_id = pe.id and d.business_date = p_date) as draft
    from people pe left join ord o on o.waiter_id = pe.id left join tot t on t.waiter_id = pe.id)
  select jsonb_build_object(
    'date', p_date,
    'locked', day_locked(p_date),
    'waiters', coalesce((select jsonb_agg(jsonb_build_object(
        'waiter_id', id, 'name', full_name, 'staff_no', staff_no, 'orders', orders, 'sales', sales,
        'products', products, 'settlement', settlement, 'draft', draft) order by (settlement is not null), sales desc, full_name) from w), '[]'::jsonb)
  ) into r;
  return r;
end $$;

create or replace function settle_waiter(p_waiter uuid, p_date date, p_cash numeric, p_mpesa numeric, p_confirmed boolean, p_notes text)
returns waiter_settlements language plpgsql security definer set search_path = public as $$
declare v waiter_settlements; sales numeric; diff numeric; cash numeric := coalesce(p_cash, 0); mp numeric := coalesce(p_mpesa, 0);
begin
  if not has_permission('handover.receive') then raise exception 'not permitted'; end if;
  if p_waiter = auth.uid() and not has_permission('close.approve') then raise exception 'only a manager can clear their own sales'; end if;
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
  delete from waiter_settlement_drafts where waiter_id = p_waiter and business_date = p_date;        -- progress is now the clearance
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
  -- keep what was cleared as saved progress, so the accountant edits it instead of retyping
  insert into waiter_settlement_drafts(waiter_id, business_date, cash_handed, mpesa_total, mpesa_confirmed, notes, saved_by, saved_at)
  values (v.waiter_id, v.business_date, v.cash_handed, v.mpesa_total, v.mpesa_confirmed, v.notes, auth.uid(), now())
  on conflict (waiter_id, business_date) do update
     set cash_handed = excluded.cash_handed, mpesa_total = excluded.mpesa_total, mpesa_confirmed = excluded.mpesa_confirmed,
         notes = excluded.notes, saved_by = excluded.saved_by, saved_at = excluded.saved_at;
  perform write_audit('waiter.reopen', 'waiter_settlements', v.id::text, to_jsonb(v), null, p_reason);
end $$;

revoke execute on function save_waiter_progress(uuid, date, numeric, numeric, boolean, text), waiter_settlement_sheet(date),
  settle_waiter(uuid, date, numeric, numeric, boolean, text), reopen_waiter(uuid, date, text) from public, anon;
grant execute on function save_waiter_progress(uuid, date, numeric, numeric, boolean, text), waiter_settlement_sheet(date),
  settle_waiter(uuid, date, numeric, numeric, boolean, text), reopen_waiter(uuid, date, text) to authenticated;
notify pgrst, 'reload schema';

-- CHECK: the new table and function exist (open Reconciliation > Waiters to see it working)
select to_regclass('public.waiter_settlement_drafts') is not null as table_found,
       (select count(*) from pg_proc where proname = 'save_waiter_progress') as function_found;
