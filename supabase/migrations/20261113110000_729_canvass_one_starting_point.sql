-- #729 (spec #718, ADR 0047): a Canvass has one starting point.
--
-- A Canvass starts from a product line (a Requested Item, ADR 0042) or from a line of a project
-- (a Costing Matrix Component), never free-standing. A Direct request's lines are Requested Items
-- like any other, so they are canvassed the same way, with no new database work.
--
--   sor_canvasses_refuse_free_standing  BEFORE INSERT: refuses a new Canvass with no Component
--                                       and no Requested Item, for a signed-in person (22023)
--   canvass_create_purchase_request     now refuses (22023): no new request is made from Canvasses
--   canvass_add_to_purchase_request     now refuses (22023): no Canvass is added to a request
--
-- Existing free-standing Canvasses stay as they are: readable, printable, numbered. The refusal
-- covers inserts only, so a Canvass that already exists is never touched. Inserts by the service
-- role or a migration (no signed-in person) are not refused: that is how old records and test
-- setups are made, and no person-facing path goes through them.
--
-- SAFE TO RUN AT ANY TIME: idempotent (create or replace / drop trigger if exists).

create or replace function public.sor_canvasses_refuse_free_standing()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.component_id is null
     and new.requested_item_id is null
     and coalesce(auth.role(), '') in ('authenticated', 'anon') then
    raise exception 'canvass: a Canvass starts on a product line, or on a line of a Direct request, never free-standing'
      using errcode = '22023';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_sor_canvasses_refuse_free_standing on public.sor_canvasses;
create trigger trg_sor_canvasses_refuse_free_standing
  before insert on public.sor_canvasses
  for each row execute function public.sor_canvasses_refuse_free_standing();

-- Same signatures and grants as before, so a stale browser tab gets a plain refusal, not a 404.
create or replace function public.canvass_create_purchase_request(p_title text, p_items jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  raise exception 'canvass_create_purchase_request: a Purchase Request is not made from Canvasses any more; open the request, type its lines and Canvass each line'
    using errcode = '22023';
end;
$$;

create or replace function public.canvass_add_to_purchase_request(p_request_id uuid, p_items jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  raise exception 'canvass_add_to_purchase_request: a Canvass is not added to a Purchase Request any more; Canvass the line itself'
    using errcode = '22023';
end;
$$;

revoke all on function public.canvass_create_purchase_request(text, jsonb) from public, anon;
grant execute on function public.canvass_create_purchase_request(text, jsonb) to authenticated;
revoke all on function public.canvass_add_to_purchase_request(uuid, jsonb) from public, anon;
grant execute on function public.canvass_add_to_purchase_request(uuid, jsonb) to authenticated;
