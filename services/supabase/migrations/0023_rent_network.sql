-- 0023_rent_network.sql
-- Private connectivity for a lease. When Lumen opens a lease it can mint a VPN auth key
-- (stored in the existing lease_access_token) and record the box's private hostname here,
-- so the renter reaches the rented machine over an isolated overlay instead of a raw
-- endpoint. network_status carries the fail-soft marker ("provisioned" | "unprovisioned")
-- so a later worker pass can retry a lease whose connectivity never landed at open.
-- Both nullable: null means no network service is configured (the default, unchanged path).
alter table rents add column if not exists network_hostname text;
alter table rents add column if not exists network_status text;
