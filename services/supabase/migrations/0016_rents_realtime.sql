-- 0016_rents_realtime.sql
-- Let a signed-in user read their OWN rents directly from the browser so the dashboard can
-- subscribe to live changes (real charged total, status) instead of extrapolating an estimate.
-- Safe/additive: the server functions and the metering worker use the service-role key, which
-- bypasses RLS, so every existing read and write is unaffected; writes still go only through them.
-- The browser has never read `rents` directly, so enabling RLS breaks nothing.
alter table rents enable row level security;

drop policy if exists "rents_owner_select" on rents;
create policy "rents_owner_select" on rents
  for select using (user_id = (select auth.uid())::text);

-- Realtime needs the full row on UPDATE so the client sees total_cost/status change, and RLS can
-- be evaluated against the changed row.
alter table rents replica identity full;

-- Add the table to Supabase's realtime publication (idempotent).
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'rents'
  ) then
    alter publication supabase_realtime add table rents;
  end if;
end $$;
