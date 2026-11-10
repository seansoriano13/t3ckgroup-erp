-- ==============================================================================
-- 20261015110000_transmittals_warehouse_checking.sql
--
-- Issue #253 (Transmittals: Warehouse checking, releasing and Received in Odoo,
-- spec #251). Builds on 20261015100000 (#252).
--
-- WHAT IT ADDS
-- - Evidence: the private `pms-evidence` bucket (50 MB a file) and the
--   `pms_evidence` table, for `transmittal_stage` records. Readable by exactly
--   the Transmittal's readers (transmittal_can_read). Files are added while the
--   stage is open and by its list only.
-- - transmittal_rate: the Warehouse in-charge rates each line GC or NA, with a
--   remark on NA and a quantity received only where it differs.
-- - transmittal_complete_stage: signs Warehouse checking or Warehouse releasing.
--   Checking needs every line rated and a picture/video or a no-pictures reason.
--   Releasing may be opened on a Warehouse-only slip (optional) and never
--   blocks Check by. Advances the slip and returns the notices owed.
-- - transmittal_confirm_signature: the co-signer confirms or declines.
-- - transmittal_received_in_odoo: Warehouse list or Purchasing access, from
--   submission until closed.
-- - transmittal_stage_list_members: the names on a staff list, for the
--   signatory pickers (readers of the Transmittal only).
--
-- FREEZES (triggers, so they hold for every role, the service role included)
-- - A signed stage's remarks, signatures, pictures and no-pictures reason never
--   change. Only the co-signer's confirm / decline flags move.
-- - A signed Warehouse checking stage refuses changes to its lines' Warehouse
--   ratings and quantity received. Same for Technical inspection (#254 writes
--   its ratings through the same guard).
-- - Pictures are added or removed only while their stage is open.
--
-- Storage objects cannot be frozen from SQL: a signed stage's file is still
-- there if someone with the service key deletes it from the Storage API. The
-- row is refused. Noted in the ticket.
--
-- SAFE TO RUN AT ANY TIME, against a live frontend of any version: a new
-- table, a new bucket, new functions and policies, and two triggers replaced
-- on the transmittal tables (no data change). Idempotent.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- Evidence bucket and table
-- ------------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('pms-evidence', 'pms-evidence', false, 52428800, null)
on conflict (id) do nothing;

-- Path inside the bucket: <transmittal id>/<stage id>/<uuid>-<file name>.
create table if not exists public.pms_evidence (
  id              uuid primary key default gen_random_uuid(),
  record_type     text not null,
  record_id       uuid not null,
  transmittal_id  uuid not null references public.transmittals (id) on delete cascade,
  kind            text not null,
  storage_path    text not null,
  file_name       text not null,
  mime_type       text,
  size_bytes      bigint not null,
  uploaded_by     uuid references public.employees (id),
  created_at      timestamptz not null default now(),

  constraint pms_evidence_path_key unique (storage_path),
  constraint pms_evidence_record_type_chk check (record_type in ('transmittal_stage')),
  constraint pms_evidence_kind_chk check (kind in ('picture', 'video')),
  constraint pms_evidence_size_chk check (size_bytes > 0 and size_bytes <= 52428800),
  constraint pms_evidence_name_chk check (length(btrim(file_name)) > 0)
);

comment on table public.pms_evidence is
  'Pictures and videos attached to a Transmittal stage (#253, spec #251). Files live in the private pms-evidence bucket. Added or removed only while the stage is open; never updated.';

create index if not exists pms_evidence_record_idx on public.pms_evidence (record_type, record_id);
create index if not exists pms_evidence_transmittal_id_idx on public.pms_evidence (transmittal_id);
create index if not exists pms_evidence_uploaded_by_idx on public.pms_evidence (uploaded_by);

-- ------------------------------------------------------------------------------
-- Helpers
-- ------------------------------------------------------------------------------

-- The Transmittal a bucket path belongs to, or null when the path isn't one.
create or replace function public._pms_evidence_transmittal_id(p_name text)
returns uuid
language plpgsql
stable
set search_path = public, storage
as $$
begin
  return (storage.foldername(p_name))[1]::uuid;
exception when others then
  return null;
end;
$$;

-- Whether a bucket path belongs to a stage that is still open and whose list
-- the caller is on. Used by the storage policies.
create or replace function public._pms_evidence_stage_open(p_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = public, storage
as $$
declare
  v_stage_id uuid;
  v_row record;
begin
  begin
    v_stage_id := (storage.foldername(p_name))[2]::uuid;
  exception when others then
    return false;
  end;

  select s.stage, s.completed_at, s.transmittal_id, t.state
    into v_row
    from public.transmittal_stages s
    join public.transmittals t on t.id = s.transmittal_id
   where s.id = v_stage_id;

  if not found or v_row.completed_at is not null or v_row.state in ('closed', 'cancelled') then
    return false;
  end if;
  if v_row.transmittal_id::text is distinct from (storage.foldername(p_name))[1] then
    return false;
  end if;

  return public.transmittal_on_list(
    case when v_row.stage = 'technical_inspection' then 'transmittal_technical' else 'transmittal_warehouse' end
  );
end;
$$;

-- The active employees on a staff list, as { id, name } objects.
create or replace function public._transmittal_list_ids(p_list_key text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(l.employee_id order by l.employee_id), '[]'::jsonb)
    from public.ipas_signer_lists l
    join public.employees e on e.id = l.employee_id
   where l.list_key = p_list_key
     and not coalesce(e.is_deleted, false);
$$;

revoke all on function public._pms_evidence_transmittal_id(text) from public, anon;
revoke all on function public._pms_evidence_stage_open(text) from public, anon;
revoke all on function public._transmittal_list_ids(text) from public, anon, authenticated;
grant execute on function public._pms_evidence_transmittal_id(text) to authenticated;
grant execute on function public._pms_evidence_stage_open(text) to authenticated;

-- ------------------------------------------------------------------------------
-- Freezes (triggers)
-- ------------------------------------------------------------------------------

-- A stage: open, it changes only through the RPCs. Signed, nothing changes but
-- the co-signer's confirm / decline flags. Never deleted.
create or replace function public.transmittal_stages_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
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
      new.completed_at, new.first_signer_id, new.first_signed_at, new.first_confirmed,
      new.first_signature_declined, new.second_signer_id, new.second_signer_name, new.second_signed_at,
      new.created_at)
     is distinct from
     (old.id, old.transmittal_id, old.stage, old.remarks, old.no_pictures_reason, old.completed_by,
      old.completed_at, old.first_signer_id, old.first_signed_at, old.first_confirmed,
      old.first_signature_declined, old.second_signer_id, old.second_signer_name, old.second_signed_at,
      old.created_at) then
    select number into v_number from public.transmittals where id = old.transmittal_id;
    raise exception 'transmittal: the % stage of % is signed; its remarks and signatures can''t change',
      old.stage, v_number using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists transmittal_stages_guard on public.transmittal_stages;
create trigger transmittal_stages_guard
  before update or delete on public.transmittal_stages
  for each row execute function public.transmittal_stages_guard();

-- Lines: as #252 (draft takes any change; submitted fixes the identity columns;
-- closed or cancelled takes nothing), plus the stage freezes on the ratings.
create or replace function public.transmittal_lines_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid := coalesce(new.transmittal_id, old.transmittal_id);
  v_state text;
  v_number text;
begin
  select state, number into v_state, v_number from public.transmittals where id = v_id;

  if tg_op = 'DELETE' then
    if v_state is distinct from 'draft' then
      raise exception 'transmittal: % is %, and its lines can''t change', v_number, v_state using errcode = '42501';
    end if;
    return old;
  end if;

  if tg_op = 'INSERT' then
    if v_state is distinct from 'draft' then
      raise exception 'transmittal: % is %, and its lines can''t change', v_number, v_state using errcode = '42501';
    end if;
    return new;
  end if;

  -- UPDATE
  if v_state in ('closed', 'cancelled') then
    raise exception 'transmittal: % is %, and its lines can''t change', v_number, v_state using errcode = '42501';
  end if;
  if v_state = 'draft' then
    return new;
  end if;

  if (new.position, new.kind, new.ipas_id, new.odoo_po_line_id, new.description, new.quantity,
      new.unit, new.opportunity_id, new.serial_numbers, new.box_quantity)
     is distinct from
     (old.position, old.kind, old.ipas_id, old.odoo_po_line_id, old.description, old.quantity,
      old.unit, old.opportunity_id, old.serial_numbers, old.box_quantity) then
    raise exception 'transmittal: % is submitted; its lines are fixed', v_number using errcode = '42501';
  end if;

  if (new.wh_in_charge_id, new.wh_rating, new.wh_remark, new.quantity_received)
     is distinct from
     (old.wh_in_charge_id, old.wh_rating, old.wh_remark, old.quantity_received) then
    if exists (
      select 1 from public.transmittal_stages s
       where s.transmittal_id = v_id and s.stage = 'warehouse_checking' and s.completed_at is not null
    ) then
      raise exception 'transmittal: % Warehouse checking is signed; its ratings can''t change', v_number
        using errcode = '42501';
    end if;
  end if;

  if (new.tech_in_charge_id, new.tech_rating, new.tech_remark)
     is distinct from
     (old.tech_in_charge_id, old.tech_rating, old.tech_remark) then
    if exists (
      select 1 from public.transmittal_stages s
       where s.transmittal_id = v_id and s.stage = 'technical_inspection' and s.completed_at is not null
    ) then
      raise exception 'transmittal: % Technical inspection is signed; its ratings can''t change', v_number
        using errcode = '42501';
    end if;
  end if;

  return new;
end;
$$;

-- Evidence: added and removed while the stage is open; never updated; the
-- stage must belong to the same Transmittal.
create or replace function public.pms_evidence_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_stage_id uuid := coalesce(new.record_id, old.record_id);
  v_stage_tx uuid;
  v_done timestamptz;
  v_state text;
  v_number text;
begin
  if tg_op = 'UPDATE' then
    raise exception 'pms_evidence: a file is added or removed, never changed' using errcode = '42501';
  end if;

  select s.transmittal_id, s.completed_at, t.state, t.number
    into v_stage_tx, v_done, v_state, v_number
    from public.transmittal_stages s
    join public.transmittals t on t.id = s.transmittal_id
   where s.id = v_stage_id;

  if not found then
    raise exception 'pms_evidence: that stage doesn''t exist' using errcode = 'P0002';
  end if;
  if v_done is not null or v_state in ('closed', 'cancelled') then
    raise exception 'transmittal: the stage of % is signed or ended; its files can''t change', v_number
      using errcode = '42501';
  end if;
  if tg_op = 'INSERT' and new.transmittal_id is distinct from v_stage_tx then
    raise exception 'pms_evidence: the file must belong to its stage''s Transmittal' using errcode = '22023';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists pms_evidence_guard on public.pms_evidence;
create trigger pms_evidence_guard
  before insert or update or delete on public.pms_evidence
  for each row execute function public.pms_evidence_guard();

-- ------------------------------------------------------------------------------
-- Row level security: reads only; writes are RPCs (and the guards above)
-- ------------------------------------------------------------------------------

alter table public.pms_evidence enable row level security;

drop policy if exists pms_evidence_read on public.pms_evidence;
create policy pms_evidence_read on public.pms_evidence
  for select to authenticated
  using (public.transmittal_can_read(transmittal_id));

revoke insert, update, delete, truncate on public.pms_evidence from anon, authenticated;

-- Storage: the bucket is private. Readers of the Transmittal read its files;
-- a file is added while its stage is open and by that stage's list; a file is
-- removed by whoever added it, while the stage is open.
drop policy if exists "pms_evidence_insert_open_stage" on storage.objects;
create policy "pms_evidence_insert_open_stage"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'pms-evidence'
  and public._pms_evidence_stage_open(name)
);

drop policy if exists "pms_evidence_select_readers" on storage.objects;
create policy "pms_evidence_select_readers"
on storage.objects for select
to authenticated
using (
  bucket_id = 'pms-evidence'
  and public._pms_evidence_transmittal_id(name) is not null
  and public.transmittal_can_read(public._pms_evidence_transmittal_id(name))
);

drop policy if exists "pms_evidence_delete_uploader" on storage.objects;
create policy "pms_evidence_delete_uploader"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'pms-evidence'
  and public._pms_evidence_stage_open(name)
  and exists (
    select 1 from public.pms_evidence e
     where e.storage_path = name
       and e.uploaded_by = public.get_employee_id()
  )
);

-- ------------------------------------------------------------------------------
-- RPCs
-- ------------------------------------------------------------------------------

-- The names on one staff list, for a signatory picker. Readers of the slip only.
create or replace function public.transmittal_stage_list_members(p_transmittal_id uuid, p_list_key text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.transmittal_can_read(p_transmittal_id) then
    raise exception 'transmittal_stage_list_members: that Transmittal doesn''t exist or you can''t read it'
      using errcode = '42501';
  end if;
  if p_list_key not in ('transmittal_warehouse', 'transmittal_technical', 'transmittal_logistics', 'transmittal_check_by') then
    raise exception 'transmittal_stage_list_members: % isn''t a Transmittal list', p_list_key using errcode = '22023';
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object('id', e.id, 'name', e.name) order by e.name)
      from public.ipas_signer_lists l
      join public.employees e on e.id = l.employee_id
     where l.list_key = p_list_key
       and not coalesce(e.is_deleted, false)
  ), '[]'::jsonb);
end;
$$;

comment on function public.transmittal_stage_list_members(uuid, text) is
  '#253: the active members of one Transmittal staff list, for the signatory pickers. Readers of the slip only.';

revoke all on function public.transmittal_stage_list_members(uuid, text) from public, anon;
grant execute on function public.transmittal_stage_list_members(uuid, text) to authenticated;

-- Rates the lines of a Warehouse checking stage. p_line_ratings is an array of
-- { line_id, rating ('gc' | 'na'), remark, in_charge_id, quantity_received }.
-- The in-charge defaults to the caller and must be on the Warehouse list. An NA
-- needs a remark. A quantity received is kept only where it differs from the
-- quantity sent. Refused once the stage is signed.
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
begin
  if v_actor is null then
    raise exception 'transmittal_rate: not signed in' using errcode = '42501';
  end if;

  select * into v_row from public.transmittals t where t.id = p_transmittal_id for update;
  if not found then
    raise exception 'transmittal_rate: that Transmittal doesn''t exist' using errcode = 'P0002';
  end if;
  if not public.transmittal_on_list('transmittal_warehouse') then
    raise exception 'transmittal_rate: only the Warehouse list rates the lines' using errcode = '42501';
  end if;
  if jsonb_typeof(p_line_ratings) is distinct from 'array' then
    raise exception 'transmittal_rate: the ratings are a list' using errcode = '22023';
  end if;

  select * into v_stage from public.transmittal_stages s
   where s.transmittal_id = p_transmittal_id and s.stage = 'warehouse_checking';
  if not found or v_stage.completed_at is not null or v_row.state <> 'warehouse_checking' then
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
       where l.list_key = 'transmittal_warehouse' and l.employee_id = v_in_charge
    ) then
      raise exception 'transmittal_rate: the in-charge is on the Warehouse list' using errcode = '22023';
    end if;

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
    v_count := v_count + 1;
  end loop;

  perform public._transmittal_event(p_transmittal_id, v_actor, 'rated', jsonb_build_object(
    'number', v_row.number,
    'lines', v_count
  ));

  return jsonb_build_object('id', p_transmittal_id, 'number', v_row.number, 'rated', v_count);
end;
$$;

comment on function public.transmittal_rate(uuid, jsonb) is
  '#253: the Warehouse in-charge rates a slip''s lines GC or NA during Warehouse checking. Remark on NA; quantity received only where it differs. Refused once checking is signed.';

revoke all on function public.transmittal_rate(uuid, jsonb) from public, anon;
grant execute on function public.transmittal_rate(uuid, jsonb) to authenticated;

-- Signs a Warehouse stage. The caller is on the Warehouse list and is the first
-- signatory; p_other_signer_id names the other (on the Warehouse list for
-- checking; on the Technical list for releasing when Technical follows; any
-- employee, or a typed p_other_signer_name, otherwise). Checking needs every
-- line rated and a picture/video or a reason none. Releasing on a Warehouse-only
-- slip opens its row here when it doesn't exist yet.
--
-- Returns the notices owed: next list and its members, the co-signer to
-- confirm, and the NA recipients (the preparer and the Check by list).
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
  if p_stage not in ('warehouse_checking', 'warehouse_releasing') then
    raise exception 'transmittal_complete_stage: the Warehouse signs Warehouse checking or releasing' using errcode = '22023';
  end if;
  if not public.transmittal_on_list('transmittal_warehouse') then
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

  -- The other signatory.
  if p_stage = 'warehouse_checking' then
    if p_other_signer_id is null or not exists (
         select 1 from public.ipas_signer_lists l
          where l.list_key = 'transmittal_warehouse' and l.employee_id = p_other_signer_id
       ) then
      raise exception 'transmittal_complete_stage: name the other signatory from the Warehouse list' using errcode = '22023';
    end if;
  elsif v_row.check_technical then
    if p_other_signer_id is null or not exists (
         select 1 from public.ipas_signer_lists l
          where l.list_key = 'transmittal_technical' and l.employee_id = p_other_signer_id
       ) then
      raise exception 'transmittal_complete_stage: Received by is on the Technical list' using errcode = '22023';
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
    if v_pictures = 0 and v_reason is null then
      raise exception 'transmittal_complete_stage: attach a picture or video, or give the reason none' using errcode = '22023';
    end if;

    select count(*) into v_na from public.transmittal_lines l
     where l.transmittal_id = p_transmittal_id and l.wh_rating = 'na';
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
  '#253: the Warehouse signs Warehouse checking or releasing. Checking needs every line rated and a picture or a reason none. Advances the slip and returns the notices owed.';

revoke all on function public.transmittal_complete_stage(uuid, text, uuid, text, text, text) from public, anon;
grant execute on function public.transmittal_complete_stage(uuid, text, uuid, text, text, text) to authenticated;

-- The co-signer confirms or declines the signature stored for them on a signed
-- stage. The only change a signed stage takes (see transmittal_stages_guard).
create or replace function public.transmittal_confirm_signature(p_stage_id uuid, p_confirm boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := public.get_employee_id();
  v_stage public.transmittal_stages;
  v_number text;
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
  if v_stage.second_signer_id is distinct from v_actor then
    raise exception 'transmittal_confirm_signature: only the co-signer confirms this signature' using errcode = '42501';
  end if;

  if coalesce(p_confirm, false) then
    update public.transmittal_stages
       set second_confirmed = true, second_signature_declined = false
     where id = p_stage_id;
  else
    update public.transmittal_stages
       set second_confirmed = false, second_signature_declined = true
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
    'notify_id', case when coalesce(p_confirm, false) then null else v_stage.first_signer_id end
  );
end;
$$;

comment on function public.transmittal_confirm_signature(uuid, boolean) is
  '#253: the co-signer of a signed stage confirms or declines the signature stored for them.';

revoke all on function public.transmittal_confirm_signature(uuid, boolean) from public, anon;
grant execute on function public.transmittal_confirm_signature(uuid, boolean) to authenticated;

-- Records the slip's receipt into Odoo: the signer, the time and the optional
-- Odoo receipt reference. Warehouse list or Purchasing access, from submission
-- until the slip closes.
create or replace function public.transmittal_received_in_odoo(p_transmittal_id uuid, p_ref text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := public.get_employee_id();
  v_row public.transmittals;
  v_ref text := nullif(btrim(coalesce(p_ref, '')), '');
  v_at timestamptz := now();
begin
  if v_actor is null then
    raise exception 'transmittal_received_in_odoo: not signed in' using errcode = '42501';
  end if;

  select * into v_row from public.transmittals t where t.id = p_transmittal_id for update;
  if not found then
    raise exception 'transmittal_received_in_odoo: that Transmittal doesn''t exist' using errcode = 'P0002';
  end if;
  if not (public.transmittal_on_list('transmittal_warehouse') or coalesce(public.has_purchasing_access(), false)) then
    raise exception 'transmittal_received_in_odoo: only the Warehouse list or Purchasing records the Odoo receipt'
      using errcode = '42501';
  end if;
  if v_row.state not in ('warehouse_checking', 'warehouse_releasing', 'technical_inspection', 'awaiting_check') then
    raise exception 'transmittal_received_in_odoo: % is %; the Odoo receipt is recorded from submission until close',
      v_row.number, v_row.state using errcode = '22023';
  end if;
  if v_row.odoo_received_at is not null then
    raise exception 'transmittal_received_in_odoo: % already has its Odoo receipt', v_row.number using errcode = '22023';
  end if;

  update public.transmittals
     set odoo_received_by = v_actor, odoo_received_at = v_at, odoo_receipt_ref = v_ref
   where id = p_transmittal_id;

  perform public._transmittal_event(p_transmittal_id, v_actor, 'received_in_odoo', jsonb_build_object(
    'number', v_row.number,
    'receipt_ref', v_ref
  ));

  return jsonb_build_object('id', p_transmittal_id, 'number', v_row.number, 'received_at', v_at, 'receipt_ref', v_ref);
end;
$$;

comment on function public.transmittal_received_in_odoo(uuid, text) is
  '#253: records who received the slip into Odoo, when and under which receipt reference. Warehouse list or Purchasing, from submission until close.';

revoke all on function public.transmittal_received_in_odoo(uuid, text) from public, anon;
grant execute on function public.transmittal_received_in_odoo(uuid, text) to authenticated;

-- Records a picture or video the storage upload just made for an open stage.
-- The file's path must sit under this Transmittal and stage.
create or replace function public.transmittal_attach_evidence(
  p_stage_id uuid,
  p_kind text,
  p_path text,
  p_file_name text,
  p_mime text,
  p_size bigint
)
returns jsonb
language plpgsql
security definer
set search_path = public, storage
as $$
declare
  v_actor uuid := public.get_employee_id();
  v_stage public.transmittal_stages;
  v_row public.transmittals;
  v_id uuid;
begin
  if v_actor is null then
    raise exception 'transmittal_attach_evidence: not signed in' using errcode = '42501';
  end if;

  select * into v_stage from public.transmittal_stages s where s.id = p_stage_id;
  if not found then
    raise exception 'transmittal_attach_evidence: that stage doesn''t exist' using errcode = 'P0002';
  end if;
  select * into v_row from public.transmittals t where t.id = v_stage.transmittal_id;

  if v_stage.completed_at is not null or v_row.state in ('closed', 'cancelled') then
    raise exception 'transmittal_attach_evidence: the stage of % is signed; its files can''t change', v_row.number
      using errcode = '42501';
  end if;
  if not public.transmittal_on_list(
       case when v_stage.stage = 'technical_inspection' then 'transmittal_technical' else 'transmittal_warehouse' end
     ) then
    raise exception 'transmittal_attach_evidence: only the stage''s list adds files' using errcode = '42501';
  end if;
  if p_kind not in ('picture', 'video') then
    raise exception 'transmittal_attach_evidence: a file is a picture or a video' using errcode = '22023';
  end if;
  if p_size is null or p_size <= 0 or p_size > 52428800 then
    raise exception 'transmittal_attach_evidence: a file is 50 MB or less' using errcode = '22023';
  end if;
  if p_path is null
     or public._pms_evidence_transmittal_id(p_path) is distinct from v_row.id
     or (storage.foldername(p_path))[2] is distinct from p_stage_id::text then
    raise exception 'transmittal_attach_evidence: that file isn''t stored for this stage' using errcode = '22023';
  end if;

  insert into public.pms_evidence (
    record_type, record_id, transmittal_id, kind, storage_path, file_name, mime_type, size_bytes, uploaded_by
  ) values (
    'transmittal_stage', p_stage_id, v_row.id, p_kind, p_path,
    coalesce(nullif(btrim(p_file_name), ''), 'file'), p_mime, p_size, v_actor
  )
  returning id into v_id;

  return jsonb_build_object('id', v_id, 'transmittal_id', v_row.id, 'stage_id', p_stage_id);
end;
$$;

comment on function public.transmittal_attach_evidence(uuid, text, text, text, text, bigint) is
  '#253: records a picture or video uploaded for an open stage. The stage''s list adds files while the stage is open.';

revoke all on function public.transmittal_attach_evidence(uuid, text, text, text, text, bigint) from public, anon;
grant execute on function public.transmittal_attach_evidence(uuid, text, text, text, text, bigint) to authenticated;

-- Removes a picture or video its uploader added, while the stage is open. The
-- client removes the stored file first (the storage policy needs this row),
-- then calls this.
create or replace function public.transmittal_remove_evidence(p_evidence_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := public.get_employee_id();
  v_ev public.pms_evidence;
begin
  if v_actor is null then
    raise exception 'transmittal_remove_evidence: not signed in' using errcode = '42501';
  end if;

  select * into v_ev from public.pms_evidence e where e.id = p_evidence_id for update;
  if not found then
    raise exception 'transmittal_remove_evidence: that file doesn''t exist' using errcode = 'P0002';
  end if;
  if v_ev.uploaded_by is distinct from v_actor then
    raise exception 'transmittal_remove_evidence: only the uploader removes a file' using errcode = '42501';
  end if;

  delete from public.pms_evidence where id = p_evidence_id;

  perform public._transmittal_event(v_ev.transmittal_id, v_actor, 'evidence_removed', jsonb_build_object(
    'file_name', v_ev.file_name,
    'stage_id', v_ev.record_id
  ));

  return jsonb_build_object('id', p_evidence_id, 'storage_path', v_ev.storage_path);
end;
$$;

comment on function public.transmittal_remove_evidence(uuid) is
  '#253: removes a picture or video its uploader added, while the stage is open.';

revoke all on function public.transmittal_remove_evidence(uuid) from public, anon;
grant execute on function public.transmittal_remove_evidence(uuid) to authenticated;
