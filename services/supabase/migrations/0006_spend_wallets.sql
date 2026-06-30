-- Per-user Arc spend wallet. The EOA that streams a user's nano-payments and whose
-- balance the app shows. The passkey Modular Wallet stays identity-only; this is the
-- payer. enc_private_key is AES-256-GCM ciphertext (Web Crypto, key = SPEND_WALLET_ENC_KEY)
-- and is service-role only: NO client RLS policy, never selectable from the browser,
-- never returned by any server function.

create table if not exists spend_wallets (
  user_id uuid primary key references auth.users(id) on delete cascade,
  address text not null unique,
  enc_private_key text not null,
  created_at timestamptz not null default now()
);

-- RLS on with no policies = service role only (the app already talks to this table
-- exclusively through the service-role client). This DB is shared with PrimeBot;
-- this table is new and unreferenced by it.
alter table spend_wallets enable row level security;
