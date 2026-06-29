-- prime-compute trust retrofit (Plan 9): stake_amount -> TrustProfile {tier, signals}
-- Additive only. The matching stake_amount drop is a separate, deferred migration
-- (0003_drop_stake_amount.sql) so the live shared DB never takes a destructive change
-- without an explicit decision. The code no longer reads or writes stake_amount.

alter table providers
  add column if not exists trust_tier text not null default 'Community'
    check (trust_tier in ('Community','Verified','Bonded','Enterprise')),
  add column if not exists trust_signals jsonb not null default
    '{"uptime":1,"successfulRentals":0,"health":"healthy","verification":false}';

alter table rents
  add column if not exists required_trust_tier text not null default 'Community'
    check (required_trust_tier in ('Community','Verified','Bonded','Enterprise'));
