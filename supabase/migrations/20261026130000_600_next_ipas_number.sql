-- Set the next IPAS number (#600, spec #595).
--
-- The IPAS number is TGIPAS_ plus the value of `ipas_number_seq` (#242). It was
-- fixed at 49 when the module was built, which cannot be changed from the app
-- and lets test runs eat into the real series. On go-live day a Super Admin
-- needs to carry on from the sheet's real last number.
--
-- 1. `ipas_next_number()`: the read behind Settings > Purchasing. Returns the
--    number the next IPAS will take, and the highest number already given.
--    Any signed-in employee may read it; it is only a number.
--
-- 2. `ipas_set_next_number(p_number)`: Super Admins only. Sets the sequence so
--    the next IPAS takes `p_number`. Refused at or below the highest number
--    already given, parsed from the existing `TGIPAS_` numbers (cancelled IPAS
--    included, since a cancelled number is never reused). Unlike the
--    Transmittal first-number function it can be used at any time, not just
--    before the first record: it can only move the series forward, so no number
--    is ever handed out twice. Writes an audit row (who, when, from, to) to
--    `system_audit_logs`.
--
-- SAFE TO RUN AT ANY TIME: two new functions, nothing existing altered.

-- ------------------------------------------------------------------------------
-- 1. The highest number given (internal) and the read
-- ------------------------------------------------------------------------------

create or replace function public.ipas_highest_number_given()
returns bigint
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(max((substring(number from '^TGIPAS_(\d+)$'))::bigint), 0)
  from public.ipas;
$$;

comment on function public.ipas_highest_number_given() is
  '#600: the highest IPAS number already given, parsed from every existing TGIPAS_ number (cancelled ones included). 0 when there is none. Internal.';

revoke all on function public.ipas_highest_number_given() from public, anon, authenticated;

create or replace function public.ipas_next_number()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_last bigint;
  v_called boolean;
  v_next bigint;
begin
  if public.get_employee_id() is null then
    raise exception 'ipas_next_number: sign in first' using errcode = '42501';
  end if;

  select last_value, is_called into v_last, v_called from public.ipas_number_seq;
  v_next := case when v_called then v_last + 1 else v_last end;

  return jsonb_build_object(
    'next_value', v_next,
    'number_format', public.ipas_format_number(v_next),
    'highest_given', public.ipas_highest_number_given()
  );
end;
$$;

comment on function public.ipas_next_number() is
  '#600: the number the next IPAS will take (next_value, number_format) and the highest number already given. Any signed-in employee.';

revoke all on function public.ipas_next_number() from public, anon;
grant execute on function public.ipas_next_number() to authenticated;

-- ------------------------------------------------------------------------------
-- 2. Set the next number (Super Admins only)
-- ------------------------------------------------------------------------------

create or replace function public.ipas_set_next_number(p_number bigint)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := public.get_employee_id();
  v_before jsonb;
  v_highest bigint;
begin
  if not coalesce(public.is_super_admin(), false) then
    raise exception 'ipas_set_next_number: only a Super Admin sets the next IPAS number' using errcode = '42501';
  end if;
  if p_number is null or p_number < 1 then
    raise exception 'ipas_set_next_number: the next number must be 1 or more' using errcode = '22023';
  end if;

  -- Wait for any IPAS being raised right now, and hold new ones back, so the
  -- highest number given cannot move between the check and the change.
  lock table public.ipas in share row exclusive mode;

  v_highest := public.ipas_highest_number_given();
  if p_number <= v_highest then
    raise exception 'ipas_set_next_number: % is already used or below it; the next number must be above %',
      public.ipas_format_number(p_number), public.ipas_format_number(v_highest)
      using errcode = '22023';
  end if;

  v_before := public.ipas_next_number();
  perform setval('public.ipas_number_seq', p_number, false);

  insert into public.system_audit_logs (author_id, entity_type, entity_id, content, type, metadata)
  values (
    v_actor,
    'IPAS_NUMBER',
    'ipas_number_seq',
    'Next IPAS number set to ' || public.ipas_format_number(p_number)
      || ' (was ' || (v_before ->> 'number_format') || ')',
    'SYSTEM',
    jsonb_build_object(
      'from', (v_before ->> 'next_value')::bigint,
      'to', p_number,
      'highest_given', v_highest
    )
  );

  return jsonb_build_object(
    'next_value', p_number,
    'number_format', public.ipas_format_number(p_number),
    'highest_given', v_highest
  );
end;
$$;

comment on function public.ipas_set_next_number(bigint) is
  '#600: a Super Admin sets the next IPAS number at any time. Refused at or below the highest number already given (cancelled ones included), so a number is never reused. Writes an audit row.';

revoke all on function public.ipas_set_next_number(bigint) from public, anon;
grant execute on function public.ipas_set_next_number(bigint) to authenticated;
