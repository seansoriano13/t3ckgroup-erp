-- #713 (spec #699): the received date is an Arrived in Whs. date, and the database only lets an IMPORT
-- IPAS carry one (ipas_supplier_origin_import_chk). A local IPAS could never fill it in, so Logistics
-- could never be signed on it and Filing never opened. The received date is asked for on an import only;
-- a local IPAS needs its Item Location and a Transmittal, as before.
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
    case when i.source = 'import' and i.arrived_in_whs_on is null then 'the received date' end
  ], null)
  from public.ipas i
  where i.id = p_ipas_id;
$$;

revoke all on function public._ipas_logistics_missing(uuid) from public, anon, authenticated;
