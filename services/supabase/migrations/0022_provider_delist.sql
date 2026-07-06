-- Listings can be delisted but never hard-deleted: charges.provider_id and rents.provider_id
-- reference providers with no cascade, so the payment ledger and rent history must keep their
-- provider rows forever. A delisted provider disappears from the marketplace and from broker
-- matching (listProviders filters on this) while getProvider keeps answering for history views.
alter table providers add column if not exists delisted_at timestamptz;
