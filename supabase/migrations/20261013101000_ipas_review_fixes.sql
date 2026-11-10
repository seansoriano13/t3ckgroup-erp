-- ==============================================================================
-- IPAS code-review fixes (#241).
--
--   1. Numbering broke at 1000: lpad(n, 3, '0') TRUNCATES, so 1000 became
--      TGIPAS_100 and collided with the unique key. The format is now a function
--      that pads to three digits and never cuts a longer number.
--   2. has_finance_access() and ipas_can_read() were granted to authenticated
--      but never revoked from public/anon (the migration pattern is revoke, then
--      grant). Revoked here; the IPAS trigger functions are revoked from every
--      client role too, as the helpers already were.
--   3. ipas_sor_headers(null) returned the SORs of every IPAS. A null or empty
--      id list now returns nothing; callers name the IPAS they want.
--
-- SAFE TO RUN AT ANY TIME, against a live frontend of any version. The service
-- change that stops asking for "every IPAS" ships with it: an older frontend
-- that still passes null gets no SOR headers on the list until it is updated.
-- Idempotent.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. Numbering
-- ------------------------------------------------------------------------------

create or replace function public.ipas_format_number(p_value bigint)
returns text
language sql
immutable
set search_path = public
as $$
  select 'TGIPAS_' || lpad(p_value::text, greatest(3, length(p_value::text)), '0');
$$;

comment on function public.ipas_format_number(bigint) is
  '#241: the IPAS number for a sequence value: TGIPAS_ and the value zero-padded to three digits at least, never truncated (TGIPAS_048, TGIPAS_999, TGIPAS_1000).';

revoke all on function public.ipas_format_number(bigint) from public, anon, authenticated;

alter table public.ipas
  alter column number set default public.ipas_format_number(nextval('public.ipas_number_seq'));

-- ------------------------------------------------------------------------------
-- 2. Grants
-- ------------------------------------------------------------------------------

revoke all on function public.has_finance_access() from public, anon;
grant execute on function public.has_finance_access() to authenticated;

revoke all on function public.ipas_can_read() from public, anon;
grant execute on function public.ipas_can_read() to authenticated;

-- Trigger functions: never called by a client, only fired by their trigger.
revoke all on function public.set_ipas_updated_at() from public, anon, authenticated;
revoke all on function public.ipas_guard() from public, anon, authenticated;
revoke all on function public.ipas_enforce_sor_rule() from public, anon, authenticated;
revoke all on function public.ipas_events_append_only() from public, anon, authenticated;
revoke all on function public.ipas_fill_from_odoo_copy() from public, anon, authenticated;
revoke all on function public.ipas_options_guard() from public, anon, authenticated;
revoke all on function public.ipas_signoffs_guard() from public, anon, authenticated;
revoke all on function public.ipas_payments_paid_before_approval() from public, anon, authenticated;
revoke all on function public.ipas_freeze_guard() from public, anon, authenticated;
revoke all on function public.ipas_children_freeze_guard() from public, anon, authenticated;

-- ------------------------------------------------------------------------------
-- 3. ipas_sor_headers: ids are required
-- ------------------------------------------------------------------------------

create or replace function public.ipas_sor_headers(p_ipas_ids uuid[] default null)
returns table (
  ipas_id uuid,
  opportunity_id uuid,
  sales_reference text,
  project_title text,
  client_name text
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if public.get_employee_id() is null then
    raise exception 'ipas_sor_headers: not signed in' using errcode = '42501';
  end if;
  if not public.ipas_can_read() then
    return;
  end if;
  -- Ask for the IPAS you mean: no ids, no rows (null used to mean every IPAS).
  if p_ipas_ids is null or cardinality(p_ipas_ids) = 0 then
    return;
  end if;

  return query
    select s.ipas_id, s.opportunity_id, o.sales_reference, o.project_title, o.client_name
      from public.ipas_sors s
      join public.sales_opportunities o on o.id = s.opportunity_id
     where s.ipas_id = any (p_ipas_ids)
     order by o.sales_reference;
end;
$$;

comment on function public.ipas_sor_headers(uuid[]) is
  '#242, #241 review: the SORs each named IPAS has, as reference, project and customer, for anyone who can read IPAS (who may not be able to read the SOR itself). A null or empty id list, or no IPAS access, returns no rows.';

revoke all on function public.ipas_sor_headers(uuid[]) from public, anon;
grant execute on function public.ipas_sor_headers(uuid[]) to authenticated;
