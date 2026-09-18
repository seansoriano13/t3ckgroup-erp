-- ==============================================================================
-- 0060_sor_inclusion_cost.sql
--
-- An Inclusion's cost basis (issue #47) — a stamped snapshot, never read
-- live. A decision has to be reproducible: a background job that silently
-- moved the number underneath an already-made decision would destroy that,
-- so the cost is written once (by markWinner or an explicit refresh) and
-- read back exactly as stored until somebody deliberately asks for it again.
--
-- ── Why three columns, not one ──────────────────────────────────────────────
-- amount alone cannot answer "is this still trustworthy" — cost_established_at
-- is what the screen's staleness display reads (constants/projectEvaluation.js
-- costAgeDays), and cost_source is what tells a reader whether the figure came
-- from a canvassed winner, Odoo's catalog, or somebody typing a number in by
-- hand — the same three-tier priority order resolveCost() implements.
--
-- Nullable, all three, together: an Inclusion nobody has costed yet has none
-- of them set, which is a different statement from a cost of zero.
--
-- SAFE TO RUN AT ANY TIME, against a live production frontend of any version:
--   * Three new nullable columns with no default. Every existing Inclusion
--     keeps meaning exactly what it meant: not yet costed.
--   * No existing row, table or policy is modified.
--   * Idempotent — safe to re-run.
-- ==============================================================================

alter table public.sor_inclusions
  add column if not exists cost_amount numeric(14,2);

alter table public.sor_inclusions
  add column if not exists cost_source text;

alter table public.sor_inclusions
  add column if not exists cost_established_at timestamptz;

alter table public.sor_inclusions
  drop constraint if exists sor_inclusions_cost_source_chk;

alter table public.sor_inclusions
  add constraint sor_inclusions_cost_source_chk check (
    cost_source is null or cost_source in ('CANVASS_OFFER', 'ODOO_CATALOG', 'MANUAL')
  );

comment on column public.sor_inclusions.cost_amount is
  'Issue #47: stamped cost basis, resolved in priority order (winning Canvass offer, Odoo catalog, manual entry) and never read live.';
comment on column public.sor_inclusions.cost_source is
  'Issue #47: which of the three tiers cost_amount came from — see constants/projectEvaluation.js resolveCost().';
comment on column public.sor_inclusions.cost_established_at is
  'Issue #47: when cost_amount was stamped. Drives the staleness display; only an explicit refresh (or a new Canvass winner) moves it.';
