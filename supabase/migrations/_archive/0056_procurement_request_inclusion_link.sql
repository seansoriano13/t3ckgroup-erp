-- ==============================================================================
-- 0056_procurement_request_inclusion_link.sql
--
-- Ties a Procurement Request back to the Inclusion it was raised from
-- (issue #45).
--
-- WHY
-- When purchasing answers "cannot be sourced" or "sourced something else", that
-- answer is about an item on the client's specification. Today it stops at the
-- request row, and somebody has to go and set the Inclusion's completeness by
-- hand — which means the spec check, the one thing this module exists to make
-- reliable, is only as current as whoever remembered to update it twice.
--
-- With the link, resolving the request updates the breakdown. Nobody re-enters
-- the same fact in two places, and the two cannot drift.
--
-- ON DELETE SET NULL, deliberately — mirroring task_id in 0017 and for the same
-- reason. A request is the frozen record of what was asked for and must outlive
-- the row that prompted it. If sales deletes an Inclusion after purchasing has
-- already answered it, the answer stays; it simply stops pointing anywhere.
--
-- NULLABLE, and most rows will stay null. Requests are still raised straight
-- from the composer for products that were never on a spec sheet, which is the
-- original case 0017 was written for and is not changed here. Null means
-- "raised on its own", and the write-back skips those rows entirely.
--
-- NO UNIQUE CONSTRAINT. One Inclusion can legitimately be sourced more than
-- once — a first attempt comes back UNAVAILABLE, a second finds a substitute —
-- and forcing uniqueness would make the second, more useful answer the one that
-- errors. The write-back therefore applies whichever request was resolved last,
-- which is the answer somebody just gave.
--
-- SAFE TO RUN AT ANY TIME, against a live production frontend of any version:
--   * One new nullable column with no default. Every existing row keeps meaning
--     exactly what it meant: a request raised on its own.
--   * No existing row, policy or constraint is modified.
--   * A frontend deployed before this migration never names the column.
--   * Idempotent.
-- ==============================================================================

alter table public.sor_procurement_requests
  add column if not exists inclusion_id uuid
    references public.sor_inclusions(id) on delete set null;

comment on column public.sor_procurement_requests.inclusion_id is
  'Issue #45: the Inclusion this request was raised from, if any. Resolving the request writes its outcome back onto that Inclusion''s completeness. Null means the request was raised on its own, which is the 0017 case and stays unchanged.';

-- The write-back reads by inclusion, and the breakdown shows what has been
-- sent to purchasing. Partial: rows with no link are the majority and are never
-- looked up this way.
create index if not exists sor_procurement_requests_inclusion_idx
  on public.sor_procurement_requests (inclusion_id)
  where inclusion_id is not null;
