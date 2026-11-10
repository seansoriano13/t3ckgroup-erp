-- ==============================================================================
-- 20261005132200_pr_queue_sor_status.sql
--
-- #209 follow-up: the Procurement Queue's Stage column read "—" for every
-- request on an SOR registered before Sales Flows (no Flow Stage; its stage is
-- still the legacy `sales_opportunities.status`, e.g. PROPOSAL_SUBMITTED). The
-- requests migrated from the old procurement table (#313) are all on such SORs.
--
-- `pr_queue` gains `sor_status` (the SOR's legacy status); the frontend labels
-- it when there is no `stage_name`. The return type changes, so the function is
-- dropped and recreated, body unchanged otherwise (20261005131900).
-- ==============================================================================

drop function if exists public.pr_queue(uuid);

create function public.pr_queue(p_request_id uuid default null)
returns table (
  id uuid,
  opportunity_id uuid,
  sales_reference text,
  project_title text,
  stage_name text,
  sor_closed text,
  buyer_id uuid,
  buyer_name text,
  buyer_avatar_path text,
  created_at timestamptz,
  updated_at timestamptz,
  item_count integer,
  open_count integer,
  last_activity_at timestamptz,
  sor_status text
)
language sql
stable
security definer
set search_path = public
as $function$
  select
    r.id,
    r.opportunity_id,
    coalesce(nullif(o.sales_reference, ''), o.sor_code, o.opportunity_no),
    o.project_title,
    fs.name,
    case when o.id is not null then public._sor_purchasing_closed_reason(o) end,
    r.buyer_id,
    b.name,
    b.avatar_path,
    r.created_at,
    r.updated_at,
    coalesce(i.item_count, 0)::integer,
    coalesce(i.open_count, 0)::integer,
    greatest(r.updated_at, m.last_message_at),
    o.status
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
  '#308: the Procurement Queue — every Purchase Request the caller may read, with the SOR''s locked header (reference, project, Stage, and sor_closed: deleted or lost; sor_status, the legacy status for an SOR with no Flow Stage), the Buyer, item counts and last activity. With p_request_id, that one request.';

revoke all on function public.pr_queue(uuid) from public, anon;
grant execute on function public.pr_queue(uuid) to authenticated;
