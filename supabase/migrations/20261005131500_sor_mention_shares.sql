-- Who an SOR has been shared with by Mention (#477).
--
-- Mentioned people may mention others in (a TIGHTEN(mention) relaxation), so
-- invitations chain. Whoever holds full access sees the whole list: each
-- person, who mentioned them, on which Stage, and whether that window is still
-- open. sor_mention_viewers itself stays readable only by its own subject.

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
    (m.stage_visit_id is null or (v.left_at is null and v.undone_at is null)),
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

revoke all on function public.sor_mention_shares(uuid) from public, anon;
grant execute on function public.sor_mention_shares(uuid) to authenticated;
