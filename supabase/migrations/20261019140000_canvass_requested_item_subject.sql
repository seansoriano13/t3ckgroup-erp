-- ==============================================================================
-- #280 (spec #275): Canvass on a Requested Item that names no Component
--
-- A Requested Item that names a Component is canvassed through that Component, so a
-- Canvass may hang off a Requested Item only while the item names none. This trigger
-- refuses a Canvass whose requested_item_id points at an item with a component_id, on
-- insert and whenever the subject changes.
--
-- Access for the Requested Item subject (the Purchase Request read for the non-money
-- tables; Purchasing access, Finance access or Super Admin on top of it for prices) was
-- put in place by #276 and is not touched here.
--
-- SAFE TO RUN AT ANY TIME: one function and one trigger, both re-creatable.
-- ==============================================================================

-- Functions

create or replace function public.sor_canvasses_refuse_component_item()
returns trigger
language plpgsql
set search_path = public
as $function$
begin
  if new.requested_item_id is not null and exists (
    select 1 from public.purchase_request_items i
    where i.id = new.requested_item_id and i.component_id is not null
  ) then
    raise exception 'This Requested Item names a Component. Canvass the Component instead.'
      using errcode = '23514';
  end if;
  return new;
end
$function$;

drop trigger if exists trg_sor_canvasses_refuse_component_item on public.sor_canvasses;
create trigger trg_sor_canvasses_refuse_component_item
  before insert or update of requested_item_id on public.sor_canvasses
  for each row execute function public.sor_canvasses_refuse_component_item();
