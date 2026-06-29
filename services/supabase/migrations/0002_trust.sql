-- prime-compute trust retrofit (Plan 9): stake_amount -> TrustProfile {tier, signals}

alter table providers
  add column if not exists trust_tier text not null default 'Community'
    check (trust_tier in ('Community','Verified','Bonded','Enterprise')),
  add column if not exists trust_signals jsonb not null default
    '{"uptime":1,"successfulRentals":0,"health":"healthy","verification":false}';

alter table providers drop column if exists stake_amount;

alter table rents
  add column if not exists required_trust_tier text not null default 'Community'
    check (required_trust_tier in ('Community','Verified','Bonded','Enterprise'));
