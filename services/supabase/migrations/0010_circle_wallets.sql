-- services/supabase/migrations/0010_circle_wallets.sql
-- Circle developer-controlled wallets: custody lives at Circle (MPC); we store only the
-- wallet id + address per principal. No key material, encrypted or otherwise.
create table if not exists circle_wallets (
  owner_kind text not null check (owner_kind in ('user','agent','platform')),
  owner_id text not null,
  wallet_id text not null unique,
  address text not null unique,
  created_at timestamptz not null default now(),
  primary key (owner_kind, owner_id)
);
alter table circle_wallets enable row level security;
