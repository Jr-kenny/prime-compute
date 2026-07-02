-- Identity v2: the Circle user-controlled login id, stored alongside the wallet anchor.
-- Operational metadata only — wallet_address stays the unique immutable identity (C1-C5).
alter table profiles add column if not exists circle_user_id text;
