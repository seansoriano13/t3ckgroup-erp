-- ==============================================================================
-- #1233 (spec #1220 follow-up): the Payers seed also finds 201 by name.
--
-- 20261227120000_1223 seeded "the employee with call sign 201". On production no
-- employee has a call sign yet: the GM is the Super Admin named "201" with an empty
-- call sign, so that seed would leave the Payers list empty and 201 would get no
-- bell and no For payment count.
--
-- _ipas_seed_payers() now takes the employee with call sign 201, or, when nobody
-- has that call sign, the Super Admin named exactly "201" whose call sign is empty.
-- Re-runnable: someone already on the list is left as they are.
-- ==============================================================================

create or replace function public._ipas_seed_payers()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_added integer;
begin
  insert into public.ipas_signer_lists (list_key, employee_id)
  select 'payers', e.id
    from public.employees e
   where not coalesce(e.is_deleted, false)
     and (
       e.call_sign = '201'
       or (
         e.call_sign is null
         and e.name = '201'
         and e.is_super_admin
         and not exists (
           select 1 from public.employees c
            where c.call_sign = '201' and not coalesce(c.is_deleted, false)
         )
       )
     )
  on conflict do nothing;
  get diagnostics v_added = row_count;
  return v_added;
end;
$$;

revoke all on function public._ipas_seed_payers() from public, anon, authenticated;

select public._ipas_seed_payers();
