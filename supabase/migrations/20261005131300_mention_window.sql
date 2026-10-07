-- A note Mention opens a Mention Window on the SOR's current Stage Visit
-- (ADR 0021, amendment 2026-10-07; #473).
--
-- 20261001140000 made a mention a permanent, header-only 'participant' grant:
-- the mentioned person opened the SOR to an empty timeline, because the
-- Stage's notes, tasks and fields sit behind sor_visible_visit_ids, which never
-- read sor_mention_viewers. Now each grant row names the visit the SOR was on
-- when the Mention was made:
--
--   * while that visit is open  -> 'participant', and the visit is visible
--   * once the SOR has left it  -> 'locked', and the visit stays visible
--   * no visit (SOR has none)   -> 'participant', header only, permanently
--
-- Two relaxations are deliberate and marked TIGHTEN(mention) with the strict
-- form beside them: a window opens on a Restricted Stage, and anyone inside a
-- window may mention others in.

-- ─── one row per (person, visit) ────────────────────────────────────────────

alter table public.sor_mention_viewers
  add column if not exists id uuid not null default gen_random_uuid(),
  add column if not exists stage_visit_id uuid references public.sor_stage_visits (id) on delete cascade;

-- Grants made before this migration: the visit the SOR was on at grant time.
-- A grant older than the SOR's first visit stays null (header-only).
update public.sor_mention_viewers m
set stage_visit_id = (
  select v.id
  from public.sor_stage_visits v
  where v.opportunity_id = m.opportunity_id
    and v.undone_at is null
    and v.entered_at <= m.created_at
  order by v.sequence desc
  limit 1
)
where m.stage_visit_id is null;

alter table public.sor_mention_viewers drop constraint if exists sor_mention_viewers_pkey;
alter table public.sor_mention_viewers add constraint sor_mention_viewers_pkey primary key (id);
alter table public.sor_mention_viewers drop constraint if exists sor_mention_viewers_window_key;
alter table public.sor_mention_viewers
  add constraint sor_mention_viewers_window_key
  unique nulls not distinct (opportunity_id, employee_id, stage_visit_id);
create index if not exists sor_mention_viewers_employee_idx on public.sor_mention_viewers (employee_id);

-- ─── who a Mention would open a window for ──────────────────────────────────
-- Shared by the grant and by the composer's hint, so the hint can never promise
-- a window the grant would not open.

create or replace function public.sor_mention_window_candidates(p_opportunity_id uuid, p_employee_ids uuid[])
returns setof uuid
language sql
stable
security definer
set search_path = public
as $function$
  with cur as (
    select v.id, v.sequence, v.flow_stage_id
    from public.sor_stage_visits v
    where v.opportunity_id = p_opportunity_id
      and v.left_at is null
      and v.undone_at is null
    order by v.sequence desc
    limit 1
  )
  select e.id
  from public.employees e
  join public.sales_opportunities o on o.id = p_opportunity_id
  left join cur on true
  where e.id = any (p_employee_ids)
    -- Only someone who could post here may ask who a Mention would open for.
    and public.sor_access_level(p_opportunity_id) in ('full', 'participant')
    and coalesce(e.is_deleted, false) = false
    and not coalesce(e.is_super_admin, false)
    -- Already reaches this Stage as Deal Team / Always sees. Someone on the
    -- Deal Team shut out of a Restricted Stage does not, so a Mention opens it.
    -- sor_is_deal_team is NULL, not false, when some Deal Team columns are empty.
    and not (
      (coalesce(public.sor_is_deal_team(o, e.id), false) or coalesce(public.sor_always_sees(o, e.id), false))
      and (cur.id is null or not public.sor_is_stage_shut_out(o, e.id, cur.flow_stage_id))
    )
    -- TIGHTEN(mention): a Restricted Stage stays shut to a Mention. Uncomment:
    -- and (cur.id is null or not public.sor_is_stage_shut_out(o, e.id, cur.flow_stage_id))
    -- Already inside an open Stage Participant window that reaches this visit.
    and not exists (
      select 1
      from public.sor_stage_participants p
      join public.sor_stage_visits opened on opened.id = p.opened_visit_id
      where p.opportunity_id = p_opportunity_id
        and p.employee_id = e.id
        and p.closed_at is null
        and opened.undone_at is null
        and cur.id is not null
        and opened.sequence <= cur.sequence
    )
    -- Already holds a window on this visit (or the header grant on a visitless SOR).
    and not exists (
      select 1 from public.sor_mention_viewers m
      where m.opportunity_id = p_opportunity_id
        and m.employee_id = e.id
        and m.stage_visit_id is not distinct from cur.id
    )
$function$;

revoke all on function public.sor_mention_window_candidates(uuid, uuid[]) from public, anon;
grant execute on function public.sor_mention_window_candidates(uuid, uuid[]) to authenticated;

-- ─── the grant ──────────────────────────────────────────────────────────────

create or replace function public.sor_grant_mention_view(p_opportunity_id uuid, p_employee_ids uuid[])
returns integer
language plpgsql
volatile
security definer
set search_path = public
as $function$
declare
  v_count integer;
  v_visit uuid;
begin
  -- Whoever can post a note on the SOR can mention someone into it, including
  -- someone who is only there by a Mention.
  if public.sor_access_level(p_opportunity_id) not in ('full', 'participant') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  -- TIGHTEN(mention): only the Deal Team, Always sees and Stage Participants
  -- invite; a mentioned person cannot chain. Replace the check above with:
  -- if public.sor_access_level(p_opportunity_id) <> 'full'
  --    and not exists (
  --      select 1 from public.sor_stage_participants p
  --      where p.opportunity_id = p_opportunity_id
  --        and p.employee_id = public.get_employee_id()
  --        and p.closed_at is null
  --    ) then
  --   raise exception 'not allowed' using errcode = '42501';
  -- end if;

  select v.id into v_visit
  from public.sor_stage_visits v
  where v.opportunity_id = p_opportunity_id
    and v.left_at is null
    and v.undone_at is null
  order by v.sequence desc
  limit 1;

  insert into public.sor_mention_viewers (opportunity_id, employee_id, granted_by, stage_visit_id)
  select p_opportunity_id, c, public.get_employee_id(), v_visit
  from public.sor_mention_window_candidates(p_opportunity_id, p_employee_ids) c
  on conflict do nothing;
  get diagnostics v_count = row_count;
  return v_count;
end
$function$;

revoke all on function public.sor_grant_mention_view(uuid, uuid[]) from public, anon;
grant execute on function public.sor_grant_mention_view(uuid, uuid[]) to authenticated;

-- ─── access level ───────────────────────────────────────────────────────────

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
    -- An open Mention Window, or the header grant on an SOR with no visit.
    when exists (
      select 1 from public.sor_mention_viewers m
      left join public.sor_stage_visits v on v.id = m.stage_visit_id
      where m.opportunity_id = p_opportunity_id
        and m.employee_id = public.get_employee_id()
        and (
          m.stage_visit_id is null
          or (v.left_at is null and v.undone_at is null)
        )
    ) then 'participant'
    when exists (
      select 1 from public.sor_stage_participants p
      where p.opportunity_id = p_opportunity_id
        and p.employee_id = public.get_employee_id()
    ) then 'locked'
    -- A Mention Window the SOR has since left.
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

-- ─── visible visits ─────────────────────────────────────────────────────────

create or replace function public.sor_visible_visit_ids(p_opportunity_id uuid)
returns setof uuid
language sql
stable
security definer
set search_path = public
as $function$
  select v.id
  from public.sor_stage_visits v
  where v.opportunity_id = p_opportunity_id
    and v.undone_at is null
    and public.is_super_admin()

  union

  select v.id
  from public.sor_stage_visits v
  join public.sales_opportunities o on o.id = v.opportunity_id
  where v.opportunity_id = p_opportunity_id
    and v.undone_at is null
    and not public.is_super_admin()
    and (
      public.sor_is_deal_team(o, public.get_employee_id())
      or public.sor_always_sees(o, public.get_employee_id())
    )
    and not public.sor_is_stage_shut_out(o, public.get_employee_id(), v.flow_stage_id)

  union

  select v.id
  from public.sor_stage_participants p
  join public.sor_stage_visits opened on opened.id = p.opened_visit_id
  join public.sor_stage_visits v on v.opportunity_id = p.opportunity_id
  where p.opportunity_id = p_opportunity_id
    and p.employee_id = public.get_employee_id()
    and not public.is_super_admin()
    and opened.undone_at is null
    and v.undone_at is null
    and (
      (p.closed_at is null and v.sequence >= opened.sequence)
      or (
        p.closed_at is not null
        and v.sequence >= opened.sequence
        and v.sequence <= (
          select max(closing.sequence)
          from public.sor_stage_visits closing
          where closing.opportunity_id = p.opportunity_id
            and closing.sequence >= opened.sequence
            and closing.left_at is not null
            and closing.left_at <= p.closed_at
        )
      )
    )

  union

  -- Mention Windows: exactly the visit each Mention was made on, open or since
  -- left (a left one is the locked view's read-only look).
  select v.id
  from public.sor_mention_viewers m
  join public.sor_stage_visits v on v.id = m.stage_visit_id
  where m.opportunity_id = p_opportunity_id
    and m.employee_id = public.get_employee_id()
    and not public.is_super_admin()
    and v.undone_at is null
    -- TIGHTEN(mention): a Restricted Stage stays shut to a Mention. Uncomment:
    -- and not exists (
    --   select 1 from public.sales_opportunities o
    --   where o.id = v.opportunity_id
    --     and public.sor_is_stage_shut_out(o, public.get_employee_id(), v.flow_stage_id)
    -- )
$function$;

-- ─── who is notified from a visit ───────────────────────────────────────────
-- An open Mention Window is part of the visit's audience, so the person hears
-- replies on the thread they were pulled into.

create or replace function public.sor_visit_audience(p_opportunity_id uuid, p_visit_id uuid)
returns setof uuid
language sql
stable
security definer
set search_path = public
as $function$
  with allowed as (
    select public.sor_access_level(p_opportunity_id) in ('full', 'participant') as ok
  )
  select e.id from public.employees e, allowed
  where allowed.ok and e.is_super_admin

  union

  select e.id
  from public.employees e
  join public.sales_opportunities o on o.id = p_opportunity_id
  join public.sor_stage_visits v on v.id = p_visit_id and v.opportunity_id = p_opportunity_id
  , allowed
  where allowed.ok
    and v.undone_at is null
    and (
      public.sor_is_deal_team(o, e.id)
      or public.sor_always_sees(o, e.id)
    )
    and not public.sor_is_stage_shut_out(o, e.id, v.flow_stage_id)

  union

  select p.employee_id
  from public.sor_stage_participants p
  join public.sor_stage_visits opened on opened.id = p.opened_visit_id
  join public.sor_stage_visits v on v.id = p_visit_id and v.opportunity_id = p.opportunity_id
  , allowed
  where allowed.ok
    and p.opportunity_id = p_opportunity_id
    and p.closed_at is null
    and opened.undone_at is null
    and v.undone_at is null
    and v.sequence >= opened.sequence

  union

  select m.employee_id
  from public.sor_mention_viewers m
  join public.sor_stage_visits v on v.id = m.stage_visit_id
  , allowed
  where allowed.ok
    and m.opportunity_id = p_opportunity_id
    and m.stage_visit_id = p_visit_id
    and v.left_at is null
    and v.undone_at is null
$function$;
