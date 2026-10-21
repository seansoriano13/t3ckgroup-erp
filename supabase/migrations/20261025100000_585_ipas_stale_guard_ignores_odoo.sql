-- #585: the stale-save guard cried "someone else saved" when nobody did.
--
-- Cause: the refresh from Odoo (on open, and on print) writes ipas_events in the VIEWER's name
-- (odoo_copy_changed, filled_from_odoo, approvals_cleared "PO changed in Odoo"). The form's
-- loaded version is the newest event it has seen, so a refresh that lands after that version
-- was taken (Save all pressed while the page is still reloading, or a print whose refresh the
-- page never learned about) looked like another person's save. Another person merely opening
-- the IPAS did the same.
--
-- Fix: ipas_assert_unchanged ignores events written by the Odoo sync. A real edit by anyone
-- (including a second tab of the same person) still refuses. Same signature, same 40001 text.

create or replace function public.ipas_assert_unchanged(p_ipas_id uuid, p_since timestamptz)
returns void
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'ipas_assert_unchanged: not signed in' using errcode = '42501';
  end if;
  if p_since is null then
    return;
  end if;
  if exists (
    select 1 from public.ipas_events e
     where e.ipas_id = p_ipas_id
       and e.created_at > p_since
       and e.kind not in ('odoo_copy_changed', 'filled_from_odoo', 'odoo_changed_since_filing')
       and not (e.kind = 'approvals_cleared' and e.detail ->> 'reason' = 'PO changed in Odoo')
  ) then
    raise exception 'ipas_assert_unchanged: someone else saved this IPAS after you opened it. Nothing was saved. Reload to see their changes; what you typed is still here.'
      using errcode = '40001';
  end if;
end;
$$;

revoke all on function public.ipas_assert_unchanged(uuid, timestamptz) from public, anon;
grant execute on function public.ipas_assert_unchanged(uuid, timestamptz) to authenticated;
