-- services/supabase/migrations/0009_platform_fee.sql
-- Provider-side platform fee: the renter pays the listed (gross) price; the provider's
-- endpoint charges net; the difference streams to the treasury per tick as its own
-- nano-payment. fee_amount is atomic USDC like amount; fee_settlement_ref is the fee
-- payment's batch ref (null = the fee tick didn't land yet; the terminal sweep catches it).
alter table charges add column if not exists fee_amount numeric not null default 0;
alter table charges add column if not exists fee_settlement_ref text;
alter table rents add column if not exists fees_swept_at timestamptz;
