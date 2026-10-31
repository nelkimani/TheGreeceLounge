-- The Gliz Lounge POS — 021: the real floor plan, 30 tables (numbered 1 to 30)
-- Run once in the Supabase SQL Editor, after 018. Safe to run again.
--
-- Tables 1-12 already exist as "Demo table 1..12": they are renamed (so any tab already on them is untouched).
-- Tables 13-30 are added. The waiter screen shows them as "Table 1" ... "Table 30".

insert into floor_tables(number, label)
select n::text, 'Table ' || n from generate_series(1, 30) n
on conflict (number) do update set label = excluded.label;

-- CHECK: should show 30 tables and 0 still called "Demo"
select count(*) as tables, count(*) filter (where label ilike 'demo%') as still_demo from floor_tables;
