-- Who to ask for access to an SOR you cannot open (#474).
--
-- A person with no access used to get nothing on screen: the modal did not
-- render. The prohibited screen names the Deal Owner to ask, and nothing else
-- about the SOR — no reference, no client, no Stage. Zero rows when the SOR
-- does not exist (or is deleted), so the screen can say "not found" instead.

create or replace function public.sor_access_contact(p_opportunity_id uuid)
returns table (deal_owner_name text)
language sql
stable
security definer
set search_path = public
as $function$
  select e.name
  from public.sales_opportunities o
  left join public.employees e on e.id = o.deal_owner_id
  where o.id = p_opportunity_id
    and coalesce(o.is_deleted, false) = false
    and public.get_employee_id() is not null
$function$;

revoke all on function public.sor_access_contact(uuid) from public, anon;
grant execute on function public.sor_access_contact(uuid) to authenticated;
