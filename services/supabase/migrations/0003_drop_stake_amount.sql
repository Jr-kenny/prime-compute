-- prime-compute (Plan 9, deferred): retire the legacy stake_amount column.
-- Not yet applied to the live shared DB. The code stopped using stake_amount in
-- migration 0002; this drop is the cleanup, kept separate so the destructive change
-- is an explicit, deliberate step. Run it once you're comfortable removing the column.

alter table providers drop column if exists stake_amount;
