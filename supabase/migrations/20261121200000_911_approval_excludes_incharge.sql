-- Evaluation approved excludes the Technical in-charge (#911, spec #907 decision 10).
--
-- WHY: #908 refused the one who gave the Compliance verdict. The verdict is now the Technical in-charge's
-- alone, so the rule is the in-charge: they cannot approve the S0 Evaluation they judged, whoever they are
-- and whatever the verdict's stamp says. Someone else on the evaluation list approves it.
--
-- WHAT THIS CHANGES
--   * costing_sign('evaluation_approved') refuses the SOR's Technical in-charge (technical_incharge_id)
--     instead of "anyone who marked a row" (compliance_by). Everything else in the function is unchanged.
--
-- SAFE TO RUN AT ANY TIME: create or replace of the same function body; grants carry over. Idempotent.

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

  if not coalesce(p_decline_signature, false) then
    select nullif(btrim(e.signature_path), '') into v_signature from public.employees e where e.id = v_actor;
  end if;

  insert into public.costing_signoffs (matrix_id, role, signed_by, signature_declined, signature_version)
  values (p_matrix_id, p_role, v_actor, coalesce(p_decline_signature, false), v_signature)
  returning * into v_row;

  return jsonb_build_object('signoff', to_jsonb(v_row));
end;
$$;
