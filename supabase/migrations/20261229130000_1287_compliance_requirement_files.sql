-- ==============================================================================
-- 20261228180000_1287_compliance_requirement_files.sql
--
-- Each Compliance Requirement kind holds the papers of its own clearance (#1287, spec #1284).
--
--   ipas_compliance_requirement_files   (id, requirement_id, url, file_name, created_by, created_at), the shape
--                                       of ipas_document_files (#1153). Rows go with their requirement (unpicking a
--                                       kind or answering No). Read by whoever reads the IPAS; written only by the
--                                       two functions below. Same own-file-store link check as the other link columns.
--   ipas_add_compliance_file / ipas_remove_compliance_file
--                                       Purchasing access, Logistics access or a Super Admin (as ipas_set_compliance);
--                                       refused on a filed or cancelled IPAS and on one that does not ask. Each writes
--                                       an ipas_events row (compliance_file_added / compliance_file_removed).
--   Attaching and marking done stay apart: a kind can be done with no file.
--   The IPAS read is a table read, so each requirement's files come as an embed (ipasService COMPLIANCE_SELECT).
--   ipas_summaries_for_sor is not touched: kinds and done days only, no files.
--   The "Compliance (Local)" document_kind option is set inactive (found by label), so
--   ipas_suggest_documents stops adding it to new IPAS. Existing ipas_documents rows and files stay.
-- ==============================================================================

create table if not exists public.ipas_compliance_requirement_files (
  id uuid primary key default gen_random_uuid(),
  requirement_id uuid not null references public.ipas_compliance_requirements(id) on delete cascade,
  url text not null,
  file_name text not null,
  created_by uuid references public.employees(id),
  created_at timestamptz not null default now(),
  constraint ipas_compliance_requirement_files_url_chk check (url ~* '^https?://'),
  constraint ipas_compliance_requirement_files_name_chk check (btrim(file_name) <> '' and char_length(file_name) <= 200)
);

comment on table public.ipas_compliance_requirement_files is
  '#1287 (spec #1284): the files of a Compliance Requirement kind, any number. Written only through ipas_add_compliance_file / ipas_remove_compliance_file.';

create index if not exists ipas_compliance_requirement_files_requirement_id_idx on public.ipas_compliance_requirement_files (requirement_id);
create index if not exists ipas_compliance_requirement_files_created_by_idx on public.ipas_compliance_requirement_files (created_by);

alter table public.ipas_compliance_requirement_files enable row level security;

drop policy if exists ipas_compliance_requirement_files_read on public.ipas_compliance_requirement_files;
create policy ipas_compliance_requirement_files_read on public.ipas_compliance_requirement_files
  for select to authenticated
  using ((select public.ipas_can_read()));

revoke insert, update, delete, truncate on public.ipas_compliance_requirement_files from anon, authenticated;

drop trigger if exists ipas_compliance_requirement_files_file_link on public.ipas_compliance_requirement_files;
create trigger ipas_compliance_requirement_files_file_link
  before insert or update of url on public.ipas_compliance_requirement_files
  for each row execute function public.ipas_file_link_guard('url');

-- ------------------------------------------------------------------------------
-- Add / remove one file
-- ------------------------------------------------------------------------------
create or replace function public.ipas_add_compliance_file(
  p_requirement_id uuid,
  p_url text,
  p_file_name text default null
) returns public.ipas_compliance_requirement_files
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := public._ipas_compliance_writer('ipas_add_compliance_file');
  v_req public.ipas_compliance_requirements;
  v_ipas public.ipas;
  v_kind text;
  v_url text := nullif(btrim(p_url), '');
  v_name text;
  v_row public.ipas_compliance_requirement_files;
begin
  select * into v_req from public.ipas_compliance_requirements where id = p_requirement_id;
  if v_req.id is null then
    raise exception 'ipas_add_compliance_file: Compliance Requirement not found' using errcode = '22023';
  end if;

  v_ipas := public._ipas_compliance_lock('ipas_add_compliance_file', v_req.ipas_id);
  select * into v_req from public.ipas_compliance_requirements where id = p_requirement_id;
  if v_req.id is null then
    raise exception 'ipas_add_compliance_file: Compliance Requirement not found' using errcode = '22023';
  end if;

  if v_url is null or v_url !~* '^https?://' then
    raise exception 'ipas_add_compliance_file: the file must be a link to the uploaded file' using errcode = '22023';
  end if;
  if not public._ipas_is_own_file_link(v_url) then
    raise exception 'ipas_file_link: attach a file you uploaded here, not a link to another site' using errcode = '22023';
  end if;

  v_name := left(coalesce(nullif(btrim(p_file_name), ''), public._ipas_file_name_from_url(v_url)), 200);
  select o.label into v_kind from public.ipas_options o where o.id = v_req.kind_id;

  insert into public.ipas_compliance_requirement_files (requirement_id, url, file_name, created_by)
  values (v_req.id, v_url, v_name, v_actor)
  returning * into v_row;

  perform public._ipas_write_event(v_ipas.id, v_actor, 'compliance_file_added',
    jsonb_build_object('requirement_id', v_req.id, 'kind', v_kind, 'file_id', v_row.id, 'file_name', v_row.file_name));

  return v_row;
end;
$$;

comment on function public.ipas_add_compliance_file(uuid, text, text) is
  '#1287: adds one file to a Compliance Requirement kind (Purchasing access, Logistics access or a Super Admin; an open IPAS that asks). The link must be to the app''s own file store (#1128). Marking done is separate. Writes a compliance_file_added event.';

revoke all on function public.ipas_add_compliance_file(uuid, text, text) from public, anon;
grant execute on function public.ipas_add_compliance_file(uuid, text, text) to authenticated;

create or replace function public.ipas_remove_compliance_file(p_file_id uuid)
returns public.ipas_compliance_requirement_files
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := public._ipas_compliance_writer('ipas_remove_compliance_file');
  v_row public.ipas_compliance_requirement_files;
  v_req public.ipas_compliance_requirements;
  v_ipas public.ipas;
  v_kind text;
begin
  select * into v_row from public.ipas_compliance_requirement_files where id = p_file_id;
  if v_row.id is null then
    raise exception 'ipas_remove_compliance_file: file % not found', p_file_id using errcode = '22023';
  end if;
  select * into v_req from public.ipas_compliance_requirements where id = v_row.requirement_id;

  v_ipas := public._ipas_compliance_lock('ipas_remove_compliance_file', v_req.ipas_id);

  delete from public.ipas_compliance_requirement_files where id = v_row.id returning * into v_row;
  if v_row.id is null then
    raise exception 'ipas_remove_compliance_file: file % not found', p_file_id using errcode = '22023';
  end if;
  select o.label into v_kind from public.ipas_options o where o.id = v_req.kind_id;

  perform public._ipas_write_event(v_ipas.id, v_actor, 'compliance_file_removed',
    jsonb_build_object('requirement_id', v_req.id, 'kind', v_kind, 'file_id', v_row.id, 'file_name', v_row.file_name));

  return v_row;
end;
$$;

comment on function public.ipas_remove_compliance_file(uuid) is
  '#1287: removes one file of a Compliance Requirement kind; its other files stay (same rights and refusals as adding). Writes a compliance_file_removed event.';

revoke all on function public.ipas_remove_compliance_file(uuid) from public, anon;
grant execute on function public.ipas_remove_compliance_file(uuid) to authenticated;

-- ------------------------------------------------------------------------------
-- New IPAS stop getting "Compliance (Local)". Old IPAS keep their document and its files.
-- ------------------------------------------------------------------------------
update public.ipas_options
   set active = false
 where list = 'document_kind'
   and label = 'Compliance (Local)'
   and active;
