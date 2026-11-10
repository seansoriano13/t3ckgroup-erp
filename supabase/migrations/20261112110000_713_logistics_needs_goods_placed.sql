-- #713 (spec #699): Logistics (stored section 8) is signed once the goods are at their location, so the
-- sign-off is refused until the IPAS has an Item Location (its own, or a Transmittal's), a TG03
-- Transmittal carrying it, and the date the goods were received at the warehouse.
create or replace function public._ipas_logistics_missing(p_ipas_id uuid)
returns text[]
language sql
stable
set search_path = public
as $$
  select array_remove(array[
    case when i.item_location_id is null and not exists (
      select 1 from public.transmittal_ipas ti
        join public.transmittals t on t.id = ti.transmittal_id
       where ti.ipas_id = i.id and t.item_location_id is not null
    ) then 'the Item Location' end,
    case when not exists (select 1 from public.transmittal_ipas ti where ti.ipas_id = i.id)
      then 'a Transmittal' end,
    case when i.arrived_in_whs_on is null then 'the received date' end
  ], null)
  from public.ipas i
  where i.id = p_ipas_id;
$$;

revoke all on function public._ipas_logistics_missing(uuid) from public, anon, authenticated;

create or replace function public._ipas_signoff_logistics_guard()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_missing text[];
begin
  if new.section = 8 then
    v_missing := public._ipas_logistics_missing(new.ipas_id);
    if coalesce(array_length(v_missing, 1), 0) > 0 then
      raise exception 'ipas_sign: Logistics needs % first', array_to_string(v_missing, ', ')
        using errcode = '22023';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public._ipas_signoff_logistics_guard() from public, anon, authenticated;

drop trigger if exists ipas_signoffs_logistics_guard on public.ipas_signoffs;
create trigger ipas_signoffs_logistics_guard
  before insert on public.ipas_signoffs
  for each row execute function public._ipas_signoff_logistics_guard();
