-- A mention on an OLD SOR (one that has never opened a Stage Visit) lets the
-- mentioned person open it, read-only.
--
-- ADR 0021's "a mention grants nothing" holds for Stage-scoped SORs, whose
-- audience is the visit. An old SOR has no visit to scope by, so everyone
-- mentioned was notified but a person without access got an empty modal.
-- For these SORs the mention itself is the grant. It resolves to the existing
-- 'participant' access level: the money-free read-only record, never a write.

create table if not exists public.sor_mention_viewers (
  opportunity_id uuid not null references public.sales_opportunities (id) on delete cascade,
  employee_id    uuid not null references public.employees (id),
  granted_by     uuid references public.employees (id),
  created_at     timestamptz not null default now(),
  primary key (opportunity_id, employee_id)
);

alter table public.sor_mention_viewers enable row level security;

drop policy if exists "sor_mention_viewers_read" on public.sor_mention_viewers;
create policy "sor_mention_viewers_read" on public.sor_mention_viewers
  as permissive for select to authenticated
  using (employee_id = public.get_employee_id() or public.is_super_admin());
-- No insert/update/delete policy: rows are written only by
-- sor_grant_mention_view below.

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
    when exists (
      select 1 from public.sor_mention_viewers m
      where m.opportunity_id = p_opportunity_id
        and m.employee_id = public.get_employee_id()
        and not exists (select 1 from public.sor_stage_visits v where v.opportunity_id = p_opportunity_id)
    ) then 'participant'
    when exists (
      select 1 from public.sor_stage_participants p
      where p.opportunity_id = p_opportunity_id
        and p.employee_id = public.get_employee_id()
    ) then 'locked'
    else 'none'
  end
$function$;

-- Called by the note composer for each mention on an old SOR. The caller must
-- already have full access, and a SOR with a Stage Visit is refused: its
-- audience stays the visit's.
create or replace function public.sor_grant_mention_view(p_opportunity_id uuid, p_employee_ids uuid[])
returns integer
language plpgsql
volatile
security definer
set search_path = public
as $function$
declare
  v_count integer;
begin
  if public.sor_access_level(p_opportunity_id) <> 'full' then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if exists (select 1 from public.sor_stage_visits v where v.opportunity_id = p_opportunity_id) then
    return 0;
  end if;
  insert into public.sor_mention_viewers (opportunity_id, employee_id, granted_by)
  select p_opportunity_id, e.id, public.get_employee_id()
  from public.employees e
  where e.id = any (p_employee_ids)
    and coalesce(e.is_deleted, false) = false
  on conflict do nothing;
  get diagnostics v_count = row_count;
  return v_count;
end
$function$;

revoke all on function public.sor_grant_mention_view(uuid, uuid[]) from public, anon;
grant execute on function public.sor_grant_mention_view(uuid, uuid[]) to authenticated;
