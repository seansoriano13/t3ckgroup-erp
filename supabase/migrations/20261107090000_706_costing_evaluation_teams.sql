-- Evaluation of Specification lives on the matrix rows (#706, spec #699).
--
-- WHAT THIS ADDS
--   * costing_tender_lines.evaluating_team ('RRD' | 'IOE' | null): the Technical team that judges the row.
--     Sales and Purchasing set it.
--   * Two more kinds of costing_signer_lists rows, 'team_rrd' and 'team_ioe': who is in each team. A Super
--     Admin fills them (same screen as the other lists).
--   * costing_components.complied_by: who last marked the verdict (stamped by a trigger).
--   * A trigger on the verdict, its note and the alternative: only a member of the row's team can write them
--     (a row with no team can't be judged yet), and a Deviates verdict keeps its note (the CHECK from #271).
--   * costing_sign('evaluation_approved') refuses a signer who marked any row of the evaluation.
--   * A team member reads the matrix as the participant tier (no money) and counts as Technical.
--
-- Money: the new columns are not money. Technical reads the participant tier, whose columns carry no figure.
-- The evaluation carries no markup: nothing here reads or writes one.
--
-- SAFE TO RUN AT ANY TIME: new columns, constraint widening, replaced functions. Idempotent.

alter table public.costing_tender_lines add column if not exists evaluating_team text;
alter table public.costing_tender_lines drop constraint if exists costing_tender_lines_team_chk;
alter table public.costing_tender_lines add constraint costing_tender_lines_team_chk
  check (evaluating_team is null or evaluating_team in ('RRD', 'IOE'));
comment on column public.costing_tender_lines.evaluating_team is
  '#706: the Technical team (RRD or IOE) that judges this row. Only a member of that team (costing_signer_lists team_rrd / team_ioe) can mark it.';

alter table public.costing_components add column if not exists complied_by uuid references public.employees (id) on delete set null;
comment on column public.costing_components.complied_by is
  '#706: who last marked the verdict or its note. Stamped by a trigger; the evaluation''s approver can''t be anyone listed here.';

alter table public.costing_signer_lists drop constraint if exists costing_signer_lists_key_chk;
alter table public.costing_signer_lists add constraint costing_signer_lists_key_chk
  check (list_key in ('final_acquire', 'evaluation', 'team_rrd', 'team_ioe'));

-- Registry: who reads the new columns (everyone who reads the matrix), who writes the team.
insert into public.costing_column_tiers (table_name, column_name, tiers) values
  ('costing_tender_lines', 'evaluating_team', '{participant,price,cost,closed_book}'),
  ('costing_components', 'complied_by', '{participant,price,cost,closed_book}')
on conflict (table_name, column_name) do update set tiers = excluded.tiers;

insert into public.costing_column_bands (table_name, column_name, bands) values
  ('costing_tender_lines', 'evaluating_team', '{sales,purchasing}')
on conflict (table_name, column_name) do update set bands = excluded.bands;

-- costing_tier (latest: 20261102170000_costing_open_to_deal_purchasing.sql): a team member reads the matrix
-- without money (participant tier).
create or replace function public.costing_tier(p_opportunity_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when not exists (select 1 from public.sales_opportunities o where o.id = p_opportunity_id) then null
    when public.costing_is_open(p_opportunity_id) then 'closed_book'
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
    when (public.costing_on_list('evaluation') or public.costing_on_list('team_rrd') or public.costing_on_list('team_ioe'))
      and exists (select 1 from public.costing_matrices m where m.opportunity_id = p_opportunity_id)
    then 'participant'
    else null
  end
$$;

-- costing_is_technical (latest: 20261018140000_costing_matrix_evaluation.sql): also a member of an evaluating team.
create or replace function public.costing_is_technical(p_opportunity_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_purchasing_access()
    or public.costing_on_list('team_rrd')
    or public.costing_on_list('team_ioe')
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

-- Only the row's team marks it, and the mark is stamped with who made it.
create or replace function public.costing_compliance_team_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_team  text;
  v_actor uuid := public.get_employee_id();
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

  select l.evaluating_team into v_team from public.costing_tender_lines l where l.id = new.tender_line_id;
  if v_team is null then
    raise exception 'costing_team: name the team (RRD or IOE) that judges this row first' using errcode = '42501';
  end if;
  if not public.costing_on_list('team_' || lower(v_team)) then
    raise exception 'costing_team: only the % team can mark this row', v_team using errcode = '42501';
  end if;
  if new.compliance is distinct from old.compliance or new.compliance_note is distinct from old.compliance_note then
    new.complied_by := v_actor;
  end if;
  return new;
end;
$$;

revoke all on function public.costing_compliance_team_guard() from public, anon, authenticated;

drop trigger if exists costing_compliance_team_guard on public.costing_components;
create trigger costing_compliance_team_guard
  before update of compliance, compliance_note, recommended_alternative on public.costing_components
  for each row execute function public.costing_compliance_team_guard();

-- costing_sign (latest: 20261102180000_costing_open_review_fixes.sql): the evaluation can't be approved by
-- someone who marked any of its rows.
create or replace function public.costing_sign(p_matrix_id uuid, p_role text, p_decline_signature boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor     uuid := public.get_employee_id();
  v_opp       uuid;
  v_incharge  uuid;
  v_missing   integer;
  v_signature text;
  v_row       public.costing_signoffs;
begin
  if v_actor is null then
    raise exception 'costing_sign: sign in first' using errcode = '42501';
  end if;
  if p_role is null or p_role not in ('prepared', 'costed', 'evaluation_approved', 'final_approved') then
    raise exception 'costing_sign: % is not a sign-off', coalesce(p_role, 'that') using errcode = '22023';
  end if;

  v_opp := public.costing_matrix_opp(p_matrix_id);
  if v_opp is null then
    raise exception 'costing_sign: not found' using errcode = '22023';
  end if;
  if not public.costing_can_read(v_opp) then
    raise exception 'costing_sign: not allowed' using errcode = '42501';
  end if;

  if p_role = 'evaluation_approved' then
    if not public.costing_on_list('evaluation') then
      raise exception 'costing_sign: only someone on the evaluation list can approve the evaluation' using errcode = '42501';
    end if;
  elsif p_role = 'prepared' then
    select m.sales_incharge_id into v_incharge from public.costing_matrices m where m.id = p_matrix_id;
    if v_incharge is distinct from v_actor then
      raise exception 'costing_sign: only the Sales incharge can sign Prepared by' using errcode = '42501';
    end if;
  elsif p_role = 'costed' then
    select m.purchasing_incharge_id into v_incharge from public.costing_matrices m where m.id = p_matrix_id;
    if v_incharge is distinct from v_actor then
      raise exception 'costing_sign: only the Purchasing incharge can sign Costed by' using errcode = '42501';
    end if;
  elsif not (public.costing_on_list('final_acquire') or public.costing_is_open(v_opp)) then
    raise exception 'costing_sign: only Sales, Purchasing or the Final Acquire list can approve the Final Acquire and offer' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtext('costing_sign:' || p_matrix_id::text));

  if exists (
    select 1 from public.costing_signoffs s
    where s.matrix_id = p_matrix_id and s.role = p_role and s.cleared_at is null
  ) then
    if p_role = 'evaluation_approved' then
      raise exception 'costing_sign: the evaluation is already approved' using errcode = '22023';
    end if;
    raise exception 'costing_sign: that sign-off is already signed' using errcode = '22023';
  end if;

  if p_role = 'evaluation_approved' then
    if exists (
      select 1
      from public.costing_components c
      join public.costing_tender_lines l on l.id = c.tender_line_id
      where l.matrix_id = p_matrix_id and c.complied_by = v_actor
    ) then
      raise exception 'costing_sign: you marked some of these rows, so someone else has to approve the evaluation' using errcode = '42501';
    end if;
    select count(*) into v_missing
    from public.costing_components c
    join public.costing_tender_lines l on l.id = c.tender_line_id
    where l.matrix_id = p_matrix_id and c.compliance is null;
    if v_missing > 0 then
      raise exception 'costing_sign: % Component% no verdict yet',
        v_missing, case when v_missing = 1 then ' has' else 's have' end
        using errcode = '22023';
    end if;
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
