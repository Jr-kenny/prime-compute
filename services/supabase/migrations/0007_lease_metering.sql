-- services/supabase/migrations/0007_lease_metering.sql
-- The metering worker needs a recoverable balance-stall state and per-lease resumability +
-- connect credentials. Additive: widen the status check and add two nullable columns.

alter table rents drop constraint if exists rents_status_check;
alter table rents add constraint rents_status_check
  check (status in ('queued','running','paused','completed','cancelled','failed','suspended'));

alter table rents add column if not exists last_charged_at timestamptz;
alter table rents add column if not exists lease_access_token text;
