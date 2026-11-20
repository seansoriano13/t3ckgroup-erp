-- 20261221130200_1153_ipas_document_files.sql
-- #1153 (spec #1151, T7): an IPAS document holds any number of files.
--
--   * ipas_document_files (id, document_id, url, file_name, created_by, created_at). Rows go when
--     their document goes.
--   * Every non-null ipas_documents.attachment_url moves in as that document's first file. The column
--     stays, read-only, for a later clean-up. A document inserted with an attachment_url (ipas_add_document)
--     gets that file row from a trigger, so nothing new reads the column.
--   * ipas_add_document_file / ipas_remove_document_file replace ipas_set_document_attachment: same writer
--     rule (_ipas_purchasing_writer), same own-file-store link check (#1128), same refusal on a filed or
--     cancelled IPAS (_ipas_lock_document -> _ipas_lock_open).
--   * "Purchasing has it" and "Finance has it" stay on the document.
--   * _ipas_missing_documents counts a document as present when it has at least one file.

-- ---------------------------------------------------------------------------
-- The table
-- ---------------------------------------------------------------------------
create table if not exists public.ipas_document_files (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.ipas_documents(id) on delete cascade,
  url text not null,
  file_name text not null,
  created_by uuid references public.employees(id),
  created_at timestamptz not null default now(),
  constraint ipas_document_files_url_chk check (url ~* '^https?://'),
  constraint ipas_document_files_name_chk check (btrim(file_name) <> '' and char_length(file_name) <= 200)
);

comment on table public.ipas_document_files is
  '#1153: the files of an IPAS document, any number. Written only through ipas_add_document_file / ipas_remove_document_file.';

create index if not exists ipas_document_files_document_id_idx on public.ipas_document_files (document_id);
create index if not exists ipas_document_files_created_by_idx on public.ipas_document_files (created_by);

alter table public.ipas_document_files enable row level security;

drop policy if exists ipas_document_files_read on public.ipas_document_files;
create policy ipas_document_files_read on public.ipas_document_files
  for select to authenticated
  using ((select public.ipas_can_read()));

revoke insert, update, delete, truncate on public.ipas_document_files from anon, authenticated;

-- Same own-file-store link check as the other three link columns (#1128).
drop trigger if exists ipas_document_files_file_link on public.ipas_document_files;
create trigger ipas_document_files_file_link
  before insert or update of url on public.ipas_document_files
  for each row execute function public.ipas_file_link_guard('url');

-- ---------------------------------------------------------------------------
-- A readable name from a link: the last path part; "File" if there is none.
-- ---------------------------------------------------------------------------
create or replace function public._ipas_file_name_from_url(p_url text)
returns text
language sql
immutable
set search_path = public
as $$
  select coalesce(
    nullif(left(btrim(regexp_replace(split_part(split_part(p_url, '?', 1), '#', 1), '^.*/', '')), 200), ''),
    'File'
  );
$$;

revoke all on function public._ipas_file_name_from_url(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Move what is there: each attachment_url becomes the document's first file.
-- ---------------------------------------------------------------------------
insert into public.ipas_document_files (document_id, url, file_name, created_by, created_at)
select d.id, btrim(d.attachment_url), public._ipas_file_name_from_url(btrim(d.attachment_url)), d.created_by, d.created_at
  from public.ipas_documents d
 where d.attachment_url is not null
   and btrim(d.attachment_url) <> ''
   and not exists (select 1 from public.ipas_document_files f where f.document_id = d.id);

-- A document added with a file (ipas_add_document's p_attachment_url) gets its first file row.
create or replace function public._ipas_document_first_file()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.attachment_url is not null and btrim(new.attachment_url) <> '' then
    insert into public.ipas_document_files (document_id, url, file_name, created_by)
    values (new.id, btrim(new.attachment_url), public._ipas_file_name_from_url(btrim(new.attachment_url)), new.created_by);
  end if;
  return new;
end;
$$;

revoke all on function public._ipas_document_first_file() from public, anon, authenticated;

drop trigger if exists ipas_documents_first_file on public.ipas_documents;
create trigger ipas_documents_first_file
  after insert on public.ipas_documents
  for each row execute function public._ipas_document_first_file();

-- ---------------------------------------------------------------------------
-- Add / remove one file
-- ---------------------------------------------------------------------------
drop function if exists public.ipas_set_document_attachment(uuid, text);

create or replace function public.ipas_add_document_file(
  p_document_id uuid,
  p_url text,
  p_file_name text default null
) returns public.ipas_document_files
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := public._ipas_purchasing_writer('ipas_add_document_file');
  v_doc public.ipas_documents;
  v_url text := nullif(btrim(p_url), '');
  v_name text;
  v_row public.ipas_document_files;
begin
  v_doc := public._ipas_lock_document('ipas_add_document_file', p_document_id);

  if v_url is null or v_url !~* '^https?://' then
    raise exception 'ipas_add_document_file: the file must be a link to the uploaded file'
      using errcode = '22023';
  end if;
  if not public._ipas_is_own_file_link(v_url) then
    raise exception 'ipas_file_link: attach a file you uploaded here, not a link to another site'
      using errcode = '22023';
  end if;

  v_name := left(coalesce(nullif(btrim(p_file_name), ''), public._ipas_file_name_from_url(v_url)), 200);

  insert into public.ipas_document_files (document_id, url, file_name, created_by)
  values (v_doc.id, v_url, v_name, v_actor)
  returning * into v_row;

  perform public._ipas_write_event(v_doc.ipas_id, v_actor, 'document_attachment_set',
    jsonb_build_object('document_id', v_doc.id, 'label', public._ipas_document_label(v_doc),
                       'file_id', v_row.id, 'file_name', v_row.file_name));

  return v_row;
end;
$$;

comment on function public.ipas_add_document_file(uuid, text, text) is
  '#1153: Purchasing adds one file to a document on an open IPAS. The link must be to the app''s own file store (#1128). Writes "document_attachment_set".';

revoke all on function public.ipas_add_document_file(uuid, text, text) from public, anon;
grant execute on function public.ipas_add_document_file(uuid, text, text) to authenticated;

create or replace function public.ipas_remove_document_file(p_file_id uuid)
returns public.ipas_document_files
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := public._ipas_purchasing_writer('ipas_remove_document_file');
  v_row public.ipas_document_files;
  v_doc public.ipas_documents;
begin
  select * into v_row from public.ipas_document_files where id = p_file_id;
  if v_row.id is null then
    raise exception 'ipas_remove_document_file: file % not found', p_file_id using errcode = '22023';
  end if;

  v_doc := public._ipas_lock_document('ipas_remove_document_file', v_row.document_id);

  delete from public.ipas_document_files where id = v_row.id returning * into v_row;
  if v_row.id is null then
    raise exception 'ipas_remove_document_file: file % not found', p_file_id using errcode = '22023';
  end if;

  perform public._ipas_write_event(v_doc.ipas_id, v_actor, 'document_attachment_removed',
    jsonb_build_object('document_id', v_doc.id, 'label', public._ipas_document_label(v_doc),
                       'file_id', v_row.id, 'file_name', v_row.file_name));

  return v_row;
end;
$$;

comment on function public.ipas_remove_document_file(uuid) is
  '#1153: Purchasing removes one file of a document on an open IPAS; the other files stay. Writes "document_attachment_removed".';

revoke all on function public.ipas_remove_document_file(uuid) from public, anon;
grant execute on function public.ipas_remove_document_file(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- "Required before": a document is present when it has at least one file.
-- ---------------------------------------------------------------------------
create or replace function public._ipas_missing_documents(p_ipas_id uuid, p_section integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_source text;
  v_screen smallint;
  v_proof boolean;
  v_missing text[] := '{}';
  v_pay record;
begin
  select source into v_source from public.ipas where id = p_ipas_id;
  if v_source is null then
    return '[]'::jsonb;
  end if;

  if p_section = 3 then
    select proof_on_every_payment into v_proof from public.ipas_file_rules limit 1;
    if coalesce(v_proof, true) then
      for v_pay in
        select paid_on from public.ipas_payments
         where ipas_id = p_ipas_id and proof_url is null
         order by paid_on, created_at
      loop
        v_missing := v_missing || ('Proof of payment of ' || to_char(v_pay.paid_on, 'Mon DD, YYYY'));
      end loop;
    end if;
    return to_jsonb(v_missing);
  end if;

  v_screen := case p_section when 1 then 1 when 6 then 3 when 7 then 6 else null end;
  if v_screen is null then
    return '[]'::jsonb;
  end if;

  select coalesce(array_agg(o.label order by o.sort, o.label), '{}')
    into v_missing
    from public.ipas_options o
   where o.list = 'document_kind'
     and o.active
     and o.required_before = v_screen
     and o.applies_to in (v_source, 'both')
     and not exists (
       select 1
         from public.ipas_documents d
         join public.ipas_document_files f on f.document_id = d.id
        where d.ipas_id = p_ipas_id
          and d.kind_id = o.id
     );

  return to_jsonb(v_missing);
end;
$$;

revoke all on function public._ipas_missing_documents(uuid, integer) from public, anon, authenticated;
