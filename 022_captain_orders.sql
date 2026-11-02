-- The Greece Lounge POS — 022: captain-order workflow
-- Run in the Supabase SQL Editor after 021. Safe to run twice. Nothing existing is dropped.
--
-- THE NEW FLOW
--   * The waiter takes the order, keys it in at a terminal and sends it. The system records the SALE at
--     that moment (the receipt IS the sale) and prints, at that terminal:
--       - one customer receipt with everything, and
--       - one captain order per station: Bar (drinks), Choma zone (all meat: wet fry, dry fry, choma),
--         Restaurant (everything else that is not a drink, e.g. ugali).
--   * Stations serve from the printed captain order. Nobody signs in to press "Serve".
--   * Bar stock goes down automatically when the order is sent. A bartender can sell directly like a waiter;
--     his sale also prints a captain order, so it can be reconciled at close of day.
--   * Cash / M-Pesa / split are NOT recorded in the system (waiters keep their own M-Pesa book).
--   * A wrong or cancelled order is voided by a manager: the station gets a VOID slip and bar stock goes back.
--   * Day-end reconciliation: the accountant ticks off the captain orders collected from each station against
--     the orders in the system, then compares expected bar stock with the physical count (already built).
--
-- WHAT STAYS: tabs, orders and order_items (every sale is stored as a served line, so all owner reports keep
-- working), the stock ledger, approvals, purchasing and expenses. The old payment, queue and hand-in
-- functions stay in the database, unused, so old test data is still readable.

-- ───────────── Captain orders: one slip per station per order ─────────────
create table if not exists captain_orders (
  id uuid primary key default gen_random_uuid(),
  slip_no bigint generated always as identity unique,
  order_id uuid not null references orders(id),
  tab_id uuid not null references tabs(id),
  station text not null check (station in ('bar', 'choma', 'restaurant')),
  waiter_id uuid not null references staff(id),
  terminal_id uuid references terminals(id),
  business_date date not null default business_date(now()),
  created_at timestamptz not null default now(),
  reprints int not null default 0,
  seen_at timestamptz, seen_by uuid references staff(id),                       -- ticked off by the accountant
  voided_at timestamptz, voided_by uuid references staff(id),
  void_reason text, void_approval_id uuid references approvals(id),
  unique (order_id, station));
create index if not exists captain_orders_day on captain_orders(business_date, station);
alter table order_items add column if not exists captain_order_id uuid references captain_orders(id);
create index if not exists order_items_captain on order_items(captain_order_id);

-- Read only through the sales_slips view below; writes only through the functions in this file.
alter table captain_orders enable row level security;

-- ───────────── Which station prints which item ─────────────
-- bar = drinks, choma = all meat, restaurant = everything else (products with no station land here too).
create or replace function slip_station(s station) returns text
language sql immutable as $$
  select case s when 'bar' then 'bar' when 'choma' then 'choma' else 'restaurant' end
$$;

-- ───────────── One order as JSON, for printing ─────────────
create or replace function sale_json(p_order uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'order_id', o.id, 'order_no', o.ticket_no, 'created_at', o.created_at,
    'waiter', s.full_name,
    'label', coalesce('Table ' || ft.number, t.customer_name, 'Sale'),
    'total', (select coalesce(sum(i.qty * i.unit_price), 0) from order_items i where i.order_id = o.id and i.status <> 'cancelled'),
    'slips', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', c.id, 'slip_no', c.slip_no, 'station', c.station,
               'lines', (select jsonb_agg(jsonb_build_object('qty', i.qty, 'name', p.name, 'price', i.unit_price, 'notes', i.notes) order by p.name)
                           from order_items i join products p on p.id = i.product_id where i.captain_order_id = c.id))
             order by c.slip_no)
      from captain_orders c where c.order_id = o.id), '[]'::jsonb))
  from orders o
  join tabs t on t.id = o.tab_id
  join staff s on s.id = o.responsible_waiter
  left join floor_tables ft on ft.id = t.table_id
  where o.id = p_order
$$;

-- ───────────── submit_sale: the one call the waiter's SEND makes ─────────────
-- p_items: [{"product_id":"…","qty":2,"notes":"no ice"}]. Prices are taken from the catalogue here, not from the screen.
-- Safe to retry: the same p_key returns the same sale and never creates a second one.
-- Each sale gets its own tab, already settled, so tables are free the moment the order is sent.
create or replace function submit_sale(p_table uuid, p_customer text, p_items jsonb, p_terminal text, p_key text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_order orders; v_tab tabs; v_term uuid; it jsonb; v_p products; v_qty numeric; v_item uuid;
        v_co uuid; v_st text; v_table_no text; v_cust text; v_n int := 0; v_total numeric := 0;
begin
  if not has_permission('tab.open') then raise exception 'not permitted'; end if;
  if coalesce(btrim(p_key), '') = '' then raise exception 'missing request key'; end if;
  select * into v_order from orders where idempotency_key = p_key;
  if found then return sale_json(v_order.id); end if;                         -- retry-safe
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'order has no items'; end if;

  if p_table is not null then
    select number into v_table_no from floor_tables where id = p_table;
    if not found then raise exception 'table not found'; end if;
    if exists (select 1 from tabs where table_id = p_table and status in ('open', 'bill_requested', 'partially_paid', 'reopened')) then
      raise exception 'Table % still has an old open tab from before the change. Ask the manager to close it.', v_table_no;
    end if;
  end if;
  v_cust := nullif(btrim(p_customer), '');
  if p_table is null and v_cust is null then v_cust := 'Takeaway'; end if;
  select id into v_term from terminals where code = p_terminal;

  insert into tabs(table_id, customer_name, waiter_id, status, closed_at, shift_id, idempotency_key)
  values (p_table, v_cust, auth.uid(), 'settled', now(), current_shift(), 'sale:' || p_key)
  returning * into v_tab;
  insert into orders(tab_id, entered_by, responsible_waiter, terminal_id, idempotency_key)
  values (v_tab.id, auth.uid(), auth.uid(), v_term, p_key) returning * into v_order;

  for it in select * from jsonb_array_elements(p_items) loop
    v_qty := (it->>'qty')::numeric;
    if v_qty is null or v_qty <= 0 then raise exception 'bad quantity'; end if;
    select * into v_p from products where id = (it->>'product_id')::uuid and active and available;
    if not found then raise exception 'a product is unavailable'; end if;
    if v_p.selling_price is null then raise exception '% has no price', v_p.name; end if;

    v_st := slip_station(v_p.station);
    select id into v_co from captain_orders where order_id = v_order.id and station = v_st;
    if not found then
      insert into captain_orders(order_id, tab_id, station, waiter_id, terminal_id)
      values (v_order.id, v_tab.id, v_st, auth.uid(), v_term) returning id into v_co;
    end if;

    insert into order_items(order_id, tab_id, product_id, station, qty, unit_price, notes, status,
                            claimed_by, claimed_terminal, claimed_at, captain_order_id)
    values (v_order.id, v_tab.id, v_p.id, v_p.station, v_qty, v_p.selling_price,
            nullif(btrim(it->>'notes'), ''), 'served', auth.uid(), v_term, now(), v_co)
    returning id into v_item;
    insert into order_item_events(item_id, status, actor_id) values (v_item, 'served', auth.uid());
    perform deduct_for_item(v_item);                    -- bar stock leaves the bar now (bar items only; once, even if retried)
    v_n := v_n + 1; v_total := v_total + v_qty * v_p.selling_price;
  end loop;

  perform write_audit('sale.submit', 'orders', v_order.id::text, null,
                      jsonb_build_object('order_no', v_order.ticket_no, 'items', v_n, 'total', v_total));
  return sale_json(v_order.id);
end $$;

-- ───────────── Reading slips (own slips; managers, accountant and owners see all) ─────────────
create or replace view sales_slips with (security_invoker = false) as
select c.id as captain_order_id, c.slip_no, c.order_id, o.ticket_no as order_no, c.station, c.business_date, c.created_at,
       c.waiter_id, s.full_name as waiter_name, ft.number as table_number, t.customer_name,
       (select jsonb_agg(jsonb_build_object('qty', i.qty, 'name', p.name, 'price', i.unit_price, 'notes', i.notes) order by p.name)
          from order_items i join products p on p.id = i.product_id where i.captain_order_id = c.id) as lines,
       (select coalesce(sum(i.qty * i.unit_price), 0) from order_items i where i.captain_order_id = c.id) as total,
       c.reprints, c.seen_at, sb.full_name as seen_by_name, c.voided_at, c.void_reason,
       exists (select 1 from approvals a where a.kind = 'order_void' and a.status = 'pending'
                  and a.payload->>'captain_order_id' = c.id::text) as void_pending
from captain_orders c
join orders o on o.id = c.order_id
join tabs t on t.id = c.tab_id
join staff s on s.id = c.waiter_id
left join floor_tables ft on ft.id = t.table_id
left join staff sb on sb.id = c.seen_by
where c.waiter_id = auth.uid() or has_permission('tab.view_all')
   or has_permission('recon.view_all') or has_permission('report.sales');

grant select on sales_slips to authenticated;
revoke all on sales_slips from anon;

-- ───────────── Reprints are logged (a second slip must never mean a second serving unnoticed) ─────────────
-- p_captain null = a copy of the customer receipt. Returns the reprint count for that captain order.
create or replace function log_reprint(p_order uuid, p_captain uuid) returns int
language plpgsql security definer set search_path = public as $$
declare n int := 0; o orders;
begin
  select * into o from orders where id = p_order;
  if not found then raise exception 'order not found'; end if;
  if o.responsible_waiter <> auth.uid() and not (has_permission('tab.view_all') or has_permission('recon.view_all')) then
    raise exception 'not your order'; end if;
  if p_captain is not null then
    update captain_orders set reprints = reprints + 1 where id = p_captain and order_id = p_order returning reprints into n;
    if not found then raise exception 'slip not found'; end if;
  end if;
  perform write_audit('slip.reprint', 'orders', p_order::text, null,
                      jsonb_build_object('captain_order_id', p_captain, 'copy', n));
  return n;
end $$;

-- ───────────── Voids: manager approves, station gets a VOID slip, bar stock goes back ─────────────
create or replace function _apply_void(p_captain uuid, p_approval uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare c captain_orders; r record; m stock_movements;
begin
  select * into c from captain_orders where id = p_captain for update;
  if not found then raise exception 'slip not found'; end if;
  if c.voided_at is not null then return; end if;                              -- already done
  if day_locked(c.business_date) then raise exception 'This day is already closed and approved'; end if;
  for r in select id, station from order_items where captain_order_id = p_captain and status <> 'cancelled' loop
    update order_items set status = 'cancelled', cancel_reason = p_reason, cancel_approval_id = p_approval where id = r.id;
    insert into order_item_events(item_id, status, actor_id) values (r.id, 'cancelled', auth.uid());
    if r.station = 'bar' then                                                  -- put the bottle back on the bar book
      select * into m from stock_movements
       where ref_table = 'order_items' and ref_id = r.id and from_location is not null and to_location is null
       order by at limit 1;
      if found then
        insert into stock_movements(product_id, from_location, to_location, qty_base, type, ref_table, ref_id,
                                    shift_id, actor_id, approval_id, reverses_id, idempotency_key, note)
        values (m.product_id, null, loc('main_bar'), m.qty_base, 'approved_return', 'order_items', r.id,
                current_shift(), auth.uid(), p_approval, m.id, 'void:' || r.id, 'Void of slip ' || c.slip_no)
        on conflict (idempotency_key) do nothing;
      end if;
    end if;
  end loop;
  update captain_orders set voided_at = now(), voided_by = auth.uid(), void_reason = p_reason, void_approval_id = p_approval
   where id = p_captain;
  perform write_audit('slip.void', 'captain_orders', p_captain::text, null,
                      jsonb_build_object('slip_no', c.slip_no, 'station', c.station), p_reason, p_approval);
end $$;

-- A waiter or bartender asks for a void; a manager (approval.grant) decides it in Approvals.
-- A manager asking is voiding on his own authority: it applies at once and is logged.
create or replace function request_void(p_captain uuid, p_reason text, p_key text) returns approvals
language plpgsql security definer set search_path = public as $$
declare c captain_orders; a approvals; v_sum text; v_tot numeric; v_payload jsonb;
begin
  if not (has_permission('tab.open') or has_permission('approval.grant')) then raise exception 'not permitted'; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'write the reason for the void'; end if;
  select * into c from captain_orders where id = p_captain for update;
  if not found then raise exception 'slip not found'; end if;
  if c.waiter_id <> auth.uid() and not has_permission('tab.view_all') then raise exception 'not your order'; end if;
  if c.voided_at is not null then raise exception 'this slip is already voided'; end if;
  select * into a from approvals where kind = 'order_void' and requested_by = auth.uid() and payload->>'key' = p_key;
  if found then return a; end if;                                              -- retry-safe
  select * into a from approvals where kind = 'order_void' and status = 'pending' and payload->>'captain_order_id' = p_captain::text;
  if found then return a; end if;                                              -- already waiting for a decision

  select string_agg(trim_scale(i.qty)::text || ' x ' || p.name, ', ' order by p.name), sum(i.qty * i.unit_price)
    into v_sum, v_tot
    from order_items i join products p on p.id = i.product_id where i.captain_order_id = p_captain;
  v_payload := jsonb_build_object('captain_order_id', p_captain, 'slip_no', c.slip_no, 'station', c.station,
                                  'summary', v_sum, 'total', v_tot, 'key', p_key);
  if has_permission('approval.grant') then
    insert into approvals(kind, requested_by, approved_by, reason, status, payload, decided_at)
    values ('order_void', auth.uid(), null, p_reason, 'approved', v_payload, now()) returning * into a;
    perform _apply_void(p_captain, a.id, p_reason);
  else
    insert into approvals(kind, requested_by, reason, payload)
    values ('order_void', auth.uid(), p_reason, v_payload) returning * into a;
    perform write_audit('approval.request', 'approvals', a.id::text, null, to_jsonb(a), p_reason, a.id);
  end if;
  return a;
end $$;

-- decide_approval: same as 008, plus the order_void kind
create or replace function decide_approval(p_id uuid, p_approve boolean) returns approvals
language plpgsql security definer set search_path = public as $$
declare a approvals; pl jsonb;
begin
  if not has_permission('approval.grant') then raise exception 'not permitted'; end if;
  select * into a from approvals where id = p_id for update;
  if not found then raise exception 'approval not found'; end if;
  if a.status <> 'pending' then raise exception 'already decided'; end if;
  if a.requested_by = auth.uid() then raise exception 'you cannot approve your own request'; end if;
  update approvals set status = case when p_approve then 'approved' else 'rejected' end,
                       approved_by = auth.uid(), decided_at = now()
   where id = p_id returning * into a;
  pl := a.payload;
  if p_approve and a.kind = 'stock_out' then
    perform _post_out((pl->>'product_id')::uuid, (pl->>'qty')::numeric, (pl->>'type')::movement_type,
                      a.reason, a.requested_by, a.id, 'appr:' || a.id);
  elsif p_approve and a.kind = 'order_void' then
    perform _apply_void((pl->>'captain_order_id')::uuid, a.id, a.reason);
  end if;
  perform write_audit('approval.decide', 'approvals', p_id::text, null, to_jsonb(a), a.reason, a.id);
  return a;
end $$;

-- ───────────── Reconciliation: the accountant ticks off the slips collected from the stations ─────────────
create or replace function mark_slips_seen(p_ids uuid[], p_seen boolean) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not has_permission('recon.view_all') then raise exception 'not permitted'; end if;
  if p_ids is null or array_length(p_ids, 1) is null then return 0; end if;
  if exists (select 1 from captain_orders where id = any(p_ids) and day_locked(business_date)) then
    raise exception 'This day is already closed and approved'; end if;
  update captain_orders
     set seen_at = case when p_seen then now() end, seen_by = case when p_seen then auth.uid() end
   where id = any(p_ids);
  get diagnostics n = row_count;
  perform write_audit('slip.seen', 'captain_orders', null, null, jsonb_build_object('count', n, 'seen', p_seen));
  return n;
end $$;

-- Day summary: the 014 figures, plus slip counts. (Cash and M-Pesa figures are zero from now on.)
create or replace function day_summary(p_date date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r jsonb; c daily_closes;
begin
  if not has_permission('recon.view_all') then raise exception 'not permitted'; end if;
  select * into c from daily_closes where business_date = p_date and shift_id is null;
  select jsonb_build_object(
    'date', p_date,
    'sales_total',   coalesce((select sum(tt.bill_total) from tab_totals tt join tabs t on t.id = tt.tab_id where t.business_date = p_date), 0),
    'cash_expected', coalesce((select sum(expected_cash) from recon_cash where business_date = p_date), 0),
    'cash_received', coalesce((select sum(actual) from recon_cash where business_date = p_date and received), 0),
    'cash_variance', coalesce((select sum(variance) from recon_cash where business_date = p_date and received), 0),
    'cash_unreceived', (select count(*) from recon_cash where business_date = p_date and not coalesce(received, false) and expected_cash <> 0),
    'mpesa_total',    coalesce((select sum(amount) from recon_mpesa where business_date = p_date), 0),
    'mpesa_verified', coalesce((select sum(amount) from recon_mpesa where business_date = p_date and verification = 'verified'), 0),
    'mpesa_disputed', coalesce((select sum(amount) from recon_mpesa where business_date = p_date and verification = 'disputed'), 0),
    'mpesa_unverified', coalesce((select sum(amount) from recon_mpesa where business_date = p_date and verification = 'recorded'), 0),
    'mpesa_unverified_count', (select count(*) from recon_mpesa where business_date = p_date and verification = 'recorded'),
    'open_tabs', (select count(*) from tabs where business_date = p_date and status not in ('settled', 'closed_credit')),
    'open_tabs_balance', coalesce((select sum(b.balance) from tab_balances b join tabs t on t.id = b.tab_id
                                    where t.business_date = p_date and t.status not in ('settled', 'closed_credit')), 0),
    'slips_total',   (select count(*) from captain_orders where business_date = p_date and voided_at is null),
    'slips_seen',    (select count(*) from captain_orders where business_date = p_date and voided_at is null and seen_at is not null),
    'slips_missing', (select count(*) from captain_orders where business_date = p_date and voided_at is null and seen_at is null),
    'slips_voided',  (select count(*) from captain_orders where business_date = p_date and voided_at is not null),
    'voids_pending', (select count(*) from approvals a where a.kind = 'order_void' and a.status = 'pending'
                        and exists (select 1 from captain_orders co where co.id::text = a.payload->>'captain_order_id' and co.business_date = p_date)),
    'pending_approvals', (select count(*) from approvals where status = 'pending'),
    'count_variances', (select count(*) from stock_counts where business_date = p_date and variance <> 0),
    'close_id', c.id, 'close_status', c.status, 'close_notes', c.notes,
    'close_submitted_by', (select full_name from staff where id = c.submitted_by)
  ) into r;
  return r;
end $$;

create or replace function day_exceptions(p_date date)
returns table (kind text, detail text, amount numeric)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
begin
  if not has_permission('recon.view_all') then raise exception 'not permitted'; end if;
  return query
  select 'Slip not seen', upper(c.station) || ' slip #' || c.slip_no || ' · ' || s.full_name || ' · '
                          || coalesce('Table ' || ft.number, t.customer_name, 'Sale'),
         (select sum(i.qty * i.unit_price) from order_items i where i.captain_order_id = c.id)
    from captain_orders c join staff s on s.id = c.waiter_id join tabs t on t.id = c.tab_id
    left join floor_tables ft on ft.id = t.table_id
   where c.business_date = p_date and c.voided_at is null and c.seen_at is null
  union all
  select 'Void waiting for approval', coalesce(a.payload->>'station', '') || ' slip #' || coalesce(a.payload->>'slip_no', '?')
                                      || ' · ' || a.reason, (a.payload->>'total')::numeric
    from approvals a
   where a.kind = 'order_void' and a.status = 'pending'
     and exists (select 1 from captain_orders co where co.id::text = a.payload->>'captain_order_id' and co.business_date = p_date)
  union all
  select 'Open tab (old)', coalesce('Table ' || ft.number, t.customer_name, 'Tab') || ' · ' || s.full_name || ' · ' || t.status, b.balance
    from tabs t join staff s on s.id = t.waiter_id left join floor_tables ft on ft.id = t.table_id
    join tab_balances b on b.tab_id = t.id
   where t.business_date = p_date and t.status not in ('settled', 'closed_credit')
  union all
  select 'Cash not received', full_name || ' (' || staff_no || ')', expected_cash
    from recon_cash where business_date = p_date and not coalesce(received, false) and expected_cash <> 0
  union all
  select case when variance > 0 then 'Cash SHORTAGE' else 'Cash surplus' end,
         full_name || ' · ' || coalesce(notes, 'no note'), variance
    from recon_cash where business_date = p_date and received and variance <> 0
  union all
  select 'M-Pesa DISPUTED', code || ' · ' || waiter_name || ' · ' || coalesce(discrepancy_reason, ''), amount
    from recon_mpesa where business_date = p_date and verification = 'disputed'
  union all
  select 'M-Pesa not verified', code || ' · ' || waiter_name, amount
    from recon_mpesa where business_date = p_date and verification = 'recorded'
  union all
  select 'Stock count variance', p.name || ' · ' || coalesce(sc.explanation, 'no explanation'), sc.variance
    from stock_counts sc join products p on p.id = sc.product_id where sc.business_date = p_date and sc.variance <> 0
  union all
  select 'Approval pending', a.kind || ' · ' || a.reason, null::numeric from approvals a
   where a.status = 'pending' and a.kind <> 'order_void'
  union all
  select 'Missing unit conversion', coalesce(new_values->>'product', '?'), null::numeric
    from audit_log where action = 'stock.conversion_missing' and business_date(at) = p_date;
end $$;

-- Daily close: slips not seen and voids still waiting now block a clean close (same rule as open items before)
create or replace function submit_daily_close(p_date date, p_notes text)
returns daily_closes language plpgsql security definer set search_path = public as $$
declare d daily_closes; s jsonb; blockers int; st text;
begin
  if not has_permission('close.submit') then raise exception 'not permitted'; end if;
  if p_date > business_date(now()) then raise exception 'cannot close a future day'; end if;
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

-- ───────────── Owner report: who sold what, and when ─────────────
-- Every sold line with its time, waiter, slip and table, plus every void. Voided lines are not sales.
create or replace function report_sales_log(p_start date, p_end date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r jsonb;
begin
  if not has_permission('report.sales') then raise exception 'not permitted'; end if;
  if p_start is null or p_end is null or p_end < p_start then raise exception 'choose a valid period'; end if;
  if p_end - p_start > 31 then raise exception 'choose a period of 32 days or less for the sales log'; end if;

  with s as (select * from _sold_lines(p_start, p_end))
  select jsonb_build_object(
    'period', jsonb_build_object('start', p_start, 'end', p_end),
    'total', coalesce((select sum(line_total) from s), 0),
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object(
               'time', o.created_at, 'order_no', o.ticket_no, 'slip_no', c.slip_no, 'station', c.station,
               'waiter', w.full_name, 'place', coalesce('Table ' || ft.number, t.customer_name),
               'product', p.name, 'qty', s.qty, 'unit_price', s.unit_price, 'total', s.line_total)
             order by o.created_at, o.ticket_no, p.name)
      from s
      join order_items i on i.id = s.item_id
      join orders o on o.id = i.order_id
      join tabs t on t.id = s.tab_id
      join staff w on w.id = s.waiter_id
      join products p on p.id = s.product_id
      left join captain_orders c on c.id = i.captain_order_id
      left join floor_tables ft on ft.id = t.table_id), '[]'::jsonb),
    'voids', coalesce((
      select jsonb_agg(jsonb_build_object(
               'time', c.voided_at, 'slip_no', c.slip_no, 'station', c.station, 'waiter', w.full_name,
               'voided_by', vb.full_name, 'reason', c.void_reason,
               'total', (select coalesce(sum(i.qty * i.unit_price), 0) from order_items i where i.captain_order_id = c.id))
             order by c.voided_at)
      from captain_orders c
      join staff w on w.id = c.waiter_id
      left join staff vb on vb.id = c.voided_by
      where c.voided_at is not null and business_date(c.voided_at) between p_start and p_end), '[]'::jsonb)
  ) into r;
  return r;
end $$;

-- ───────────── Profit report: a voided bar sale returns its stock, so it also takes its cost back ─────────────
-- Same as 016 except the bar_mv line.
create or replace function report_profit(p_start date, p_end date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r jsonb;
begin
  if not has_permission('report.profit') then raise exception 'not permitted'; end if;
  if p_start is null or p_end is null or p_end < p_start then raise exception 'choose a valid period'; end if;
  if p_end - p_start > 400 then raise exception 'choose a period of 400 days or less'; end if;

  with s as (select sl.*, p.station::text as station from _sold_lines(p_start, p_end) sl join products p on p.id = sl.product_id),
  sales_by as (select station, sum(line_total) as v from s group by 1),
  adj as (select coalesce(sum(amount), 0) as v from tab_adjustments where business_date(at) between p_start and p_end),
  bar_mv as (select product_id, sum(case when type = 'approved_return' then -qty_base else qty_base end) as qty from stock_movements
              where (type in ('tab_sale', 'direct_sale') or (type = 'approved_return' and ref_table = 'order_items'))
                and business_date(at) between p_start and p_end group by 1),
  bar_sold as (select product_id, sum(qty) as qty, sum(line_total) as sales from s where station = 'bar' group by 1),
  bar_rows as (
    select p.id, p.name, coalesce(bs.qty, 0) as qty_sold, coalesce(bs.sales, 0) as sales,
           coalesce(bm.qty, 0) as qty_base, uc.c as unit_cost, p.base_unit,
           round(coalesce(bm.qty, 0) * coalesce(uc.c, 0), 2) as cost
    from products p
    left join bar_sold bs on bs.product_id = p.id
    left join bar_mv bm on bm.product_id = p.id
    cross join lateral (select _unit_cost(p.id, p_end) as c) uc
    where bs.product_id is not null or bm.product_id is not null),
  food_mv as (
    select m.product_id, l.kind::text as kind,
           sum(case when m.from_location = l.id then m.qty_base else 0 end)
         - sum(case when m.to_location = l.id and m.type <> 'purchase' then m.qty_base else 0 end) as used
    from stock_movements m join locations l on l.id in (m.to_location, m.from_location)
    where l.kind in ('kitchen', 'choma') and l.custodian_id is null and business_date(m.at) between p_start and p_end
    group by m.product_id, l.kind),
  food_rows as (
    select p.name, f.kind, p.base_unit, f.used as qty_used, uc.c as unit_cost, round(f.used * coalesce(uc.c, 0), 2) as cost
    from food_mv f join products p on p.id = f.product_id
    cross join lateral (select _unit_cost(p.id, p_end) as c) uc
    where f.used <> 0),
  loss_mv as (
    select m.type::text as kind, p.name, p.base_unit, sum(m.qty_base) as qty,
           round(sum(m.qty_base) * coalesce(_unit_cost(p.id, p_end), 0), 2) as cost
    from stock_movements m join products p on p.id = m.product_id
    where m.type in ('wastage', 'breakage', 'complimentary', 'staff_meal') and business_date(m.at) between p_start and p_end
    group by m.type, p.id, p.name, p.base_unit),
  loss_cnt as (   -- count differences in the bar and store are stock lost (kitchen/choma differences are the "food used" above)
    select 'count_difference'::text as kind, p.name, p.base_unit, -sum(c.variance) as qty,
           round(-sum(c.variance) * coalesce(_unit_cost(p.id, p_end), 0), 2) as cost
    from stock_counts c join locations l on l.id = c.location_id join products p on p.id = c.product_id
    where l.kind in ('main_bar', 'store') and c.business_date between p_start and p_end and c.variance <> 0
    group by p.id, p.name, p.base_unit),
  loss as (select * from loss_mv union all select * from loss_cnt),
  exp as (select e.category, sum(e.amount) as v from expenses e
           where e.business_date between p_start and p_end and e.category <> 'Supplier payment'
             and not exists (select 1 from expense_voids v where v.expense_id = e.id)
           group by 1),
  t as (select
      coalesce((select v from sales_by where station = 'bar'), 0) as s_bar,
      coalesce((select v from sales_by where station = 'kitchen'), 0) as s_kitchen,
      coalesce((select v from sales_by where station = 'choma'), 0) as s_choma,
      coalesce((select v from sales_by where station = 'none'), 0) as s_none,
      coalesce((select sum(v) from sales_by), 0) as gross,
      (select v from adj) as adjustments,
      coalesce((select sum(cost) from bar_rows), 0) as bar_cost,
      coalesce((select sum(cost) from food_rows), 0) as food_cost,
      coalesce((select sum(cost) from loss), 0) as loss_total,
      coalesce((select sum(v) from exp), 0) as exp_total)
  select jsonb_build_object(
    'period', jsonb_build_object('start', p_start, 'end', p_end),
    'sales', jsonb_build_object('bar', t.s_bar, 'kitchen', t.s_kitchen, 'choma', t.s_choma, 'untracked', t.s_none,
                                'gross', t.gross, 'adjustments', t.adjustments, 'net', t.gross - t.adjustments),
    'cost', jsonb_build_object('bar', t.bar_cost, 'food_used', t.food_cost, 'total', t.bar_cost + t.food_cost),
    'gross_profit', t.gross - t.adjustments - t.bar_cost - t.food_cost,
    'losses_total', t.loss_total,
    'expenses_total', t.exp_total,
    'operating_result', t.gross - t.adjustments - t.bar_cost - t.food_cost - t.loss_total - t.exp_total,
    'bar_rows', coalesce((select jsonb_agg(jsonb_build_object('product', name, 'unit', base_unit, 'qty_sold', qty_sold, 'sales', sales, 'qty_base', qty_base, 'unit_cost', unit_cost, 'cost', case when unit_cost is null then null else cost end, 'margin', case when unit_cost is null then null else sales - cost end) order by sales desc, name) from bar_rows), '[]'::jsonb),
    'food_rows', coalesce((select jsonb_agg(jsonb_build_object('product', name, 'location', kind, 'unit', base_unit, 'qty_used', qty_used, 'unit_cost', unit_cost, 'cost', cost) order by cost desc, name) from food_rows), '[]'::jsonb),
    'loss_rows', coalesce((select jsonb_agg(jsonb_build_object('type', kind, 'product', name, 'unit', base_unit, 'qty', qty, 'cost', cost) order by kind, cost desc) from loss), '[]'::jsonb),
    'expense_rows', coalesce((select jsonb_agg(jsonb_build_object('category', category, 'amount', v) order by v desc) from exp), '[]'::jsonb),
    'flags', jsonb_build_object(
       'uncosted_products', coalesce((select jsonb_agg(distinct name) from (
            select name from bar_rows where unit_cost is null and (qty_base > 0 or sales > 0)
            union all select name from food_rows where unit_cost is null) u), '[]'::jsonb),
       'bar_items_without_stock_deduction', (select count(*) from s where station = 'bar'
            and not exists (select 1 from stock_movements m where m.ref_table = 'order_items' and m.ref_id = s.item_id)),
       'counts', coalesce((select jsonb_object_agg(kind, jsonb_build_object('products', n, 'first', first_d, 'last', last_d)) from (
            select l.kind::text as kind, count(distinct c.product_id) as n, min(c.business_date) as first_d, max(c.business_date) as last_d
            from stock_counts c join locations l on l.id = c.location_id
            where l.kind in ('kitchen', 'choma') and c.business_date between p_start and p_end group by l.kind) k), '{}'::jsonb))
  ) into r from t;
  return r;
end $$;

-- ───────────── Who may call what ─────────────
revoke execute on function slip_station(station), sale_json(uuid), _apply_void(uuid, uuid, text) from public, anon;
revoke execute on function submit_sale(uuid, text, jsonb, text, text), log_reprint(uuid, uuid),
  request_void(uuid, text, text), mark_slips_seen(uuid[], boolean), report_sales_log(date, date),
  decide_approval(uuid, boolean), day_summary(date), day_exceptions(date), submit_daily_close(date, text)
  from public, anon;
grant execute on function submit_sale(uuid, text, jsonb, text, text), log_reprint(uuid, uuid),
  request_void(uuid, text, text), mark_slips_seen(uuid[], boolean), report_sales_log(date, date),
  decide_approval(uuid, boolean), day_summary(date), day_exceptions(date), submit_daily_close(date, text)
  to authenticated;

-- ───────────── CHECK ─────────────
select 'captain_orders' as thing, count(*) as rows_now from captain_orders;
