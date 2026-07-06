-- Batched nanopayments: one x402 payment can now cover several usage-units (seconds, GBs),
-- so a charge row records how many units its amount bought. Every pre-existing row was one
-- payment for one unit, which the default preserves. seq becomes "first unit this charge
-- covers": for the legacy one-unit rows that is exactly the value 0018 renumbered them to,
-- and (rent_id, seq) stays unique because charges are contiguous and units >= 1.
alter table charges add column if not exists units integer not null default 1;
alter table charges add constraint charges_units_positive check (units >= 1);
