-- The Glizz Lounge POS — 045: the trading day now rolls over at 08:00 (it was 05:00)
-- Run in the Supabase SQL Editor ("Run without RLS" if asked). Safe to run more than once.
-- Everything from 08:00 one morning to 07:59 the next belongs to ONE trading day. A sale at 6 am still counts for the day before.
-- Existing records keep the day they were saved with; only the cut-off for new records, and for reports that work the day out
-- from the time (sales reports, bookkeeping, trends), moves. The day-close, reconciliation and waiter clearing follow the new rule.

update business_settings set value = '8'::jsonb where key = 'day_rollover_hour';
insert into business_settings(key, value) select 'day_rollover_hour', '8'::jsonb
 where not exists (select 1 from business_settings where key = 'day_rollover_hour');

select key, value as rollover_hour,
       business_date(timestamptz '2026-11-16 07:30+03') as seven_thirty_am_counts_for,
       business_date(timestamptz '2026-11-16 08:00+03') as eight_am_counts_for
from business_settings where key = 'day_rollover_hour';
