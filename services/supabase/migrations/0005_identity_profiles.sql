-- Phase 0 identity. The wallet is the permanent identity anchor; auth.users.id is today's
-- replaceable session-provider key. profiles is the only provisioned record (the profile IS
-- the seed: no preferences, flags, balances, or sample data).

create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  wallet_address text not null unique,         -- C2: one wallet, one user. Canonical anchor.
  wallet_id text,                              -- Circle's account handle (operational metadata).
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- wallet_address is the identity: immutable once set (a different wallet is a different user).
create or replace function enforce_wallet_address_immutable()
returns trigger language plpgsql as $$
begin
  if new.wallet_address is distinct from old.wallet_address then
    raise exception 'wallet_address is immutable';
  end if;
  new.updated_at := now();
  return new;
end; $$;

drop trigger if exists profiles_wallet_address_immutable on profiles;
create trigger profiles_wallet_address_immutable
  before update on profiles
  for each row execute function enforce_wallet_address_immutable();

-- C4: atomic provisioning. A profile is created in the same transaction as its auth user,
-- reading the wallet from the user metadata set at creation time. A user can never exist
-- without a profile. wallet_address is normalized to lower-case so C2 holds case-insensitively.
-- IMPORTANT: this project's auth.users is shared with PrimeBot, which also uses Supabase Auth.
-- The trigger fires for EVERY auth.users insert, so it is a NO-OP unless our wallet_address
-- metadata is present, leaving PrimeBot's (and any other) auth-user creation untouched.
create or replace function handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.raw_user_meta_data ? 'wallet_address' then
    insert into profiles (id, wallet_address, wallet_id)
    values (
      new.id,
      lower(new.raw_user_meta_data->>'wallet_address'),
      new.raw_user_meta_data->>'wallet_id'
    );
  end if;
  return new;
end; $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- RLS: a user reads and updates only their own row.
alter table profiles enable row level security;

drop policy if exists profiles_select_own on profiles;
create policy profiles_select_own on profiles
  for select using (auth.uid() = id);

drop policy if exists profiles_update_own on profiles;
create policy profiles_update_own on profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);
