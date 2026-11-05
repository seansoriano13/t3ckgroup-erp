-- Technical in-charge + offer-level Compliance (#908, spec #907 decision 10).
--
-- WHY: the RRD and IOE teams judged Compliance one Component at a time. The Technical side is one
-- person per SOR now: the Technical in-charge, who gives one verdict for the whole S0 Evaluation.
--
-- WHAT THIS ADDS
--   * costing_matrices.technical_incharge_id: the one employee who judges the S0 Evaluation. Sales or
--     Purchasing set it (costing_column_bands). Only an employee in the Technical sub-department
--     (sub_department trimmed, case-insensitive) can be named.
--   * costing_matrices.compliance ('complies' | 'deviates' | null = unjudged), compliance_note (Technical
--     Evaluation Remarks & Recommendations; a deviation needs one), compliance_by and compliance_at
--     (stamped by a trigger). Only the named in-charge can write the verdict or its note.
--   * costing_matrices changes to the verdict or its note clear 'evaluation_approved' (the sign-off
--     reason is kept in the history).
--   * The in-charge reads the matrix at the participant tier (no money) and counts as Technical.
--   * costing_sign('evaluation_approved') needs the offer-level verdict, and refuses whoever gave it.
--   * costing_technical_list() serves the SORs whose in-charge is the caller (every SOR for a Super
--     Admin). Same columns as before; team reads 'Technical'.
--
-- RETIRED
--   * costing_tender_lines.evaluating_team, its row check, the per-row team trigger and its notice.
--   * The 'team_rrd' and 'team_ioe' signer lists (rows removed, key no longer allowed).
--   * The team guard on costing_components. Per-Component verdicts stay as read-only history: a write
--     to compliance, compliance_note or recommended_alternative is refused. complied_by stays too.
--
-- SAFE TO RUN AT ANY TIME: new columns, constraints, functions and triggers are replaced or dropped
-- and recreated; registry rows are upserted; retired rows are deleted. Idempotent.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

alter table public.costing_matrices add column if not exists technical_incharge_id uuid references public.employees (id) on delete set null;
alter table public.costing_matrices add column if not exists compliance text;
alter table public.costing_matrices add column if not exists compliance_note text;
alter table public.costing_matrices add column if not exists compliance_by uuid references public.employees (id) on delete set null;
alter table public.costing_matrices add column if not exists compliance_at timestamp with time zone;

alter table public.costing_matrices drop constraint if exists costing_matrices_compliance_chk;
alter table public.costing_matrices add constraint costing_matrices_compliance_chk
  check (compliance is null or compliance in ('complies', 'deviates'));

alter table public.costing_matrices drop constraint if exists costing_matrices_deviation_note_chk;
alter table public.costing_matrices add constraint costing_matrices_deviation_note_chk
  check (compliance is distinct from 'deviates' or nullif(btrim(compliance_note), '') is not null);

comment on column public.costing_matrices.technical_incharge_id is
  '#908: the Technical in-charge who judges the S0 Evaluation. Set by Sales or Purchasing; an employee in the Technical sub-department.';
comment on column public.costing_matrices.compliance is
  '#908: the one Compliance verdict for the whole S0 Evaluation: complies, deviates, or null (unjudged). Written only by the Technical in-charge.';
comment on column public.costing_matrices.compliance_note is
  '#908: Technical Evaluation Remarks & Recommendations. Required when the verdict is deviates.';
comment on column public.costing_matrices.compliance_by is
  '#908: who last gave the verdict or its note. Stamped by a trigger.';
comment on column public.costing_matrices.compliance_at is
  '#908: when the verdict or its note was last given. Stamped by a trigger.';

-- ---------------------------------------------------------------------------
-- Registry: who reads the new columns (everyone who reads the matrix, no money), who names the in-charge
-- ---------------------------------------------------------------------------

insert into public.costing_column_tiers (table_name, column_name, tiers) values
  ('costing_matrices', 'technical_incharge_id', '{participant,price,cost,closed_book}'),
  ('costing_matrices', 'compliance', '{participant,price,cost,closed_book}'),
  ('costing_matrices', 'compliance_note', '{participant,price,cost,closed_book}'),
  ('costing_matrices', 'compliance_by', '{participant,price,cost,closed_book}'),
  ('costing_matrices', 'compliance_at', '{participant,price,cost,closed_book}')
on conflict (table_name, column_name) do update set tiers = excluded.tiers;

insert into public.costing_column_bands (table_name, column_name, bands) values
  ('costing_matrices', 'technical_incharge_id', '{sales,purchasing}')
on conflict (table_name, column_name) do update set bands = excluded.bands;

-- ---------------------------------------------------------------------------
-- Retire the RRD / IOE teams
-- ---------------------------------------------------------------------------

-- Per-Component verdicts are history now: no band may write them, and the guard below refuses any write.
delete from public.costing_column_bands
 where table_name = 'costing_components' and column_name in ('compliance', 'compliance_note', 'recommended_alternative');

drop trigger if exists costing_compliance_team_guard on public.costing_components;
drop function if exists public.costing_compliance_team_guard();

create or replace function public.costing_component_verdict_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (new.compliance is not distinct from old.compliance)
     and (new.compliance_note is not distinct from old.compliance_note)
     and (new.recommended_alternative is not distinct from old.recommended_alternative) then
    return new;
  end if;
  if auth.uid() is null
     or coalesce(auth.role(), '') = 'service_role'
     or coalesce(current_setting('costing.bypass', true), '') = 'on' then
    return new;
  end if;
  raise exception 'costing_compliance: a Component''s verdict is read-only history; the Technical verdict is on the S0 Evaluation'
    using errcode = '42501';
end;
$$;

revoke all on function public.costing_component_verdict_guard() from public, anon, authenticated;

drop trigger if exists costing_component_verdict_guard on public.costing_components;
create trigger costing_component_verdict_guard
  before update of compliance, compliance_note, recommended_alternative on public.costing_components
  for each row execute function public.costing_component_verdict_guard();

drop trigger if exists costing_tender_lines_notify_team on public.costing_tender_lines;
drop function if exists public._costing_notify_evaluation_team();

alter table public.costing_tender_lines drop constraint if exists costing_tender_lines_team_chk;
alter table public.costing_tender_lines drop column if exists evaluating_team;
delete from public.costing_column_tiers where table_name = 'costing_tender_lines' and column_name = 'evaluating_team';
delete from public.costing_column_bands where table_name = 'costing_tender_lines' and column_name = 'evaluating_team';

delete from public.costing_signer_lists where list_key in ('team_rrd', 'team_ioe');
alter table public.costing_signer_lists drop constraint if exists costing_signer_lists_key_chk;
alter table public.costing_signer_lists add constraint costing_signer_lists_key_chk
  check (list_key in ('final_acquire', 'evaluation', 'markup'));

-- ---------------------------------------------------------------------------
-- The in-charge: a Technical employee, named by Sales or Purchasing (the bands above)
-- ---------------------------------------------------------------------------

create or replace function public.costing_check_technical_incharge()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.technical_incharge_id is null then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.technical_incharge_id is not distinct from old.technical_incharge_id then
    return new;
  end if;
  if not exists (
    select 1 from public.employees e
    where e.id = new.technical_incharge_id
      and not coalesce(e.is_deleted, false)
      and lower(btrim(e.sub_department)) = 'technical'
  ) then
    raise exception 'costing_technical: the Technical in-charge must be an employee in the Technical sub-department'
      using errcode = '22023';
  end if;
  return new;
end;
$$;

revoke all on function public.costing_check_technical_incharge() from public, anon, authenticated;

drop trigger if exists costing_check_technical_incharge on public.costing_matrices;
create trigger costing_check_technical_incharge
  before insert or update of technical_incharge_id on public.costing_matrices
  for each row execute function public.costing_check_technical_incharge();

-- ---------------------------------------------------------------------------
-- The offer-level verdict: only the named in-charge writes it, and the mark is stamped
-- ---------------------------------------------------------------------------

create or replace function public.costing_matrix_verdict_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := public.get_employee_id();
begin
  if (new.compliance is not distinct from old.compliance)
     and (new.compliance_note is not distinct from old.compliance_note) then
    -- Not a verdict change. The stamp belongs to the verdict, so a plain write cannot move it.
    new.compliance_by := old.compliance_by;
    new.compliance_at := old.compliance_at;
    return new;
  end if;
  if auth.uid() is null
     or coalesce(auth.role(), '') = 'service_role'
     or coalesce(current_setting('costing.bypass', true), '') = 'on' then
    return new;
  end if;
  if old.technical_incharge_id is null then
    raise exception 'costing_technical: name the Technical in-charge first' using errcode = '42501';
  end if;
  if v_actor is distinct from old.technical_incharge_id then
    raise exception 'costing_technical: only the Technical in-charge can give the Compliance verdict' using errcode = '42501';
  end if;
  new.compliance_by := v_actor;
  new.compliance_at := now();
  return new;
end;
$$;

revoke all on function public.costing_matrix_verdict_guard() from public, anon, authenticated;

drop trigger if exists costing_matrix_verdict_guard on public.costing_matrices;
create trigger costing_matrix_verdict_guard
  before update on public.costing_matrices
  for each row execute function public.costing_matrix_verdict_guard();

-- A changed verdict or note makes an approved Evaluation stale (the reason stays on the cleared sign-off).
drop trigger if exists costing_clear_evaluation_matrix on public.costing_matrices;
create trigger costing_clear_evaluation_matrix
  after update of compliance, compliance_note on public.costing_matrices
  for each row execute function public.costing_clear_evaluation_approval();

-- ---------------------------------------------------------------------------
-- Who is Technical, and who reads the matrix as a participant
-- ---------------------------------------------------------------------------

-- costing_is_technical (latest: 20261121050004_908): the in-charge of this SOR, Purchasing access, or a current
-- member of a group task on that SOR created from the Evaluation of Specification template.
create or replace function public.costing_is_technical(p_opportunity_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_purchasing_access()
    or exists (
      select 1 from public.costing_matrices m
      where m.opportunity_id = p_opportunity_id
        and m.technical_incharge_id = public.get_employee_id()
    )
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

-- costing_tier (latest: 20261121050004_908): the Technical in-charge reads the matrix without money.
create or replace function public.costing_tier(p_opportunity_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when not exists (select 1 from public.sales_opportunities o where o.id = p_opportunity_id) then null
    when public.costing_on_list('final_acquire') or public.costing_is_open(p_opportunity_id) then 'closed_book'
    when exists (
      select 1 from public.sales_opportunities o
      where o.id = p_opportunity_id
        and (
          public.sor_is_deal_team(o, public.get_employee_id())
          or public.sor_always_sees(o, public.get_employee_id())
        )
    ) then 'price'
    when exists (
      select 1 from public.sor_stage_participants p
      where p.opportunity_id = p_opportunity_id
        and p.employee_id = public.get_employee_id()
        and p.closed_at is null
    ) then 'participant'
    when exists (
      select 1 from public.costing_matrices m
      where m.opportunity_id = p_opportunity_id
        and (
          m.technical_incharge_id = public.get_employee_id()
          or public.costing_on_list('evaluation')
        )
    ) then 'participant'
    else null
  end
$$;

-- ---------------------------------------------------------------------------
-- Evaluation approved: needs the offer-level verdict, and not from whoever gave it
-- ---------------------------------------------------------------------------

create or replace function public.costing_sign(p_matrix_id uuid, p_role text, p_decline_signature boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor     uuid := public.get_employee_id();
  v_opp       uuid;
  v_signature text;
  v_row       public.costing_signoffs;
begin
  if v_actor is null then
    raise exception 'costing_sign: sign in first' using errcode = '42501';
  end if;
  if p_role is null or p_role <> 'evaluation_approved' then
    raise exception 'costing_sign: % is not a sign-off', coalesce(p_role, 'that') using errcode = '22023';
  end if;

  v_opp := public.costing_matrix_opp(p_matrix_id);
  if v_opp is null then
    raise exception 'costing_sign: not found' using errcode = '22023';
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
    raise exception 'costing_sign: the evaluation is already approved' using errcode = '22023';
  end if;

  if exists (select 1 from public.costing_matrices m where m.id = p_matrix_id and m.compliance_by = v_actor) then
    raise exception 'costing_sign: you gave the Technical verdict, so someone else has to approve the evaluation' using errcode = '42501';
  end if;
  if not exists (select 1 from public.costing_matrices m where m.id = p_matrix_id and m.compliance is not null) then
    raise exception 'costing_sign: the Technical verdict is not given yet' using errcode = '22023';
  end if;

  if not coalesce(p_decline_signature, false) then
    select nullif(btrim(e.signature_path), '') into v_signature from public.employees e where e.id = v_actor;
  end if;

  insert into public.costing_signoffs (matrix_id, role, signed_by, signature_declined, signature_version)
  values (p_matrix_id, p_role, v_actor, coalesce(p_decline_signature, false), v_signature)
  returning * into v_row;

  return jsonb_build_object('signoff', to_jsonb(v_row));
end;
$$;

-- ---------------------------------------------------------------------------
-- The Technical list: the SORs whose in-charge is the caller (every SOR for a Super Admin)
-- ---------------------------------------------------------------------------

create or replace function public.costing_technical_list()
returns table (
  opportunity_id uuid,
  sor_code text,
  sales_reference text,
  project_title text,
  client_name text,
  stage text,
  team text,
  rows_total integer,
  rows_judged integer,
  approved boolean,
  is_mine boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_me uuid := public.get_employee_id();
  v_all boolean := coalesce(public.is_super_admin(), false);
begin
  if v_me is null then
    raise exception 'costing_technical_list: not signed in' using errcode = '42501';
  end if;

  return query
  select
    o.id,
    o.sor_code,
    o.sales_reference,
    o.project_title,
    o.client_name,
    fs.name,
    'Technical'::text,
    (select count(*)::integer from public.costing_tender_lines l where l.matrix_id = m.id),
    case when m.compliance is null then 0
         else (select count(*)::integer from public.costing_tender_lines l where l.matrix_id = m.id)
    end,
    exists (
      select 1 from public.costing_signoffs s
      where s.matrix_id = m.id and s.role = 'evaluation_approved' and s.cleared_at is null
    ),
    m.technical_incharge_id = v_me
  from public.costing_matrices m
  join public.sales_opportunities o on o.id = m.opportunity_id
  left join public.flow_stages fs on fs.id = o.flow_stage_id
  where m.technical_incharge_id is not null
    and not coalesce(o.is_deleted, false)
    and not coalesce(o.is_scratch, false)
    and (v_all or m.technical_incharge_id = v_me)
  order by o.serial_no desc;
end;
$$;

revoke all on function public.costing_technical_list() from public, anon;
grant execute on function public.costing_technical_list() to authenticated;

-- ---------------------------------------------------------------------------
-- Drop the retired column last: every function above no longer names it
-- ---------------------------------------------------------------------------

alter table public.costing_tender_lines drop column if exists evaluating_team;
