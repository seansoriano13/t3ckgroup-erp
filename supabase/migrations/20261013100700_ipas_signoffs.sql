-- ==============================================================================
-- 20261013100700_ipas_signoffs.sql
--
-- Issue #247 (IPAS, spec #241) — sections 1 and 3 sign-offs.
--
-- Sections 1 and 3 are Prepared by Purchasing and Approved by the people on the
-- section's list, which Super Admins keep. Nothing else in the IPAS needs a
-- signature before Filing (section 7 is #248), and nothing else undoes one:
-- only a changed Odoo PO and a flagged Account # clear an approval.
--
--   employees.call_sign     the numeric code a person goes by (101 Boss Lito,
--                           1203 Ma'am Jelay): text, unique where set, changed
--                           only by HR and Super Admins. The signer lists are
--                           seeded by it.
--   ipas_signoffs           one row per signature; a cleared row is kept as
--                           history and the live sign-off is the uncleared one
--                           (at most one per IPAS, section and role).
--   ipas_sign               Prepared (Purchasing access) and Approved (the
--                           section's list). No self-approval. A Super Admin
--                           signs only when they are on the list.
--   ipas_send_back          a signer returns a section with a reason: clears
--                           its Prepared and Approved and names the preparer.
--   _ipas_clear_approvals   the one place an approval is undone by the system.
--                           ipas_record_odoo_copy (#243) and ipas_set_bank_details
--                           (#245) now call it; they were written against this
--                           table by dynamic SQL before it existed and are
--                           re-created below with plain SQL.
--   paid_before_approval    set by an insert trigger on ipas_payments while
--                           section 1 has no live Approved sign-off.
--
-- SECTION 7 PLUGS IN HERE (#248). `ipas_signoffs` already allows section 7 and
-- its four roles, `_ipas_signoff_list_key` already maps each of them to its
-- list, and `_ipas_can_sign_section` already knows section 7's lists. What is
-- left for #248 is to re-create `ipas_sign` and `ipas_send_back` with the
-- section 7 ordering rules (Received, then Noted and Checked, then Approved,
-- which files) where the marked refusals stand.
--
-- The tables are read-only to clients: every change is one of the functions
-- above, which checks the actor and the state and writes an ipas_events row in
-- the same transaction (ADR 0013). Signer lists are plain rows, written by
-- Super Admins under row level security (created in #242).
--
-- SEED. Signer lists start from the sheet, matched on call sign: 101 for both
-- approvals (and section 7's Approved), 1203 for Received. A call sign with no
-- employee seeds nothing and says so with a notice; the migration never fails
-- on it. The two people the sheet names for Noted and Checked have no call sign
-- in the spec, so nothing is seeded for those two lists (a notice says so): a
-- Super Admin adds them in IPAS settings.
--
-- SAFE TO RUN AT ANY TIME, against a live frontend of any version: one new
-- nullable column, one new table, new functions, and `create or replace` of the
-- two functions named above and the escalation trigger. Idempotent.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- Call sign
-- ------------------------------------------------------------------------------

alter table public.employees
  add column if not exists call_sign text;

alter table public.employees drop constraint if exists employees_call_sign_chk;
alter table public.employees
  add constraint employees_call_sign_chk
  check (call_sign is null or (length(btrim(call_sign)) > 0 and call_sign = btrim(call_sign)));

comment on column public.employees.call_sign is
  'The numeric code a person goes by (101, 1203) — CONTEXT.md "Call Sign". Unique where set, null when none. Changed only by HR and Super Admins (prevent_role_escalation). IPAS signer lists are seeded by it.';

create unique index if not exists employees_call_sign_key
  on public.employees (call_sign) where call_sign is not null;

-- Extends the role-escalation trigger (prior shape in
-- 20261013100000_finance_access_flag.sql) so only HR and Super Admins set a
-- call sign. Every earlier rule is kept as it was. A call sign grants nothing
-- by itself, so unlike the access flags HR may set their own.
create or replace function public.prevent_role_escalation()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
DECLARE
  v_caller_id                UUID;
  v_caller_is_super_admin    BOOLEAN;
  v_caller_is_hr             BOOLEAN;
  v_caller_can_manage_leaves BOOLEAN;
  v_caller_is_role_simulator BOOLEAN;
BEGIN
  v_caller_id := public.get_employee_id();

  SELECT is_super_admin, is_hr, can_manage_leaves, is_role_simulator
  INTO   v_caller_is_super_admin, v_caller_is_hr, v_caller_can_manage_leaves, v_caller_is_role_simulator
  FROM   public.employees
  WHERE  id = v_caller_id;

  IF v_caller_is_role_simulator IS TRUE THEN
    RETURN NEW;
  END IF;

  IF NOT (v_caller_is_super_admin IS TRUE OR v_caller_is_hr IS TRUE) THEN
    IF NEW.is_super_admin IS DISTINCT FROM OLD.is_super_admin THEN
      NEW.is_super_admin := OLD.is_super_admin;
    END IF;
    IF NEW.is_hr IS DISTINCT FROM OLD.is_hr THEN
      NEW.is_hr := OLD.is_hr;
    END IF;
    IF NEW.is_head IS DISTINCT FROM OLD.is_head THEN
      NEW.is_head := OLD.is_head;
    END IF;
  END IF;

  IF NEW.is_super_admin = TRUE
     AND OLD.is_super_admin = FALSE
     AND NOT (v_caller_is_super_admin IS TRUE)
  THEN
    RAISE EXCEPTION
      'Insufficient privileges: only a super-admin can grant super-admin status.'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.can_manage_leaves IS DISTINCT FROM OLD.can_manage_leaves
     AND NOT (v_caller_is_super_admin IS TRUE)
  THEN
    RAISE EXCEPTION
      'Insufficient privileges: only a super-admin can change leave-management access.'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.can_edit_sales_flows IS DISTINCT FROM OLD.can_edit_sales_flows
     AND NOT (v_caller_is_super_admin IS TRUE)
  THEN
    RAISE EXCEPTION
      'Insufficient privileges: only a super-admin can change Flow editor access.'
      USING ERRCODE = '42501';
  END IF;

  -- Purchasing and Finance access (#242). Only a Super Admin or HR grants
  -- them, and HR cannot grant themselves (a Super Admin may). A caller with no
  -- employee row is the service role or a migration, and is trusted.
  IF v_caller_id IS NOT NULL
     AND (
       NOT (v_caller_is_super_admin IS TRUE OR v_caller_is_hr IS TRUE)
       OR (OLD.id = v_caller_id AND NOT (v_caller_is_super_admin IS TRUE))
     )
  THEN
    IF NEW.has_purchasing_flow IS DISTINCT FROM OLD.has_purchasing_flow THEN
      NEW.has_purchasing_flow := OLD.has_purchasing_flow;
    END IF;
    IF NEW.has_finance_flow IS DISTINCT FROM OLD.has_finance_flow THEN
      NEW.has_finance_flow := OLD.has_finance_flow;
    END IF;
  END IF;

  -- Call sign (#247). Only HR and Super Admins set one, their own included.
  IF v_caller_id IS NOT NULL
     AND NOT (v_caller_is_super_admin IS TRUE OR v_caller_is_hr IS TRUE)
     AND NEW.call_sign IS DISTINCT FROM OLD.call_sign
  THEN
    NEW.call_sign := OLD.call_sign;
  END IF;

  -- Nobody edits their own hidden-navigation override — server-side, not by
  -- hiding the control — and only HR/Super Admin may edit anyone else's.
  IF NEW.hidden_nav_keys IS DISTINCT FROM OLD.hidden_nav_keys THEN
    IF OLD.id = v_caller_id OR NOT (v_caller_is_super_admin IS TRUE OR v_caller_is_hr IS TRUE) THEN
      NEW.hidden_nav_keys := OLD.hidden_nav_keys;
    END IF;
  END IF;

  IF v_caller_can_manage_leaves IS TRUE
     AND NOT (v_caller_is_super_admin IS TRUE OR v_caller_is_hr IS TRUE)
     AND OLD.id IS DISTINCT FROM v_caller_id
  THEN
    NEW := jsonb_populate_record(OLD, jsonb_build_object(
      'offset_hours_balance', NEW.offset_hours_balance,
      'sil_hours_balance', NEW.sil_hours_balance,
      'updated_at', NEW.updated_at
    ));
  END IF;

  RETURN NEW;
END;
$function$;

-- ------------------------------------------------------------------------------
-- Sign-offs
-- ------------------------------------------------------------------------------

-- Whether the section has this sign-off at all: sections 1 and 3 have Prepared and
-- Approved; section 7 has the other four. Defined first: the table's check uses it.
create or replace function public._ipas_signoff_pair_ok(p_section integer, p_role text)
returns boolean
language sql
immutable
as $$
  select (p_section in (1, 3) and p_role in ('prepared', 'approved'))
      or (p_section = 7 and p_role in ('received', 'noted', 'checked', 'approved'));
$$;

create table if not exists public.ipas_signoffs (
  id                 uuid primary key default gen_random_uuid(),
  ipas_id            uuid not null references public.ipas (id) on delete cascade,
  section            smallint not null,
  role               text not null,
  signed_by          uuid not null references public.employees (id),
  signed_at          timestamptz not null default now(),
  signature_declined boolean not null default false,
  signature_version  text,
  cleared_at         timestamptz,
  cleared_by         uuid references public.employees (id),
  cleared_reason     text,

  constraint ipas_signoffs_section_chk check (section in (1, 3, 7)),
  constraint ipas_signoffs_role_chk check (role in ('prepared', 'approved', 'received', 'noted', 'checked')),
  constraint ipas_signoffs_pair_chk check (public._ipas_signoff_pair_ok(section::integer, role)),
  constraint ipas_signoffs_cleared_chk check (
    (cleared_at is null and cleared_reason is null and cleared_by is null)
    or (cleared_at is not null and cleared_reason is not null and length(btrim(cleared_reason)) > 0)
  )
);

comment on table public.ipas_signoffs is
  'IPAS sign-offs (#241, #247): one row per signature. A cleared row is kept as history; the live sign-off is the uncleared row, and there is at most one per IPAS, section and role. Written only through ipas_sign, ipas_send_back and the approval resets (a changed Odoo PO, a flagged Account #).';
comment on column public.ipas_signoffs.signature_version is
  'The signer''s stored signature (employees.signature_path) as it was when they signed, so uploading a new signature never rewrites an old print. Null when they had none or signature_declined.';
comment on column public.ipas_signoffs.signature_declined is
  'The signer signed without their stored signature; the printed form shows the name only.';
comment on column public.ipas_signoffs.cleared_reason is
  '"PO changed in Odoo", "Account # flagged", "Sent back: <reason>" or (section 7) the reopening reason.';

-- One live sign-off per IPAS, section and role.
create unique index if not exists ipas_signoffs_live_key
  on public.ipas_signoffs (ipas_id, section, role) where cleared_at is null;
create index if not exists ipas_signoffs_ipas_id_idx on public.ipas_signoffs (ipas_id, section);
create index if not exists ipas_signoffs_signed_by_idx on public.ipas_signoffs (signed_by);
create index if not exists ipas_signoffs_cleared_by_idx on public.ipas_signoffs (cleared_by);

-- A signature is never rewritten: once given, only the clearing columns move,
-- and a cleared row doesn't change again. A trigger, so the service role is held
-- to it too.
create or replace function public.ipas_signoffs_guard()
returns trigger
language plpgsql
as $$
begin
  if old.cleared_at is not null then
    raise exception 'ipas_signoffs: a cleared sign-off is history and doesn''t change' using errcode = '42501';
  end if;
  if new.ipas_id is distinct from old.ipas_id
     or new.section is distinct from old.section
     or new.role is distinct from old.role
     or new.signed_by is distinct from old.signed_by
     or new.signed_at is distinct from old.signed_at
     or new.signature_declined is distinct from old.signature_declined
     or new.signature_version is distinct from old.signature_version then
    raise exception 'ipas_signoffs: a signature can only be cleared, never changed' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists ipas_signoffs_guard on public.ipas_signoffs;
create trigger ipas_signoffs_guard
  before update on public.ipas_signoffs
  for each row execute function public.ipas_signoffs_guard();

alter table public.ipas_signoffs enable row level security;

drop policy if exists ipas_signoffs_read on public.ipas_signoffs;
create policy ipas_signoffs_read on public.ipas_signoffs
  for select to authenticated
  using (public.ipas_can_read());

revoke insert, update, delete, truncate on public.ipas_signoffs from anon, authenticated;

-- ------------------------------------------------------------------------------
-- Who may sign
-- ------------------------------------------------------------------------------

-- Whether the employee is on the signer list (never a soft-deleted employee).
create or replace function public._ipas_on_list(p_list_key text, p_employee_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from ipas_signer_lists l
      join employees e on e.id = l.employee_id
     where l.list_key = p_list_key
       and l.employee_id = p_employee_id
       and not coalesce(e.is_deleted, false)
  );
$$;

-- The list that may give a sign-off: null for Prepared (Purchasing access, not a
-- list), and for a pair the sheet doesn't have.
create or replace function public._ipas_signoff_list_key(p_section integer, p_role text)
returns text
language sql
immutable
as $$
  select case
    when p_section = 1 and p_role = 'approved' then 's1_approved'
    when p_section = 3 and p_role = 'approved' then 's3_approved'
    when p_section = 7 and p_role = 'received' then 's7_received'
    when p_section = 7 and p_role = 'noted' then 's7_noted'
    when p_section = 7 and p_role = 'checked' then 's7_checked'
    when p_section = 7 and p_role = 'approved' then 's7_approved'
    else null
  end;
$$;

-- Whether the employee is a signer of the section, who may send it back:
-- sections 1 and 3 by their approval list, section 7 by any of its lists.
create or replace function public._ipas_can_sign_section(p_section integer, p_employee_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when p_section = 1 then public._ipas_on_list('s1_approved', p_employee_id)
    when p_section = 3 then public._ipas_on_list('s3_approved', p_employee_id)
    when p_section = 7 then
      public._ipas_on_list('s7_received', p_employee_id)
      or public._ipas_on_list('s7_noted', p_employee_id)
      or public._ipas_on_list('s7_checked', p_employee_id)
      or public._ipas_on_list('s7_approved', p_employee_id)
    else false
  end;
$$;

revoke all on function public._ipas_on_list(text, uuid) from public, anon, authenticated;
revoke all on function public._ipas_signoff_list_key(integer, text) from public, anon, authenticated;
revoke all on function public._ipas_signoff_pair_ok(integer, text) from public, anon, authenticated;
revoke all on function public._ipas_can_sign_section(integer, uuid) from public, anon, authenticated;

-- ------------------------------------------------------------------------------
-- Undoing approvals (the system's side)
-- ------------------------------------------------------------------------------

-- Clears the live section 1 and 3 `approved` sign-offs of an IPAS with a reason,
-- and writes the "approvals_cleared" event. Prepared stays live: the section
-- goes back to awaiting approval. Returns the sections cleared and the people
-- who prepared them, so the caller's service can notify them. Nothing cleared:
-- nothing written, empty answers.
create or replace function public._ipas_clear_approvals(
  p_ipas_id uuid,
  p_actor uuid,
  p_reason text,
  out sections integer[],
  out preparer_ids uuid[]
)
language plpgsql
security definer
set search_path = public
as $$
begin
  with cleared as (
    update public.ipas_signoffs s
       set cleared_at = now(), cleared_by = p_actor, cleared_reason = p_reason
     where s.ipas_id = p_ipas_id
       and s.section in (1, 3)
       and s.role = 'approved'
       and s.cleared_at is null
    returning s.section
  )
  select coalesce(array_agg(distinct section::integer), '{}'::integer[]) into sections from cleared;

  preparer_ids := '{}'::uuid[];
  if cardinality(sections) > 0 then
    select coalesce(array_agg(distinct s.signed_by), '{}'::uuid[])
      into preparer_ids
      from public.ipas_signoffs s
     where s.ipas_id = p_ipas_id
       and s.section = any (sections)
       and s.role = 'prepared'
       and s.cleared_at is null;

    perform public._ipas_write_event(p_ipas_id, p_actor, 'approvals_cleared', jsonb_build_object(
      'reason', p_reason,
      'sections', to_jsonb(sections)
    ));
  end if;
end;
$$;

revoke all on function public._ipas_clear_approvals(uuid, uuid, text) from public, anon, authenticated;

-- ipas_record_odoo_copy and ipas_set_bank_details are re-created here, from
-- their #243 and #245 bodies, with the dynamic SQL replaced by a call to the
-- helper above. Nothing else in them changes.
create or replace function public.ipas_record_odoo_copy(p_ipas_id uuid, p_odoo_copy jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := public.get_employee_id();
  v_row public.ipas;
  v_before public.ipas;
  v_note jsonb;
  v_lines_changed boolean;
  v_digest_changed boolean;
  v_state_from text;
  v_state_to text;
  v_filled text[] := '{}';
  v_sections integer[] := '{}';
  v_preparers uuid[] := '{}';
begin
  if v_actor is null then
    raise exception 'ipas_record_odoo_copy: not signed in' using errcode = '42501';
  end if;
  if not public.ipas_can_read() then
    raise exception 'ipas_record_odoo_copy: you can''t read IPAS' using errcode = '42501';
  end if;

  if p_odoo_copy is null
     or jsonb_typeof(p_odoo_copy) <> 'object'
     or jsonb_typeof(p_odoo_copy->'po') is distinct from 'object'
     or jsonb_typeof(p_odoo_copy->'lines') is distinct from 'array' then
    raise exception 'ipas_record_odoo_copy: the Odoo copy is missing' using errcode = '22023';
  end if;

  select * into v_row from public.ipas where id = p_ipas_id for update;
  if v_row.id is null then
    raise exception 'ipas_record_odoo_copy: IPAS % not found', p_ipas_id using errcode = 'P0002';
  end if;
  if upper(btrim(p_odoo_copy->'po'->>'name')) is distinct from v_row.po_number then
    raise exception 'ipas_record_odoo_copy: the Odoo copy is for %, not %',
      coalesce(p_odoo_copy->'po'->>'name', 'no PO'), v_row.po_number
      using errcode = '22023';
  end if;
  if v_row.state = 'cancelled' then
    raise exception 'ipas_record_odoo_copy: % is cancelled and keeps the copy it had', v_row.number
      using errcode = '55000';
  end if;

  v_before := v_row;
  v_digest_changed := public._ipas_copy_digest(v_row.odoo_copy) is distinct from public._ipas_copy_digest(p_odoo_copy);

  -- A filed IPAS keeps its frozen copy. All that moves is the flag, in step with
  -- whether the PO still matches what was filed.
  if v_row.state = 'filed' then
    if v_digest_changed is distinct from v_row.odoo_changed_since_filing then
      update public.ipas set odoo_changed_since_filing = v_digest_changed where id = v_row.id returning * into v_row;
      if v_digest_changed then
        perform public._ipas_write_event(v_row.id, v_actor, 'odoo_changed_since_filing', jsonb_build_object(
          'note', public._ipas_change_note(v_before.odoo_copy, p_odoo_copy, v_before.odoo_fetched_at)
        ));
      end if;
    end if;
    return jsonb_build_object(
      'ipas', to_jsonb(v_row),
      'changed', false,
      'filed', true,
      'approvals_cleared', '[]'::jsonb,
      'preparer_ids', '[]'::jsonb
    );
  end if;

  v_note := public._ipas_change_note(v_row.odoo_copy, p_odoo_copy, v_row.odoo_fetched_at);
  v_lines_changed := v_note is not null;
  v_state_from := public._ipas_po_state_class(v_row.odoo_copy);
  v_state_to := public._ipas_po_state_class(p_odoo_copy);

  -- The trigger fills a blank contact and P.I # from the new copy.
  update public.ipas
     set odoo_copy = p_odoo_copy,
         odoo_fetched_at = now(),
         odoo_po_id = case when (p_odoo_copy->'po'->>'id') ~ '^[0-9]+$' then (p_odoo_copy->'po'->>'id')::integer else odoo_po_id end,
         odoo_change_note = case
           when v_note is null then odoo_change_note
           else v_note || jsonb_build_object('at', now())
         end
   where id = v_row.id
  returning * into v_row;

  if v_row.supplier_contact is distinct from v_before.supplier_contact then
    v_filled := array_append(v_filled, 'supplier_contact');
  end if;
  if v_row.pi_number is distinct from v_before.pi_number then
    v_filled := array_append(v_filled, 'pi_number');
  end if;
  if cardinality(v_filled) > 0 then
    perform public._ipas_write_event(v_row.id, v_actor, 'filled_from_odoo', jsonb_build_object(
      'fields', to_jsonb(v_filled),
      'supplier_contact', case when 'supplier_contact' = any (v_filled) then v_row.supplier_contact end,
      'pi_number', case when 'pi_number' = any (v_filled) then v_row.pi_number end
    ));
  end if;

  if v_lines_changed or v_state_from is distinct from v_state_to then
    perform public._ipas_write_event(v_row.id, v_actor, 'odoo_copy_changed', jsonb_build_object(
      'note', v_note,
      'po_state_from', v_before.odoo_copy->'po'->>'state',
      'po_state_to', p_odoo_copy->'po'->>'state'
    ));
  end if;

  -- Lines or the total changed: the live section 1 and 3 approvals no longer
  -- approve what is being bought. Prepared stays, so the section goes back to
  -- awaiting approval.
  if v_lines_changed then
    select c.sections, c.preparer_ids
      into v_sections, v_preparers
      from public._ipas_clear_approvals(v_row.id, v_actor, 'PO changed in Odoo') c;
  end if;

  return jsonb_build_object(
    'ipas', to_jsonb(v_row),
    'changed', v_lines_changed,
    'filed', false,
    'approvals_cleared', to_jsonb(v_sections),
    'preparer_ids', to_jsonb(v_preparers)
  );
end;
$$;

comment on function public.ipas_record_odoo_copy(uuid, jsonb) is
  '#243: stores a fresh Odoo copy of the IPAS''s PO (read by the client from odoo-po-ipas), with its fetch time and a change note against the previous copy. Fills a blank contact and P.I # from Odoo. When lines or the total changed it clears the live section 1 and 3 approvals ("PO changed in Odoo") and returns the preparers to notify. On a filed IPAS it stores nothing and only sets odoo_changed_since_filing. Returns { ipas, changed, filed, approvals_cleared[], preparer_ids[] }.';

revoke all on function public.ipas_record_odoo_copy(uuid, jsonb) from public, anon;
grant execute on function public.ipas_record_odoo_copy(uuid, jsonb) to authenticated;

create or replace function public.ipas_set_bank_details(
  p_ipas_id uuid,
  p_bank_name text,
  p_account_name text,
  p_account_number text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := public.get_employee_id();
  v_ipas public.ipas;
  v_before public.ipas_bank_details;
  v_row public.ipas_bank_details;
  v_bank text := nullif(btrim(p_bank_name), '');
  v_name text := nullif(btrim(p_account_name), '');
  v_number text := nullif(btrim(p_account_number), '');
  v_new boolean;
  v_key text;
  v_partner text;
  v_prev_id uuid;
  v_prev_number text;
  v_prev_key text;
  v_flagged boolean := false;
  v_account_changed boolean;
  v_fields text[] := '{}';
  v_sections integer[] := '{}';
  v_preparers uuid[] := '{}';
begin
  if v_actor is null then
    raise exception 'ipas_set_bank_details: not signed in' using errcode = '42501';
  end if;
  if not public.has_purchasing_access() then
    raise exception 'ipas_set_bank_details: only Purchasing types bank details' using errcode = '42501';
  end if;

  v_ipas := public._ipas_lock_open('ipas_set_bank_details', p_ipas_id);

  select * into v_before from public.ipas_bank_details where ipas_id = v_ipas.id for update;
  v_new := v_before.ipas_id is null;

  if length(coalesce(v_bank, '')) > 200 or length(coalesce(v_name, '')) > 200 then
    raise exception 'ipas_set_bank_details: Bank Name and Account Name are 200 characters at most' using errcode = '22023';
  end if;
  if length(coalesce(v_number, '')) > 100 then
    raise exception 'ipas_set_bank_details: Account # is 100 characters at most' using errcode = '22023';
  end if;

  v_key := public._ipas_account_key(v_number);

  -- Against the same supplier's most recent other IPAS that has an Account #.
  -- Security definer: the caller reads no other IPAS's bank details, only the
  -- answer. No Odoo partner id means nothing to match on.
  v_partner := nullif(v_ipas.odoo_copy->'supplier'->>'id', '');
  if v_key <> '' and v_partner is not null then
    select b.ipas_id, i.number, b.account_number
      into v_prev_id, v_prev_number, v_prev_key
      from public.ipas_bank_details b
      join public.ipas i on i.id = b.ipas_id
     where i.id <> v_ipas.id
       and i.state <> 'cancelled'
       and i.odoo_copy->'supplier'->>'id' = v_partner
       and public._ipas_account_key(b.account_number) <> ''
     order by i.created_at desc, i.id desc
     limit 1;
    if v_prev_id is not null then
      v_flagged := public._ipas_account_key(v_prev_key) <> v_key;
    end if;
  end if;

  v_account_changed := public._ipas_account_key(v_before.account_number) <> v_key;

  if not v_new then
    if v_bank is distinct from v_before.bank_name then v_fields := array_append(v_fields, 'bank_name'); end if;
    if v_name is distinct from v_before.account_name then v_fields := array_append(v_fields, 'account_name'); end if;
    if v_number is distinct from v_before.account_number then v_fields := array_append(v_fields, 'account_number'); end if;
    -- Nothing typed differently and the flag stands: nothing to record.
    if cardinality(v_fields) = 0 and v_flagged = v_before.account_flagged then
      return jsonb_build_object(
        'bank_details', to_jsonb(v_before),
        'flagged', v_before.account_flagged,
        'account_changed', false,
        'approvals_cleared', '[]'::jsonb,
        'preparer_ids', '[]'::jsonb
      );
    end if;
  else
    if v_bank is not null then v_fields := array_append(v_fields, 'bank_name'); end if;
    if v_name is not null then v_fields := array_append(v_fields, 'account_name'); end if;
    if v_number is not null then v_fields := array_append(v_fields, 'account_number'); end if;
  end if;

  insert into public.ipas_bank_details (ipas_id, bank_name, account_name, account_number, account_flagged, updated_by)
  values (v_ipas.id, v_bank, v_name, v_number, v_flagged, v_actor)
  on conflict (ipas_id) do update
     set bank_name = excluded.bank_name,
         account_name = excluded.account_name,
         account_number = excluded.account_number,
         account_flagged = excluded.account_flagged,
         updated_by = excluded.updated_by
  returning * into v_row;

  -- What changed, never the values: ipas_events is readable by people who may
  -- not read bank details.
  perform public._ipas_write_event(
    v_ipas.id, v_actor,
    case when v_new then 'bank_details_set' else 'bank_details_changed' end,
    jsonb_build_object(
      'fields', to_jsonb(v_fields),
      'account_changed', v_account_changed,
      'flagged', v_flagged,
      'was_flagged', case when v_new then false else v_before.account_flagged end
    )
  );

  if v_flagged and v_account_changed then
    perform public._ipas_write_event(v_ipas.id, v_actor, 'account_flagged', jsonb_build_object(
      'previous_ipas_id', v_prev_id,
      'previous_number', v_prev_number
    ));

    -- The live section 1 and 3 approvals no longer approve this account.
    select c.sections, c.preparer_ids
      into v_sections, v_preparers
      from public._ipas_clear_approvals(v_ipas.id, v_actor, 'Account # flagged') c;
  end if;

  return jsonb_build_object(
    'bank_details', to_jsonb(v_row),
    'flagged', v_flagged,
    'account_changed', v_account_changed,
    'approvals_cleared', to_jsonb(v_sections),
    'preparer_ids', to_jsonb(v_preparers)
  );
end;
$$;

comment on function public.ipas_set_bank_details(uuid, text, text, text) is
  '#245: Purchasing access types or changes the supplier''s Bank Name, Account Name and Account # on an open IPAS. The Account # (spaces and dashes stripped) is compared with the same Odoo supplier''s most recent other IPAS that is not cancelled and has one: a difference sets account_flagged, writes an "account_flagged" event, clears the live section 1 and 3 approvals ("Account # flagged") and returns the preparers to notify; a supplier''s first IPAS is never flagged. Events record which fields changed, never the values. Returns { bank_details, flagged, account_changed, approvals_cleared[], preparer_ids[] }.';

revoke all on function public.ipas_set_bank_details(uuid, text, text, text) from public, anon;
grant execute on function public.ipas_set_bank_details(uuid, text, text, text) to authenticated;

-- ------------------------------------------------------------------------------
-- Signing
-- ------------------------------------------------------------------------------

create or replace function public.ipas_sign(
  p_ipas_id uuid,
  p_section integer,
  p_role text,
  p_decline_signature boolean default false
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := public.get_employee_id();
  v_ipas public.ipas;
  v_prepared public.ipas_signoffs;
  v_row public.ipas_signoffs;
  v_list_key text;
  v_signature text;
  v_notify uuid[] := '{}';
begin
  if v_actor is null then
    raise exception 'ipas_sign: not signed in' using errcode = '42501';
  end if;
  if p_section is null or p_role is null or not public._ipas_signoff_pair_ok(p_section, p_role) then
    raise exception 'ipas_sign: section % has no % sign-off', coalesce(p_section::text, 'null'), coalesce(p_role, 'null')
      using errcode = '22023';
  end if;
  -- #248: section 7's rules (sections 1 and 3 approved first; Received, then
  -- Noted and Checked; Approved needs all three and Costs complete, and files
  -- the IPAS) replace this refusal when Filing lands.
  if p_section = 7 then
    raise exception 'ipas_sign: section 7 is signed at Filing' using errcode = '22023';
  end if;

  v_ipas := public._ipas_lock_open('ipas_sign', p_ipas_id);
  v_list_key := public._ipas_signoff_list_key(p_section, p_role);

  if p_role = 'prepared' then
    if not public.has_purchasing_access() then
      raise exception 'ipas_sign: only Purchasing prepares a section' using errcode = '42501';
    end if;
  elsif not public._ipas_on_list(v_list_key, v_actor) then
    -- Every other sign-off belongs to its list, and a Super Admin is no
    -- exception: they sign when they are on it.
    raise exception 'ipas_sign: you are not on the list that may give this sign-off' using errcode = '42501';
  end if;

  if exists (
    select 1 from public.ipas_signoffs s
     where s.ipas_id = v_ipas.id and s.section = p_section and s.role = p_role and s.cleared_at is null
  ) then
    raise exception 'ipas_sign: section % is already % on %', p_section, p_role, v_ipas.number using errcode = '55000';
  end if;

  if p_role = 'approved' and p_section in (1, 3) then
    select * into v_prepared
      from public.ipas_signoffs s
     where s.ipas_id = v_ipas.id and s.section = p_section and s.role = 'prepared' and s.cleared_at is null;
    if v_prepared.id is null then
      raise exception 'ipas_sign: section % hasn''t been prepared yet', p_section using errcode = '55000';
    end if;
    if v_prepared.signed_by = v_actor then
      raise exception 'ipas_sign: you prepared section %, so someone else approves it', p_section using errcode = '42501';
    end if;
  end if;

  if p_decline_signature then
    v_signature := null;
  else
    select e.signature_path into v_signature from public.employees e where e.id = v_actor;
  end if;

  insert into public.ipas_signoffs (ipas_id, section, role, signed_by, signature_declined, signature_version)
  values (v_ipas.id, p_section, p_role, v_actor, coalesce(p_decline_signature, false), v_signature)
  returning * into v_row;

  perform public._ipas_write_event(v_ipas.id, v_actor, 'signed', jsonb_build_object(
    'section', p_section,
    'role', p_role,
    'signoff_id', v_row.id,
    'signature_declined', v_row.signature_declined
  ));

  -- Prepared is ready for approval: tell that section's approval list (never
  -- the person who just prepared it).
  if p_role = 'prepared' then
    select coalesce(array_agg(l.employee_id order by l.created_at), '{}'::uuid[])
      into v_notify
      from public.ipas_signer_lists l
      join public.employees e on e.id = l.employee_id
     where l.list_key = public._ipas_signoff_list_key(p_section, 'approved')
       and not coalesce(e.is_deleted, false)
       and l.employee_id <> v_actor;
  end if;

  return jsonb_build_object(
    'signoff', to_jsonb(v_row),
    'ipas', to_jsonb(v_ipas),
    'section', p_section,
    'role', p_role,
    'notify_ids', to_jsonb(v_notify)
  );
end;
$$;

comment on function public.ipas_sign(uuid, integer, text, boolean) is
  '#247: gives a sign-off on an open IPAS. Prepared needs Purchasing access; Approved needs the section''s list (a Super Admin only when on it), a live Prepared, and someone other than the preparer. Snapshots the signer''s stored signature unless they decline it. Sections 1 and 3 only until Filing (#248). Returns { signoff, ipas, section, role, notify_ids[] }: a Prepared notifies the section''s approval list, never its signer.';

revoke all on function public.ipas_sign(uuid, integer, text, boolean) from public, anon;
grant execute on function public.ipas_sign(uuid, integer, text, boolean) to authenticated;

-- ------------------------------------------------------------------------------
-- Sending back
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
begin
  if v_actor is null then
    raise exception 'ipas_send_back: not signed in' using errcode = '42501';
  end if;
  if v_reason is null then
    raise exception 'ipas_send_back: give a reason, so the preparer knows what to fix' using errcode = '22023';
  end if;
  if length(v_reason) > 500 then
    raise exception 'ipas_send_back: the reason is 500 characters at most' using errcode = '22023';
  end if;
  -- #248: section 7 is sent back by its own lists and clears its own sign-offs;
  -- it joins here when Filing lands.
  if p_section is null or p_section not in (1, 3) then
    raise exception 'ipas_send_back: only sections 1 and 3 can be sent back' using errcode = '22023';
  end if;

  v_ipas := public._ipas_lock_open('ipas_send_back', p_ipas_id);

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
    'preparer_ids', to_jsonb(v_preparers)
  );
end;
$$;

comment on function public.ipas_send_back(uuid, integer, text) is
  '#247: a signer of section 1 or 3 returns it with a reason. Clears the section''s live Prepared and Approved (kept as history, "Sent back: <reason>") and returns the preparers to notify. Refused when nothing is signed, on a filed or cancelled IPAS, and to anyone not on the section''s approval list (a Super Admin only when on it). Returns { ipas, section, actor_id, cleared_roles[], preparer_ids[] }.';

revoke all on function public.ipas_send_back(uuid, integer, text) from public, anon;
grant execute on function public.ipas_send_back(uuid, integer, text) to authenticated;

-- ------------------------------------------------------------------------------
-- Paid before approval
-- ------------------------------------------------------------------------------

-- Set by the database when a payment is recorded while section 1 has no live
-- Approved sign-off; never by a client, and never changed afterwards (a later
-- approval doesn't make an earlier payment "approved").
create or replace function public.ipas_payments_paid_before_approval()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    new.paid_before_approval := not exists (
      select 1 from public.ipas_signoffs s
       where s.ipas_id = new.ipas_id
         and s.section = 1
         and s.role = 'approved'
         and s.cleared_at is null
    );
  else
    new.paid_before_approval := old.paid_before_approval;
  end if;
  return new;
end;
$$;

drop trigger if exists ipas_payments_paid_before_approval on public.ipas_payments;
create trigger ipas_payments_paid_before_approval
  before insert or update on public.ipas_payments
  for each row execute function public.ipas_payments_paid_before_approval();

comment on column public.ipas_payments.paid_before_approval is
  'Set by the database when a payment is recorded while section 1 has no live Approved sign-off (#247). Never set by a client and never changed afterwards.';

-- ------------------------------------------------------------------------------
-- Signer lists: the sheet's signers
-- ------------------------------------------------------------------------------

do $seed$
declare
  v_row record;
  v_employee uuid;
begin
  for v_row in
    select * from (values
      ('101',  's1_approved'),
      ('101',  's3_approved'),
      ('101',  's7_approved'),
      ('1203', 's7_received')
    ) as t (call_sign, list_key)
  loop
    select e.id into v_employee
      from public.employees e
     where e.call_sign = v_row.call_sign
       and not coalesce(e.is_deleted, false);

    if v_employee is null then
      raise notice 'ipas_signer_lists: no employee has call sign %, so % starts empty (add them in IPAS settings)',
        v_row.call_sign, v_row.list_key;
    else
      insert into public.ipas_signer_lists (list_key, employee_id)
      values (v_row.list_key, v_employee)
      on conflict (list_key, employee_id) do nothing;
    end if;
  end loop;

  -- The sheet names two people for Noted and Checked but the spec gives no
  -- call sign for either, so there is nothing to match on.
  raise notice 'ipas_signer_lists: s7_noted and s7_checked are not seeded (the sheet''s two signers have no call sign on record); add them in IPAS settings';
end;
$seed$;
