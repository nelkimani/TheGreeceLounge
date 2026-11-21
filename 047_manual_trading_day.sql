-- The Glizz Lounge POS — 047: the trading day is closed BY HAND (no more automatic 08:00 rollover)
-- Run in the Supabase SQL Editor ("Run without RLS" if asked). Run after 046. Safe to run more than once.
--
-- WHY
--   The lounge trades 24 hours, so a fixed 08:00 cut-off (045) splits a night's sales across two days. Now the day stays open
--   until the accountant or manager presses "End trading day" (Reconciliation > Day close). Everything sold, voided, counted
--   or received after that goes into the NEW day.
--
-- WHAT IT DOES
--   trading_days             one row per day: label (business_date), opened_at, closed_at, who closed it and why.
--   business_date(ts)        now answers from trading_days (the day that was open at that moment). Times before the first row
--                            keep the automatic rule (day_rollover_hour, 08:00 since 045), so all history keeps its date. Everything that already calls
--                            business_date() (sales, stock, counts, expenses, reports) follows automatically.
--   current_trading_day()    the open day and since when (the app reads this instead of working the date out itself).
--   end_trading_day(day, note)  closes the open day and opens the next one. Needs close.submit (accountant, manager).
--                            "day" must be the day the screen showed, so a double tap can never close two days.
--   submit_daily_close       (022) a day must be ENDED before its close can be submitted (an open day cannot be locked).
--
-- WHAT STAYS THE SAME
--   Reconciliation of the closed day carries on as before: clear waiters, tick slips, submit, approve (manager). The ended day
--   stays editable until the manager approves and locks it. The label of the next day is the next date (or today's calendar date
--   if the day was left open for several days). Nothing existing is changed or deleted.

create table if not exists trading_days (
  business_date date primary key,
  opened_at timestamptz not null,
  closed_at timestamptz,
  closed_by uuid references staff(id),
  close_note text,
  check (closed_at is null or closed_at > opened_at));
create unique index if not exists trading_days_one_open on trading_days ((true)) where closed_at is null;
create index if not exists trading_days_opened on trading_days(opened_at);
alter table trading_days enable row level security;       -- no policies: read only through the functions below

-- The automatic rule (rollover hour from business_settings, 08:00 Nairobi since 045), kept for everything before the first trading_days row
create or replace function _legacy_business_date(ts timestamptz) returns date
language sql stable as $$
  select ((ts at time zone 'Africa/Nairobi')
          - make_interval(hours => coalesce((select (value)::int from business_settings where key='day_rollover_hour'),5)))::date
$$;

create or replace function business_date(ts timestamptz) returns date
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select d.business_date from trading_days d
      where d.opened_at <= ts and (d.closed_at is null or ts < d.closed_at)
      order by d.opened_at desc limit 1),
    _legacy_business_date(ts))
$$;

-- First open day = the day the old rule says it is right now, opened when that day began
insert into trading_days(business_date, opened_at)
select _legacy_business_date(now()),
       ((_legacy_business_date(now())::timestamp
          + make_interval(hours => coalesce((select (value)::int from business_settings where key='day_rollover_hour'), 5)))
        at time zone 'Africa/Nairobi')
where not exists (select 1 from trading_days);

create or replace function current_trading_day() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select jsonb_build_object('date', d.business_date, 'opened_at', d.opened_at) from trading_days d where d.closed_at is null),
    jsonb_build_object('date', _legacy_business_date(now()), 'opened_at', null))
$$;

create or replace function end_trading_day(p_expected date, p_note text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare cur trading_days; nxt date; n timestamptz := now();
begin
  if not has_permission('close.submit') then raise exception 'not permitted'; end if;
  select * into cur from trading_days where closed_at is null for update;
  if not found then raise exception 'no open trading day found'; end if;
  if p_expected is distinct from cur.business_date then
    raise exception 'The open trading day is % (the screen showed %). Refresh the screen.', cur.business_date, p_expected; end if;
  if day_locked(cur.business_date) then raise exception 'This day is already closed and approved'; end if;

  nxt := greatest(cur.business_date + 1, (n at time zone 'Africa/Nairobi')::date);
  update trading_days set closed_at = n, closed_by = auth.uid(), close_note = nullif(btrim(p_note), '')
   where business_date = cur.business_date;
  insert into trading_days(business_date, opened_at) values (nxt, n);
  perform write_audit('day.end', 'trading_days', cur.business_date::text, to_jsonb(cur),
                      jsonb_build_object('next_day', nxt, 'closed_at', n), p_note);
  return jsonb_build_object('closed', cur.business_date, 'opened', nxt, 'opened_at', n);
end $$;

-- Same as 022, plus: the day must have been ended before its close is submitted
create or replace function submit_daily_close(p_date date, p_notes text)
returns daily_closes language plpgsql security definer set search_path = public as $$
declare d daily_closes; s jsonb; blockers int; st text;
begin
  if not has_permission('close.submit') then raise exception 'not permitted'; end if;
  if p_date > business_date(now()) then raise exception 'cannot close a future day'; end if;
  if exists (select 1 from trading_days where business_date = p_date and closed_at is null) then
    raise exception 'This trading day is still open. Press "End trading day" first, then submit its close.'; end if;
  select * into d from daily_closes where business_date = p_date and shift_id is null for update;
  if found and d.status = 'approved' then raise exception 'This day is already approved'; end if;
  s := day_summary(p_date);
  blockers := (s->>'cash_unreceived')::int + (s->>'mpesa_unverified_count')::int + (s->>'open_tabs')::int
            + (s->>'slips_missing')::int + (s->>'voids_pending')::int;
  st := case when blockers > 0 then 'provisional' else 'submitted' end;
  if st = 'provisional' and coalesce(btrim(p_notes), '') = '' then
    raise exception 'Items are still open (slips not seen, voids waiting, or old open tabs) – write why you are closing anyway'; end if;
  if found then
    update daily_closes set status = st, submitted_by = auth.uid(), submitted_at = now(), notes = nullif(btrim(p_notes), ''),
           approved_by = null, approved_at = null, summary = s where id = d.id returning * into d;
  else
    insert into daily_closes(business_date, status, submitted_by, submitted_at, notes, summary)
    values (p_date, st, auth.uid(), now(), nullif(btrim(p_notes), ''), s) returning * into d;
  end if;
  perform write_audit('close.submit', 'daily_closes', d.id::text, null, to_jsonb(d), p_notes);
  return d;
end $$;

revoke execute on function _legacy_business_date(timestamptz), current_trading_day(), end_trading_day(date, text),
  submit_daily_close(date, text) from public, anon;
grant execute on function current_trading_day(), end_trading_day(date, text), submit_daily_close(date, text) to authenticated;
grant execute on function business_date(timestamptz) to authenticated;
notify pgrst, 'reload schema';

-- CHECK: the day that is open now (expect one row)
select business_date as open_day, opened_at from trading_days where closed_at is null;
