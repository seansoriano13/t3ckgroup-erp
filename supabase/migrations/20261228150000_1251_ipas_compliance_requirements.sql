-- #1251 (spec #1247, T1): Compliance Requirements on the IPAS (DENR, MARINA, OMB, NTC, FDA).
--
-- Storage
--   ipas_options.list = 'compliance_kind'   the kinds, seeded DENR, MARINA, OMB, NTC, FDA in that order.
--                                           Retired (active = false), never deleted. The ipas_options insert and
--                                           update policies are unchanged: Purchasing access and Super Admins.
--   ipas.compliance_asked                   false for every IPAS that exists when this runs, true for every IPAS
--                                           made after (default added as false, then changed to true).
--   ipas.compliance_needed                  null = not answered yet.
--   ipas.compliance_answered_by / _at       who answered last, and when.
--   ipas_compliance_requirements            one row per kind an IPAS needs: done_on, note, done_by. Readable by
--                                           whoever reads the IPAS; written only by the functions below.
-- Functions (security definer; Purchasing access, Logistics access or a Super Admin, same as IPAS Status)
--   ipas_set_compliance(ipas, needed, kind_ids)
--   ipas_tick_compliance(requirement, done_on, note)
--   ipas_untick_compliance(requirement)
--   Refused on a filed or cancelled IPAS and on an IPAS that does not ask. Every change writes ipas_events.
-- SOR summary
--   ipas_summaries_for_sor also returns `compliance` (null when the IPAS does not ask): each kind with its done day.
--   No note, no money.
-- Nobody is notified.

-- ------------------------------------------------------------------------------
-- The kinds
-- ------------------------------------------------------------------------------

alter table public.ipas_options drop constraint if exists ipas_options_list_chk;
alter table public.ipas_options add constraint ipas_options_list_chk check (list in (
  'payment_method', 'charge_kind', 'document_kind', 'freight_service', 'item_location',
  'transmittal_product', 'transmittal_reference', 'compliance_kind'
));

insert into public.ipas_options (list, label, sort) values
  ('compliance_kind', 'DENR', 10),
  ('compliance_kind', 'MARINA', 20),
  ('compliance_kind', 'OMB', 30),
  ('compliance_kind', 'NTC', 40),
  ('compliance_kind', 'FDA', 50)
on conflict do nothing;

-- ------------------------------------------------------------------------------
-- On the IPAS
-- ------------------------------------------------------------------------------

-- Added with default false so every IPAS that exists now never asks, then true for every IPAS made after.
alter table public.ipas add column if not exists compliance_asked boolean not null default false;
alter table public.ipas alter column compliance_asked set default true;
alter table public.ipas add column if not exists compliance_needed boolean;
alter table public.ipas add column if not exists compliance_answered_by uuid references public.employees (id);
alter table public.ipas add column if not exists compliance_answered_at timestamptz;

comment on column public.ipas.compliance_asked is
  '#1251: true when the IPAS asks whether its order needs a Compliance Requirement. False for every IPAS that existed when the column was added.';
comment on column public.ipas.compliance_needed is
  '#1251: the answer. Null = not answered yet.';

create index if not exists ipas_compliance_answered_by_idx on public.ipas (compliance_answered_by);

-- ------------------------------------------------------------------------------
-- ipas_compliance_requirements
-- ------------------------------------------------------------------------------

create table if not exists public.ipas_compliance_requirements (
  id         uuid primary key default gen_random_uuid(),
  ipas_id    uuid not null references public.ipas (id) on delete cascade,
  kind_id    uuid not null references public.ipas_options (id),
  done_on    date,
  note       text,
  done_by    uuid references public.employees (id),
  created_by uuid references public.employees (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint ipas_compliance_requirements_ipas_kind_key unique (ipas_id, kind_id),
  constraint ipas_compliance_requirements_note_chk check (note is null or (btrim(note) <> '' and char_length(note) <= 500)),
  constraint ipas_compliance_requirements_done_chk check (done_on is not null or note is null)
);

comment on table public.ipas_compliance_requirements is
  '#1251 (spec #1247): one row per Compliance Requirement kind an IPAS needs. Open while done_on is null. Written only by ipas_set_compliance, ipas_tick_compliance and ipas_untick_compliance.';

create index if not exists ipas_compliance_requirements_kind_id_idx on public.ipas_compliance_requirements (kind_id);
create index if not exists ipas_compliance_requirements_done_by_idx on public.ipas_compliance_requirements (done_by);
create index if not exists ipas_compliance_requirements_created_by_idx on public.ipas_compliance_requirements (created_by);

alter table public.ipas_compliance_requirements enable row level security;

drop policy if exists ipas_compliance_requirements_read on public.ipas_compliance_requirements;
create policy ipas_compliance_requirements_read on public.ipas_compliance_requirements
  for select to authenticated
  using ((select public.ipas_can_read()));

revoke insert, update, delete, truncate on public.ipas_compliance_requirements from anon, authenticated;

-- ------------------------------------------------------------------------------
-- Who may answer and tick
-- ------------------------------------------------------------------------------

create or replace function public._ipas_compliance_writer(p_fn text)
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_actor uuid := public.get_employee_id();
begin
  if v_actor is null then
    raise exception '%: not signed in', p_fn using errcode = '42501';
  end if;
  if not (
    coalesce(public.has_purchasing_access(), false)
    or coalesce(public.has_logistics_access(), false)
    or coalesce(public.is_super_admin(), false)
  ) then
    raise exception '%: only Purchasing, Logistics or a Super Admin answers Compliance Requirements', p_fn using errcode = '42501';
  end if;
  return v_actor;
end;
$$;

revoke all on function public._ipas_compliance_writer(text) from public, anon, authenticated;

-- Locks the IPAS open and checks that it asks.
create or replace function public._ipas_compliance_lock(p_fn text, p_ipas_id uuid)
returns public.ipas
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.ipas := public._ipas_lock_open(p_fn, p_ipas_id);
begin
  if not v_row.compliance_asked then
    raise exception '%: % does not ask about Compliance Requirements', p_fn, v_row.number using errcode = '22023';
  end if;
  return v_row;
end;
$$;

revoke all on function public._ipas_compliance_lock(text, uuid) from public, anon, authenticated;

-- ------------------------------------------------------------------------------
-- ipas_set_compliance
-- ------------------------------------------------------------------------------

create or replace function public.ipas_set_compliance(p_ipas_id uuid, p_needed boolean, p_kind_ids uuid[] default '{}')
returns public.ipas
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := public._ipas_compliance_writer('ipas_set_compliance');
  v_row public.ipas;
  v_wanted uuid[];
  v_kind record;
  v_before boolean;
begin
  if p_needed is null then
    raise exception 'ipas_set_compliance: answer Yes or No' using errcode = '22023';
  end if;

  v_row := public._ipas_compliance_lock('ipas_set_compliance', p_ipas_id);
  v_before := v_row.compliance_needed;

  if p_needed then
    select coalesce(array_agg(distinct k), '{}') into v_wanted from unnest(coalesce(p_kind_ids, '{}')) k where k is not null;
    if cardinality(v_wanted) = 0 then
      raise exception 'ipas_set_compliance: pick at least one kind' using errcode = '22023';
    end if;
    -- A kind must be a Compliance Requirement kind. A kind added now must be active; one the IPAS already
    -- holds may be retired and stays.
    if exists (
      select 1 from unnest(v_wanted) w
       where not exists (
         select 1 from public.ipas_options o
          where o.id = w and o.list = 'compliance_kind'
            and (o.active or exists (
              select 1 from public.ipas_compliance_requirements r where r.ipas_id = v_row.id and r.kind_id = o.id
            ))
       )
    ) then
      raise exception 'ipas_set_compliance: pick kinds from the active list' using errcode = '22023';
    end if;
  else
    v_wanted := '{}';
  end if;

  -- Removing a kind takes it off the IPAS (and its tick with it).
  for v_kind in
    select r.id, r.kind_id, o.label
      from public.ipas_compliance_requirements r
      join public.ipas_options o on o.id = r.kind_id
     where r.ipas_id = v_row.id and not (r.kind_id = any (v_wanted))
     order by o.sort, o.label
  loop
    delete from public.ipas_compliance_requirements where id = v_kind.id;
    perform public._ipas_write_event(v_row.id, v_actor, 'compliance_kind_removed',
      jsonb_build_object('kind_id', v_kind.kind_id, 'kind', v_kind.label));
  end loop;

  if v_before is distinct from p_needed then
    update public.ipas
       set compliance_needed = p_needed, compliance_answered_by = v_actor, compliance_answered_at = now()
     where id = v_row.id;
    perform public._ipas_write_event(v_row.id, v_actor, 'compliance_answered',
      jsonb_build_object('from', v_before, 'to', p_needed));
  end if;

  for v_kind in
    select o.id, o.label
      from public.ipas_options o
     where o.id = any (v_wanted)
       and not exists (select 1 from public.ipas_compliance_requirements r where r.ipas_id = v_row.id and r.kind_id = o.id)
     order by o.sort, o.label
  loop
    insert into public.ipas_compliance_requirements (ipas_id, kind_id, created_by)
    values (v_row.id, v_kind.id, v_actor);
    perform public._ipas_write_event(v_row.id, v_actor, 'compliance_kind_added',
      jsonb_build_object('kind_id', v_kind.id, 'kind', v_kind.label));
  end loop;

  select * into v_row from public.ipas where id = v_row.id;
  return v_row;
end;
$$;

comment on function public.ipas_set_compliance(uuid, boolean, uuid[]) is
  '#1251: answers "Does this order need a Compliance Requirement?" (Purchasing access, Logistics access or a Super Admin; an open IPAS that asks). Yes needs at least one active kind; No removes the kinds; a kind left out is removed. Writes compliance_answered, compliance_kind_added and compliance_kind_removed events.';

revoke all on function public.ipas_set_compliance(uuid, boolean, uuid[]) from public, anon;
grant execute on function public.ipas_set_compliance(uuid, boolean, uuid[]) to authenticated;

-- ------------------------------------------------------------------------------
-- ipas_tick_compliance / ipas_untick_compliance
-- ------------------------------------------------------------------------------

create or replace function public.ipas_tick_compliance(p_requirement_id uuid, p_done_on date default null, p_note text default null)
returns public.ipas_compliance_requirements
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := public._ipas_compliance_writer('ipas_tick_compliance');
  v_req public.ipas_compliance_requirements;
  v_ipas public.ipas;
  v_kind text;
  v_day date := coalesce(p_done_on, public._ipas_today());
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  select * into v_req from public.ipas_compliance_requirements where id = p_requirement_id;
  if v_req.id is null then
    raise exception 'ipas_tick_compliance: Compliance Requirement not found' using errcode = '22023';
  end if;

  v_ipas := public._ipas_compliance_lock('ipas_tick_compliance', v_req.ipas_id);
  select * into v_req from public.ipas_compliance_requirements where id = p_requirement_id;
  if v_req.id is null then
    raise exception 'ipas_tick_compliance: Compliance Requirement not found' using errcode = '22023';
  end if;

  if v_note is not null and char_length(v_note) > 500 then
    raise exception 'ipas_tick_compliance: the note is up to 500 characters' using errcode = '22023';
  end if;
  perform public._ipas_check_date('ipas_tick_compliance', v_day, 'the done day');

  if v_req.done_on is not distinct from v_day and v_req.note is not distinct from v_note then
    return v_req;
  end if;

  select o.label into v_kind from public.ipas_options o where o.id = v_req.kind_id;

  update public.ipas_compliance_requirements
     set done_on = v_day, note = v_note, done_by = v_actor, updated_at = now()
   where id = v_req.id
   returning * into v_req;

  perform public._ipas_write_event(v_ipas.id, v_actor, 'compliance_ticked',
    jsonb_build_object('requirement_id', v_req.id, 'kind', v_kind, 'done_on', v_day, 'note', v_note));

  return v_req;
end;
$$;

comment on function public.ipas_tick_compliance(uuid, date, text) is
  '#1251: ticks a Compliance Requirement done (Purchasing access, Logistics access or a Super Admin; an open IPAS that asks). The day defaults to today (Asia/Manila), never later; the note is optional, up to 500 characters. Ticking again with a new day or note changes them. Writes a compliance_ticked event.';

revoke all on function public.ipas_tick_compliance(uuid, date, text) from public, anon;
grant execute on function public.ipas_tick_compliance(uuid, date, text) to authenticated;

create or replace function public.ipas_untick_compliance(p_requirement_id uuid)
returns public.ipas_compliance_requirements
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := public._ipas_compliance_writer('ipas_untick_compliance');
  v_req public.ipas_compliance_requirements;
  v_ipas public.ipas;
  v_kind text;
begin
  select * into v_req from public.ipas_compliance_requirements where id = p_requirement_id;
  if v_req.id is null then
    raise exception 'ipas_untick_compliance: Compliance Requirement not found' using errcode = '22023';
  end if;

  v_ipas := public._ipas_compliance_lock('ipas_untick_compliance', v_req.ipas_id);
  select * into v_req from public.ipas_compliance_requirements where id = p_requirement_id;
  if v_req.id is null then
    raise exception 'ipas_untick_compliance: Compliance Requirement not found' using errcode = '22023';
  end if;

  if v_req.done_on is null then
    return v_req;
  end if;

  select o.label into v_kind from public.ipas_options o where o.id = v_req.kind_id;

  update public.ipas_compliance_requirements
     set done_on = null, note = null, done_by = null, updated_at = now()
   where id = v_req.id
   returning * into v_req;

  perform public._ipas_write_event(v_ipas.id, v_actor, 'compliance_unticked',
    jsonb_build_object('requirement_id', v_req.id, 'kind', v_kind));

  return v_req;
end;
$$;

comment on function public.ipas_untick_compliance(uuid) is
  '#1251: takes a Compliance Requirement back to open (same rights and refusals as ticking). Writes a compliance_unticked event.';

revoke all on function public.ipas_untick_compliance(uuid) from public, anon;
grant execute on function public.ipas_untick_compliance(uuid) to authenticated;

-- ------------------------------------------------------------------------------
-- The SOR's IPAS summary carries the kinds (body of #1158, plus `compliance`)
-- ------------------------------------------------------------------------------

drop function if exists public.ipas_summaries_for_sor(uuid);

create function public.ipas_summaries_for_sor(p_opportunity_id uuid)
returns table (
  ipas_id uuid,
  number text,
  po_number text,
  supplier text,
  purpose text,
  state text,
  computation_status text,
  signoffs jsonb,
  landed_cost_total_php numeric,
  landed_cost_mark text,
  status text,
  status_reached_on date,
  on_hold boolean,
  direct_delivery boolean,
  compliance jsonb
)
language sql
stable
security definer
set search_path = public
as $function$
  select
    i.id,
    i.number,
    i.po_number,
    nullif(btrim(i.odoo_copy #>> '{supplier,name}'), ''),
    i.purpose,
    i.state,
    i.computation_status,
    jsonb_build_object(
      '1', jsonb_build_object(
        'prepared', '1:prepared' = any (lv.live),
        'approved', '1:approved' = any (lv.live)
      ),
      '3', jsonb_build_object(
        'prepared', '3:prepared' = any (lv.live),
        'approved', '3:approved' = any (lv.live)
      ),
      '6', jsonb_build_object(
        'prepared', '6:prepared' = any (lv.live),
        'approved', '6:approved' = any (lv.live)
      ),
      '7', jsonb_build_object(
        'received', '7:received' = any (lv.live),
        'noted', '7:noted' = any (lv.live),
        'checked', '7:checked' = any (lv.live),
        'approved', '7:approved' = any (lv.live)
      )
    ),
    lcost.total,
    lcost.mark,
    i.status,
    (select st.reached_on from public.ipas_status_steps st where st.ipas_id = i.id and st.step = i.status),
    coalesce(i.on_hold, false),
    coalesce(i.direct_delivery, false),
    -- #1251: null on an IPAS that does not ask; else the answer and each kind with its done day (no note).
    case when i.compliance_asked then
      jsonb_build_object(
        'needed', i.compliance_needed,
        'kinds', coalesce((
          select jsonb_agg(
                   jsonb_build_object('id', r.id, 'kind_id', r.kind_id, 'label', o.label, 'done_on', r.done_on)
                   order by o.sort, o.label)
            from public.ipas_compliance_requirements r
            join public.ipas_options o on o.id = r.kind_id
           where r.ipas_id = i.id
        ), '[]'::jsonb)
      )
    end
  from public.ipas i
  cross join lateral (
    select coalesce(array_agg(so.section::text || ':' || so.role), '{}'::text[]) as live
    from public.ipas_signoffs so
    where so.ipas_id = i.id and so.cleared_at is null
  ) lv
  -- #283: the IPAS's Landed Cost total and mark, for cost-tier readers only.
  cross join lateral (
    select
      case when bool_or(l.mark = 'unavailable') then null else sum(l.total_php) end as total,
      case when count(*) = 0 then null
           when bool_or(l.mark = 'unavailable') then 'unavailable'
           when bool_and(l.mark = 'final') then 'final'
           else 'provisional' end as mark
    from public.ipas_line_landed_costs(i.id) l
    where public.costing_can_read_cost(p_opportunity_id)
  ) lcost
  where (select public.sor_access_level(p_opportunity_id)) = 'full'
    and i.purpose = 'project'
    and exists (
      select 1 from public.ipas_sors s
      where s.ipas_id = i.id and s.opportunity_id = p_opportunity_id
    )
  order by
    case i.state when 'open' then 0 when 'filed' then 1 else 2 end,
    i.number;
$function$;

comment on function public.ipas_summaries_for_sor(uuid) is
  '#249, #256, #283, #1157, #1251: the Project IPAS naming an SOR, as a summary (number, PO, supplier, Purpose, state, the IPAS Status with the day it was reached, On-Hold, Direct delivery, computation status, sign-off progress, and the Compliance Requirements: each kind with its done day, null on an IPAS that does not ask) for anyone who can read the SOR. Landed Cost total and mark only for the matrix''s cost tiers (null otherwise). Never payments, charges, bank details or the note of a Compliance Requirement. No SOR access -> no rows.';

revoke all on function public.ipas_summaries_for_sor(uuid) from public, anon;
grant execute on function public.ipas_summaries_for_sor(uuid) to authenticated;
