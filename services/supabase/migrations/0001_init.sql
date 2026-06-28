-- prime-compute registry schema (Plan 2)

create table if not exists providers (
  id uuid primary key default gen_random_uuid(),
  alias text not null,
  owner_wallet text not null,
  endpoint_url text not null,
  resource_type text not null check (resource_type in ('GPU','CPU','Storage','Full Server')),
  region text not null,
  specs jsonb not null default '{}',
  online boolean not null default true,
  stake_amount numeric not null default 0,
  price_per_charge numeric not null,
  compute_score numeric not null default 80,
  avg_latency_ms numeric not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists rents (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  user_id text not null,
  resource_type text not null check (resource_type in ('GPU','CPU','Storage','Full Server')),
  region text,
  estimated_usage numeric,
  autonomy_armed boolean not null default false,
  status text not null default 'queued'
    check (status in ('queued','running','paused','completed','cancelled','failed')),
  provider_id uuid references providers(id),
  total_cost numeric not null default 0,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  ended_at timestamptz
);

create table if not exists rent_decisions (
  id uuid primary key default gen_random_uuid(),
  rent_id uuid not null references rents(id) on delete cascade,
  candidates jsonb not null default '[]',
  chosen_provider_id uuid references providers(id),
  rationale text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists charges (
  id uuid primary key default gen_random_uuid(),
  rent_id uuid not null references rents(id) on delete cascade,
  provider_id uuid not null references providers(id),
  seq integer not null,
  amount numeric not null,
  authorization_ref text,
  settled boolean not null default false,
  settlement_ref text,
  created_at timestamptz not null default now()
);

create table if not exists settlements (
  id uuid primary key default gen_random_uuid(),
  batch_ref text,
  tx_hash text,
  charge_ids uuid[] not null default '{}',
  amount numeric not null default 0,
  status text not null default 'pending',
  created_at timestamptz not null default now()
);

create index if not exists idx_charges_rent on charges(rent_id);
create index if not exists idx_rents_status on rents(status);
create index if not exists idx_providers_type_online on providers(resource_type, online);
