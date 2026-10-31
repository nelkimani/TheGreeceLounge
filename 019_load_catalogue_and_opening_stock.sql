-- The Gliz Lounge POS — 019: load the real catalogue and opening stock (from the 02/10/2026 delivery sheet)
--
-- Run AFTER 018_go_live_reset.sql. Safe to run again: existing products are left untouched
-- (so prices you set later are NOT overwritten) and opening stock is only recorded once per product.
--
-- WHAT IT DOES
--   * Adds the 'can' unit and the categories Spirits / Soft drinks & mixers / Ready-to-drink.
--   * Creates 38 products, all on the BAR station, with NO price yet.
--     Products with no price are hidden from waiters until a selling price is set.
--   * Records opening stock for each product into the Main Bar (992 units in total),
--     counted from the delivery sheet: cases x bottles per case (Liberty and McDowell's: 10 single bottles).
--   * Spirits are sold as whole bottles (base unit and sale unit are both 'bottle'; cans are 'can').
--
-- Stock is booked to manager M001 and logged in the audit trail.

insert into units(code, name) values ('can', 'Can') on conflict do nothing;

insert into categories(name) values ('Spirits'), ('Soft drinks & mixers'), ('Ready-to-drink')
on conflict (name) do nothing;

with items(sku, name, cat, unit, liquor, qty) as (values
  ('GL-BLACK-WHITE-375ML', 'Black & White 375ml', 'Spirits', 'bottle', true, 24),
  ('GL-CAPTAIN-MORGAN-250ML', 'Captain Morgan 250ml', 'Spirits', 'bottle', true, 48),
  ('GL-CAPTAIN-MORGAN-750ML', 'Captain Morgan 750ml', 'Spirits', 'bottle', true, 12),
  ('GL-CAPTAIN-MUCKPIT-250ML', 'Captain Muckpit 250ml', 'Spirits', 'bottle', true, 24),
  ('GL-CAPTAIN-MUCKPIT-750ML', 'Captain Muckpit 750ml', 'Spirits', 'bottle', true, 12),
  ('GL-CHROME-GIN-750ML', 'Chrome Gin 750ml', 'Spirits', 'bottle', true, 12),
  ('GL-CHROME-LEMON-250ML', 'Chrome Lemon 250ml', 'Spirits', 'bottle', true, 24),
  ('GL-CHROME-VODKA-250ML', 'Chrome Vodka 250ml', 'Spirits', 'bottle', true, 48),
  ('GL-CHROME-VODKA-750ML', 'Chrome Vodka 750ml', 'Spirits', 'bottle', true, 24),
  ('GL-GILBEYS-250ML', 'Gilbeys 250ml', 'Spirits', 'bottle', true, 48),
  ('GL-GILBEYS-750ML', 'Gilbeys 750ml', 'Spirits', 'bottle', true, 12),
  ('GL-GUARANA-CAN', 'Guarana Can', 'Soft drinks & mixers', 'can', false, 48),
  ('GL-KANE-250ML', 'Kane 250ml', 'Spirits', 'bottle', true, 24),
  ('GL-KANE-750ML', 'Kane 750ml', 'Spirits', 'bottle', true, 12),
  ('GL-KC-LEMON-250ML', 'KC Lemon 250ml', 'Spirits', 'bottle', true, 48),
  ('GL-KC-LEMON-750ML', 'KC Lemon 750ml', 'Spirits', 'bottle', true, 12),
  ('GL-KC-PP-250ML', 'KC PP 250ml', 'Spirits', 'bottle', true, 48),
  ('GL-KC-PP-750ML', 'KC PP 750ml', 'Spirits', 'bottle', true, 12),
  ('GL-KC-SMOOTH-250ML', 'KC Smooth 250ml', 'Spirits', 'bottle', true, 48),
  ('GL-KC-SMOOTH-750ML', 'KC Smooth 750ml', 'Spirits', 'bottle', true, 12),
  ('GL-LIBERTY-750ML', 'Liberty 750ml', 'Spirits', 'bottle', true, 10),
  ('GL-MCDOWELL-S-750ML', 'McDowell''s 750ml', 'Spirits', 'bottle', true, 10),
  ('GL-ORIJIN-250ML', 'Orijin 250ml', 'Spirits', 'bottle', true, 24),
  ('GL-ORIJIN-750ML', 'Orijin 750ml', 'Spirits', 'bottle', true, 12),
  ('GL-PUNCH-CAN', 'Punch Can', 'Soft drinks & mixers', 'can', false, 48),
  ('GL-RICHOT-250ML', 'Richot 250ml', 'Spirits', 'bottle', true, 24),
  ('GL-RICHOT-750ML', 'Richot 750ml', 'Spirits', 'bottle', true, 12),
  ('GL-SMIRNOFF-RASPBERRY-300ML-BOTTLE', 'Smirnoff Raspberry 300ml Bottle', 'Ready-to-drink', 'bottle', true, 48),
  ('GL-SMIRNOFF-RASPBERRY-CAN', 'Smirnoff Raspberry Can', 'Ready-to-drink', 'can', true, 48),
  ('GL-SMIRNOFF-RED-250ML', 'Smirnoff Red 250ml', 'Spirits', 'bottle', true, 24),
  ('GL-SMIRNOFF-RED-750ML', 'Smirnoff Red 750ml', 'Spirits', 'bottle', true, 12),
  ('GL-SNAPP-CAN', 'Snapp Can', 'Soft drinks & mixers', 'can', false, 48),
  ('GL-TRIPLE-ACE-250ML', 'Triple Ace 250ml', 'Spirits', 'bottle', true, 24),
  ('GL-TRIPLE-ACE-750ML', 'Triple Ace 750ml', 'Spirits', 'bottle', true, 12),
  ('GL-V-A-250ML', 'V&A 250ml', 'Spirits', 'bottle', true, 24),
  ('GL-V-A-750ML', 'V&A 750ml', 'Spirits', 'bottle', true, 12),
  ('GL-VAT-69-350ML', 'Vat 69 350ml', 'Spirits', 'bottle', true, 24),
  ('GL-VAT-69-750ML', 'Vat 69 750ml', 'Spirits', 'bottle', true, 24)
), new_products as (
  insert into products(sku, name, category_id, station, is_liquor, base_unit, sale_unit, is_demo)
  select i.sku, i.name, (select id from categories where name = i.cat), 'bar'::station,
         i.liquor, i.unit, i.unit, false
  from items i
  on conflict (sku) do nothing
  returning sku
)
select count(*) as products_created from new_products;

-- Opening stock (one 'opening' movement per product, into the Main Bar; once only, keyed by SKU)
with items(sku, qty) as (values
  ('GL-BLACK-WHITE-375ML', 24),
  ('GL-CAPTAIN-MORGAN-250ML', 48),
  ('GL-CAPTAIN-MORGAN-750ML', 12),
  ('GL-CAPTAIN-MUCKPIT-250ML', 24),
  ('GL-CAPTAIN-MUCKPIT-750ML', 12),
  ('GL-CHROME-GIN-750ML', 12),
  ('GL-CHROME-LEMON-250ML', 24),
  ('GL-CHROME-VODKA-250ML', 48),
  ('GL-CHROME-VODKA-750ML', 24),
  ('GL-GILBEYS-250ML', 48),
  ('GL-GILBEYS-750ML', 12),
  ('GL-GUARANA-CAN', 48),
  ('GL-KANE-250ML', 24),
  ('GL-KANE-750ML', 12),
  ('GL-KC-LEMON-250ML', 48),
  ('GL-KC-LEMON-750ML', 12),
  ('GL-KC-PP-250ML', 48),
  ('GL-KC-PP-750ML', 12),
  ('GL-KC-SMOOTH-250ML', 48),
  ('GL-KC-SMOOTH-750ML', 12),
  ('GL-LIBERTY-750ML', 10),
  ('GL-MCDOWELL-S-750ML', 10),
  ('GL-ORIJIN-250ML', 24),
  ('GL-ORIJIN-750ML', 12),
  ('GL-PUNCH-CAN', 48),
  ('GL-RICHOT-250ML', 24),
  ('GL-RICHOT-750ML', 12),
  ('GL-SMIRNOFF-RASPBERRY-300ML-BOTTLE', 48),
  ('GL-SMIRNOFF-RASPBERRY-CAN', 48),
  ('GL-SMIRNOFF-RED-250ML', 24),
  ('GL-SMIRNOFF-RED-750ML', 12),
  ('GL-SNAPP-CAN', 48),
  ('GL-TRIPLE-ACE-250ML', 24),
  ('GL-TRIPLE-ACE-750ML', 12),
  ('GL-V-A-250ML', 24),
  ('GL-V-A-750ML', 12),
  ('GL-VAT-69-350ML', 24),
  ('GL-VAT-69-750ML', 24)
)
insert into stock_movements(product_id, from_location, to_location, qty_base, type, shift_id, actor_id, idempotency_key, note)
select p.id, null, loc('main_bar'), i.qty, 'opening', current_shift(),
       (select id from staff where staff_no = 'M001'), 'opening:' || i.sku, 'Opening stock - delivery 02/10/2026'
from items i join products p on p.sku = i.sku
on conflict (idempotency_key) do nothing;

insert into audit_log(actor_id, action, entity, reason)
select (select id from staff where staff_no = 'M001'), 'stock.opening_load', 'stock_movements',
       'Opening stock loaded from delivery sheet 02/10/2026 (38 products)'
where not exists (select 1 from audit_log where action = 'stock.opening_load');

-- ───────────── CHECK ─────────────
select count(*) as products, sum(qty_on_hand) as total_units
from (select p.id, coalesce(sum(case when m.to_location = loc('main_bar') then m.qty_base else 0 end)
                          - sum(case when m.from_location = loc('main_bar') then m.qty_base else 0 end), 0) as qty_on_hand
      from products p left join stock_movements m on m.product_id = p.id
      where p.sku like 'GL-%' group by p.id) t;
