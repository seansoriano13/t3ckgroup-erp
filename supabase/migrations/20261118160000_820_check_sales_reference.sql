-- #820 (spec #800, ADR 0050) — Registration runs the same checks as the S0 save step.
--
-- check_sales_reference is the read-only half of set_sales_reference: format, duplicates and the
-- Odoo fact, in the same order and with the same refusal texts and hint codes, but nothing is
-- written. The registration form's save calls it (through the sor-sales-reference edge function,
-- action "check") BEFORE the SOR is created, so a refused S0 never leaves a half-registered SOR.
-- Registering then goes through set_sales_reference itself, so the write, the Odoo state, the
-- product pull and the history are not duplicated here.
--
-- Anyone signed in may register, so unlike the save step there is no permission or lock check.
-- Service role only: the browser never sends Odoo facts.

create or replace function public.check_sales_reference(
  p_actor_email text,
  p_sales_reference text,
  p_odoo text default 'unreachable'
) returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_new text := upper(nullif(btrim(coalesce(p_sales_reference, '')), ''));
  v_other record;
begin
  if p_actor_email is null or btrim(p_actor_email) = '' then
    raise exception 'check_sales_reference: not signed in' using errcode = '42501';
  end if;
  if p_odoo is null or p_odoo not in ('found', 'not_found', 'unreachable') then
    raise exception 'check_sales_reference: p_odoo must be found, not_found or unreachable' using errcode = '22023';
  end if;

  -- Nothing typed: nothing to check (an S0 can be added later).
  if v_new is null then
    return jsonb_build_object('sales_reference', null, 'odoo_state', null);
  end if;

  -- 1. Format.
  if v_new ~ '^SO[0-9]+$' then
    v_new := 'S' || substr(v_new, 3);
  end if;
  if v_new !~ '^S[0-9]+$' then
    raise exception 'Sales Reference must be the Odoo quotation number — "S" followed by digits, e.g. S01237.'
      using errcode = '22023', hint = 'format';
  end if;

  -- 2. Duplicates: any SOR that is not deleted (Lost included). No bypass.
  select o.id, o.project_title, o.client_name into v_other
    from public.sales_opportunities o
    where o.sales_reference = v_new
      and coalesce(o.is_deleted, false) = false
    order by o.created_at
    limit 1;
  if v_other.id is not null then
    raise exception '% is already on SOR "%" (%). One S0 per SOR.',
      v_new, v_other.project_title, v_other.client_name
      using errcode = '23505', hint = 'duplicate';
  end if;

  -- 3. Odoo.
  if p_odoo = 'not_found' then
    raise exception 'Odoo has no %. Check the number.', v_new using errcode = '22023', hint = 'not_found';
  end if;

  return jsonb_build_object(
    'sales_reference', v_new,
    'odoo_state', case p_odoo when 'found' then 'found' else 'not_checked' end
  );
end;
$$;

comment on function public.check_sales_reference(text, text, text) is
  '#820 (ADR 0050): the read-only half of set_sales_reference for registration: format, duplicates (Lost counts, deleted does not, no bypass) and the Odoo fact, same refusals and hints, nothing written. Service role only.';

revoke all on function public.check_sales_reference(text, text, text) from public, anon, authenticated;
grant execute on function public.check_sales_reference(text, text, text) to service_role;
