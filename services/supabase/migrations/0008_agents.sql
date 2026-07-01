-- services/supabase/migrations/0008_agents.sql
-- Autonomous agents are a first-class principal alongside human users. They self-register, hold a
-- permanent Arc spend wallet, and authenticate with hashed API keys. Rents gain an explicit agent
-- owner beside the existing user owner (exactly one is set). Providers are unchanged (wallet-owned).
-- All new tables are service-role only (RLS on, no policies), like spend_wallets.

create table if not exists agents (
  id uuid primary key default gen_random_uuid(),
  label text,
  created_at timestamptz not null default now()
);
alter table agents enable row level security;

create table if not exists agent_wallets (
  agent_id uuid primary key references agents(id) on delete cascade,
  address text not null unique,
  enc_private_key text not null,
  created_at timestamptz not null default now()
);
alter table agent_wallets enable row level security;

create table if not exists agent_api_keys (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references agents(id) on delete cascade,
  key_hash text not null unique,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);
alter table agent_api_keys enable row level security;
create index if not exists agent_api_keys_agent_id_idx on agent_api_keys (agent_id);

-- Rent ownership: user_id becomes nullable, add agent_id, exactly one must be set.
alter table rents alter column user_id drop not null;
alter table rents add column if not exists agent_id text;
alter table rents drop constraint if exists rents_one_owner;
alter table rents add constraint rents_one_owner
  check ((user_id is not null) <> (agent_id is not null));
