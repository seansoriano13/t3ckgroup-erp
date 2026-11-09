-- Compliance follows the products (#932, spec #927 decision 3).
--
-- WHY: the S0 Evaluation's overall verdict (costing_matrices.compliance) was picked by hand while each product has
-- its own verdict (costing_components.compliance). The Technical list's bar read only the overall verdict, so it was
-- all-or-nothing, and it counted tender lines while the sheet judges products.
--
-- WHAT THIS CHANGES
--   * costing_overall_compliance_value(matrix) computes the verdict: Complies only when every product complies, Deviates
--     as soon as one deviates, unjudged (null) otherwise, and unjudged for a matrix with no products.
--     costing_refresh_overall_compliance(matrix) stores it. Triggers on costing_components (product added, removed,
--     re-judged, moved) and on costing_tender_lines (line deleted, its products cascade) keep
--     costing_matrices.compliance equal to it. compliance_by on a derived verdict is the matrix's Technical in-charge
--     (not the editor who touched a product), empty when none is named.
--   * costing_matrices.compliance can no longer be written by hand (only the derivation, or the service role, writes it).
--     The in-charge still writes the offer-level note (compliance_note) and is still the only one who may.
--   * Existing stored overall verdicts are replaced by the derived value. Approvals are NOT cleared by this backfill.
--   * The "a deviation needs a note" CHECK on the matrix is dropped (a product's deviation would otherwise make a
--     product write fail); costing_sign now refuses approving a Deviates evaluation whose note is blank instead.
--   * costing_technical_list() counts products (rows_total, rows_judged), adds rows_deviates and compliance.
--
-- SAFE TO RUN AT ANY TIME: create or replace / drop if exists; the backfill is idempotent.

-- ---------------------------------------------------------------------------
-- The derivation
-- ---------------------------------------------------------------------------

create or replace function public.costing_overall_compliance_value(p_matrix_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when count(c.id) = 0 then null
    when count(*) filter (where c.compliance = 'deviates') > 0 then 'deviates'
    when count(*) filter (where c.compliance = 'complies') = count(c.id) then 'complies'
    else null
  end
  from public.costing_tender_lines l
  join public.costing_components c on c.tender_line_id = l.id
  where l.matrix_id = p_matrix_id
$$;

create or replace function public.costing_refresh_overall_compliance(p_matrix_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_new text := public.costing_overall_compliance_value(p_matrix_id);
  v_old text;
begin
  select m.compliance into v_old from public.costing_matrices m where m.id = p_matrix_id;
  if not found or v_old is not distinct from v_new then
    return;
  end if;
  -- compliance_by means "whose verdict this is". The derived verdict is the Technical in-charge's by role (they are the
  -- only person who may judge the offer), whoever happened to edit a product row (a sales or costing editor, or a
  -- cascade from a deleted line). With no in-charge named yet it is left empty rather than naming an editor.
  perform set_config('costing.derive', 'on', true);
  update public.costing_matrices
     set compliance = v_new, compliance_by = technical_incharge_id, compliance_at = now()
   where id = p_matrix_id;
  perform set_config('costing.derive', 'off', true);
end;
$$;

-- Fires for a product row (insert, delete, re-judge, move to another line) ...
create or replace function public.costing_component_derive_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_matrix uuid;
begin
  if tg_op in ('INSERT', 'UPDATE') then
    select l.matrix_id into v_matrix from public.costing_tender_lines l where l.id = new.tender_line_id;
    if v_matrix is not null then
      perform public.costing_refresh_overall_compliance(v_matrix);
    end if;
  end if;
  if tg_op in ('DELETE', 'UPDATE') then
    select l.matrix_id into v_matrix from public.costing_tender_lines l where l.id = old.tender_line_id;
    if v_matrix is not null then
      perform public.costing_refresh_overall_compliance(v_matrix);
    end if;
  end if;
  return null;
end;
$$;

-- ... and for a tender line that is deleted: its products go with it (cascade), and by then the line is
-- gone, so the product trigger above cannot find its matrix. This one re-derives from the line itself.
create or replace function public.costing_tender_line_derive_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.costing_refresh_overall_compliance(old.matrix_id);
  return null;
end;
$$;

revoke all on function public.costing_overall_compliance_value(uuid) from public, anon, authenticated;
revoke all on function public.costing_refresh_overall_compliance(uuid) from public, anon, authenticated;
revoke all on function public.costing_component_derive_trigger() from public, anon, authenticated;
revoke all on function public.costing_tender_line_derive_trigger() from public, anon, authenticated;

drop trigger if exists costing_component_derive on public.costing_components;
create trigger costing_component_derive
  after insert or delete or update of compliance, tender_line_id on public.costing_components
  for each row execute function public.costing_component_derive_trigger();

drop trigger if exists costing_tender_line_derive on public.costing_tender_lines;
create trigger costing_tender_line_derive
  after delete on public.costing_tender_lines
  for each row execute function public.costing_tender_line_derive_trigger();

-- Re-run safe: the first version of this migration used these two names.
drop function if exists public.costing_derived_compliance(uuid);
drop function if exists public.costing_derive_compliance(uuid);

-- ---------------------------------------------------------------------------
-- The matrix guard: the verdict is never written by hand
-- ---------------------------------------------------------------------------

create or replace function public.costing_matrix_verdict_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := public.get_employee_id();
  v_trusted boolean := auth.uid() is null
    or coalesce(auth.role(), '') = 'service_role'
    or coalesce(current_setting('costing.bypass', true), '') = 'on';
begin
  if new.compliance is distinct from old.compliance then
    if coalesce(current_setting('costing.derive', true), '') = 'on' or v_trusted then
      return new;
    end if;
    raise exception 'costing_technical: the overall verdict follows from the products and cannot be set by hand'
      using errcode = '42501';
  end if;
  if new.compliance_note is not distinct from old.compliance_note then
    -- Not a verdict change. The stamp belongs to the verdict, so a plain write cannot move it.
    new.compliance_by := old.compliance_by;
    new.compliance_at := old.compliance_at;
    return new;
  end if;
  if v_trusted then
    return new;
  end if;
  if old.technical_incharge_id is null then
    raise exception 'costing_technical: name the Technical in-charge first' using errcode = '42501';
  end if;
  if v_actor is distinct from old.technical_incharge_id then
    raise exception 'costing_technical: only the Technical in-charge can give the Compliance verdict' using errcode = '42501';
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Backfill: stored overall verdicts become the derived value (approvals stay)
-- ---------------------------------------------------------------------------

alter table public.costing_matrices drop constraint if exists costing_matrices_deviation_note_chk;

alter table public.costing_matrices disable trigger costing_clear_evaluation_matrix;
alter table public.costing_matrices disable trigger costing_matrix_verdict_guard;
update public.costing_matrices m
   set compliance = public.costing_overall_compliance_value(m.id)
 where m.compliance is distinct from public.costing_overall_compliance_value(m.id);
alter table public.costing_matrices enable trigger costing_matrix_verdict_guard;
alter table public.costing_matrices enable trigger costing_clear_evaluation_matrix;

-- ---------------------------------------------------------------------------
-- The Technical list counts products
-- ---------------------------------------------------------------------------

drop function if exists public.costing_technical_list();

create function public.costing_technical_list()
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
  is_mine boolean,
  rows_deviates integer,
  compliance text
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_me uuid := public.get_employee_id();
  v_all boolean := coalesce(public.is_super_admin(), false) or public.costing_on_list('evaluation');
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
    p.total,
    p.judged,
    exists (
      select 1 from public.costing_signoffs s
      where s.matrix_id = m.id and s.role = 'evaluation_approved' and s.cleared_at is null
    ),
    m.technical_incharge_id = v_me,
    p.deviates,
    m.compliance
  from public.costing_matrices m
  join public.sales_opportunities o on o.id = m.opportunity_id
  left join public.flow_stages fs on fs.id = o.flow_stage_id
  cross join lateral (
    select count(c.id)::integer as total,
           (count(*) filter (where c.compliance is not null))::integer as judged,
           (count(*) filter (where c.compliance = 'deviates'))::integer as deviates
    from public.costing_tender_lines l
    join public.costing_components c on c.tender_line_id = l.id
    where l.matrix_id = m.id
  ) p
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
-- Approval: a Deviates evaluation needs the offer-level note
-- (the 20261121200000 body, plus the note check)
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

  if exists (select 1 from public.costing_matrices m where m.id = p_matrix_id and m.technical_incharge_id = v_actor) then
    raise exception 'costing_sign: the Technical in-charge cannot approve the evaluation, so someone else has to' using errcode = '42501';
  end if;
  if not exists (select 1 from public.costing_matrices m where m.id = p_matrix_id and m.compliance is not null) then
    raise exception 'costing_sign: the Technical verdict is not given yet' using errcode = '22023';
  end if;
  if exists (select 1 from public.costing_matrices m where m.id = p_matrix_id and m.compliance = 'deviates' and nullif(btrim(m.compliance_note), '') is null) then
    raise exception 'costing_sign: a deviation needs the Technical note first' using errcode = '22023';
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
