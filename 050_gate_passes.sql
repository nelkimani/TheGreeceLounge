-- The Glizz Lounge POS — 050: gate passes (entry paid at the gate, redeemed for drinks at the counter)
-- Run in the Supabase SQL Editor ("Run without RLS" if asked). Run AFTER 041, 044, 046-049 (it builds on the Save/Clear waiter clearing
-- from 048). Safe to run more than once. Nothing existing is dropped.
--
-- How it works
--   * The manager sets the entry amount for the night (e.g. Friday KES 500). A pass is worth that amount in drinks.
--   * At the gate the manager (or accountant) sells passes: cash or M-Pesa (M-Pesa needs the code). Each pass gets a unique
--     6-digit code and is printed on the handheld printer.
--   * At the counter, whoever serves types the code, sees the balance and applies the value of the drinks served (any drinks,
--     one or several times) against the waiter whose order it covers. The balance goes down; a pass cannot be used twice.
--   * A pass is only good on the trading night it was sold (08:00 to 08:00). Unused value is shown as "expired" the next day.
--   * Waiter clearing: drinks paid for with a pass are not cash the waiter owes. The Waiters tab now takes the passes redeemed on
--     a waiter's orders off what they must hand in: short = sales - passes - cash - M-Pesa.
-- Permissions: set the amount / void a pass = close.approve (manager); sell passes = close.approve or handover.receive;
--   check and redeem = tab.open (anyone who takes orders); summary = recon.view_all. Everything is written to the audit log.

create table if not exists gate_nights (
  business_date date primary key,
  entry_amount numeric(10,2) not null check (entry_amount > 0),
  active boolean not null default true,
  set_by uuid not null references staff(id),
  set_at timestamptz not null default now());
alter table gate_nights enable row level security;

create table if not exists gate_passes (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[0-9]{6}$'),
  business_date date not null,
  amount numeric(10,2) not null check (amount > 0),
  balance numeric(10,2) not null check (balance >= 0),
  pay_method text not null check (pay_method in ('cash', 'mpesa')),
  mpesa_ref text,
  status text not null default 'active' check (status in ('active', 'void')),
  sold_by uuid not null references staff(id),
  sold_at timestamptz not null default now(),
  voided_by uuid references staff(id), voided_at timestamptz, void_reason text,
  idempotency_key text unique);
create index if not exists gate_passes_day on gate_passes(business_date);
alter table gate_passes enable row level security;

create table if not exists gate_pass_uses (
  id uuid primary key default gen_random_uuid(),
  pass_id uuid not null references gate_passes(id),
  business_date date not null,
  amount numeric(10,2) not null check (amount > 0),
  waiter_id uuid not null references staff(id),
  note text,
  used_by uuid not null references staff(id),
  used_at timestamptz not null default now(),
  idempotency_key text unique);
create index if not exists gate_pass_uses_day on gate_pass_uses(business_date, waiter_id);
alter table gate_pass_uses enable row level security;

alter table waiter_settlements add column if not exists passes_used numeric(14,2) not null default 0;

-- ───────────── set tonight's entry amount ─────────────
create or replace function gate_set_amount(p_date date, p_amount numeric, p_active boolean default true) returns gate_nights
language plpgsql security definer set search_path = public as $$
declare v gate_nights; old jsonb;
begin
  if not has_permission('close.approve') then raise exception 'not permitted'; end if;
  if p_date is null or p_date < business_date(now()) then raise exception 'choose tonight or a later day'; end if;
  if p_amount is null or p_amount <= 0 or p_amount > 100000 then raise exception 'enter an entry amount above 0'; end if;
  select to_jsonb(g) into old from gate_nights g where business_date = p_date;
  insert into gate_nights(business_date, entry_amount, active, set_by) values (p_date, round(p_amount, 2), coalesce(p_active, true), auth.uid())
  on conflict (business_date) do update set entry_amount = excluded.entry_amount, active = excluded.active, set_by = excluded.set_by, set_at = now()
  returning * into v;
  perform write_audit('gate.set_amount', 'gate_nights', v.business_date::text, old, to_jsonb(v), null);
  return v;
end $$;

-- ───────────── sell passes at the gate ─────────────
create or replace function gate_sell(p_qty int, p_method text, p_ref text, p_key text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare d date := business_date(now()); n gate_nights; i int; c text; tries int; v gate_passes; out jsonb := '[]'::jsonb;
begin
  if not (has_permission('close.approve') or has_permission('handover.receive')) then raise exception 'not permitted'; end if;
  if p_key is null or btrim(p_key) = '' then raise exception 'missing key'; end if;
  if p_method not in ('cash', 'mpesa') then raise exception 'choose cash or M-Pesa'; end if;
  if p_qty is null or p_qty < 1 or p_qty > 50 then raise exception 'sell between 1 and 50 passes at a time'; end if;
  if p_method = 'mpesa' and coalesce(btrim(p_ref), '') = '' then raise exception 'enter the M-Pesa code'; end if;
  -- the same request sent twice returns the passes already made
  if exists (select 1 from gate_passes where idempotency_key = p_key || '#1') then
    select jsonb_agg(jsonb_build_object('id', id, 'code', code, 'amount', amount, 'business_date', business_date) order by idempotency_key)
      into out from gate_passes where idempotency_key like p_key || '#%';
    return out;
  end if;
  select * into n from gate_nights where business_date = d;
  if not found or not n.active then raise exception 'No entry amount is set for tonight. Set it first.'; end if;
  for i in 1..p_qty loop
    tries := 0;
    loop
      c := lpad((floor(random() * 1000000))::int::text, 6, '0');
      exit when not exists (select 1 from gate_passes where code = c);
      tries := tries + 1; if tries > 50 then raise exception 'could not make a code, try again'; end if;
    end loop;
    insert into gate_passes(code, business_date, amount, balance, pay_method, mpesa_ref, sold_by, idempotency_key)
    values (c, d, n.entry_amount, n.entry_amount, p_method, nullif(btrim(p_ref), ''), auth.uid(), p_key || '#' || i)
    returning * into v;
    out := out || jsonb_build_object('id', v.id, 'code', v.code, 'amount', v.amount, 'business_date', v.business_date);
  end loop;
  perform write_audit('gate.sell', 'gate_passes', d::text, null,
    jsonb_build_object('qty', p_qty, 'amount_each', n.entry_amount, 'method', p_method, 'mpesa_ref', nullif(btrim(p_ref), '')), null);
  return out;
end $$;

-- ───────────── look a pass up (before redeeming) ─────────────
create or replace function gate_lookup(p_code text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare g gate_passes; c text := regexp_replace(coalesce(p_code, ''), '[^0-9]', '', 'g'); ok boolean; msg text;
begin
  if not has_permission('tab.open') then raise exception 'not permitted'; end if;
  select * into g from gate_passes where code = c;
  if not found then return jsonb_build_object('found', false, 'message', 'No pass with that code.'); end if;
  ok := true;
  if g.status = 'void' then ok := false; msg := 'This pass was cancelled.';
  elsif g.business_date <> business_date(now()) then ok := false; msg := 'This pass was for ' || to_char(g.business_date, 'DD Mon') || ' and has expired.';
  elsif g.balance <= 0 then ok := false; msg := 'This pass is fully used.'; end if;
  return jsonb_build_object('found', true, 'id', g.id, 'code', g.code, 'amount', g.amount, 'balance', g.balance,
    'business_date', g.business_date, 'valid', ok, 'message', coalesce(msg, 'Valid.'));
end $$;

-- ───────────── redeem (use some or all of the balance) ─────────────
create or replace function gate_redeem(p_code text, p_amount numeric, p_waiter uuid, p_note text, p_key text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare g gate_passes; c text := regexp_replace(coalesce(p_code, ''), '[^0-9]', '', 'g'); w uuid := coalesce(p_waiter, auth.uid()); u gate_pass_uses;
begin
  if not has_permission('tab.open') then raise exception 'not permitted'; end if;
  if p_key is null or btrim(p_key) = '' then raise exception 'missing key'; end if;
  select * into u from gate_pass_uses where idempotency_key = p_key;
  if found then
    select * into g from gate_passes where id = u.pass_id;
    return jsonb_build_object('ok', true, 'used', u.amount, 'balance', g.balance, 'repeat', true);
  end if;
  if p_amount is null or p_amount <= 0 then raise exception 'enter the value of the drinks served'; end if;
  select * into g from gate_passes where code = c for update;
  if not found then raise exception 'No pass with that code.'; end if;
  if g.status = 'void' then raise exception 'This pass was cancelled.'; end if;
  if g.business_date <> business_date(now()) then raise exception 'This pass was for % and has expired.', to_char(g.business_date, 'DD Mon'); end if;
  if g.balance <= 0 then raise exception 'This pass is fully used.'; end if;
  p_amount := round(p_amount, 2);
  if p_amount > g.balance then raise exception 'Only KES % is left on this pass.', g.balance; end if;
  if not exists (select 1 from staff where id = w and active) then raise exception 'choose the waiter whose order this covers'; end if;
  insert into gate_pass_uses(pass_id, business_date, amount, waiter_id, note, used_by, idempotency_key)
  values (g.id, g.business_date, p_amount, w, nullif(btrim(p_note), ''), auth.uid(), p_key) returning * into u;
  update gate_passes set balance = balance - p_amount where id = g.id returning * into g;
  perform write_audit('gate.redeem', 'gate_passes', g.id::text, null,
    jsonb_build_object('code', g.code, 'used', p_amount, 'balance', g.balance, 'waiter_id', w), p_note);
  return jsonb_build_object('ok', true, 'used', p_amount, 'balance', g.balance, 'repeat', false);
end $$;

-- ───────────── cancel a pass that was never used ─────────────
create or replace function gate_void(p_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare g gate_passes;
begin
  if not has_permission('close.approve') then raise exception 'not permitted'; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'write why you are cancelling this pass'; end if;
  select * into g from gate_passes where id = p_id for update;
  if not found then raise exception 'pass not found'; end if;
  if g.status = 'void' then raise exception 'already cancelled'; end if;
  if exists (select 1 from gate_pass_uses where pass_id = g.id) then raise exception 'This pass has already been used, it cannot be cancelled.'; end if;
  update gate_passes set status = 'void', balance = 0, voided_by = auth.uid(), voided_at = now(), void_reason = p_reason where id = g.id;
  perform write_audit('gate.void', 'gate_passes', g.id::text, to_jsonb(g), null, p_reason);
end $$;

-- ───────────── the gate summary for a night ─────────────
create or replace function gate_summary(p_date date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r jsonb; n gate_nights;
begin
  if not has_permission('recon.view_all') then raise exception 'not permitted'; end if;
  select * into n from gate_nights where business_date = p_date;
  select jsonb_build_object(
    'date', p_date, 'today', business_date(now()),
    'entry_amount', n.entry_amount, 'active', coalesce(n.active, false), 'is_set', n.business_date is not null,
    'sold', count(*) filter (where g.status = 'active'),
    'cash', coalesce(sum(g.amount) filter (where g.status = 'active' and g.pay_method = 'cash'), 0),
    'mpesa', coalesce(sum(g.amount) filter (where g.status = 'active' and g.pay_method = 'mpesa'), 0),
    'collected', coalesce(sum(g.amount) filter (where g.status = 'active'), 0),
    'redeemed', coalesce(sum(g.amount - g.balance) filter (where g.status = 'active'), 0),
    'unused', coalesce(sum(g.balance) filter (where g.status = 'active'), 0),
    'void', count(*) filter (where g.status = 'void'),
    'passes', coalesce(jsonb_agg(jsonb_build_object('id', g.id, 'code', g.code, 'amount', g.amount, 'balance', g.balance, 'status', g.status,
         'method', g.pay_method, 'mpesa_ref', g.mpesa_ref, 'sold_by', sb.full_name, 'sold_at', g.sold_at,
         'uses', coalesce((select jsonb_agg(jsonb_build_object('amount', x.amount, 'waiter', sw.full_name, 'at', x.used_at) order by x.used_at)
                             from gate_pass_uses x join staff sw on sw.id = x.waiter_id where x.pass_id = g.id), '[]'::jsonb))
         order by g.sold_at desc), '[]'::jsonb)
  ) into r
  from gate_passes g join staff sb on sb.id = g.sold_by where g.business_date = p_date;
  if r is null then
    r := jsonb_build_object('date', p_date, 'today', business_date(now()), 'entry_amount', n.entry_amount, 'active', coalesce(n.active, false),
      'is_set', n.business_date is not null, 'sold', 0, 'cash', 0, 'mpesa', 0, 'collected', 0, 'redeemed', 0, 'unused', 0, 'void', 0, 'passes', '[]'::jsonb);
  else
    r := r || jsonb_build_object('entry_amount', n.entry_amount, 'active', coalesce(n.active, false), 'is_set', n.business_date is not null);
  end if;
  return r;
end $$;

-- ───────────── waiter clearing now knows about passes (builds on 048: Save progress / Clear) ─────────────
create or replace function waiter_settlement_sheet(p_date date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r jsonb;
begin
  if not has_permission('recon.view_all') then raise exception 'not permitted'; end if;
  with sl as (select * from _waiter_sales(p_date)),
  ord as (select c.waiter_id, count(distinct c.order_id) as n from captain_orders c
           where c.business_date = p_date and c.voided_at is null group by 1),
  tot as (select waiter_id, sum(total) as t from sl group by 1),
  ps as (select waiter_id, sum(amount) as p from gate_pass_uses where business_date = p_date group by 1),
  people as (
    select s.id, s.full_name, s.staff_no from staff s
     where (s.active and exists (select 1 from staff_roles sr where sr.staff_id = s.id and sr.role_code = 'waiter'))
        or exists (select 1 from sl where sl.waiter_id = s.id)
        or exists (select 1 from ps where ps.waiter_id = s.id)
        or exists (select 1 from waiter_settlements w where w.waiter_id = s.id and w.business_date = p_date)
        or exists (select 1 from waiter_settlement_drafts d where d.waiter_id = s.id and d.business_date = p_date)),
  w as (
    select pe.id, pe.full_name, pe.staff_no, coalesce(o.n, 0) as orders, coalesce(t.t, 0) as sales, coalesce(ps.p, 0) as passes,
           coalesce((select jsonb_agg(jsonb_build_object('name', sl.product, 'qty', sl.qty, 'total', sl.total) order by sl.total desc, sl.product)
                       from sl where sl.waiter_id = pe.id), '[]'::jsonb) as products,
           (select jsonb_build_object('cash', x.cash_handed, 'mpesa', x.mpesa_total, 'variance', x.variance, 'notes', x.notes,
                                      'sales_at_clearing', x.sales_total, 'passes', x.passes_used, 'cleared_at', x.cleared_at,
                                      'cleared_by', cb.full_name, 'mpesa_confirmed', x.mpesa_confirmed)
              from waiter_settlements x join staff cb on cb.id = x.cleared_by
             where x.waiter_id = pe.id and x.business_date = p_date) as settlement,
           (select jsonb_build_object('cash', d.cash_handed, 'mpesa', d.mpesa_total, 'notes', d.notes,
                                      'mpesa_confirmed', d.mpesa_confirmed, 'saved_at', d.saved_at, 'saved_by', sb.full_name)
              from waiter_settlement_drafts d join staff sb on sb.id = d.saved_by
             where d.waiter_id = pe.id and d.business_date = p_date) as draft
    from people pe left join ord o on o.waiter_id = pe.id left join tot t on t.waiter_id = pe.id left join ps on ps.waiter_id = pe.id)
  select jsonb_build_object(
    'date', p_date,
    'locked', day_locked(p_date),
    'waiters', coalesce((select jsonb_agg(jsonb_build_object(
        'waiter_id', id, 'name', full_name, 'staff_no', staff_no, 'orders', orders, 'sales', sales, 'passes', passes,
        'products', products, 'settlement', settlement, 'draft', draft) order by (settlement is not null), sales desc, full_name) from w), '[]'::jsonb)
  ) into r;
  return r;
end $$;

create or replace function settle_waiter(p_waiter uuid, p_date date, p_cash numeric, p_mpesa numeric, p_confirmed boolean, p_notes text)
returns waiter_settlements language plpgsql security definer set search_path = public as $$
declare v waiter_settlements; sales numeric; pass numeric; diff numeric; cash numeric := coalesce(p_cash, 0); mp numeric := coalesce(p_mpesa, 0);
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
  select coalesce(sum(amount), 0) into pass from gate_pass_uses where waiter_id = p_waiter and business_date = p_date;
  diff := sales - pass - cash - mp;
  if diff <> 0 and coalesce(btrim(p_notes), '') = '' then
    raise exception 'Cash + M-Pesa differs from what is owed by KES % (positive = short) - write the reason', diff; end if;
  insert into waiter_settlements(waiter_id, business_date, sales_total, passes_used, cash_handed, mpesa_total, variance, mpesa_confirmed, notes, cleared_by)
  values (p_waiter, p_date, sales, pass, cash, mp, diff, coalesce(p_confirmed, false), nullif(btrim(p_notes), ''), auth.uid())
  returning * into v;
  delete from waiter_settlement_drafts where waiter_id = p_waiter and business_date = p_date;        -- progress is now the clearance
  perform write_audit('waiter.clear', 'waiter_settlements', v.id::text, null, to_jsonb(v), p_notes);
  return v;
end $$;

revoke execute on function gate_set_amount(date, numeric, boolean), gate_sell(int, text, text, text), gate_lookup(text),
  gate_redeem(text, numeric, uuid, text, text), gate_void(uuid, text), gate_summary(date) from public, anon;
grant execute on function gate_set_amount(date, numeric, boolean), gate_sell(int, text, text, text), gate_lookup(text),
  gate_redeem(text, numeric, uuid, text, text), gate_void(uuid, text), gate_summary(date) to authenticated;
grant execute on function waiter_settlement_sheet(date), settle_waiter(uuid, date, numeric, numeric, boolean, text) to authenticated;
notify pgrst, 'reload schema';

select (select count(*) from pg_proc where proname in ('gate_set_amount','gate_sell','gate_lookup','gate_redeem','gate_void','gate_summary')) as gate_functions_found,
       to_regclass('public.gate_passes') is not null as passes_table_found;
