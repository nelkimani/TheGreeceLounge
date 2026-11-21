-- The Glizz Lounge POS — 049: the counter (bartender) can void ITEMS on a receipt; waiters cannot
-- Run in the Supabase SQL Editor ("Run without RLS" if asked). Run after 046. Safe to run more than once.
--
-- WHAT IT DOES
--   New permission order.void ("Void items on a receipt"), given to Bartender (the counter) and Manager. Waiters do not get it.
--   request_void_item (046) now needs order.void instead of approval.grant. The void applies at once, puts the item's stock
--   back on the bar and takes it out of sales, the waiter's day total and every report, and is logged under the counter
--   person's name (the sales-log Voids table shows who voided it and why).
--   sales_slips: whoever holds order.void can now see today's receipts of all waiters, so the counter can find the item to void.
--
-- WHAT STAYS THE SAME
--   Voiding a WHOLE slip or a WHOLE receipt is still manager-only (approval.grant). Counter staff void item by item.
--   A day that is approved and locked still cannot be changed. Nothing is deleted.
--   To give the same right to another role (or take it from the bartender) change role_permissions; no code change is needed.

insert into permissions(code, description) values ('order.void', 'Void items on a receipt')
on conflict (code) do nothing;
insert into role_permissions(role_code, permission_code) values ('bartender', 'order.void'), ('manager', 'order.void')
on conflict do nothing;

create or replace function request_void_item(p_item uuid, p_reason text, p_key text) returns approvals
language plpgsql security definer set search_path = public as $$
declare i order_items; c captain_orders; a approvals; v_name text; v_payload jsonb;
begin
  if not has_permission('order.void') then raise exception 'only the counter or a manager can void an item'; end if;
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

create or replace view sales_slips with (security_invoker = false) as
select c.id as captain_order_id, c.slip_no, c.order_id, o.ticket_no as order_no, c.station, c.business_date, c.created_at,
       c.waiter_id, s.full_name as waiter_name, ft.number as table_number, t.customer_name,
       (select jsonb_agg(jsonb_build_object('id', i.id, 'qty', i.qty, 'name', p.name, 'price', i.unit_price, 'notes', i.notes,
                                            'voided', (i.status = 'cancelled' or c.voided_at is not null),
                                            'void_reason', i.cancel_reason) order by p.name, i.created_at)
          from order_items i join products p on p.id = i.product_id where i.captain_order_id = c.id) as lines,
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
   or has_permission('recon.view_all') or has_permission('report.sales') or has_permission('order.void');

grant select on sales_slips to authenticated;
revoke all on sales_slips from anon;
revoke execute on function request_void_item(uuid, text, text) from public, anon;
grant execute on function request_void_item(uuid, text, text) to authenticated;
notify pgrst, 'reload schema';

-- CHECK: who can void items (expect bartender and manager)
select role_code from role_permissions where permission_code = 'order.void' order by role_code;
