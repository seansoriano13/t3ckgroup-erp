-- #712 (spec #699): the IPAS S0 warning can be marked checked.
--
-- The warning now only says when the IPAS names an SOR the PO does not mention.
-- A purchaser who has looked can mark it checked, with a reason. It is stored on
-- the IPAS as { references, reason, by, at } (the S numbers that were checked),
-- an `sor_warning_checked` history event is written, and the app stops showing
-- the warning while every S number it would name is in `references`.
--
-- SAFE TO RUN AT ANY TIME: one nullable column and one new function.

alter table public.ipas
  add column if not exists sor_warning_checked jsonb;

alter table public.ipas drop constraint if exists ipas_sor_warning_checked_chk;
alter table public.ipas
  add constraint ipas_sor_warning_checked_chk
  check (sor_warning_checked is null or jsonb_typeof(sor_warning_checked) = 'object');

comment on column public.ipas.sor_warning_checked is
  '#712: a purchaser marked the S0 warning checked: { references: [S numbers checked], reason, by, at }. Null when not.';

create or replace function public.ipas_mark_sor_warning_checked(
  p_ipas_id uuid,
  p_references text[],
  p_reason text
) returns public.ipas
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := public.get_employee_id();
  v_row public.ipas;
  v_reason text := nullif(btrim(p_reason), '');
  v_refs text[] := coalesce(p_references, '{}'::text[]);
begin
  if v_actor is null then
    raise exception 'ipas_mark_sor_warning_checked: not signed in' using errcode = '42501';
  end if;
  if not public.has_purchasing_access() then
    raise exception 'ipas_mark_sor_warning_checked: only Purchasing marks the S0 warning checked' using errcode = '42501';
  end if;
  if v_reason is null then
    raise exception 'ipas_mark_sor_warning_checked: give the reason' using errcode = '22023';
  end if;

  -- Open IPAS only: _ipas_lock_open refuses a filed or cancelled one.
  perform public._ipas_lock_open('ipas_mark_sor_warning_checked', p_ipas_id);

  update public.ipas
     set sor_warning_checked = jsonb_build_object(
           'references', to_jsonb(v_refs),
           'reason', v_reason,
           'by', v_actor,
           'at', now()
         )
   where id = p_ipas_id
  returning * into v_row;

  perform public._ipas_write_event(
    v_row.id,
    v_actor,
    'sor_warning_checked',
    jsonb_build_object('references', to_jsonb(v_refs), 'reason', v_reason)
  );

  return v_row;
end;
$$;

comment on function public.ipas_mark_sor_warning_checked(uuid, text[], text) is
  '#712: Purchasing marks the S0 warning checked, with a required reason, on an open IPAS. Stores it on the IPAS and writes an sor_warning_checked event. Returns the ipas row.';

revoke all on function public.ipas_mark_sor_warning_checked(uuid, text[], text) from public, anon;
grant execute on function public.ipas_mark_sor_warning_checked(uuid, text[], text) to authenticated;
