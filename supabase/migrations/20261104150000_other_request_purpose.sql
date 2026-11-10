-- #679 (spec #675): Ask for a product. An Other request says what it is for: the client, or the
-- job's own materials. Only the person's words, quantity, photos and this choice are stored; the
-- item starts at Not checked, with who asked and when already on the row.
--
-- Materials for the job never join the Costing Matrix: an item with no S0 line is not a Component
-- source, and only a "For the client" ask can later be added to the S0 (a later ticket).

alter table public.purchase_request_items
  add column if not exists purpose text not null default 'client';

alter table public.purchase_request_items
  drop constraint if exists purchase_request_items_purpose_check;
alter table public.purchase_request_items
  add constraint purchase_request_items_purpose_check
  check (purpose in ('client', 'job') and (purpose = 'client' or sor_item_id is null));

comment on column public.purchase_request_items.purpose is
  '#679: client = asked for the client (may join the S0 later); job = material for the job (never on the S0). An S0 line''s item is always client.';

drop function if exists public.purchase_request_add_new_item(uuid, text, numeric, text, text, jsonb);

create or replace function public.purchase_request_add_new_item(
  p_request_id uuid,
  p_name text,
  p_quantity numeric,
  p_unit text default null,
  p_description text default null,
  p_images jsonb default '[]'::jsonb,
  p_purpose text default 'client'
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_req public.purchase_requests := public._purchase_request_for_adding(p_request_id, 'purchase_request_add_new_item');
  v_images jsonb := coalesce(p_images, '[]'::jsonb);
  v_item public.purchase_request_items;
begin
  if nullif(btrim(p_name), '') is null then
    raise exception 'purchase_request_add_new_item: a new product needs a name' using errcode = '22023';
  end if;
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'purchase_request_add_new_item: the quantity must be more than zero' using errcode = '22023';
  end if;
  if p_purpose is null or p_purpose not in ('client', 'job') then
    raise exception 'purchase_request_add_new_item: say whether it is for the client or material for the job' using errcode = '22023';
  end if;
  if jsonb_typeof(v_images) <> 'array'
     or jsonb_array_length(v_images) > 5
     or exists (
       select 1 from jsonb_array_elements(v_images) img
       where jsonb_typeof(img) <> 'object' or nullif(img->>'url', '') is null
     ) then
    raise exception 'purchase_request_add_new_item: images must be up to 5 uploaded files' using errcode = '22023';
  end if;

  insert into public.purchase_request_items
    (request_id, source, name, unit, quantity, description, images, purpose, requested_by)
  values
    (v_req.id, 'new', btrim(p_name), nullif(btrim(p_unit), ''), p_quantity,
     nullif(btrim(p_description), ''), v_images, p_purpose, public.get_employee_id())
  returning * into v_item;

  perform public._purchase_request_item_added(v_item);
  return v_item.id;
end;
$$;

comment on function public.purchase_request_add_new_item(uuid, text, numeric, text, text, jsonb, text) is
  '#679: adds an Other request (the asker''s words, quantity, up to 5 photos, and whether it is for the client or material for the job) at Not checked. Only the request''s sales side, a deal member or its Buyer may.';

revoke all on function public.purchase_request_add_new_item(uuid, text, numeric, text, text, jsonb, text) from public, anon;
grant execute on function public.purchase_request_add_new_item(uuid, text, numeric, text, text, jsonb, text) to authenticated;
