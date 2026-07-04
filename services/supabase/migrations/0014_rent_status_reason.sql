-- 0014_rent_status_reason.sql
-- A suspend used to lose its cause: the worker set status="suspended" and the UI
-- guessed "spend wallet ran low", which is wrong whenever the real cause is a funding
-- or gateway error (bad provider deposit, Circle exec failure). We now stash the actual
-- message so the dashboard shows the truth and we can diagnose without the worker logs.
-- Nullable: null means "no failure recorded" (the normal case for healthy leases).
alter table rents add column if not exists status_reason text;
