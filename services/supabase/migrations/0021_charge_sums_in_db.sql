-- rent_cost / billed_units were computed client-side by downloading every charge row of the
-- lease on every meter tick, so egress grew with the square of a lease's lifetime: a 6h
-- per-second lease re-fetched ~12k rows several times per pass, which is what exhausted the
-- plan's egress quota. Sum where the rows live; one number leaves the database per call.
create or replace function rent_cost(p_rent_id uuid) returns numeric language sql stable as $$
  select coalesce(sum(amount), 0) from charges where rent_id = p_rent_id;
$$;

create or replace function billed_units(p_rent_id uuid) returns numeric language sql stable as $$
  select coalesce(sum(units), 0) from charges where rent_id = p_rent_id;
$$;
