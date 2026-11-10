-- #722 (spec #718): Evaluation approval and the Bid Decision are the only sign-offs before the bid.
--
--   costing_sign      accepts only 'evaluation_approved'. 'prepared', 'costed' and 'final_approved'
--                     are refused like any other role that is not a sign-off (22023). "Costed" is
--                     now derived on screen (every row has a cost); Prepared is the Final Offer
--                     itself; Final approved went with Final Acquire.
--   costing_clear_print_signoffs
--                     no longer clears the three retired roles, so a signature on an old deal stays
--                     live and keeps printing as it was signed. Evaluation clearing is untouched.
--
-- Old costing_signoffs rows are not touched: they stay readable as history. Costing settled
-- (costing_settled_met) already reads only evaluation_approved + a live Go; unchanged.
--
-- SAFE TO RUN AT ANY TIME. Idempotent: create-or-replace.

-- costing_sign (latest: 20261107090000_706_costing_evaluation_teams.sql)
create or replace function public.costing_sign(p_matrix_id uuid, p_role text, p_decline_signature boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor     uuid := public.get_employee_id();
  v_opp       uuid;
  v_missing   integer;
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

  if not coalesce(p_decline_signature, false) then
    select nullif(btrim(e.signature_path), '') into v_signature from public.employees e where e.id = v_actor;
  end if;

  insert into public.costing_signoffs (matrix_id, role, signed_by, signature_declined, signature_version)
  values (p_matrix_id, p_role, v_actor, coalesce(p_decline_signature, false), v_signature)
  returning * into v_row;

  return jsonb_build_object('signoff', to_jsonb(v_row));
end;
$$;

-- costing_clear_print_signoffs (latest: 20261018200000_costing_print_signoffs.sql): skips retired roles.
create or replace function public.costing_clear_print_signoffs()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_roles  text[] := array(
    select r from unnest(string_to_array(tg_argv[0], ',')) r
    where r not in ('prepared', 'costed', 'final_approved')
  );
  v_reason text := tg_argv[1];
  v_column text := coalesce(tg_argv[2], '');
  v_old    jsonb := case when tg_op = 'INSERT' then null else to_jsonb(old) end;
  v_new    jsonb := case when tg_op = 'DELETE' then null else to_jsonb(new) end;
  v_matrix uuid;
begin
  if coalesce(array_length(v_roles, 1), 0) = 0 then
    return null;
  end if;

  if v_column <> '' then
    if tg_op = 'INSERT' and coalesce(v_new -> v_column, 'null'::jsonb) = 'null'::jsonb then
      return null;
    elsif tg_op = 'DELETE' and coalesce(v_old -> v_column, 'null'::jsonb) = 'null'::jsonb then
      return null;
    elsif tg_op = 'UPDATE' and (v_new -> v_column) is not distinct from (v_old -> v_column) then
      return null;
    end if;
  end if;

  v_matrix := public.costing_matrix_of(tg_table_name, coalesce(v_new, v_old));
  if v_matrix is null or not exists (select 1 from public.costing_matrices where id = v_matrix) then
    return null;
  end if;

  perform public.costing_clear_signoffs(v_matrix, v_roles, v_reason);
  return null;
end;
$$;

revoke all on function public.costing_clear_print_signoffs() from public, anon, authenticated;
revoke all on function public.costing_sign(uuid, text, boolean) from public, anon;
grant execute on function public.costing_sign(uuid, text, boolean) to authenticated;
