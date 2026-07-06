-- total_cost was stamped from a charge sum that silently truncated at 1000 rows (same root
-- cause 0018 repaired), so long leases displayed an undercounted "charged so far". Re-derive
-- every rent's total from its actual charges; the metering worker keeps it in sync from here.
-- (Running leases self-heal on their next tick anyway; this repairs the finished ones that
-- nothing recomputes anymore.)

update rents r
set total_cost = coalesce(c.real_total, 0)
from (select rent_id, sum(amount) as real_total from charges group by rent_id) c
where c.rent_id = r.id and r.total_cost <> c.real_total;

update rents r
set total_cost = 0
where total_cost <> 0 and not exists (select 1 from charges ch where ch.rent_id = r.id);
