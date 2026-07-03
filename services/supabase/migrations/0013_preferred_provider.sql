-- 0013_preferred_provider.sql
-- "Rent from X" pins the provider the renter picked. We start the lease on that exact
-- provider and only let the broker migrate away if it later degrades. Nullable: an unset
-- value means the broker picks freely by score, same as before.
alter table rents add column if not exists preferred_provider_id text;
