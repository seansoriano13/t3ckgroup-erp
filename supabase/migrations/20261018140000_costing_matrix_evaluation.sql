-- Costing Matrix, part 3: Evaluation of Specification (#271, spec #266).
--
-- WHAT THIS ADDS
--   Components gain three columns: compliance ('complies' | 'deviates' | null),
--   compliance_note and recommended_alternative. A CHECK requires a note when the
--   verdict is 'deviates'. The Offer Specification column already exists (#268);
--   the screen shows it beside the Tender Specification.
--
--   costing_is_technical(opp) is widened (it is #271's function): Purchasing access,
--   or a current member of a group task on that SOR that was created from the
--   Evaluation of Specification template. The template lives in its own one-row
--   table, costing_evaluation_settings (costing_settings is #270's), seeded by the
--   template's name when one is found and left empty otherwise. The Technical band
--   (Compliance, its note, the recommended alternative, an Inclusion's Completeness)
--   reads the matrix without money: those columns are served to every tier.
--
--   costing_signoffs holds the four sign-offs (prepared, costed, evaluation_approved,
--   final_approved); the live one is the uncleared row. This ticket builds the
--   evaluation one:
--     costing_sign(matrix, role)            ADR 0013 style. Only 'evaluation_approved'
--                                           is available now: the caller is on the
--                                           'evaluation' list and every Component has a
--                                           verdict. The other roles are #274's.
--     costing_clear_signoffs(matrix, roles, reason)
--                                           called by triggers, never by a client;
--                                           records the reason on the cleared row.
--   Triggers clear 'evaluation_approved' (reason kept, visible in the history) on a
--   change to a Tender Specification, an Offer Specification, a verdict or its note,
--   and on adding or removing a Tender Line or a Component. It locks nothing.
--
--   The 'evaluation' signer list is seeded with employee code (call_sign) 1001; if
--   that employee is absent, nothing is seeded and nothing fails.
--
-- ACCESS
--   Sign-offs are readable by anyone who can read the matrix (they are served by
--   costing_matrix_read like any other non-money table) and written only by
--   costing_sign / costing_clear_signoffs. The evaluation settings are readable by
--   any signed-in employee and written by Super Admins.
--
-- SAFE TO RUN AT ANY TIME: new columns, tables, functions, policies and registry
-- rows. Idempotent.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

alter table public.costing_components add column if not exists compliance text;
alter table public.costing_components add column if not exists compliance_note text;
alter table public.costing_components add column if not exists recommended_alternative text;

alter table public.costing_components drop constraint if exists costing_components_compliance_chk;
alter table public.costing_components add constraint costing_components_compliance_chk
  check (compliance is null or compliance in ('complies', 'deviates'));

alter table public.costing_components drop constraint if exists costing_components_deviation_note_chk;
alter table public.costing_components add constraint costing_components_deviation_note_chk
  check (compliance is distinct from 'deviates' or nullif(btrim(compliance_note), '') is not null);

comment on column public.costing_components.compliance is
  '#271: the Technical verdict against the Tender Line: complies, deviates, or null (not yet evaluated). Written by the Technical band.';
comment on column public.costing_components.compliance_note is
  '#271: why a Component deviates. Required (CHECK) when compliance is deviates.';
comment on column public.costing_components.recommended_alternative is
  '#271: the compliant alternative Technical recommends instead, if any.';

create table if not exists public.costing_evaluation_settings (
  id                     boolean primary key default true,
  -- The group task template whose tasks call Technical in ("Evaluation of Specification").
  evaluation_template_id uuid references public.group_task_templates (id) on delete set null,
  updated_at             timestamptz not null default now(),

  constraint costing_evaluation_settings_single check (id)
);

comment on table public.costing_evaluation_settings is
  '#271: one row. evaluation_template_id names the group task template that makes a task member Technical on that SOR (costing_is_technical). Seeded by the template name when found, else null; a Super Admin sets it in the Costing Matrix settings.';

create table if not exists public.costing_signoffs (
  id                 uuid primary key default gen_random_uuid(),
  matrix_id          uuid not null references public.costing_matrices (id) on delete cascade,
  role               text not null,
  signed_by          uuid not null references public.employees (id),
  signed_at          timestamptz not null default now(),
  signature_declined boolean not null default false,
  cleared_at         timestamptz,
  cleared_reason     text,

  constraint costing_signoffs_role_chk check (role in ('prepared', 'costed', 'evaluation_approved', 'final_approved')),
  constraint costing_signoffs_cleared_chk check (
    (cleared_at is null and cleared_reason is null)
    or (cleared_at is not null and nullif(btrim(cleared_reason), '') is not null)
  )
);

create unique index if not exists costing_signoffs_live_key
  on public.costing_signoffs (matrix_id, role)
  where cleared_at is null;

create index if not exists costing_signoffs_matrix_idx
  on public.costing_signoffs (matrix_id, signed_at desc);

comment on table public.costing_signoffs is
  '#271: the matrix''s sign-offs. The live one for a role is the uncleared row; a change that makes it stale clears it with a reason and the row stays as history. Written only by costing_sign and costing_clear_signoffs.';

-- Functions
-- ---------------------------------------------------------------------------
-- Technical band
-- ---------------------------------------------------------------------------

-- Who may do work for a Technical evaluator on this SOR: Purchasing access, or a
-- current member of a group task on it that was created from the Evaluation of
-- Specification template. Removing a member deletes their row, so "current" is "the
-- row is there"; a cancelled task grants nothing.
create or replace function public.costing_is_technical(p_opportunity_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_purchasing_access()
    or exists (
      select 1
      from public.committee_tasks t
      join public.committee_task_members m on m.committee_task_id = t.id
      where t.opportunity_id = p_opportunity_id
        and t.template_id is not null
        and t.template_id = (select s.evaluation_template_id from public.costing_evaluation_settings s limit 1)
        and t.status <> 'CANCELLED'
        and m.employee_id = public.get_employee_id()
    )
$$;

-- ---------------------------------------------------------------------------
-- Sign-offs
-- ---------------------------------------------------------------------------

-- A cleared sign-off never changes; only the clearing columns may move.
create or replace function public.costing_signoffs_guard()
returns trigger
language plpgsql
as $$
begin
  if old.cleared_at is not null then
    raise exception 'costing_signoffs: a cleared sign-off can''t change' using errcode = '42501';
  end if;
  if (to_jsonb(new) - 'cleared_at' - 'cleared_reason') is distinct from (to_jsonb(old) - 'cleared_at' - 'cleared_reason') then
    raise exception 'costing_signoffs: only the clearing can change on a sign-off' using errcode = '42501';
  end if;
  return new;
end;
$$;

-- Clears the live sign-offs of the given roles, recording why. Returns how many it
-- cleared. Called by triggers (and by later tickets' triggers for the other roles);
-- no client can call it.
create or replace function public.costing_clear_signoffs(p_matrix_id uuid, p_roles text[], p_reason text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  if nullif(btrim(coalesce(p_reason, '')), '') is null then
    raise exception 'costing_clear_signoffs: a reason is needed' using errcode = '22023';
  end if;
  -- The matrix is going (an SOR cascade): nothing left to clear.
  if not exists (select 1 from public.costing_matrices where id = p_matrix_id) then
    return 0;
  end if;
  update public.costing_signoffs
     set cleared_at = now(), cleared_reason = btrim(p_reason)
   where matrix_id = p_matrix_id
     and role = any (p_roles)
     and cleared_at is null;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- Evaluation approved goes stale when what it approved changes: a Tender
-- Specification, an Offer Specification, a verdict or its note, or a Tender Line or
-- Component added or removed. The note is the reason on the cleared sign-off.
create or replace function public.costing_clear_evaluation_approval()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old    jsonb := case when tg_op = 'INSERT' then null else to_jsonb(old) end;
  v_new    jsonb := case when tg_op = 'DELETE' then null else to_jsonb(new) end;
  v_matrix uuid;
  v_reason text;
begin
  if tg_op = 'UPDATE' then
    if tg_table_name = 'costing_tender_lines' then
      if (v_new -> 'tender_specification') is not distinct from (v_old -> 'tender_specification') then
        return null;
      end if;
      v_reason := 'A Tender Specification changed';
    elsif (v_new -> 'offer_specification') is distinct from (v_old -> 'offer_specification') then
      v_reason := 'An Offer Specification changed';
    elsif (v_new -> 'compliance') is distinct from (v_old -> 'compliance') then
      v_reason := 'A Compliance verdict changed';
    elsif (v_new -> 'compliance_note') is distinct from (v_old -> 'compliance_note') then
      v_reason := 'A Compliance note changed';
    else
      return null;
    end if;
  elsif tg_table_name = 'costing_tender_lines' then
    v_reason := case tg_op when 'INSERT' then 'A Tender Line was added' else 'A Tender Line was removed' end;
  else
    v_reason := case tg_op when 'INSERT' then 'A Component was added' else 'A Component was removed' end;
  end if;

  v_matrix := public.costing_matrix_of(tg_table_name, coalesce(v_new, v_old));
  if v_matrix is not null then
    perform public.costing_clear_signoffs(v_matrix, array['evaluation_approved'], v_reason);
  end if;
  return null;
end;
$$;

-- Signs the matrix off for one role (ADR 0013: one function checks and writes). Only
-- 'evaluation_approved' is built yet: the caller is on the 'evaluation' list (a Super
-- Admin signs only when on it) and every Component has a verdict. The other three
-- roles come with #274 and raise until then. Returns {signoff: <the new row>}.
create or replace function public.costing_sign(p_matrix_id uuid, p_role text, p_decline_signature boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor   uuid := public.get_employee_id();
  v_opp     uuid;
  v_missing integer;
  v_row     public.costing_signoffs;
begin
  if v_actor is null then
    raise exception 'costing_sign: sign in first' using errcode = '42501';
  end if;
  if p_role is null or p_role not in ('prepared', 'costed', 'evaluation_approved', 'final_approved') then
    raise exception 'costing_sign: % is not a sign-off', coalesce(p_role, 'that') using errcode = '22023';
  end if;
  if p_role <> 'evaluation_approved' then
    raise exception 'costing_sign: the % sign-off is not available yet', p_role using errcode = '0A000';
  end if;

  v_opp := public.costing_matrix_opp(p_matrix_id);
  if v_opp is null then
    raise exception 'costing_sign: not found' using errcode = 'P0002';
  end if;
  if not public.costing_can_read(v_opp) then
    raise exception 'costing_sign: not allowed' using errcode = '42501';
  end if;
  if not public.costing_on_list('evaluation') then
    raise exception 'costing_sign: only someone on the evaluation list can approve the evaluation' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtext('costing_sign:' || p_matrix_id::text));

  if exists (
    select 1 from public.costing_signoffs s
    where s.matrix_id = p_matrix_id and s.role = p_role and s.cleared_at is null
  ) then
    raise exception 'costing_sign: the evaluation is already approved' using errcode = '55000';
  end if;

  select count(*) into v_missing
  from public.costing_components c
  join public.costing_tender_lines l on l.id = c.tender_line_id
  where l.matrix_id = p_matrix_id and c.compliance is null;
  if v_missing > 0 then
    raise exception 'costing_sign: % Component% no verdict yet',
      v_missing, case when v_missing = 1 then ' has' else 's have' end
      using errcode = '55000';
  end if;

  insert into public.costing_signoffs (matrix_id, role, signed_by, signature_declined)
  values (p_matrix_id, p_role, v_actor, coalesce(p_decline_signature, false))
  returning * into v_row;

  return jsonb_build_object('signoff', to_jsonb(v_row));
end;
$$;

revoke all on function public.costing_signoffs_guard() from public, anon, authenticated;
revoke all on function public.costing_clear_signoffs(uuid, text[], text) from public, anon, authenticated;
revoke all on function public.costing_clear_evaluation_approval() from public, anon, authenticated;
revoke all on function public.costing_sign(uuid, text, boolean) from public, anon;
grant execute on function public.costing_sign(uuid, text, boolean) to authenticated;

drop trigger if exists costing_signoffs_guard on public.costing_signoffs;
create trigger costing_signoffs_guard before update on public.costing_signoffs
  for each row execute function public.costing_signoffs_guard();

drop trigger if exists costing_events_write on public.costing_signoffs;
create trigger costing_events_write after insert or update or delete on public.costing_signoffs
  for each row execute function public.costing_write_events();

drop trigger if exists costing_clear_evaluation_lines on public.costing_tender_lines;
create trigger costing_clear_evaluation_lines after insert or delete or update of tender_specification on public.costing_tender_lines
  for each row execute function public.costing_clear_evaluation_approval();

drop trigger if exists costing_clear_evaluation_components on public.costing_components;
create trigger costing_clear_evaluation_components
  after insert or delete or update of offer_specification, compliance, compliance_note on public.costing_components
  for each row execute function public.costing_clear_evaluation_approval();

-- ---------------------------------------------------------------------------
-- Row-level security and grants
-- ---------------------------------------------------------------------------

alter table public.costing_signoffs enable row level security;
alter table public.costing_evaluation_settings enable row level security;

revoke all on table public.costing_signoffs, public.costing_evaluation_settings from anon, authenticated;
grant select on public.costing_signoffs to authenticated;
grant select, insert, update on public.costing_evaluation_settings to authenticated;

drop policy if exists costing_signoffs_read on public.costing_signoffs;
create policy costing_signoffs_read on public.costing_signoffs
  for select to authenticated using (public.costing_can_read(public.costing_matrix_opp(matrix_id)));

drop policy if exists costing_evaluation_settings_read on public.costing_evaluation_settings;
create policy costing_evaluation_settings_read on public.costing_evaluation_settings
  for select to authenticated using (true);

drop policy if exists costing_evaluation_settings_insert on public.costing_evaluation_settings;
create policy costing_evaluation_settings_insert on public.costing_evaluation_settings
  for insert to authenticated with check (coalesce(public.is_super_admin(), false));

drop policy if exists costing_evaluation_settings_update on public.costing_evaluation_settings;
create policy costing_evaluation_settings_update on public.costing_evaluation_settings
  for update to authenticated
  using (coalesce(public.is_super_admin(), false))
  with check (coalesce(public.is_super_admin(), false));

-- ---------------------------------------------------------------------------
-- Registry rows
-- ---------------------------------------------------------------------------

insert into public.costing_tables (table_name, parent_table, parent_column, parent_key, key_column, order_by, money) values
  ('costing_signoffs', null, null, 'id', 'id', 't.signed_at, t.id', false)
on conflict (table_name) do update
  set parent_table = excluded.parent_table, parent_column = excluded.parent_column,
      parent_key = excluded.parent_key, key_column = excluded.key_column,
      order_by = excluded.order_by, money = excluded.money;

-- No money in any of these: every tier that reads the matrix reads them.
insert into public.costing_column_tiers (table_name, column_name, tiers) values
  ('costing_components', 'compliance', '{participant,price,cost,closed_book}'),
  ('costing_components', 'compliance_note', '{participant,price,cost,closed_book}'),
  ('costing_components', 'recommended_alternative', '{participant,price,cost,closed_book}'),
  ('costing_signoffs', 'id', '{participant,price,cost,closed_book}'),
  ('costing_signoffs', 'matrix_id', '{participant,price,cost,closed_book}'),
  ('costing_signoffs', 'role', '{participant,price,cost,closed_book}'),
  ('costing_signoffs', 'signed_by', '{participant,price,cost,closed_book}'),
  ('costing_signoffs', 'signed_at', '{participant,price,cost,closed_book}'),
  ('costing_signoffs', 'signature_declined', '{participant,price,cost,closed_book}'),
  ('costing_signoffs', 'cleared_at', '{participant,price,cost,closed_book}'),
  ('costing_signoffs', 'cleared_reason', '{participant,price,cost,closed_book}')
on conflict (table_name, column_name) do update set tiers = excluded.tiers;

-- Sign-offs have no band rows: no client writes them (costing_sign and the clearing
-- triggers do). Compliance, its note and the alternative are the Technical band's.
insert into public.costing_column_bands (table_name, column_name, bands) values
  ('costing_components', 'compliance', '{technical}'),
  ('costing_components', 'compliance_note', '{technical}'),
  ('costing_components', 'recommended_alternative', '{technical}')
on conflict (table_name, column_name) do update set bands = excluded.bands;

-- ---------------------------------------------------------------------------
-- Seeds
-- ---------------------------------------------------------------------------

-- The one settings row, pointing at the template by name when one exists. A Super
-- Admin sets it in settings otherwise.
insert into public.costing_evaluation_settings (id, evaluation_template_id)
values (
  true,
  (select t.id from public.group_task_templates t
    where lower(btrim(t.name)) = 'evaluation of specification' and t.archived_at is null
    order by t.created_at limit 1)
)
on conflict (id) do update
  set evaluation_template_id = coalesce(public.costing_evaluation_settings.evaluation_template_id, excluded.evaluation_template_id);

-- The purchasing reviewer (employee code 1001) approves the evaluation. If that
-- employee is not there, seed nothing.
do $seed$
declare
  v_id uuid;
begin
  select e.id into v_id from public.employees e
   where e.call_sign = '1001' and not coalesce(e.is_deleted, false)
   limit 1;
  if v_id is null then
    raise notice 'costing evaluation list: no employee with call sign 1001, nothing seeded';
  else
    insert into public.costing_signer_lists (list_key, employee_id)
    values ('evaluation', v_id)
    on conflict (list_key, employee_id) do nothing;
  end if;
end;
$seed$;
