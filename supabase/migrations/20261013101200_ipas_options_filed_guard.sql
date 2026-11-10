-- ==============================================================================
-- 20261013101200_ipas_options_filed_guard.sql
--
-- IPAS option lists stay truthful on filed IPAS (#241).
--
-- A filed IPAS is frozen, but its payment method, charge kinds, document kinds,
-- freight service and item location are NAMES held in ipas_options, so renaming
-- an option would quietly rewrite what a filed IPAS says. An option referenced
-- by ANY filed IPAS can no longer have its label changed (nor, for a document
-- kind, its Source or used-for mark): the database refuses it for every
-- client, Super Admins included. Deactivating (active), reordering (sort) and
-- adding a new option stay allowed, and an option used only by open or
-- cancelled IPAS can still be renamed.
--
--   ipas_option_on_filed(uuid)   true when a filed IPAS references the option
--   ipas_options_filed_guard()   the refusing trigger (55000)
--   ipas_filed_option_ids()      the option ids a filed IPAS uses, for the
--                                settings screen to disable renaming
-- ==============================================================================

create or replace function public.ipas_option_on_filed(p_option_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from ipas i
     where i.state = 'filed'
       and (i.freight_service_id = p_option_id or i.item_location_id = p_option_id)
  ) or exists (
    select 1 from ipas_payments p join ipas i on i.id = p.ipas_id
     where i.state = 'filed' and p.method_id = p_option_id
  ) or exists (
    select 1 from ipas_charges c join ipas i on i.id = c.ipas_id
     where i.state = 'filed' and c.kind_id = p_option_id
  ) or exists (
    select 1 from ipas_documents d join ipas i on i.id = d.ipas_id
     where i.state = 'filed' and d.kind_id = p_option_id
  );
$$;

comment on function public.ipas_option_on_filed(uuid) is
  '#241: true when any filed IPAS references the option (payment method, charge kind, document kind, freight service or item location).';

revoke all on function public.ipas_option_on_filed(uuid) from public, anon, authenticated;

create or replace function public.ipas_options_filed_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (
    new.label is distinct from old.label
    or new.applies_to is distinct from old.applies_to
    or new.used_for is distinct from old.used_for
  ) and public.ipas_option_on_filed(old.id) then
    raise exception 'ipas_options: "%" is used on a filed IPAS. Deactivate it and add a new one instead.', old.label
      using errcode = '55000';
  end if;
  return new;
end;
$$;

comment on function public.ipas_options_filed_guard() is
  '#241: an ipas_options row used by a filed IPAS keeps its label (and a document kind its Source and used-for marks). Active and sort still change.';

revoke all on function public.ipas_options_filed_guard() from public, anon, authenticated;

drop trigger if exists ipas_options_filed_guard on public.ipas_options;
create trigger ipas_options_filed_guard
  before update on public.ipas_options
  for each row execute function public.ipas_options_filed_guard();

create or replace function public.ipas_filed_option_ids()
returns uuid[]
language sql
security definer
stable
set search_path = public
as $$
  select case when public.ipas_can_read() then
    coalesce((select array_agg(o.id) from ipas_options o where public.ipas_option_on_filed(o.id)), '{}'::uuid[])
  else '{}'::uuid[] end;
$$;

comment on function public.ipas_filed_option_ids() is
  '#241: the ids of the ipas_options rows a filed IPAS uses, i.e. the ones that can''t be renamed. Empty for someone who can''t read IPAS.';

revoke all on function public.ipas_filed_option_ids() from public, anon;
grant execute on function public.ipas_filed_option_ids() to authenticated;
