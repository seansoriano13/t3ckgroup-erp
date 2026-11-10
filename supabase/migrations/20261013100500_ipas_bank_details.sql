-- ==============================================================================
-- 20261013100500_ipas_bank_details.sql
--
-- Issue #245 (IPAS, spec #241) — bank details and the changed-account flag.
--
-- WHAT THIS ADDS
--   ipas_bank_details   Bank Name, Account Name and Account # for an IPAS, in a
--                       table of its own so its read policy can be narrower than
--                       the IPAS's. One row per IPAS (ipas_id is the key).
--   ipas_can_read_bank_details()
--                       Purchasing access, Finance access, a Super Admin, or a
--                       member of the section 1 or section 3 approval list.
--                       Section 7's Noted and Checked signers (and anyone else on
--                       a list) read the IPAS but get no bank details, refused by
--                       the database here, not by the page.
--   ipas_set_bank_details
--                       The one way to write them: Purchasing access only, on an
--                       open IPAS. Finance can't type bank details, so a changed
--                       Account # stays a check between two departments.
--
-- THE FLAG
-- An Account # is compared with the same supplier's most recent OTHER IPAS,
-- matched on the Odoo partner id in `odoo_copy` (supplier.id) and compared after
-- stripping spaces and dashes ("123-456 789" is "123456789"). Only IPAS that are
-- not cancelled and have an Account # typed count: a cancelled IPAS can't be the
-- "last known good" account, and one with nothing typed says nothing. The first
-- IPAS for a supplier is never flagged, and neither is one whose supplier has no
-- Odoo partner id.
--
-- A difference sets `account_flagged`, records an event, clears the live section
-- 1 and 3 approvals ("Account # flagged") and says who prepared them, so the
-- client notifies them. The flag is recomputed on every save, so correcting the
-- number back clears it. The cross-IPAS read runs as security definer: the
-- purchaser may not read other IPAS's bank details, only learn that this
-- number differs.
--
-- The account numbers themselves are never written to ipas_events, whose readers
-- are wider than bank details' (section 7's signers read the history). An event
-- records WHICH fields changed and whether the flag is up, never the values.
--
-- SIGN-OFFS DON'T EXIST YET. As in ipas_record_odoo_copy (#243), the approval
-- reset is written against `ipas_signoffs` by dynamic SQL guarded on
-- `to_regclass`: it does nothing until the sections 1 and 3 ticket (#247)
-- creates the table, and is first exercised for real there.
--
-- The filed freeze (#248) will refuse any write to this table through a trigger;
-- until then ipas_set_bank_details refuses a filed or cancelled IPAS itself.
--
-- SAFE TO RUN AT ANY TIME, against a live frontend of any version: a new table
-- and new functions, nothing existing altered. Idempotent.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- The table
-- ------------------------------------------------------------------------------

create table if not exists public.ipas_bank_details (
  ipas_id         uuid primary key references public.ipas (id) on delete cascade,
  bank_name       text,
  account_name    text,
  account_number  text,
  account_flagged boolean not null default false,
  updated_by      uuid references public.employees (id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint ipas_bank_details_bank_name_chk check (bank_name is null or length(bank_name) <= 200),
  constraint ipas_bank_details_account_name_chk check (account_name is null or length(account_name) <= 200),
  constraint ipas_bank_details_account_number_chk check (account_number is null or length(account_number) <= 100)
);

comment on table public.ipas_bank_details is
  'The supplier''s bank details on an IPAS (#241, #245), typed by Purchasing. A table of its own so its read policy is narrower than the IPAS''s: Purchasing, Finance, Super Admins and the section 1 and 3 approval lists only. Written only through ipas_set_bank_details. account_flagged is set by the database when Account # differs from the same supplier''s most recent other IPAS.';
comment on column public.ipas_bank_details.account_number is
  'Sensitive. Never copied to ipas_events or a notification; printed masked to the last four digits except on the filing copy.';
comment on column public.ipas_bank_details.account_flagged is
  'Set by ipas_set_bank_details: Account # (spaces and dashes stripped) differs from the same Odoo supplier''s most recent other IPAS. Never set by a client.';

create index if not exists ipas_bank_details_updated_by_idx on public.ipas_bank_details (updated_by);

drop trigger if exists ipas_bank_details_updated_at on public.ipas_bank_details;
create trigger ipas_bank_details_updated_at
  before update on public.ipas_bank_details
  for each row execute function public.set_ipas_updated_at();

-- ------------------------------------------------------------------------------
-- Who reads
-- ------------------------------------------------------------------------------

create or replace function public.ipas_can_read_bank_details()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from employees e
    where e.id = get_employee_id()
      and not coalesce(e.is_deleted, false)
      and (
        coalesce(e.has_purchasing_flow, false)
        or coalesce(e.has_finance_flow, false)
        or coalesce(e.is_super_admin, false)
        or exists (
          select 1 from ipas_signer_lists l
          where l.employee_id = e.id
            and l.list_key in ('s1_approved', 's3_approved')
        )
      )
  );
$$;

comment on function public.ipas_can_read_bank_details() is
  '#245: whether the caller may read IPAS bank details: Purchasing access, Finance access, a Super Admin, or a member of the section 1 or 3 approval list (never a soft-deleted employee). Section 7''s Noted and Checked signers are refused unless they hold one of these.';

revoke all on function public.ipas_can_read_bank_details() from public, anon;
grant execute on function public.ipas_can_read_bank_details() to authenticated;

alter table public.ipas_bank_details enable row level security;

drop policy if exists ipas_bank_details_read on public.ipas_bank_details;
create policy ipas_bank_details_read on public.ipas_bank_details
  for select to authenticated
  using (public.ipas_can_read_bank_details());

-- ------------------------------------------------------------------------------
-- Internals
-- ------------------------------------------------------------------------------

-- An Account # as compared: spaces and dashes stripped, nothing else changed.
create or replace function public._ipas_account_key(p_account text)
returns text
language sql
immutable
as $$
  select regexp_replace(coalesce(p_account, ''), '[[:space:]-]', '', 'g');
$$;

revoke all on function public._ipas_account_key(text) from public, anon, authenticated;

-- ------------------------------------------------------------------------------
-- Type bank details
-- ------------------------------------------------------------------------------

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
    -- #247 creates ipas_signoffs; until then there is nothing to clear.
    if to_regclass('public.ipas_signoffs') is not null then
      execute $q$
        with cleared as (
          update public.ipas_signoffs s
             set cleared_at = now(), cleared_reason = 'Account # flagged'
           where s.ipas_id = $1
             and s.section in (1, 3)
             and s.role = 'approved'
             and s.cleared_at is null
          returning s.section
        )
        select coalesce(array_agg(distinct section::integer), '{}'::integer[]) from cleared
      $q$ into v_sections using v_ipas.id;

      if cardinality(v_sections) > 0 then
        execute $q$
          select coalesce(array_agg(distinct s.signed_by), '{}'::uuid[])
            from public.ipas_signoffs s
           where s.ipas_id = $1
             and s.section = any ($2)
             and s.role = 'prepared'
             and s.cleared_at is null
             and s.signed_by is not null
        $q$ into v_preparers using v_ipas.id, v_sections;

        perform public._ipas_write_event(v_ipas.id, v_actor, 'approvals_cleared', jsonb_build_object(
          'reason', 'Account # flagged',
          'sections', to_jsonb(v_sections)
        ));
      end if;
    end if;
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
