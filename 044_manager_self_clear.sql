-- The Glizz Lounge POS — 044: a manager can clear their own sales in Reconciliation > Waiters
-- Run in the Supabase SQL Editor ("Run without RLS" if asked). Safe to run more than once. Only the self-clearing rule changes:
-- before, nobody could clear themselves; now a manager (close.approve) can, everyone else still cannot. The clear is still audited.

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
  perform write_audit('waiter.clear', 'waiter_settlements', v.id::text, null, to_jsonb(v), p_notes);
  return v;
end $$;

grant execute on function settle_waiter(uuid, date, numeric, numeric, boolean, text) to authenticated;
notify pgrst, 'reload schema';
select position('close.approve' in pg_get_functiondef('settle_waiter(uuid,date,numeric,numeric,boolean,text)'::regprocedure)) > 0 as manager_can_clear_self;
