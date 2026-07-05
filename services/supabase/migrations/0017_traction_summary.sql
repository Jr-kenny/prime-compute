-- 0017_traction_summary.sql
-- Read-only aggregate for daily traction reporting (the `bun run traction` script calls this).
-- Not exposed to the browser: execute is revoked from anon/authenticated and granted only to
-- service_role, which the script uses. Pure select, no writes.
create or replace function public.traction_summary()
returns jsonb
language sql
stable
as $$
  select jsonb_build_object(
    'as_of', now(),
    'volume_usdc', round((coalesce((select sum(amount) from charges), 0) / 1e6)::numeric, 6),
    'nanopayments', (select count(*) from charges),
    'gateway_transfers', (select count(distinct settlement_ref) from charges where settlement_ref is not null),
    'rents_total', (select count(*) from rents),
    'rents_active', (select count(*) from rents where status in ('running','queued','suspended')),
    'rents_completed', (select count(*) from rents where status = 'completed'),
    'users', (select count(distinct user_id) from rents where user_id is not null),
    'agents', (select count(distinct agent_id) from rents where agent_id is not null),
    'providers_online', (select count(*) from providers where online),
    'first_charge', (select min(created_at) from charges),
    'last_charge', (select max(created_at) from charges)
  );
$$;

revoke all on function public.traction_summary() from public, anon, authenticated;
grant execute on function public.traction_summary() to service_role;