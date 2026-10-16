-- Spec #251 review fixes (2026-10-16).
--
-- 1. transmittal_complete_stage: "the caller ... becomes one of the two
--    signatories". The caller always took the first slot, so nobody could
--    complete Warehouse checking or Technical inspection as Inspected by.
--    p_sign_as_second puts the caller in the second slot (confirmed) and the
--    named signatory in the first (awaiting confirmation). Releasing keeps
--    its caller as Released by. A new parameter means a new signature: the
--    six-argument function is dropped first.
-- 2. transmittal_confirm_signature confirms or declines whichever slot the
--    caller holds and hasn't confirmed, first or second. A decline notifies
--    the completer.
-- 3. transmittal_stages_guard froze first_confirmed and
--    first_signature_declined on a signed stage, which a first-slot co-signer
--    now needs to set. They join the second slot's, which were never frozen.
-- 4. transmittal_rate: "sets that stage's in-charge, rating, remark and
--    quantity_received". Technical inspection ignored the quantity, so a
--    Technical-only slip had nowhere to record a short delivery. Where
--    Warehouse checking ran, its figure stands (the line guard freezes it
--    once that stage is signed), so Technical leaves it as it is.

drop function if exists public.transmittal_complete_stage(uuid, text, uuid, text, text, text);

create or replace function public.transmittal_complete_stage(p_transmittal_id uuid, p_stage text, p_other_signer_id uuid, p_other_signer_name text, p_remarks text, p_no_pictures_reason text, p_sign_as_second boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  v_as_second boolean := coalesce(p_sign_as_second, false);
  v_actor_name text;
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

  -- Releasing's caller is Released by: Received by is the receiving side.
  if v_as_second and p_stage = 'warehouse_releasing' then
    raise exception 'transmittal_complete_stage: the Warehouse signs releasing as Released by' using errcode = '22023';
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

  select e.name into v_actor_name from public.employees e where e.id = v_actor;

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
         first_signer_id = case when v_as_second then p_other_signer_id else v_actor end,
         first_signed_at = now(),
         first_confirmed = not v_as_second,
         second_signer_id = case when v_as_second then v_actor else p_other_signer_id end,
         second_signer_name = case when v_as_second then v_actor_name else v_other_name end,
         second_signed_at = now(),
         second_confirmed = v_as_second
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
$function$
;

revoke all on function public.transmittal_complete_stage(uuid, text, uuid, text, text, text, boolean) from public, anon;
grant execute on function public.transmittal_complete_stage(uuid, text, uuid, text, text, text, boolean) to authenticated;

create or replace function public.transmittal_confirm_signature(p_stage_id uuid, p_confirm boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_actor uuid := public.get_employee_id();
  v_stage public.transmittal_stages;
  v_number text;
  v_first boolean;
begin
  if v_actor is null then
    raise exception 'transmittal_confirm_signature: not signed in' using errcode = '42501';
  end if;

  select * into v_stage from public.transmittal_stages s where s.id = p_stage_id for update;
  if not found then
    raise exception 'transmittal_confirm_signature: that stage doesn''t exist' using errcode = 'P0002';
  end if;
  if v_stage.completed_at is null then
    raise exception 'transmittal_confirm_signature: the stage isn''t signed yet' using errcode = '22023';
  end if;
  -- The co-signer is whichever slot the completer didn't sign: the second,
  -- or the first when the completer signed as the second.
  -- When one person holds both slots, the co-signer's is the one still open.
  if v_stage.first_signer_id = v_actor and v_stage.second_signer_id = v_actor then
    if not v_stage.first_confirmed or v_stage.first_signature_declined then
      v_first := true;
    elsif not v_stage.second_confirmed or v_stage.second_signature_declined then
      v_first := false;
    else
      raise exception 'transmittal_confirm_signature: both signatures are already confirmed' using errcode = '22023';
    end if;
  elsif v_stage.second_signer_id = v_actor and v_actor is distinct from v_stage.completed_by then
    v_first := false;
  elsif v_stage.first_signer_id = v_actor and v_actor is distinct from v_stage.completed_by then
    v_first := true;
  else
    raise exception 'transmittal_confirm_signature: only the co-signer confirms this signature' using errcode = '42501';
  end if;

  if v_first then
    update public.transmittal_stages
       set first_confirmed = coalesce(p_confirm, false), first_signature_declined = not coalesce(p_confirm, false)
     where id = p_stage_id;
  else
    update public.transmittal_stages
       set second_confirmed = coalesce(p_confirm, false), second_signature_declined = not coalesce(p_confirm, false)
     where id = p_stage_id;
  end if;

  select number into v_number from public.transmittals where id = v_stage.transmittal_id;
  perform public._transmittal_event(v_stage.transmittal_id, v_actor,
    case when coalesce(p_confirm, false) then 'signature_confirmed' else 'signature_declined' end,
    jsonb_build_object('number', v_number, 'stage', v_stage.stage));

  return jsonb_build_object(
    'id', v_stage.transmittal_id,
    'stage_id', p_stage_id,
    'confirmed', coalesce(p_confirm, false),
    'notify_id', case when coalesce(p_confirm, false) then null else v_stage.completed_by end
  );
end;
$function$
;

create or replace function public.transmittal_rate(p_transmittal_id uuid, p_line_ratings jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

    -- One quantity received per line: the Warehouse's, or Technical's on a
    -- slip with no Warehouse checking.
    v_received := nullif(v_item->>'quantity_received', '')::numeric;
    if v_received is not null and v_received < 0 then
      raise exception 'transmittal_rate: a quantity received is zero or more' using errcode = '22023';
    end if;
    if v_received = v_line.quantity then
      v_received := null;
    end if;

    if v_tech then
      update public.transmittal_lines
         set tech_in_charge_id = v_in_charge,
             tech_rating = v_rating,
             tech_remark = v_remark,
             quantity_received = case when v_row.check_warehouse then quantity_received else v_received end
       where id = v_line.id;
    else
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
$function$
;

create or replace function public.transmittal_stages_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_number text;
begin
  if tg_op = 'DELETE' then
    raise exception 'transmittal: a stage is never deleted' using errcode = '42501';
  end if;

  if old.completed_at is null then
    return new;
  end if;

  if (new.id, new.transmittal_id, new.stage, new.remarks, new.no_pictures_reason, new.completed_by,
      new.completed_at, new.first_signer_id, new.first_signed_at, new.second_signer_id, new.second_signer_name, new.second_signed_at,
      new.created_at)
     is distinct from
     (old.id, old.transmittal_id, old.stage, old.remarks, old.no_pictures_reason, old.completed_by,
      old.completed_at, old.first_signer_id, old.first_signed_at, old.second_signer_id, old.second_signer_name, old.second_signed_at,
      old.created_at) then
    select number into v_number from public.transmittals where id = old.transmittal_id;
    raise exception 'transmittal: the % stage of % is signed; its remarks and signatures can''t change',
      old.stage, v_number using errcode = '42501';
  end if;

  return new;
end;
$function$
;
