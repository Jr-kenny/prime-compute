-- The metering worker used to derive a charge's seq from a row count that silently capped at
-- 1000 (PostgREST's default response limit), so any lease that lived past ~1000 charges wrote
-- duplicate seqs from there on. Renumber every rent's charges by insertion order to repair the
-- ledger, then add the unique index the table should have had from day one so any future
-- counting regression fails loudly at insert time instead of quietly corrupting the audit trail.

with renumbered as (
  select id, row_number() over (partition by rent_id order by created_at, id) - 1 as new_seq
  from charges
)
update charges c
set seq = r.new_seq
from renumbered r
where c.id = r.id and c.seq is distinct from r.new_seq;

create unique index if not exists charges_rent_id_seq_key on charges (rent_id, seq);
