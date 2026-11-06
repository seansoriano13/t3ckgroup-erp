-- Filing's Received, Noted and Checked become one sign-off on screen: "Check".
-- Anyone on the Received, Noted or Checked list gives all three at once, after
-- reviewing the final IPAS form. The three rows are still written (the printed
-- form and the Approve gate read them), all signed by that one person.
-- Section 7's Approved (which files the IPAS) is unchanged.

create or replace function public.ipas_sign_check(
  p_ipas_id uuid,
  p_decline_signature boolean default false
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := public.get_employee_id();
  v_ipas public.ipas;
  v_row public.ipas_signoffs;
  v_role text;
  v_signature text;
  v_given text[] := '{}';
  v_notify uuid[] := '{}';
begin
  if v_actor is null then
    raise exception 'ipas_sign_check: not signed in' using errcode = '42501';
  end if;

  v_ipas := public._ipas_lock_open('ipas_sign_check', p_ipas_id);

  if not (
    public._ipas_on_list('s7_received', v_actor)
    or public._ipas_on_list('s7_noted', v_actor)
    or public._ipas_on_list('s7_checked', v_actor)
  ) then
    raise exception 'ipas_sign_check: you are not on the Received, Noted or Checked list' using errcode = '42501';
  end if;

  if not public._ipas_filing_open(v_ipas.id) then
    raise exception 'ipas_sign_check: the IPAS can be checked once sections %, %, % and Logistics are signed',
      public._ipas_section_no(1), public._ipas_section_no(3), public._ipas_section_no(6)
      using errcode = '22023';
  end if;

  if p_decline_signature then
    v_signature := null;
  else
    select e.signature_path into v_signature from public.employees e where e.id = v_actor;
  end if;

  foreach v_role in array array['received', 'noted', 'checked'] loop
    if not exists (
      select 1 from public.ipas_signoffs s
       where s.ipas_id = v_ipas.id and s.section = 7 and s.role = v_role and s.cleared_at is null
    ) then
      insert into public.ipas_signoffs (ipas_id, section, role, signed_by, signature_declined, signature_version)
      values (v_ipas.id, 7, v_role, v_actor, coalesce(p_decline_signature, false), v_signature)
      returning * into v_row;

      perform public._ipas_write_event(v_ipas.id, v_actor, 'signed', jsonb_build_object(
        'section', 7,
        'role', v_role,
        'signoff_id', v_row.id,
        'signature_declined', v_row.signature_declined
      ));
      v_given := v_given || v_role;
    end if;
  end loop;

  if array_length(v_given, 1) is null then
    raise exception 'ipas_sign_check: % is already checked', v_ipas.number using errcode = '22023';
  end if;

  v_notify := public._ipas_list_members(array['s7_approved'], v_actor);

  return jsonb_build_object(
    'signoff', to_jsonb(v_row),
    'ipas', to_jsonb(v_ipas),
    'section', 7,
    'role', 'checked',
    'given', to_jsonb(v_given),
    'stage', 'approve_ready',
    'filed', false,
    'notify_ids', to_jsonb(v_notify)
  );
end;
$$;
revoke all on function public.ipas_sign_check(uuid, boolean) from public, anon;
grant execute on function public.ipas_sign_check(uuid, boolean) to authenticated;
