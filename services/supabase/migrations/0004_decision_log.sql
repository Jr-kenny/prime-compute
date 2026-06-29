-- prime-compute (Plan 10): structured runtime DecisionLog columns on rent_decisions.
-- Additive and nullable: legacy recordDecision rows leave these null; recordDecisionLog
-- rows populate them. A row is a "decision log" iff decision_id is not null.

alter table rent_decisions
  add column if not exists decision_id uuid,
  add column if not exists soul_version text,
  add column if not exists policy_version text,
  add column if not exists objective text,
  add column if not exists proposals jsonb not null default '[]',
  add column if not exists chosen_action text,
  add column if not exists rejected_reason text,
  add column if not exists used_fallback boolean not null default false;
