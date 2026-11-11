-- The Glizz Lounge POS — 035: only a manager can void an order slip (waiters can no longer ask)
-- Run in the Supabase SQL Editor ("Run without RLS" if asked).
--
-- WHAT IT DOES
--   Replaces request_void() so it needs the approval.grant permission (manager) instead of tab.open.
--   A waiter who somehow calls it gets "only a manager can void an order". The Void button is also gone from the
--   waiter's My orders screen (app change in src/MyOrders.tsx), so this is the safety net behind it.
--
-- WHAT STAYS THE SAME
--   A manager voiding a slip: still applies at once, puts the stock back and is logged in the audit trail.
--   Approvals: any void request a waiter already sent before this change is still waiting there for a manager to
--   approve or reject. Nothing is deleted.
--   The waiter still sees "VOIDED" on a slip a manager voided and can still print the VOID slip for the station.
--
-- Safe to run more than once. It only replaces one function; no data is touched.

create or replace function request_void(p_captain uuid, p_reason text, p_key text) returns approvals
language plpgsql security definer set search_path = public as $$
declare c captain_orders; a approvals; v_sum text; v_tot numeric; v_payload jsonb;
begin
  if not has_permission('approval.grant') then raise exception 'only a manager can void an order'; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'write the reason for the void'; end if;
  select * into c from captain_orders where id = p_captain for update;
  if not found then raise exception 'slip not found'; end if;
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

  -- the caller is a manager (checked above): the void applies on his own authority, at once, and is logged
  insert into approvals(kind, requested_by, approved_by, reason, status, payload, decided_at)
  values ('order_void', auth.uid(), null, p_reason, 'approved', v_payload, now()) returning * into a;
  perform _apply_void(p_captain, a.id, p_reason);
  return a;
end $$;

-- CHECK: who holds the permission that is now required (should be managers only)
select r.code as role, count(*) filter (where rp.permission_code = 'approval.grant') as can_void
from roles r left join role_permissions rp on rp.role_code = r.code
group by r.code order by can_void desc, r.code;
