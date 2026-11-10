-- ==============================================================================
-- 20261013101100_ipas_followups.sql
--
-- IPAS follow-ups (#241), four database changes:
--
--   A. Signature images on a print. The `signatures` bucket is readable by the
--      owner, HR and Super Admins only, so Finance, Purchasing and the signers
--      printing an IPAS could not fetch anyone else's signature image and the
--      print fell back to the name. `ipas_signature_readable(name)` is true
--      for exactly the files an IPAS sign-off carries (the signature each
--      signer had when they signed, live or cleared, never a declined one) and
--      only for someone who reads IPAS. A second select policy on
--      storage.objects uses it. Nothing else in the bucket opens up: not a
--      signer's other versions, not a non-signer's file.
--   C. ipas_remove_document removes hand-added rows only. A row with a document
--      kind is a suggested (or picked) one: it is ticked or left unticked,
--      never removed. The Finance-has refusal stays.
--   D. ipas_send_back takes section 7. Anyone on a section 7 list (Received,
--      Noted, Checked, Approved) returns it with a reason while it is open
--      (sections 1 and 3 approved) and the IPAS isn't filed. It clears the live
--      Received, Noted and Checked sign-offs (kept as history), writes the
--      event, and returns the people whose sign-offs were cleared to notify.
--      Nothing live to clear is refused (55000). Sections 1 and 3 behave as
--      before; the result gains `notify_ids` (for 1 and 3 the preparers, as
--      `preparer_ids` already was).
--   E. Signer-list history. `ipas_signer_list_log` is an append-only record of
--      who was added to or removed from a list, by whom and when, written by
--      the new atomic `ipas_set_signer_list(list_key, employee_ids)` (Super
--      Admins only), which replaces the client's insert-then-delete. With it
--      the lists have no client write path at all: the old Super Admin write
--      policy is dropped so no change can skip the log.
--
-- SAFE TO RUN AT ANY TIME, against a live frontend of any version, except that
-- an older frontend's signer-list editor (direct inserts and deletes) is
-- refused until it is updated to call ipas_set_signer_list. Idempotent.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- A. Signature images on a print
-- ------------------------------------------------------------------------------

-- Whether the caller may read this file in the `signatures` bucket as part of an
-- IPAS: they read IPAS, and the file is the signature snapshot of a sign-off
-- (employees.signature_path as it was when they signed). Security definer: the
-- answer must not depend on what the caller may read in ipas_signoffs.
create or replace function public.ipas_signature_readable(p_name text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_name is not null
     and public.ipas_can_read()
     and exists (
       select 1
         from public.ipas_signoffs s
        where s.signature_version = p_name
          and not s.signature_declined
     );
$$;

comment on function public.ipas_signature_readable(text) is
  '#241: whether the caller may read a file in the signatures bucket for an IPAS print: they read IPAS (ipas_can_read) and the file is the signature stored on some sign-off, live or cleared. Narrower than every signer''s files: only the version actually signed with.';

revoke all on function public.ipas_signature_readable(text) from public, anon;
grant execute on function public.ipas_signature_readable(text) to authenticated;

drop policy if exists "signatures_select_ipas_signers" on storage.objects;
create policy "signatures_select_ipas_signers"
on storage.objects for select
to authenticated
using (
  bucket_id = 'signatures'
  and public.ipas_signature_readable(name)
);

-- ------------------------------------------------------------------------------
-- C. Remove a document: hand-added rows only
-- ------------------------------------------------------------------------------

create or replace function public.ipas_remove_document(p_document_id uuid)
returns public.ipas_documents
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := public._ipas_purchasing_writer('ipas_remove_document');
  v_row public.ipas_documents;
  v_label text;
begin
  v_row := public._ipas_lock_document('ipas_remove_document', p_document_id);
  if v_row.kind_id is not null then
    raise exception 'ipas_remove_document: % is a listed document kind; only a document added by hand can be removed', public._ipas_document_label(v_row)
      using errcode = '55000';
  end if;
  if v_row.finance_has then
    raise exception 'ipas_remove_document: Finance has ticked this document; ask Finance to untick it first'
      using errcode = '55000';
  end if;
  v_label := public._ipas_document_label(v_row);

  delete from public.ipas_documents where id = v_row.id;

  perform public._ipas_write_event(v_row.ipas_id, v_actor, 'document_removed', jsonb_build_object(
    'document_id', v_row.id,
    'label', v_label,
    'purchasing_has', v_row.purchasing_has,
    'had_attachment', v_row.attachment_url is not null
  ));

  return v_row;
end;
$$;

comment on function public.ipas_remove_document(uuid) is
  '#246, #241: Purchasing removes a document row that was added by hand (no document kind) from an open IPAS, unless Finance has ticked it. Rows with a kind (suggested or picked from the list) are refused: tick them or leave them. The history keeps what was removed.';

revoke all on function public.ipas_remove_document(uuid) from public, anon;
grant execute on function public.ipas_remove_document(uuid) to authenticated;

-- ------------------------------------------------------------------------------
-- D. Send back, with section 7
-- ------------------------------------------------------------------------------

create or replace function public.ipas_send_back(
  p_ipas_id uuid,
  p_section integer,
  p_reason text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := public.get_employee_id();
  v_reason text := nullif(btrim(p_reason), '');
  v_ipas public.ipas;
  v_roles text[];
  v_preparers uuid[];
  v_notify uuid[];
begin
  if v_actor is null then
    raise exception 'ipas_send_back: not signed in' using errcode = '42501';
  end if;
  if v_reason is null then
    raise exception 'ipas_send_back: give a reason, so the people who signed know what to fix' using errcode = '22023';
  end if;
  if length(v_reason) > 500 then
    raise exception 'ipas_send_back: the reason is 500 characters at most' using errcode = '22023';
  end if;
  if p_section is null or p_section not in (1, 3, 7) then
    raise exception 'ipas_send_back: only sections 1, 3 and 7 can be sent back' using errcode = '22023';
  end if;

  -- Refuses a filed or cancelled IPAS (55000): a filed one is reopened, not sent back.
  v_ipas := public._ipas_lock_open('ipas_send_back', p_ipas_id);

  if p_section = 7 then
    -- Anyone on a section 7 list, whichever sign-off they give.
    if not public._ipas_can_sign_section(7, v_actor) then
      raise exception 'ipas_send_back: only a signer of section 7 sends it back' using errcode = '42501';
    end if;

    -- Section 7 is open once sections 1 and 3 are approved.
    if not exists (
      select 1 from public.ipas_signoffs s
       where s.ipas_id = v_ipas.id and s.section = 1 and s.role = 'approved' and s.cleared_at is null
    ) or not exists (
      select 1 from public.ipas_signoffs s
       where s.ipas_id = v_ipas.id and s.section = 3 and s.role = 'approved' and s.cleared_at is null
    ) then
      raise exception 'ipas_send_back: section 7 isn''t open yet; sections 1 and 3 must be approved first' using errcode = '55000';
    end if;

    with cleared as (
      update public.ipas_signoffs s
         set cleared_at = now(), cleared_by = v_actor, cleared_reason = 'Sent back: ' || v_reason
       where s.ipas_id = v_ipas.id
         and s.section = 7
         and s.role in ('received', 'noted', 'checked')
         and s.cleared_at is null
      returning s.role, s.signed_by
    )
    select coalesce(array_agg(role order by role), '{}'::text[]),
           coalesce(array_agg(distinct signed_by) filter (where signed_by is distinct from v_actor), '{}'::uuid[])
      into v_roles, v_notify
      from cleared;

    v_preparers := '{}'::uuid[];
  else
    if not public._ipas_can_sign_section(p_section, v_actor) then
      raise exception 'ipas_send_back: only a signer of section % sends it back', p_section using errcode = '42501';
    end if;

    with cleared as (
      update public.ipas_signoffs s
         set cleared_at = now(), cleared_by = v_actor, cleared_reason = 'Sent back: ' || v_reason
       where s.ipas_id = v_ipas.id
         and s.section = p_section
         and s.role in ('prepared', 'approved')
         and s.cleared_at is null
      returning s.role, s.signed_by
    )
    select coalesce(array_agg(role order by role), '{}'::text[]),
           coalesce(array_agg(distinct signed_by) filter (where role = 'prepared'), '{}'::uuid[])
      into v_roles, v_preparers
      from cleared;

    v_notify := v_preparers;
  end if;

  if cardinality(v_roles) = 0 then
    raise exception 'ipas_send_back: section % has nothing to send back', p_section using errcode = '55000';
  end if;

  perform public._ipas_write_event(v_ipas.id, v_actor, 'sent_back', jsonb_build_object(
    'section', p_section,
    'reason', v_reason,
    'cleared', to_jsonb(v_roles)
  ));

  return jsonb_build_object(
    'ipas', to_jsonb(v_ipas),
    'section', p_section,
    'actor_id', v_actor,
    'cleared_roles', to_jsonb(v_roles),
    'preparer_ids', to_jsonb(v_preparers),
    'notify_ids', to_jsonb(v_notify)
  );
end;
$$;

comment on function public.ipas_send_back(uuid, integer, text) is
  '#247, #241: a signer returns a section with a reason. Sections 1 and 3: the section''s approval list clears the live Prepared and Approved. Section 7: anyone on a section 7 list (Received, Noted, Checked or Approved), while section 7 is open (sections 1 and 3 approved) and the IPAS is not filed, clears the live Received, Noted and Checked. Cleared sign-offs stay as history (Sent back: <reason>). Refused when nothing is signed (55000), on a filed or cancelled IPAS, and to anyone not on the section''s list (a Super Admin only when on it). Returns { ipas, section, actor_id, cleared_roles[], preparer_ids[], notify_ids[] }: notify_ids are the people to tell (the preparers for 1 and 3; whoever''s section 7 sign-off was cleared, never the person sending it back).';

revoke all on function public.ipas_send_back(uuid, integer, text) from public, anon;
grant execute on function public.ipas_send_back(uuid, integer, text) to authenticated;

-- ------------------------------------------------------------------------------
-- E. The signer-list log
-- ------------------------------------------------------------------------------

create table if not exists public.ipas_signer_list_log (
  id          uuid primary key default gen_random_uuid(),
  list_key    text not null,
  employee_id uuid not null references public.employees (id),
  action      text not null,
  actor_id    uuid not null references public.employees (id),
  created_at  timestamptz not null default now(),

  constraint ipas_signer_list_log_key_chk check (list_key in (
    's1_approved', 's3_approved', 's7_received', 's7_noted', 's7_checked', 's7_approved'
  )),
  constraint ipas_signer_list_log_action_chk check (action in ('added', 'removed'))
);

comment on table public.ipas_signer_list_log is
  'Who changed the IPAS sign-off lists (#241): one row per person added to or removed from a list, with who did it and when. Written by ipas_set_signer_list only; append-only for every role, the service role included. Readable by Super Admins.';

create index if not exists ipas_signer_list_log_created_at_idx on public.ipas_signer_list_log (created_at desc);
create index if not exists ipas_signer_list_log_employee_id_idx on public.ipas_signer_list_log (employee_id);
create index if not exists ipas_signer_list_log_actor_id_idx on public.ipas_signer_list_log (actor_id);

create or replace function public.ipas_signer_list_log_append_only()
returns trigger
language plpgsql
as $$
begin
  raise exception 'ipas_signer_list_log is append-only: history can''t be changed (% refused)', tg_op
    using errcode = '42501';
end;
$$;

drop trigger if exists ipas_signer_list_log_no_change on public.ipas_signer_list_log;
create trigger ipas_signer_list_log_no_change
  before update or delete on public.ipas_signer_list_log
  for each row execute function public.ipas_signer_list_log_append_only();

drop trigger if exists ipas_signer_list_log_no_truncate on public.ipas_signer_list_log;
create trigger ipas_signer_list_log_no_truncate
  before truncate on public.ipas_signer_list_log
  for each statement execute function public.ipas_signer_list_log_append_only();

revoke all on function public.ipas_signer_list_log_append_only() from public, anon, authenticated;
revoke insert, update, delete, truncate on public.ipas_signer_list_log from anon, authenticated;

alter table public.ipas_signer_list_log enable row level security;

drop policy if exists ipas_signer_list_log_read on public.ipas_signer_list_log;
create policy ipas_signer_list_log_read on public.ipas_signer_list_log
  for select to authenticated
  using (coalesce(public.is_super_admin(), false));

-- Replaces one list with exactly the given employees, in one transaction, and
-- logs each person added and removed. Super Admins only. No change writes nothing.
create or replace function public.ipas_set_signer_list(
  p_list_key text,
  p_employee_ids uuid[]
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := public.get_employee_id();
  v_wanted uuid[];
  v_have uuid[];
  v_added uuid[];
  v_removed uuid[];
  v_missing uuid;
begin
  if v_actor is null then
    raise exception 'ipas_set_signer_list: not signed in' using errcode = '42501';
  end if;
  if not coalesce(public.is_super_admin(), false) then
    raise exception 'ipas_set_signer_list: only a Super Admin changes who is on a sign-off list' using errcode = '42501';
  end if;
  if p_list_key is null or p_list_key not in ('s1_approved', 's3_approved', 's7_received', 's7_noted', 's7_checked', 's7_approved') then
    raise exception 'ipas_set_signer_list: % isn''t a sign-off list', coalesce(p_list_key, 'null') using errcode = '22023';
  end if;

  select coalesce(array_agg(distinct x), '{}'::uuid[])
    into v_wanted
    from unnest(coalesce(p_employee_ids, '{}'::uuid[])) as x
   where x is not null;

  -- One change to a list at a time.
  perform pg_advisory_xact_lock(hashtext('ipas_signer_list:' || p_list_key));

  select coalesce(array_agg(l.employee_id), '{}'::uuid[])
    into v_have
    from public.ipas_signer_lists l
   where l.list_key = p_list_key;

  -- Everyone newly added must be a live employee. Someone already on the list
  -- who has since left can still be taken off it.
  select x into v_missing
    from unnest(v_wanted) as x
   where x <> all (v_have)
     and not exists (
       select 1 from public.employees e where e.id = x and not coalesce(e.is_deleted, false)
     )
   limit 1;
  if v_missing is not null then
    raise exception 'ipas_set_signer_list: employee % isn''t an active employee', v_missing using errcode = 'P0002';
  end if;

  select coalesce(array_agg(x), '{}'::uuid[]) into v_added from unnest(v_wanted) as x where x <> all (v_have);
  select coalesce(array_agg(x), '{}'::uuid[]) into v_removed from unnest(v_have) as x where x <> all (v_wanted);

  if cardinality(v_removed) > 0 then
    delete from public.ipas_signer_lists
     where list_key = p_list_key and employee_id = any (v_removed);
  end if;
  if cardinality(v_added) > 0 then
    insert into public.ipas_signer_lists (list_key, employee_id)
    select p_list_key, x from unnest(v_added) as x;
  end if;

  insert into public.ipas_signer_list_log (list_key, employee_id, action, actor_id)
  select p_list_key, x, 'removed', v_actor from unnest(v_removed) as x
  union all
  select p_list_key, x, 'added', v_actor from unnest(v_added) as x;

  return jsonb_build_object(
    'list_key', p_list_key,
    'added', to_jsonb(v_added),
    'removed', to_jsonb(v_removed)
  );
end;
$$;

comment on function public.ipas_set_signer_list(text, uuid[]) is
  '#241: a Super Admin replaces one sign-off list with exactly the given employees, atomically. Everyone newly added must be an active employee; anyone not named is removed. Each addition and removal is written to ipas_signer_list_log with who did it; no change writes nothing. Past sign-offs never change. Returns { list_key, added[], removed[] }.';

revoke all on function public.ipas_set_signer_list(text, uuid[]) from public, anon;
grant execute on function public.ipas_set_signer_list(text, uuid[]) to authenticated;

-- With the RPC the only way to change a list, no client writes one directly: a
-- direct write would skip the log. (The service role and migrations still can.)
drop policy if exists ipas_signer_lists_write on public.ipas_signer_lists;
revoke insert, update, delete, truncate on public.ipas_signer_lists from anon, authenticated;
