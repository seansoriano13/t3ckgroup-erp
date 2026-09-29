-- A task's "Sales Opportunity" link (`SorLink.jsx`, issue #199) resolves its
-- own label with a raw `select sales_reference, client_name from
-- sales_opportunities where id = …`. `sor_read`'s policy is Super Admin, Deal
-- Team or Always-sees (`sor_is_deal_team` / `sor_always_sees`) — it carries no
-- Stage Participant clause at all, unlike every other SOR read path since ADR
-- 0021. A plain Stage Participant (mounted by `openWindow` for being a task's
-- assignee, with no deal-team role) gets zero rows back, so the label query
-- returns null and the whole link silently renders nothing — a task created
-- through a Stage Action loses its visible tie back to the deal it came from.
--
-- `sor_participant_record` already exists for this exact gap, but it selects
-- two dozen columns the link only ever reads two of. A one-column, one-row
-- function is simpler than routing the chip through the full projection.

create or replace function public.sor_link_label(p_opportunity_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $function$
  select coalesce(o.sales_reference, o.client_name)
  from public.sales_opportunities o
  where o.id = p_opportunity_id
    and public.sor_access_level(p_opportunity_id) in ('full', 'participant', 'locked')
$function$;

comment on function public.sor_link_label(uuid) is
  'The label a task''s SOR link renders (#199), reachable at every access '
  'level that can open a task tied to the deal — including a plain Stage '
  'Participant, which sor_read''s policy excludes entirely.';
