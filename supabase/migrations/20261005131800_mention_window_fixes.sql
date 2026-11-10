-- Mention Window review fixes (#473 follow-up).
--
-- 1. A header-only grant (no visit) only stands on an SOR that still has no
--    Stage Visit. (20261008100000 also let it through on any SOR: its left
--    join to the visit made `v.left_at is null` true for a null visit.) Once the SOR gains one, the grant reads as 'locked', not a
--    permanent 'participant' that could keep mentioning others in.
-- 2. The backfill in 20261008100000 tied each old grant to the latest visit
--    entered before it. Re-tie it to the visit actually open at grant time:
--    entered before it and not left before it. Grants it cannot place keep
--    their current visit.

update public.sor_mention_viewers m
set stage_visit_id = fix.visit_id
from (
  select m2.id,
    (
      select v.id
      from public.sor_stage_visits v
      where v.opportunity_id = m2.opportunity_id
        and v.entered_at <= m2.created_at
        and (v.left_at is null or v.left_at > m2.created_at)
      order by v.sequence desc
      limit 1
    ) as visit_id
  from public.sor_mention_viewers m2
  where m2.created_at < '2026-10-08'::timestamptz
) fix
where fix.id = m.id
  and fix.visit_id is not null
  and fix.visit_id is distinct from m.stage_visit_id
  and not exists (
    select 1 from public.sor_mention_viewers d
    where d.opportunity_id = m.opportunity_id
      and d.employee_id = m.employee_id
      and d.stage_visit_id = fix.visit_id
  );

create or replace function public.sor_access_level(p_opportunity_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $function$
  select case
    when not exists (select 1 from public.sales_opportunities where id = p_opportunity_id) then 'none'
    when public.is_super_admin() then 'full'
    when exists (
      select 1 from public.sales_opportunities o
      where o.id = p_opportunity_id
        and (
          public.sor_is_deal_team(o, public.get_employee_id())
          or public.sor_always_sees(o, public.get_employee_id())
        )
    ) then 'full'
    when exists (
      select 1 from public.sor_stage_participants p
      where p.opportunity_id = p_opportunity_id
        and p.employee_id = public.get_employee_id()
        and p.closed_at is null
    ) then 'participant'
    -- An open Mention Window, or the header grant on an SOR that still has no visit.
    when exists (
      select 1 from public.sor_mention_viewers m
      left join public.sor_stage_visits v on v.id = m.stage_visit_id
      where m.opportunity_id = p_opportunity_id
        and m.employee_id = public.get_employee_id()
        and (
          (m.stage_visit_id is null
            and not exists (select 1 from public.sor_stage_visits sv where sv.opportunity_id = p_opportunity_id))
          -- v.id, not just v.left_at: a null grant left-joins to all-null v.
          or (v.id is not null and v.left_at is null and v.undone_at is null)
        )
    ) then 'participant'
    when exists (
      select 1 from public.sor_stage_participants p
      where p.opportunity_id = p_opportunity_id
        and p.employee_id = public.get_employee_id()
    ) then 'locked'
    -- A Mention Window the SOR has since left, or a header grant it outgrew.
    when exists (
      select 1 from public.sor_mention_viewers m
      where m.opportunity_id = p_opportunity_id
        and m.employee_id = public.get_employee_id()
    ) then 'locked'
    when exists (
      select 1 from public.purchase_request_members m
      join public.purchase_requests r on r.id = m.request_id
      where r.opportunity_id = p_opportunity_id
        and m.employee_id = public.get_employee_id()
    ) then 'locked'
    else 'none'
  end
$function$;

-- sor_mention_shares: an open header grant follows the same rule.
create or replace function public.sor_mention_shares(p_opportunity_id uuid)
returns table (
  id uuid,
  employee_id uuid,
  employee_name text,
  granted_by_name text,
  stage_name text,
  is_open boolean,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $function$
  select
    m.id,
    m.employee_id,
    e.name,
    g.name,
    fs.name,
    case
      when m.stage_visit_id is null
        then not exists (select 1 from public.sor_stage_visits sv where sv.opportunity_id = p_opportunity_id)
      else v.left_at is null and v.undone_at is null
    end,
    m.created_at
  from public.sor_mention_viewers m
  join public.employees e on e.id = m.employee_id
  left join public.employees g on g.id = m.granted_by
  left join public.sor_stage_visits v on v.id = m.stage_visit_id
  left join public.flow_stages fs on fs.id = v.flow_stage_id
  where m.opportunity_id = p_opportunity_id
    and public.sor_access_level(p_opportunity_id) = 'full'
    and (v.id is null or v.undone_at is null)
  order by m.created_at desc
$function$;
