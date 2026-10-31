-- Spec #800 review fixes (ADR 0050).
--
-- 1. set_sales_reference
--    * Takes a lock on the S0 value, so two saves of the same S0 at the same moment cannot both
--      pass the duplicate check (ADR 0050 had accepted this race until a unique rule lands).
--    * Clearing the S0, or saving an S0 Odoo has with no lines, marks the old S0's Odoo products
--      Removed from S0, as the #818 preview already says it will. Hand-typed lines are untouched
--      (sor_replace_items would delete them, so it is not called with an empty list).
-- 2. sor_guard_sales_reference
--    * Also guards sales_reference_odoo_state and sales_reference_checked_at: the browser never
--      sends Odoo facts (#816).
--    * Refuses bringing back a deleted SOR (is_deleted true -> false) whose S0 another live SOR
--      now has, however it is written; restore_opportunity already checks this (#819).
--    * Only a signed-in or anon caller is judged. service_role and direct database connections
--      (no request role) pass; an anon call no longer passes just because it has no uid.
-- No data is changed.

create or replace function public.set_sales_reference(
  p_actor_email text,
  p_opportunity_id uuid,
  p_sales_reference text,
  p_reason text default null,
  p_odoo text default 'unreachable',
  p_items jsonb default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_new text := upper(nullif(btrim(coalesce(p_sales_reference, '')), ''));
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_actor uuid;
  v_opp public.sales_opportunities;
  v_lock text;
  v_super boolean;
  v_other record;
  v_state text;
  v_checked timestamptz;
  v_event text;
  v_content text;
  v_meta jsonb;
begin
  if p_actor_email is null or btrim(p_actor_email) = '' then
    raise exception 'set_sales_reference: not signed in' using errcode = '42501';
  end if;
  if p_odoo is null or p_odoo not in ('found', 'not_found', 'unreachable') then
    raise exception 'set_sales_reference: p_odoo must be found, not_found or unreachable' using errcode = '22023';
  end if;

  -- 1. Format ("S" then digits; SO123 is read as S123, as the app does).
  if v_new is not null then
    if v_new ~ '^SO[0-9]+$' then
      v_new := 'S' || substr(v_new, 3);
    end if;
    if v_new !~ '^S[0-9]+$' then
      raise exception 'Sales Reference must be the Odoo quotation number — "S" followed by digits, e.g. S01237.'
        using errcode = '22023', hint = 'format';
    end if;
  end if;

  -- Act as the caller the edge function authenticated.
  perform set_config('request.jwt.claims',
    jsonb_build_object('email', p_actor_email, 'role', 'authenticated')::text, true);
  v_actor := public.get_employee_id();
  if v_actor is null then
    raise exception 'set_sales_reference: not signed in' using errcode = '42501';
  end if;

  select * into v_opp from public.sales_opportunities
    where id = p_opportunity_id and coalesce(is_deleted, false) = false
    for update;
  if v_opp.id is null then
    raise exception 'That SOR could not be found.' using errcode = 'P0002', hint = 'not_found_sor';
  end if;

  -- Same value as now: nothing to do.
  if v_new is not distinct from v_opp.sales_reference then
    return jsonb_build_object(
      'sales_reference', v_opp.sales_reference,
      'odoo_state', v_opp.sales_reference_odoo_state,
      'checked_at', v_opp.sales_reference_checked_at
    );
  end if;

  -- 2 + 3. Permission and lock.
  v_super := public.is_super_admin();
  v_lock := public.sor_sales_reference_lock(v_opp.id);
  if not public.sor_can_edit_opportunity(v_opp.id) then
    raise exception 'You do not have permission to change this SOR''s S0.' using errcode = '42501', hint = 'forbidden';
  end if;
  if v_lock = 'locked' then
    if not v_super then
      raise exception 'This S0 is locked. Only a Super Admin can change it.' using errcode = '42501', hint = 'locked';
    end if;
    if v_reason is null then
      raise exception 'Say why the locked S0 is being changed.' using errcode = '22023', hint = 'reason_required';
    end if;
  end if;

  -- 4. Duplicates: any other SOR that is not deleted (Lost included). No bypass. The lock on the
  -- S0 value makes a second save of the same S0 wait for the first, then see its row.
  if v_new is not null then
    perform pg_advisory_xact_lock(hashtext('sales_reference:' || v_new));
    select o.id, o.project_title, o.client_name into v_other
      from public.sales_opportunities o
      where o.sales_reference = v_new
        and o.id <> v_opp.id
        and coalesce(o.is_deleted, false) = false
      order by o.created_at
      limit 1;
    if v_other.id is not null then
      raise exception '% is already on SOR "%" (%). One S0 per SOR.',
        v_new, v_other.project_title, v_other.client_name
        using errcode = '23505', hint = 'duplicate';
    end if;
  end if;

  -- 5. Odoo. Clearing needs no answer.
  if v_new is null then
    v_state := null;
    v_checked := null;
  elsif p_odoo = 'not_found' then
    raise exception 'Odoo has no %. Check the number.', v_new using errcode = '22023', hint = 'not_found';
  elsif p_odoo = 'found' then
    v_state := 'found';
    v_checked := now();
  else
    v_state := 'not_checked';
    v_checked := null;
  end if;

  v_event := case
    when v_lock = 'locked' then 'SALES_REFERENCE_OVERRIDDEN'
    when v_new is null then 'SALES_REFERENCE_CLEARED'
    when v_opp.sales_reference is null then 'SALES_REFERENCE_SET'
    else 'SALES_REFERENCE_CHANGED'
  end;

  perform set_config('app.sor_set_sales_reference', 'on', true);
  update public.sales_opportunities
     set sales_reference = v_new,
         sales_reference_odoo_state = v_state,
         sales_reference_checked_at = v_checked
   where id = v_opp.id;

  -- The Odoo lines, through the line-matching save (ADR 0041), when the edge function sent them.
  if p_items is not null then
    perform public.sor_replace_items(v_opp.id, p_items);
  elsif v_new is null or p_odoo = 'found' then
    -- Cleared, or an S0 Odoo has with no lines: the old S0's products are kept and marked, as
    -- the change preview (#818) says. Hand-typed lines stay.
    update public.sales_opportunity_items i
       set removed_from_s0 = true
     where i.opportunity_id = v_opp.id
       and i.odoo_line_id is not null
       and not i.removed_from_s0;
  end if;

  v_content := case v_event
    when 'SALES_REFERENCE_SET' then format('S0 set to %s', v_new)
    when 'SALES_REFERENCE_CLEARED' then format('S0 %s cleared', v_opp.sales_reference)
    when 'SALES_REFERENCE_OVERRIDDEN' then format('Locked S0 changed from %s to %s', v_opp.sales_reference, coalesce(v_new, '(none)'))
    else format('S0 changed from %s to %s', v_opp.sales_reference, v_new)
  end || coalesce(' — ' || v_reason, '');
  v_meta := jsonb_build_object(
    'event', v_event,
    'old', v_opp.sales_reference,
    'new', v_new,
    'reason', v_reason,
    'employeeId', v_actor
  );

  insert into public.sales_opportunity_logs (opportunity_id, author_id, type, content, metadata)
  values (v_opp.id, v_actor, 'SYSTEM', v_content, v_meta);
  insert into public.system_audit_logs (author_id, entity_type, entity_id, content, type, metadata)
  values (v_actor, 'OPPORTUNITY', v_opp.id::text, v_content, 'SYSTEM', v_meta);

  return jsonb_build_object('sales_reference', v_new, 'odoo_state', v_state, 'checked_at', v_checked);
end;
$$;

-- ------------------------------------------------------------------------------
-- The guard
-- ------------------------------------------------------------------------------

create or replace function public.sor_guard_sales_reference()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_old text;
  v_new text := nullif(btrim(upper(coalesce(NEW.sales_reference, ''))), '');
  v_other record;
begin
  -- Only browser callers are judged. service_role (the edge functions) and direct database
  -- connections carry no 'authenticated' / 'anon' request role.
  if coalesce(auth.role(), '') not in ('authenticated', 'anon') then
    return NEW;
  end if;

  -- Bringing back a deleted SOR whose S0 another live SOR now has (#819), however it is written.
  if TG_OP = 'UPDATE' and coalesce(OLD.is_deleted, false) and not coalesce(NEW.is_deleted, false)
     and v_new is not null then
    select o.project_title, o.client_name into v_other
      from public.sales_opportunities o
      where o.sales_reference = v_new
        and o.id <> NEW.id
        and coalesce(o.is_deleted, false) = false
      order by o.created_at
      limit 1;
    if found then
      raise exception '% is now on SOR "%" (%). Change one S0 before restoring.',
        v_new, v_other.project_title, v_other.client_name
        using errcode = '23505', hint = 'duplicate';
    end if;
  end if;

  if coalesce(current_setting('app.sor_set_sales_reference', true), '') = 'on' then
    return NEW;
  end if;

  if TG_OP = 'INSERT' then
    if v_new is not null or NEW.sales_reference_odoo_state is not null or NEW.sales_reference_checked_at is not null then
      raise exception 'The S0 is set from the S0 card, not when a row is written directly.'
        using errcode = '42501', hint = 'sales_reference_direct_write';
    end if;
    return NEW;
  end if;

  v_old := nullif(btrim(upper(coalesce(OLD.sales_reference, ''))), '');
  if v_new is distinct from v_old
     or NEW.sales_reference_odoo_state is distinct from OLD.sales_reference_odoo_state
     or NEW.sales_reference_checked_at is distinct from OLD.sales_reference_checked_at then
    raise exception 'The S0 can only be changed from the S0 card.'
      using errcode = '42501', hint = 'sales_reference_direct_write';
  end if;
  return NEW;
end;
$function$;

comment on function public.sor_guard_sales_reference() is
  '#822 + #800 review (ADR 0050): refuses a direct INSERT with an S0 or Odoo state, an UPDATE that changes the S0 or its Odoo state, unless set_sales_reference / recheck / retail approval set app.sor_set_sales_reference = on; and refuses restoring a deleted SOR onto an S0 another live SOR has. Only authenticated / anon callers are judged; service_role and direct database connections pass.';

drop trigger if exists trg_sales_opportunities_s0_guard on public.sales_opportunities;
create trigger trg_sales_opportunities_s0_guard
  before insert or update of sales_reference, sales_reference_odoo_state, sales_reference_checked_at, is_deleted
  on public.sales_opportunities
  for each row execute function public.sor_guard_sales_reference();
