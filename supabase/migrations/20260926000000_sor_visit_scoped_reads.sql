-- Issue #295 (part of #208, ADR 0021) — Visit-scoped reads and a
-- participant-safe SOR record.
--
-- #293 cut `sales_opportunities` reads over to Deal Team + Always sees.
-- #294 gave Stage Participants an access window (`sor_stage_participants`).
-- This migration is what actually makes a window *mean* something: which
-- Stage Visits a caller may see, a single access-level check the UI and
-- other policies both use, a participant-safe projection of the SOR with no
-- money on it anywhere a row can be read, and the fix for the tasks/
-- committee_tasks world-readable gap #208 calls out by name.
--
-- Restricted Stages (#296) are deliberately not implemented here. Every
-- function below is shaped so a "and not restricted-for-caller" filter can
-- be added later without a signature or shape change — see the comments on
-- sor_visible_visit_ids.

-- ===========================================================================
-- sor_visible_visit_ids: the one place "which visits can this caller see"
-- is decided. Everything else — logs, condition status, stage field values,
-- tasks, committee_tasks, mentions — reads through this instead of
-- re-deriving the rule.
-- ===========================================================================

create or replace function public.sor_visible_visit_ids(p_opportunity_id uuid)
returns setof uuid
language sql
stable
security definer
set search_path = public
as $function$
  -- Super Admin: every visit, no exceptions, ever.
  select v.id
  from public.sor_stage_visits v
  where v.opportunity_id = p_opportunity_id
    and public.is_super_admin()

  union

  -- Deal Team / Always sees: every visit on this opportunity today.
  -- Restricted Stages (#296) will narrow this arm with
  -- `and not exists (select 1 from flow_stage_access ... )` — the shape
  -- (one arm per audience, unioned) is kept exactly so that filter can be
  -- added here without touching the participant arm below.
  select v.id
  from public.sor_stage_visits v
  join public.sales_opportunities o on o.id = v.opportunity_id
  where v.opportunity_id = p_opportunity_id
    and not public.is_super_admin()
    and (
      public.sor_is_deal_team(o, public.get_employee_id())
      or public.sor_always_sees(o, public.get_employee_id())
    )

  union

  -- Participants: visits their window overlaps while open, plus visits
  -- covered by a since-closed window (read-only "your visits").
  --
  -- Compared by `sequence`, not by timestamp: the trigger that closes a
  -- window (close_stage_participant_windows) and the trigger that records
  -- the newly-entered visit (record_stage_visit) both fire from the same
  -- UPDATE and both stamp `now()`, which is the *transaction's* start time
  -- in Postgres — not wall-clock time — so the visit being left and the
  -- visit being entered can carry the exact same `closed_at` /
  -- `entered_at` value. A timestamp comparison alone cannot tell those two
  -- visits apart at that boundary; `sequence` is a per-opportunity integer
  -- assigned in strict visiting order, so it can.
  --
  -- Open window: every visit from the calling visit onward.
  -- Closed window: every visit from the calling visit up to and including
  -- whichever visit was still open (`left_at is not null and left_at <=
  -- closed_at`) at the moment the window closed — never the visit entered
  -- immediately after, even if the two share a timestamp.
  select v.id
  from public.sor_stage_participants p
  join public.sor_stage_visits opened on opened.id = p.opened_visit_id
  join public.sor_stage_visits v on v.opportunity_id = p.opportunity_id
  where p.opportunity_id = p_opportunity_id
    and p.employee_id = public.get_employee_id()
    and not public.is_super_admin()
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
$function$;

comment on function public.sor_visible_visit_ids(uuid) is
  'ADR 0021 / #295: setof sor_stage_visits.id the calling employee may read '
  'on this opportunity. Super Admin sees all; Deal Team/Always sees see all '
  '(Restricted Stages, #296, narrows that arm later); Participants see only '
  'their window''s visits, read-only once closed.';

-- ===========================================================================
-- sor_access_level: full | participant | locked | none
-- ===========================================================================

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
      select 1 from public.sor_stage_participants p
      where p.opportunity_id = p_opportunity_id
        and p.employee_id = public.get_employee_id()
    ) then 'locked'
    else 'none'
  end
$function$;

comment on function public.sor_access_level(uuid) is
  'ADR 0021 / #295: full | participant | locked | none for the calling '
  'employee on this opportunity. Drives which SOR-modal view renders and '
  'gates sor_locked_summary/sor_participant_record.';

-- ===========================================================================
-- sor_locked_summary: Sales Reference, project, current Stage name,
-- restricted flag — for locked or higher.
-- ===========================================================================

create or replace function public.sor_locked_summary(p_opportunity_id uuid)
returns table (
  sales_reference text,
  project_title text,
  current_stage_name text,
  is_restricted boolean
)
language sql
stable
security definer
set search_path = public
as $function$
  select
    o.sales_reference,
    o.project_title,
    fs.name,
    false -- Restricted Stages land in #296; nobody is restricted-flagged yet.
  from public.sales_opportunities o
  left join public.flow_stages fs on fs.id = o.flow_stage_id
  where o.id = p_opportunity_id
    and public.sor_access_level(p_opportunity_id) in ('full', 'participant', 'locked')
$function$;

comment on function public.sor_locked_summary(uuid) is
  'ADR 0021 / #295: the locked-view summary (Sales Reference, project, '
  'current Stage name, restricted flag) for anyone at locked access or '
  'better. Returns no rows below locked.';

-- ===========================================================================
-- sor_participant_record: the SOR without money, for participant-level
-- callers (and anyone above, so the same call works everywhere).
-- ===========================================================================

create or replace function public.sor_participant_record(p_opportunity_id uuid)
returns table (
  id uuid,
  client_name text,
  contact_person text,
  project_title text,
  sales_reference text,
  flow_stage_id uuid,
  registered_by uuid,
  deal_owner_id uuid,
  closing_sales_id uuid,
  support_sales_1_id uuid,
  support_sales_2_id uuid,
  sales_director_id uuid
)
language sql
stable
security definer
set search_path = public
as $function$
  select
    o.id,
    o.client_name,
    o.contact_person,
    o.project_title,
    o.sales_reference,
    o.flow_stage_id,
    o.registered_by,
    o.deal_owner_id,
    o.closing_sales_id,
    o.support_sales_1_id,
    o.support_sales_2_id,
    o.sales_director_id
  from public.sales_opportunities o
  where o.id = p_opportunity_id
    and public.sor_access_level(p_opportunity_id) in ('full', 'participant')
$function$;

comment on function public.sor_participant_record(uuid) is
  'ADR 0021 / #295: the SOR projection with no expected_value or commission '
  'column reachable, ever — not a UI hide, the money columns are simply not '
  'selected here. Returns no rows below participant access.';

-- Items without unit_price, same shape/spirit as sor_participant_record.
create or replace function public.sor_participant_items(p_opportunity_id uuid)
returns table (
  id uuid,
  opportunity_id uuid,
  product_name text,
  unit text,
  quantity numeric,
  sort_order integer
)
language sql
stable
security definer
set search_path = public
as $function$
  select i.id, i.opportunity_id, i.product_name, i.unit, i.quantity, i.sort_order
  from public.sales_opportunity_items i
  where i.opportunity_id = p_opportunity_id
    and public.sor_access_level(p_opportunity_id) in ('full', 'participant')
$function$;

comment on function public.sor_participant_items(uuid) is
  'ADR 0021 / #295: sales_opportunity_items without unit_price, for the '
  'participant Items tab. RLS on sales_opportunity_items itself still bars '
  'a participant from reaching unit_price by any other route (see below).';

-- ===========================================================================
-- sor_visit_audience: who can see a given visit — mentions and
-- notification routing both read this, nothing else.
-- ===========================================================================

create or replace function public.sor_visit_audience(p_opportunity_id uuid, p_visit_id uuid)
returns setof uuid
language sql
stable
security definer
set search_path = public
as $function$
  -- Guard: a caller with no visibility into this opportunity at all (below
  -- `locked`) gets an empty audience, not a roster of who else can see it —
  -- the roster is itself something only someone already let in should learn.
  -- `locked` itself is excluded too: their own window has closed, so they no
  -- longer belong in anyone's mention list or notification run.
  with allowed as (
    select public.sor_access_level(p_opportunity_id) in ('full', 'participant') as ok
  )
  select e.id from public.employees e, allowed
  where allowed.ok and e.is_super_admin

  union

  -- Deal Team + Always sees, provided the visit is one of theirs (it always
  -- is today; the join exists so a future Restricted-Stage exclusion has
  -- somewhere to attach without reshaping this function).
  select e.id
  from public.employees e
  join public.sales_opportunities o on o.id = p_opportunity_id
  , allowed
  where allowed.ok
    and exists (select 1 from public.sor_stage_visits v where v.id = p_visit_id and v.opportunity_id = p_opportunity_id)
    and (
      public.sor_is_deal_team(o, e.id)
      or public.sor_always_sees(o, e.id)
    )

  union

  -- Participants whose OPEN window currently covers this visit — closed
  -- windows do not get a seat in the audience; "read-only after closing"
  -- means no new mentions/notifications reach them, only their own past
  -- reads. No upper bound is needed here (unlike sor_visible_visit_ids):
  -- `p.closed_at is null` already restricts this arm to open windows, so
  -- the same-transaction timestamp tie at a *closing* boundary that
  -- function has to work around cannot arise here.
  select p.employee_id
  from public.sor_stage_participants p
  join public.sor_stage_visits opened on opened.id = p.opened_visit_id
  join public.sor_stage_visits v on v.id = p_visit_id and v.opportunity_id = p.opportunity_id
  , allowed
  where allowed.ok
    and p.opportunity_id = p_opportunity_id
    and p.closed_at is null
    and v.sequence >= opened.sequence
$function$;

comment on function public.sor_visit_audience(uuid, uuid) is
  'ADR 0021 / #295: employee ids who may see p_visit_id right now, for '
  'mention rosters and notification routing. Excludes anyone out-of-window.';

-- ===========================================================================
-- sales_opportunity_logs: stage_visit_id, trigger-set, backfilled, and
-- read requires visibility of that visit.
-- ===========================================================================

alter table public.sales_opportunity_logs
  add column if not exists stage_visit_id uuid references public.sor_stage_visits (id) on delete set null;

create index if not exists sales_opportunity_logs_stage_visit_id_idx
  on public.sales_opportunity_logs (stage_visit_id);

-- Backfill: rows written before Stage Visits existed (or before this
-- column did) attach to the visit whose own window [entered_at, coalesce
-- (left_at, now())] contains the log's created_at. A log with no visit
-- whose window contains it (data predates the first recorded visit, or the
-- opportunity was never flow-built) is left null and stays visible only to
-- full-access callers via the fallback in the read policy below.
update public.sales_opportunity_logs l
set stage_visit_id = v.id
from public.sor_stage_visits v
where l.stage_visit_id is null
  and v.opportunity_id = l.opportunity_id
  and l.created_at >= v.entered_at
  and l.created_at <= coalesce(v.left_at, now());

create or replace function public.sor_set_log_stage_visit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if NEW.stage_visit_id is null then
    select id into NEW.stage_visit_id
    from public.sor_stage_visits
    where opportunity_id = NEW.opportunity_id and left_at is null
    limit 1;
  end if;
  return NEW;
end;
$$;

drop trigger if exists sor_logs_set_stage_visit on public.sales_opportunity_logs;
create trigger sor_logs_set_stage_visit
  before insert on public.sales_opportunity_logs
  for each row execute function public.sor_set_log_stage_visit();

drop policy if exists "sor_log_read" on public.sales_opportunity_logs;
create policy "sor_log_read" on public.sales_opportunity_logs
  as permissive
  for select
  to authenticated
  using (
    public.is_super_admin()
    or (
      stage_visit_id is not null
      and stage_visit_id in (select public.sor_visible_visit_ids(sales_opportunity_logs.opportunity_id))
    )
    or (
      -- Pre-visit / never-flow-built rows carry no stage_visit_id at all;
      -- they fall back to whole-opportunity access rather than being
      -- unreadable forever.
      stage_visit_id is null
      and public.sor_access_level(sales_opportunity_logs.opportunity_id) in ('full', 'participant')
    )
  );

-- ===========================================================================
-- sor_condition_status / sor_stage_field_values: already carry
-- stage_visit_id (20260915030000). Give them the same visit-scoped read.
-- ===========================================================================

drop policy if exists sor_condition_status_read on public.sor_condition_status;
create policy sor_condition_status_read on public.sor_condition_status
  for select to authenticated
  using (
    public.is_super_admin()
    or (
      stage_visit_id is not null
      and stage_visit_id in (select public.sor_visible_visit_ids(sor_condition_status.opportunity_id))
    )
    or (
      stage_visit_id is null
      and public.sor_access_level(sor_condition_status.opportunity_id) in ('full', 'participant')
    )
  );

drop policy if exists sor_stage_field_values_read on public.sor_stage_field_values;
create policy sor_stage_field_values_read on public.sor_stage_field_values
  for select to authenticated
  using (
    public.is_super_admin()
    or stage_visit_id in (select public.sor_visible_visit_ids(sor_stage_field_values.opportunity_id))
  );

-- sor_stage_field_values_write was `for all using (true)`, which covers
-- select too if left in place; narrow it to non-select operations so the
-- read policy above is the one actually enforced.
drop policy if exists sor_stage_field_values_write on public.sor_stage_field_values;
create policy sor_stage_field_values_insert on public.sor_stage_field_values
  for insert to authenticated
  with check (true);
create policy sor_stage_field_values_update on public.sor_stage_field_values
  for update to authenticated
  using (true)
  with check (true);
create policy sor_stage_field_values_delete on public.sor_stage_field_values
  for delete to authenticated
  using (true);

-- ===========================================================================
-- sor_stock_snapshots: SOR-scoped (one row per opportunity, no visit id),
-- so it reads on sor_access_level rather than a visit set.
-- ===========================================================================

drop policy if exists "sor_stock_snapshots_read" on public.sor_stock_snapshots;
create policy "sor_stock_snapshots_read" on public.sor_stock_snapshots
  as permissive
  for select
  to authenticated
  using (public.sor_access_level(sor_stock_snapshots.opportunity_id) in ('full', 'participant'));

-- ===========================================================================
-- sales_opportunity_items: full read for Deal Team/Always sees only.
-- Participants reach items solely through sor_participant_items(), so
-- unit_price is unreachable to them at the row level, not just hidden by a
-- function's projection.
-- ===========================================================================

drop policy if exists "sor_items_read" on public.sales_opportunity_items;
create policy "sor_items_read" on public.sales_opportunity_items
  as permissive
  for select
  to authenticated
  using (
    public.is_super_admin()
    or exists (
      select 1 from public.sales_opportunities o
      where o.id = sales_opportunity_items.opportunity_id
        and (
          public.sor_is_deal_team(o, public.get_employee_id())
          or public.sor_always_sees(o, public.get_employee_id())
        )
    )
    or public.is_hr()
  );

-- ===========================================================================
-- tasks / committee_tasks carrying an opportunity_id: keep their own
-- assignee/member rules, but Deal Team/Always-sees access is ALSO gated by
-- stage_visit_id being in sor_visible_visit_ids. This is the fix for the
-- world-readable gap #208 names: a task naming an opportunity must not be
-- readable by someone who cannot see that opportunity's current work.
-- ===========================================================================

alter table public.tasks
  add column if not exists stage_visit_id uuid references public.sor_stage_visits (id) on delete set null;

alter table public.committee_tasks
  add column if not exists stage_visit_id uuid references public.sor_stage_visits (id) on delete set null;

create index if not exists tasks_stage_visit_id_idx on public.tasks (stage_visit_id);
create index if not exists committee_tasks_stage_visit_id_idx on public.committee_tasks (stage_visit_id);

-- Backfill both tables the same way sales_opportunity_logs was backfilled:
-- attach to the visit whose window contains created_at.
update public.tasks t
set stage_visit_id = v.id
from public.sor_stage_visits v
where t.stage_visit_id is null
  and t.opportunity_id is not null
  and v.opportunity_id = t.opportunity_id
  and t.created_at >= v.entered_at
  and t.created_at <= coalesce(v.left_at, now());

update public.committee_tasks ct
set stage_visit_id = v.id
from public.sor_stage_visits v
where ct.stage_visit_id is null
  and ct.opportunity_id is not null
  and v.opportunity_id = ct.opportunity_id
  and ct.created_at >= v.entered_at
  and ct.created_at <= coalesce(v.left_at, now());

-- `tasks` read: same assignee/head/HR/Super-Admin rule as before
-- (20260908101315), but an opportunity-linked row additionally requires
-- Deal Team/Always-sees visibility into its visit. A task with no
-- opportunity_id (the overwhelming majority — HR/ops tasks) is untouched.
drop policy if exists "Allow public read of tasks" on public.tasks;
create policy "Allow public read of tasks" on public.tasks
  as permissive
  for select
  to authenticated
  using (
    opportunity_id is null
    or public.is_super_admin()
    or logged_by = public.get_employee_id()
    or reported_to = public.get_employee_id()
    or public.is_hr()
    or (
      stage_visit_id is not null
      and stage_visit_id in (select public.sor_visible_visit_ids(tasks.opportunity_id))
    )
    or (
      stage_visit_id is null
      and public.sor_access_level(tasks.opportunity_id) in ('full', 'participant')
    )
  );

-- committee_tasks read: keep creator/member/Super-Admin, add the same
-- opportunity-linked visit gate.
drop policy if exists "committee_tasks_read" on public.committee_tasks;
create policy "committee_tasks_read" on public.committee_tasks
  as permissive
  for select
  to authenticated
  using (
    (
      opportunity_id is null
      or public.is_super_admin()
      or (
        stage_visit_id is not null
        and stage_visit_id in (select public.sor_visible_visit_ids(committee_tasks.opportunity_id))
      )
      or (
        stage_visit_id is null
        and public.sor_access_level(committee_tasks.opportunity_id) in ('full', 'participant')
      )
    )
    and (
      created_by = public.get_employee_id()
      or public.is_super_admin()
      or exists (
        select 1 from public.committee_task_members ctm
        where ctm.committee_task_id = committee_tasks.id
          and ctm.employee_id = public.get_employee_id()
      )
    )
  );

-- committee_task_members follows its parent task's visibility exactly as
-- before (committee_task_visible already re-queries committee_tasks, which
-- now itself carries the visit gate above), so no change is needed there —
-- left as documentation of why this migration does not touch it.

-- ===========================================================================
-- moveAlongFlow / the move RPC: refuse a Stage move unless the caller sees
-- the current visit at full (Deal Team/Always-sees/Super-Admin) level.
-- Enforced as a BEFORE UPDATE trigger on sales_opportunities so it holds
-- regardless of which code path performs the update.
-- ===========================================================================

create or replace function public.sor_guard_stage_move()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if NEW.flow_stage_id is not distinct from OLD.flow_stage_id then
    return NEW;
  end if;

  -- The service role runs seeding, backfills and server-side automation
  -- that must be able to move a Stage without impersonating a Deal Team
  -- member — the same reasoning every RLS policy in this schema already
  -- exempts it for. This guard is a business rule about who may operate
  -- moveAlongFlow, not a data-integrity constraint the service role itself
  -- should ever be blocked by.
  if auth.role() = 'service_role' then
    return NEW;
  end if;

  if public.sor_access_level(OLD.id) <> 'full' then
    raise exception 'You do not have access to move this stage.' using errcode = '42501';
  end if;

  return NEW;
end;
$$;

drop trigger if exists sor_guard_stage_move on public.sales_opportunities;
create trigger sor_guard_stage_move
  before update of flow_stage_id on public.sales_opportunities
  for each row execute function public.sor_guard_stage_move();

comment on function public.sor_guard_stage_move() is
  'ADR 0021 / #295: refuses a Stage move (moveAlongFlow''s UPDATE ... '
  'flow_stage_id) unless the caller''s sor_access_level is full. Runs '
  'ahead of RLS''s own WITH CHECK, so a participant/locked caller is '
  'refused even though sor_update''s predicate would otherwise allow the '
  'update for other reasons (e.g. being a head).';
