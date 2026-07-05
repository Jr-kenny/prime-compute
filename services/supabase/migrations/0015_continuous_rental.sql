-- 0015_continuous_rental.sql
-- Continuous rental: leases run until cancelled or the wallet runs dry, not to a fixed
-- estimate. Optional caps let a renter bound a continuous lease by spend or by time, and
-- suspended_at drives the grace window before a balance-suspended lease is terminated.
-- All nullable/additive: existing rows read as "continuous, no cap, not suspended".
alter table rents add column if not exists max_spend_atomic bigint;
alter table rents add column if not exists expires_at timestamptz;
alter table rents add column if not exists suspended_at timestamptz;
