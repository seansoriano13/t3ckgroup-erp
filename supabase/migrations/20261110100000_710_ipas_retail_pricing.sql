-- #710 (spec #699): retail and wholesale for an Inventory IPAS.
--   ipas.retail_multiplier        the multiplier on the bare peso price (null = not set yet)
--   ipas.wholesale_discount_pct   retail minus this percent = wholesale; starts at 30
-- Only the Markup list (and Super Admins) may write either. ipas_can_set_markup() tells the screen.
-- Safe to run at any time: new columns with a default, create or replace.

alter table public.ipas
  add column if not exists retail_multiplier numeric(10, 4),
  add column if not exists wholesale_discount_pct numeric(5, 2) not null default 30;

alter table public.ipas drop constraint if exists ipas_retail_multiplier_chk;
alter table public.ipas add constraint ipas_retail_multiplier_chk check (retail_multiplier is null or retail_multiplier > 0);
alter table public.ipas drop constraint if exists ipas_wholesale_discount_chk;
alter table public.ipas add constraint ipas_wholesale_discount_chk check (wholesale_discount_pct >= 0 and wholesale_discount_pct < 100);

comment on column public.ipas.retail_multiplier is '#710: retail = bare peso unit price x this. Written by the Markup list only.';
comment on column public.ipas.wholesale_discount_pct is '#710: wholesale = retail less this percent. Starts at 30. Written by the Markup list only.';

create or replace function public.ipas_can_set_markup()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.is_super_admin(), false) or public.costing_on_list('markup')
$$;

revoke all on function public.ipas_can_set_markup() from public, anon;
grant execute on function public.ipas_can_set_markup() to authenticated;

create or replace function public.ipas_set_markup(
  p_ipas_id uuid,
  p_multiplier numeric,
  p_discount_pct numeric
) returns public.ipas
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ipas public.ipas;
  v_row public.ipas;
  v_mult numeric := case when p_multiplier is null then null else round(p_multiplier, 4) end;
  v_disc numeric := round(coalesce(p_discount_pct, 30), 2);
begin
  if not public.ipas_can_set_markup() then
    raise exception 'ipas_set_markup: only the Markup list can set the multiplier and the discount' using errcode = '42501';
  end if;
  select * into v_ipas from public.ipas where id = p_ipas_id for update;
  if v_ipas.id is null then
    raise exception 'ipas_set_markup: IPAS % not found', p_ipas_id using errcode = 'P0002';
  end if;
  if v_mult is not null and v_mult <= 0 then
    raise exception 'ipas_set_markup: the multiplier must be more than zero' using errcode = '22023';
  end if;
  if v_disc < 0 or v_disc >= 100 then
    raise exception 'ipas_set_markup: the discount must be from 0 up to 100' using errcode = '22023';
  end if;
  if v_ipas.retail_multiplier is not distinct from v_mult and v_ipas.wholesale_discount_pct = v_disc then
    return v_ipas;
  end if;

  update public.ipas set retail_multiplier = v_mult, wholesale_discount_pct = v_disc
   where id = v_ipas.id returning * into v_row;

  perform public._ipas_write_event(v_ipas.id, public.get_employee_id(), 'header_changed', jsonb_build_object(
    'changes', jsonb_build_object(
      'retail_multiplier', jsonb_build_object('from', v_ipas.retail_multiplier, 'to', v_mult),
      'wholesale_discount_pct', jsonb_build_object('from', v_ipas.wholesale_discount_pct, 'to', v_disc))
  ));
  return v_row;
end;
$$;

revoke all on function public.ipas_set_markup(uuid, numeric, numeric) from public, anon;
grant execute on function public.ipas_set_markup(uuid, numeric, numeric) to authenticated;
