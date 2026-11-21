-- The Glizz Lounge POS — 046: void ONE item of a receipt, or the whole receipt
-- Run in the Supabase SQL Editor ("Run without RLS" if asked). Run after 035 (and 041). Safe to run more than once.
--
-- WHAT IT DOES
--   request_void_item(item, reason, key)   voids one line of a captain order. Manager only (approval.grant), same rule as 035.
--                                          Applies at once, puts bar stock back for that line, is logged. If it was the last live
--                                          line on the slip, the slip becomes VOIDED as well.
--   request_void_order(order, reason, key) voids every live slip of a receipt in one go (the "whole receipt" void).
--   sales_slips                            each line now carries its id, whether it is voided and why; "total" no longer counts
--                                          voided lines on a slip that is still live.
--   _waiter_sales                          (041) a voided line is no longer counted in what a waiter sold / must hand in.
--   report_sales_log                       (022) the Voids table lists item voids as well as whole-slip voids.
--
-- WHAT STAYS THE SAME
--   Voiding a whole slip (request_void), Approvals, the audit trail, the VOID slip, and every sales report: those already
--   read only lines with status 'served', so a voided line drops out of sales, profit, trends and "My sales" by itself.
--   Nothing is deleted; a day that is approved and locked still cannot be changed.

-- ───────────── Slips as the screens read them: lines carry id + voided flag ─────────────
create or replace view sales_slips with (security_invoker = false) as
select c.id as captain_order_id, c.slip_no, c.order_id, o.ticket_no as order_no, c.station, c.business_date, c.created_at,
       c.waiter_id, s.full_name as waiter_name, ft.number as table_number, t.customer_name,
       (select jsonb_agg(jsonb_build_object('id', i.id, 'qty', i.qty, 'name', p.name, 'price', i.unit_price, 'notes', i.notes,
                                            'voided', (i.status = 'cancelled' or c.voided_at is not null),
                                            'void_reason', i.cancel_reason) order by p.name, i.created_at)
          from order_items i join products p on p.id = i.product_id where i.captain_order_id = c.id) as lines,
       -- a live slip counts only its live lines; a voided slip keeps its original value (what was voided)
       (select coalesce(sum(i.qty * i.unit_price), 0) from order_items i
         where i.captain_order_id = c.id and (i.status <> 'cancelled' or c.voided_at is not null)) as total,
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

-- ───────────── Void one line ─────────────
create or replace function _apply_void_item(p_item uuid, p_approval uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare i order_items; c captain_orders; m stock_movements; live int;
begin
  select * into i from order_items where id = p_item for update;
  if not found then raise exception 'item not found'; end if;
  if i.captain_order_id is null then raise exception 'this line is not on a captain order'; end if;
  select * into c from captain_orders where id = i.captain_order_id for update;
  if c.voided_at is not null or i.status = 'cancelled' then return; end if;      -- already done
  if day_locked(c.business_date) then raise exception 'This day is already closed and approved'; end if;

  update order_items set status = 'cancelled', cancel_reason = p_reason, cancel_approval_id = p_approval where id = i.id;
  insert into order_item_events(item_id, status, actor_id) values (i.id, 'cancelled', auth.uid());
  if i.station = 'bar' then                                                       -- put the bottle back on the bar book
    select * into m from stock_movements
     where ref_table = 'order_items' and ref_id = i.id and from_location is not null and to_location is null
     order by at limit 1;
    if found then
      insert into stock_movements(product_id, from_location, to_location, qty_base, type, ref_table, ref_id,
                                  shift_id, actor_id, approval_id, reverses_id, idempotency_key, note)
      values (m.product_id, null, loc('main_bar'), m.qty_base, 'approved_return', 'order_items', i.id,
              current_shift(), auth.uid(), p_approval, m.id, 'void:' || i.id, 'Void of item on slip ' || c.slip_no)
      on conflict (idempotency_key) do nothing;
    end if;
  end if;

  select count(*) into live from order_items where captain_order_id = c.id and status <> 'cancelled';
  if live = 0 then                                                                -- last line gone: the whole slip is void
    update captain_orders set voided_at = now(), voided_by = auth.uid(), void_reason = p_reason, void_approval_id = p_approval
     where id = c.id;
  end if;
  perform write_audit('item.void', 'order_items', i.id::text, null,
                      jsonb_build_object('slip_no', c.slip_no, 'station', c.station, 'product_id', i.product_id,
                                         'qty', i.qty, 'slip_voided', live = 0), p_reason, p_approval);
end $$;

create or replace function request_void_item(p_item uuid, p_reason text, p_key text) returns approvals
language plpgsql security definer set search_path = public as $$
declare i order_items; c captain_orders; a approvals; v_name text; v_payload jsonb;
begin
  if not has_permission('approval.grant') then raise exception 'only a manager can void an item'; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'write the reason for the void'; end if;
  select * into a from approvals where kind = 'order_void' and requested_by = auth.uid() and payload->>'key' = p_key;
  if found then return a; end if;                                                 -- retry-safe
  select * into i from order_items where id = p_item;
  if not found or i.captain_order_id is null then raise exception 'item not found'; end if;
  select * into c from captain_orders where id = i.captain_order_id for update;
  if c.voided_at is not null then raise exception 'this slip is already voided'; end if;
  if i.status = 'cancelled' then raise exception 'this item is already voided'; end if;

  select p.name into v_name from products p where p.id = i.product_id;
  v_payload := jsonb_build_object('captain_order_id', c.id, 'item_id', i.id, 'slip_no', c.slip_no, 'station', c.station,
                                  'summary', trim_scale(i.qty)::text || ' x ' || v_name, 'total', i.qty * i.unit_price, 'key', p_key);
  insert into approvals(kind, requested_by, approved_by, reason, status, payload, decided_at)
  values ('order_void', auth.uid(), null, p_reason, 'approved', v_payload, now()) returning * into a;
  perform _apply_void_item(p_item, a.id, p_reason);
  return a;
end $$;

-- ───────────── Void the whole receipt (every live slip of the order) ─────────────
create or replace function request_void_order(p_order uuid, p_reason text, p_key text) returns int
language plpgsql security definer set search_path = public as $$
declare c captain_orders; n int := 0;
begin
  if not has_permission('approval.grant') then raise exception 'only a manager can void an order'; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'write the reason for the void'; end if;
  for c in select * from captain_orders where order_id = p_order and voided_at is null order by slip_no loop
    perform request_void(c.id, p_reason, p_key || ':' || c.id::text);
    n := n + 1;
  end loop;
  if n = 0 then raise exception 'this receipt has nothing left to void'; end if;
  return n;
end $$;

-- ───────────── A voided line is not what the waiter sold (clearing, day summary) ─────────────
create or replace function _waiter_sales(p_date date)
returns table (waiter_id uuid, product_id uuid, product text, qty numeric, total numeric, orders bigint)
language sql stable security definer set search_path = public as $$
  select c.waiter_id, i.product_id, p.name, sum(i.qty), sum(i.qty * i.unit_price), count(distinct c.order_id)
  from order_items i
  join captain_orders c on c.id = i.captain_order_id
  join products p on p.id = i.product_id
  where c.business_date = p_date and c.voided_at is null and i.status <> 'cancelled'
  group by c.waiter_id, i.product_id, p.name
$$;

-- ───────────── Sales log: voids list now shows single items too ─────────────
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
      select jsonb_agg(v.j order by v.at)
      from (
        -- whole-slip voids: value = the lines that void took out (an item voided earlier is listed on its own row)
        select c.voided_at as at,
               jsonb_build_object('time', c.voided_at, 'slip_no', c.slip_no, 'station', c.station, 'waiter', w.full_name,
                                  'voided_by', vb.full_name, 'reason', c.void_reason, 'item', 'Whole slip',
                                  'total', (select coalesce(sum(i.qty * i.unit_price), 0) from order_items i
                                             where i.captain_order_id = c.id
                                               and (i.cancel_approval_id is not distinct from c.void_approval_id or c.void_approval_id is null))) as j
        from captain_orders c
        join staff w on w.id = c.waiter_id
        left join staff vb on vb.id = c.voided_by
        left join approvals ap on ap.id = c.void_approval_id
        where c.voided_at is not null and not coalesce(ap.payload ? 'item_id', false)
          and business_date(c.voided_at) between p_start and p_end
        union all
        -- single-item voids
        select a.decided_at,
               jsonb_build_object('time', a.decided_at, 'slip_no', c.slip_no, 'station', c.station, 'waiter', w.full_name,
                                  'voided_by', vb.full_name, 'reason', a.reason, 'item', trim_scale(i.qty)::text || ' x ' || p.name,
                                  'total', i.qty * i.unit_price)
        from order_items i
        join approvals a on a.id = i.cancel_approval_id and a.payload ? 'item_id'
        join captain_orders c on c.id = i.captain_order_id
        join products p on p.id = i.product_id
        join staff w on w.id = c.waiter_id
        left join staff vb on vb.id = a.requested_by
        where i.status = 'cancelled' and business_date(a.decided_at) between p_start and p_end
      ) v), '[]'::jsonb)
  ) into r;
  return r;
end $$;

-- ───────────── Who may call what ─────────────
revoke execute on function _apply_void_item(uuid, uuid, text), request_void_item(uuid, text, text),
  request_void_order(uuid, text, text), _waiter_sales(date), report_sales_log(date, date) from public, anon;
grant execute on function request_void_item(uuid, text, text), request_void_order(uuid, text, text),
  report_sales_log(date, date) to authenticated;
notify pgrst, 'reload schema';

-- CHECK: the three new functions exist (expect 3)
select count(*) as functions_found from pg_proc where proname in ('_apply_void_item', 'request_void_item', 'request_void_order');
