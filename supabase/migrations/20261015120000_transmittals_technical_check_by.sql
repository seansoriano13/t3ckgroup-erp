-- ==============================================================================
-- 20261015120000_transmittals_technical_check_by.sql
--
-- Issue #254 (Transmittals: Technical inspection and Check by, spec #251).
-- Builds on 20261015100000 (#252) and 20261015110000 (#253).
--
-- WHAT IT ADDS
-- - transmittals: the two Check by slots (signer and time each).
-- - transmittal_rate: now also rates the Technical lines (tech_in_charge, tech
--   rating, tech remark) while Technical inspection is open. Warehouse rating
--   is unchanged. Refused for anyone off the list that rates the stage.
-- - transmittal_complete_stage: now also signs Technical inspection. Needs every
--   line rated, a picture/video or a reason none, and the other signatory from
--   the Technical list. Advances the slip to awaiting_check and returns the
--   notices owed (Check by list; NA to preparer and Check by list).
-- - transmittal_check(slot): a Check by list member signs slot 1 or 2. Refused
--   for the preparer, the same person in both slots, before awaiting_check, and
--   on a PO slip without Received in Odoo by. The second signature closes the
--   slip and notifies the preparer (returned as notify_id).
--
-- FREEZE
-- - Closed (and cancelled) already refuse changes to the header, lines, stages
--   and files through the 252 and 253 triggers, for every role. Check by sets
--   closed_at and state in the same update, so no further change is possible.
--
-- SAFE TO RUN AT ANY TIME: new columns (nullable), a new function, and
-- functions replaced in place (no data change). Idempotent.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- Check by slots
-- ------------------------------------------------------------------------------

alter table public.transmittals
  add column if not exists check_by_first_id uuid references public.employees (id),
  add column if not exists check_by_first_at timestamptz,
  add column if not exists check_by_second_id uuid references public.employees (id),
  add column if not exists check_by_second_at timestamptz;

alter table public.transmittals drop constraint if exists transmittals_check_by_chk;
alter table public.transmittals add constraint transmittals_check_by_chk check (
  (check_by_first_id is null) = (check_by_first_at is null)
  and (check_by_second_id is null) = (check_by_second_at is null)
  and (check_by_second_id is null or check_by_first_id is null or check_by_second_id <> check_by_first_id)
  and (state <> 'closed' or check_by_second_id is not null)
);

comment on column public.transmittals.check_by_first_id is
  '#254: the first Check by signatory (Check by list). Set once.';
comment on column public.transmittals.check_by_second_id is
  '#254: the second Check by signatory (Check by list). Its signature closes the slip.';

-- ------------------------------------------------------------------------------
-- transmittal_rate: Warehouse (as #253) or Technical while Technical inspection is open
-- ------------------------------------------------------------------------------

create or replace function public.transmittal_rate(p_transmittal_id uuid, p_line_ratings jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := public.get_employee_id();
  v_row public.transmittals;
  v_stage public.transmittal_stages;
  v_item jsonb;
  v_line public.transmittal_lines;
  v_rating text;
  v_remark text;
  v_in_charge uuid;
  v_received numeric;
  v_count int := 0;
  v_tech boolean;
begin
  if v_actor is null then
    raise exception 'transmittal_rate: not signed in' using errcode = '42501';
  end if;

  select * into v_row from public.transmittals t where t.id = p_transmittal_id for update;
  if not found then
    raise exception 'transmittal_rate: that Transmittal doesn''t exist' using errcode = 'P0002';
  end if;

  -- Technical inspection is rated by the Technical list; Warehouse checking by the Warehouse list.
  v_tech := v_row.state = 'technical_inspection';
  if v_tech then
    if not public.transmittal_on_list('transmittal_technical') then
      raise exception 'transmittal_rate: only the Technical list rates the lines' using errcode = '42501';
    end if;
  elsif not public.transmittal_on_list('transmittal_warehouse') then
    raise exception 'transmittal_rate: only the Warehouse list rates the lines' using errcode = '42501';
  end if;
  if jsonb_typeof(p_line_ratings) is distinct from 'array' then
    raise exception 'transmittal_rate: the ratings are a list' using errcode = '22023';
  end if;

  select * into v_stage from public.transmittal_stages s
   where s.transmittal_id = p_transmittal_id
     and s.stage = case when v_tech then 'technical_inspection' else 'warehouse_checking' end;
  if not found or v_stage.completed_at is not null
     or v_row.state not in ('warehouse_checking', 'technical_inspection') then
    raise exception 'transmittal_rate: % is not open on %', case when v_tech then 'Technical inspection' else 'Warehouse checking' end,
      v_row.number using errcode = '42501';
  end if;
  if not v_tech and v_row.state <> 'warehouse_checking' then
    raise exception 'transmittal_rate: Warehouse checking is not open on %', v_row.number using errcode = '42501';
  end if;

  for v_item in select value from jsonb_array_elements(p_line_ratings) loop
    select * into v_line from public.transmittal_lines l
     where l.id = nullif(v_item->>'line_id', '')::uuid and l.transmittal_id = p_transmittal_id;
    if not found then
      raise exception 'transmittal_rate: that line isn''t on %', v_row.number using errcode = '22023';
    end if;

    v_rating := lower(coalesce(v_item->>'rating', ''));
    if v_rating not in ('gc', 'na') then
      raise exception 'transmittal_rate: each line is GC or NA' using errcode = '22023';
    end if;

    v_remark := nullif(btrim(coalesce(v_item->>'remark', '')), '');
    if v_rating = 'na' and v_remark is null then
      raise exception 'transmittal_rate: an NA needs a remark' using errcode = '22023';
    end if;

    v_in_charge := coalesce(nullif(v_item->>'in_charge_id', '')::uuid, v_actor);
    if not exists (
      select 1 from public.ipas_signer_lists l
       where l.list_key = case when v_tech then 'transmittal_technical' else 'transmittal_warehouse' end
         and l.employee_id = v_in_charge
    ) then
      raise exception 'transmittal_rate: the in-charge is on the % list',
        case when v_tech then 'Technical' else 'Warehouse' end using errcode = '22023';
    end if;

    if v_tech then
      update public.transmittal_lines
         set tech_in_charge_id = v_in_charge,
             tech_rating = v_rating,
             tech_remark = v_remark
       where id = v_line.id;
    else
      v_received := nullif(v_item->>'quantity_received', '')::numeric;
      if v_received is not null and v_received < 0 then
        raise exception 'transmittal_rate: a quantity received is zero or more' using errcode = '22023';
      end if;
      if v_received = v_line.quantity then
        v_received := null;
      end if;

      update public.transmittal_lines
         set wh_in_charge_id = v_in_charge,
             wh_rating = v_rating,
             wh_remark = v_remark,
             quantity_received = v_received
       where id = v_line.id;
    end if;
    v_count := v_count + 1;
  end loop;

  perform public._transmittal_event(p_transmittal_id, v_actor, 'rated', jsonb_build_object(
    'number', v_row.number,
    'lines', v_count,
    'stage', case when v_tech then 'technical_inspection' else 'warehouse_checking' end
  ));

  return jsonb_build_object('id', p_transmittal_id, 'number', v_row.number, 'rated', v_count);
end;
$$;

comment on function public.transmittal_rate(uuid, jsonb) is
  '#253, extended #254: the Warehouse rates lines GC or NA during Warehouse checking; the Technical list rates them during Technical inspection. Remark on NA; quantity received (Warehouse only) where it differs. Refused once the stage is signed.';

revoke all on function public.transmittal_rate(uuid, jsonb) from public, anon;
grant execute on function public.transmittal_rate(uuid, jsonb) to authenticated;

-- ------------------------------------------------------------------------------
-- transmittal_complete_stage: Warehouse stages (as #253) and Technical inspection
-- ------------------------------------------------------------------------------

create or replace function public.transmittal_complete_stage(
  p_transmittal_id uuid,
  p_stage text,
  p_other_signer_id uuid,
  p_other_signer_name text,
  p_remarks text,
  p_no_pictures_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := public.get_employee_id();
  v_row public.transmittals;
  v_stage public.transmittal_stages;
  v_other_name text;
  v_reason text := nullif(btrim(coalesce(p_no_pictures_reason, '')), '');
  v_remarks text := nullif(btrim(coalesce(p_remarks, '')), '');
  v_unrated int;
  v_na int := 0;
  v_pictures int;
  v_next_state text;
  v_next_list text := null;
  v_next_ids jsonb := '[]'::jsonb;
  v_na_ids uuid[] := '{}';
  v_tech boolean := p_stage = 'technical_inspection';
begin
  if v_actor is null then
    raise exception 'transmittal_complete_stage: not signed in' using errcode = '42501';
  end if;

  select * into v_row from public.transmittals t where t.id = p_transmittal_id for update;
  if not found then
    raise exception 'transmittal_complete_stage: that Transmittal doesn''t exist' using errcode = 'P0002';
  end if;
  if v_row.state in ('closed', 'cancelled') then
    raise exception 'transmittal_complete_stage: % is %', v_row.number, v_row.state using errcode = '42501';
  end if;
  if p_stage not in ('warehouse_checking', 'warehouse_releasing', 'technical_inspection') then
    raise exception 'transmittal_complete_stage: the stage is Warehouse checking, releasing or Technical inspection'
      using errcode = '22023';
  end if;
  if v_tech then
    if not public.transmittal_on_list('transmittal_technical') then
      raise exception 'transmittal_complete_stage: only the Technical list signs Technical inspection' using errcode = '42501';
    end if;
  elsif not public.transmittal_on_list('transmittal_warehouse') then
    raise exception 'transmittal_complete_stage: only the Warehouse list signs the Warehouse stages' using errcode = '42501';
  end if;

  select * into v_stage from public.transmittal_stages s
   where s.transmittal_id = p_transmittal_id and s.stage = p_stage
   for update;
  if not found then
    if p_stage = 'warehouse_releasing' and not v_row.check_technical then
      insert into public.transmittal_stages (transmittal_id, stage)
      values (p_transmittal_id, p_stage)
      returning * into v_stage;
    else
      raise exception 'transmittal_complete_stage: % has no % stage', v_row.number, p_stage using errcode = 'P0002';
    end if;
  end if;

  if v_stage.completed_at is not null then
    raise exception 'transmittal_complete_stage: the % stage of % is already signed', p_stage, v_row.number
      using errcode = '42501';
  end if;
  if p_stage = 'warehouse_checking' and v_row.state <> 'warehouse_checking' then
    raise exception 'transmittal_complete_stage: Warehouse checking is not open on %', v_row.number using errcode = '42501';
  end if;
  if p_stage = 'warehouse_releasing' and v_row.check_technical and v_row.state <> 'warehouse_releasing' then
    raise exception 'transmittal_complete_stage: releasing is not open on %', v_row.number using errcode = '42501';
  end if;
  if v_tech and v_row.state <> 'technical_inspection' then
    raise exception 'transmittal_complete_stage: Technical inspection is not open on %', v_row.number using errcode = '42501';
  end if;

  -- The other signatory.
  if p_stage = 'warehouse_checking' then
    if p_other_signer_id is null or not exists (
         select 1 from public.ipas_signer_lists l
          where l.list_key = 'transmittal_warehouse' and l.employee_id = p_other_signer_id
       ) then
      raise exception 'transmittal_complete_stage: name the other signatory from the Warehouse list' using errcode = '22023';
    end if;
  elsif v_tech or v_row.check_technical then
    if p_other_signer_id is null or not exists (
         select 1 from public.ipas_signer_lists l
          where l.list_key = 'transmittal_technical' and l.employee_id = p_other_signer_id
       ) then
      raise exception 'transmittal_complete_stage: the other signatory is on the Technical list' using errcode = '22023';
    end if;
  end if;

  if p_other_signer_id = v_actor then
    raise exception 'transmittal_complete_stage: the other signatory is someone else' using errcode = '22023';
  end if;

  if p_other_signer_id is not null then
    select e.name into v_other_name from public.employees e where e.id = p_other_signer_id;
    if not found then
      raise exception 'transmittal_complete_stage: that signatory doesn''t exist' using errcode = 'P0002';
    end if;
  else
    v_other_name := nullif(btrim(coalesce(p_other_signer_name, '')), '');
  end if;
  if v_other_name is null then
    raise exception 'transmittal_complete_stage: name who signs with you' using errcode = '22023';
  end if;

  select count(*) into v_pictures from public.pms_evidence e
   where e.record_type = 'transmittal_stage' and e.record_id = v_stage.id;

  if p_stage = 'warehouse_checking' then
    select count(*) into v_unrated from public.transmittal_lines l
     where l.transmittal_id = p_transmittal_id and (l.wh_rating is null or l.wh_in_charge_id is null);
    if v_unrated > 0 then
      raise exception 'transmittal_complete_stage: % line(s) of % still need a GC or NA rating',
        v_unrated, v_row.number using errcode = '22023';
    end if;
  elsif v_tech then
    select count(*) into v_unrated from public.transmittal_lines l
     where l.transmittal_id = p_transmittal_id and (l.tech_rating is null or l.tech_in_charge_id is null);
    if v_unrated > 0 then
      raise exception 'transmittal_complete_stage: % line(s) of % still need a GC or NA rating from Technical',
        v_unrated, v_row.number using errcode = '22023';
    end if;
  end if;

  -- Every stage: "Provided Pictures & Videos" is No only with a reason (spec #251).
  if v_pictures = 0 and v_reason is null then
    raise exception 'transmittal_complete_stage: attach a picture or video, or give the reason none' using errcode = '22023';
  end if;

  if p_stage = 'warehouse_checking' then
    select count(*) into v_na from public.transmittal_lines l
     where l.transmittal_id = p_transmittal_id and l.wh_rating = 'na';
  elsif v_tech then
    select count(*) into v_na from public.transmittal_lines l
     where l.transmittal_id = p_transmittal_id and l.tech_rating = 'na';
  end if;

  update public.transmittal_stages
     set remarks = v_remarks,
         no_pictures_reason = case when v_pictures > 0 then null else v_reason end,
         completed_by = v_actor,
         completed_at = now(),
         first_signer_id = v_actor,
         first_signed_at = now(),
         first_confirmed = true,
         second_signer_id = p_other_signer_id,
         second_signer_name = v_other_name,
         second_signed_at = now()
   where id = v_stage.id;

  -- Advance the slip.
  if p_stage = 'warehouse_checking' then
    if v_row.check_technical then
      v_next_state := 'warehouse_releasing';
      v_next_list := 'transmittal_warehouse';
    else
      v_next_state := 'awaiting_check';
      v_next_list := 'transmittal_check_by';
    end if;
  elsif v_tech then
    v_next_state := 'awaiting_check';
    v_next_list := 'transmittal_check_by';
  elsif v_row.check_technical then
    v_next_state := 'technical_inspection';
    v_next_list := 'transmittal_technical';
  else
    v_next_state := v_row.state;
  end if;

  if v_next_state is distinct from v_row.state then
    update public.transmittals set state = v_next_state where id = p_transmittal_id;
  end if;

  if v_next_list is not null then
    v_next_ids := public._transmittal_list_ids(v_next_list);
  end if;

  if v_na > 0 then
    v_na_ids := array(
      select distinct u from unnest(
        array_cat(
          array[v_row.prepared_by],
          array(
            select l.employee_id from public.ipas_signer_lists l
              join public.employees e on e.id = l.employee_id
             where l.list_key = 'transmittal_check_by' and not coalesce(e.is_deleted, false)
          )
        )
      ) as u
    );
  end if;

  perform public._transmittal_event(p_transmittal_id, v_actor, 'stage_signed', jsonb_build_object(
    'number', v_row.number,
    'stage', p_stage,
    'state_to', v_next_state,
    'na_count', v_na,
    'other_signer', v_other_name
  ));

  return jsonb_build_object(
    'id', p_transmittal_id,
    'number', v_row.number,
    'stage', p_stage,
    'state', v_next_state,
    'na_count', v_na,
    'notify_next_list', v_next_list,
    'notify_next_ids', v_next_ids,
    'notify_confirm_id', p_other_signer_id,
    'notify_na_ids', case when v_na > 0 then to_jsonb(v_na_ids) else '[]'::jsonb end
  );
end;
$$;

comment on function public.transmittal_complete_stage(uuid, text, uuid, text, text, text) is
  '#253, extended #254: signs Warehouse checking, Warehouse releasing or Technical inspection. Checking and inspection need every line rated and a picture or a reason none. Advances the slip (inspection to awaiting_check) and returns the notices owed.';

revoke all on function public.transmittal_complete_stage(uuid, text, uuid, text, text, text) from public, anon;
grant execute on function public.transmittal_complete_stage(uuid, text, uuid, text, text, text) to authenticated;

-- ------------------------------------------------------------------------------
-- transmittal_check: the Check by signatures (slot 1 or 2)
-- ------------------------------------------------------------------------------

-- A Check by list member signs one of the two slots on a slip awaiting Check by.
-- Refused for the preparer, for the same person in both slots, before every
-- stage is signed, and on a PO slip without Received in Odoo by. The second
-- signature closes the slip and notifies the preparer.
create or replace function public.transmittal_check(p_transmittal_id uuid, p_slot int)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := public.get_employee_id();
  v_row public.transmittals;
  v_open_stages int;
  v_po_lines int;
  v_closed boolean := false;
begin
  if v_actor is null then
    raise exception 'transmittal_check: not signed in' using errcode = '42501';
  end if;

  select * into v_row from public.transmittals t where t.id = p_transmittal_id for update;
  if not found then
    raise exception 'transmittal_check: that Transmittal doesn''t exist' using errcode = 'P0002';
  end if;
  if not public.transmittal_on_list('transmittal_check_by') then
    raise exception 'transmittal_check: only the Check by list signs a Transmittal' using errcode = '42501';
  end if;
  if p_slot is null or p_slot not in (1, 2) then
    raise exception 'transmittal_check: the slot is 1 or 2' using errcode = '22023';
  end if;
  if v_row.state <> 'awaiting_check' then
    raise exception 'transmittal_check: % is %, not awaiting Check by', v_row.number, v_row.state using errcode = '42501';
  end if;
  if v_row.prepared_by = v_actor then
    raise exception 'transmittal_check: the preparer can''t check their own slip' using errcode = '42501';
  end if;

  if p_slot = 1 and v_row.check_by_first_id is not null
     or p_slot = 2 and v_row.check_by_second_id is not null then
    raise exception 'transmittal_check: that Check by slot is signed already' using errcode = '22023';
  end if;
  if (v_row.check_by_first_id = v_actor and p_slot = 2)
     or (v_row.check_by_second_id = v_actor and p_slot = 1) then
    raise exception 'transmittal_check: the same person can''t sign both Check by slots' using errcode = '42501';
  end if;

  select count(*) into v_open_stages from public.transmittal_stages s
   where s.transmittal_id = p_transmittal_id and s.completed_at is null;
  if v_open_stages > 0 then
    raise exception 'transmittal_check: % has a stage still open', v_row.number using errcode = '22023';
  end if;

  select count(*) into v_po_lines from public.transmittal_lines l
   where l.transmittal_id = p_transmittal_id and l.kind = 'po_line';
  if v_po_lines > 0 and v_row.odoo_received_at is null then
    raise exception 'transmittal_check: % is a PO slip; record Received in Odoo first', v_row.number using errcode = '22023';
  end if;

  if p_slot = 1 then
    update public.transmittals
       set check_by_first_id = v_actor, check_by_first_at = now()
     where id = p_transmittal_id;
  else
    update public.transmittals
       set check_by_second_id = v_actor, check_by_second_at = now()
     where id = p_transmittal_id;
  end if;

  -- The second signature closes the slip.
  if (p_slot = 1 and v_row.check_by_second_id is not null)
     or (p_slot = 2 and v_row.check_by_first_id is not null) then
    v_closed := true;
    update public.transmittals
       set state = 'closed', closed_at = now()
     where id = p_transmittal_id;
  end if;

  perform public._transmittal_event(p_transmittal_id, v_actor,
    case when v_closed then 'closed' else 'check_signed' end,
    jsonb_build_object('number', v_row.number, 'slot', p_slot));

  return jsonb_build_object(
    'id', p_transmittal_id,
    'number', v_row.number,
    'slot', p_slot,
    'state', case when v_closed then 'closed' else 'awaiting_check' end,
    'closed', v_closed,
    'notify_id', case when v_closed then v_row.prepared_by else null end
  );
end;
$$;

comment on function public.transmittal_check(uuid, int) is
  '#254: a Check by list member signs slot 1 or 2 on a slip awaiting Check by. The second signature closes the slip.';

revoke all on function public.transmittal_check(uuid, int) from public, anon;
grant execute on function public.transmittal_check(uuid, int) to authenticated;
