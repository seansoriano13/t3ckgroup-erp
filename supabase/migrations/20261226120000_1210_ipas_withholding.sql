-- ==============================================================================
-- 20261226120000_1210_ipas_withholding.sql
--
-- Withholding (2307) on a Local IPAS (spec #1205, ticket #1210, CONTEXT.md).
--
--   ipas.withholding   '1', '2', 'not_applicable' or null (not set).
--
-- Only a Local IPAS may have one: a trigger refuses it on an Import IPAS however it gets in.
-- It changes no amount. ipas_set_withholding is typed by anyone who may edit the IPAS money
-- fields (Purchasing or Finance, the same writers as freight), on an open IPAS.
--
-- SAFE TO RUN AT ANY TIME: one nullable column, one trigger, one function.
-- ==============================================================================

alter table public.ipas add column if not exists withholding text;

alter table public.ipas drop constraint if exists ipas_withholding_chk;
alter table public.ipas
  add constraint ipas_withholding_chk check (withholding is null or withholding in ('1', '2', 'not_applicable'));

comment on column public.ipas.withholding is
  'CONTEXT.md Withholding (2307): 1, 2 or not_applicable on a Local IPAS, null when not set. Never on an Import IPAS. Changes no amount.';

create or replace function public.ipas_withholding_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.withholding is not null and new.source is distinct from 'local' then
    raise exception 'ipas_withholding: Withholding (2307) is only for a Local IPAS' using errcode = '22023';
  end if;
  return new;
end;
$$;

revoke all on function public.ipas_withholding_guard() from public, anon, authenticated;

drop trigger if exists ipas_withholding_guard on public.ipas;
create trigger ipas_withholding_guard
  before insert or update of withholding, source on public.ipas
  for each row execute function public.ipas_withholding_guard();

create or replace function public.ipas_set_withholding(p_ipas_id uuid, p_withholding text)
returns public.ipas
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := public._ipas_money_writer('ipas_set_withholding');
  v_ipas public.ipas;
  v_value text := nullif(btrim(coalesce(p_withholding, '')), '');
  v_row public.ipas;
begin
  v_ipas := public._ipas_lock_open('ipas_set_withholding', p_ipas_id);
  if v_value is not null and v_value not in ('1', '2', 'not_applicable') then
    raise exception 'ipas_set_withholding: pick 1%%, 2%% or Not applicable' using errcode = '22023';
  end if;
  if v_value is not null and v_ipas.source is distinct from 'local' then
    raise exception 'ipas_set_withholding: Withholding (2307) is only for a Local IPAS' using errcode = '22023';
  end if;
  if v_ipas.withholding is not distinct from v_value then
    return v_ipas;
  end if;

  update public.ipas set withholding = v_value where id = v_ipas.id returning * into v_row;

  perform public._ipas_write_event(v_ipas.id, v_actor, 'header_changed', jsonb_build_object(
    'fields', jsonb_build_object('withholding', jsonb_build_object('from', v_ipas.withholding, 'to', v_value))
  ));
  return v_row;
end;
$$;

revoke all on function public.ipas_set_withholding(uuid, text) from public, anon;
grant execute on function public.ipas_set_withholding(uuid, text) to authenticated;
