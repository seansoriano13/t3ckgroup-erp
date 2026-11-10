-- ==============================================================================
-- 20261005130900_procurement_queue.sql
--
-- Issue #308 (part of #209) — the Procurement Queue's rows.
--
-- `pr_queue(p_request_id uuid default null)` returns one row per Purchase
-- Request the caller may read (`can_read_purchase_request`: a member, a Super
-- Admin, or anyone with Purchasing access on an unassigned request), with
-- what the queue shows about it:
--   the SOR's locked header   sales_reference (else opportunity_no),
--                             project_title, current Stage name — the same
--                             fields `sor_locked_summary` gives a locked
--                             member. A purchaser picking up an unassigned
--                             request has no SOR access yet, so the SOR can't
--                             be read directly.
--   the Buyer                 id, name, avatar.
--   item counts               item_count, open_count (not in a closed status:
--                             from_stock, received, substituted,
--                             cannot_source, cancelled).
--   last_activity_at          the newest message (every item, member and
--                             Buyer change posts one), else updated_at.
-- With `p_request_id`, only that request (the shared request view's header).
--
-- Filtering (unassigned / mine / open / closed) happens in the client over
-- these rows; see `filterQueue` in src/services/purchaseRequestService.js.
--
-- SAFE TO RUN AT ANY TIME: one new function; nothing existing is redefined.
-- Idempotent.
-- ==============================================================================

create or replace function public.pr_queue(p_request_id uuid default null)
returns table (
  id uuid,
  opportunity_id uuid,
  sales_reference text,
  project_title text,
  stage_name text,
  buyer_id uuid,
  buyer_name text,
  buyer_avatar_path text,
  created_at timestamptz,
  updated_at timestamptz,
  item_count integer,
  open_count integer,
  last_activity_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $function$
  select
    r.id,
    r.opportunity_id,
    coalesce(nullif(o.sales_reference, ''), o.opportunity_no),
    o.project_title,
    fs.name,
    r.buyer_id,
    b.name,
    b.avatar_path,
    r.created_at,
    r.updated_at,
    coalesce(i.item_count, 0)::integer,
    coalesce(i.open_count, 0)::integer,
    greatest(r.updated_at, m.last_message_at)
  from public.purchase_requests r
  left join public.sales_opportunities o on o.id = r.opportunity_id
  left join public.flow_stages fs on fs.id = o.flow_stage_id
  left join public.employees b on b.id = r.buyer_id
  left join lateral (
    select
      count(*) as item_count,
      count(*) filter (where not public._purchase_request_item_is_closed(it.status)) as open_count
    from public.purchase_request_items it
    where it.request_id = r.id
  ) i on true
  left join lateral (
    select max(msg.created_at) as last_message_at
    from public.purchase_request_messages msg
    where msg.request_id = r.id
  ) m on true
  where (p_request_id is null or r.id = p_request_id)
    and public.can_read_purchase_request(r.id)
  order by greatest(r.updated_at, m.last_message_at) desc nulls last, r.created_at desc;
$function$;

comment on function public.pr_queue(uuid) is
  '#308: the Procurement Queue — every Purchase Request the caller may read, with the SOR''s locked header (reference, project, Stage), the Buyer, item counts and last activity. With p_request_id, that one request.';

revoke all on function public.pr_queue(uuid) from public, anon;
grant execute on function public.pr_queue(uuid) to authenticated;
