-- My SORs filters (#478): the SOR code and Sales Flow of each SOR a person was
-- called or mentioned into. Neither is in sor_locked_summary, and a Stage
-- Participant cannot read sales_opportunities. Only SORs the caller reaches at
-- some access level are answered; nothing about money or the client.

create or replace function public.sor_my_sors_facets(p_opportunity_ids uuid[])
returns table (opportunity_id uuid, sor_code text, sale_type_name text)
language sql
stable
security definer
set search_path = public
as $function$
  select o.id, o.sor_code, st.name
  from public.sales_opportunities o
  left join public.sale_types st on st.id = o.sale_type_id
  where o.id = any (p_opportunity_ids)
    and public.sor_access_level(o.id) <> 'none'
$function$;

revoke all on function public.sor_my_sors_facets(uuid[]) from public, anon;
grant execute on function public.sor_my_sors_facets(uuid[]) to authenticated;
