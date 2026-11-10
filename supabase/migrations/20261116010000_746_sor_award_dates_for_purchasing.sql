-- #746 review fix (spec #735): the Awarded badge needs each SOR's Date of Award,
-- but sor_read hides SORs from Purchasing users who are not on the Deal Team.
-- This hands back only the SOR id and Date of Award, and only to Purchasing
-- holders and Super Admins (the same gate the delivery-deadline policies use).
create or replace function public.sor_award_dates(p_opportunity_ids uuid[])
returns table (id uuid, date_of_award date)
language sql
stable
security definer
set search_path = public
as $$
  select o.id, o.date_of_award
    from public.sales_opportunities o
   where o.id = any(p_opportunity_ids)
     and o.date_of_award is not null
     and (coalesce(public.has_purchasing_access(), false) or coalesce(public.is_super_admin(), false));
$$;

comment on function public.sor_award_dates(uuid[]) is
  '#746: SOR id and Date of Award for the given SORs. Nothing else. Empty unless the caller holds Purchasing or is a Super Admin.';

revoke all on function public.sor_award_dates(uuid[]) from public, anon;
grant execute on function public.sor_award_dates(uuid[]) to authenticated;
