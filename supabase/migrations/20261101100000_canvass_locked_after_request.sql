-- A Canvass is locked once it is what a Purchase Request was bought on.
--
-- Two ways to be locked:
--   * a Purchase Request was made from it (canvass_create_purchase_request re-points the bare Canvass
--     at the item it became, and the winner's price is copied onto that item), or
--   * it hangs off a Requested Item that is now Ordered or Received.
-- Locked means its Offers, winner, reason and product name refuse to change. Sign-off, attachments and
-- printing stay open. Only a Super Admin can release the lock (canvass_unlock), always with a reason
-- that goes into the Canvass history; a released lock stays released.
-- canvass_list says which Canvasses are locked.
--
-- SAFE TO RUN AT ANY TIME: idempotent.

alter table public.sor_canvasses add column if not exists request_made_at timestamptz;
alter table public.sor_canvasses add column if not exists lock_released_at timestamptz;
alter table public.sor_canvasses add column if not exists lock_released_by uuid references public.employees (id) on delete set null;

comment on column public.sor_canvasses.request_made_at is
  'When a Purchase Request was made from this Canvass (it was re-pointed at the Requested Item it became). It is locked from then on.';
comment on column public.sor_canvasses.lock_released_at is
  'When a Super Admin released the lock on this Canvass (canvass_unlock). The reason is in its history.';

-- Canvasses already turned into a request: their item says so ("From Canvass CNV_0001").
update public.sor_canvasses c
   set request_made_at = coalesce(i.created_at, now())
  from public.purchase_request_items i
 where i.id = c.requested_item_id
   and c.request_made_at is null
   and c.component_id is null
   and right(i.description, length('From Canvass ' || c.number)) = 'From Canvass ' || c.number;

create or replace function public.canvass_stamp_request_made()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.requested_item_id is null and new.requested_item_id is not null and new.request_made_at is null then
    new.request_made_at := now();
  end if;
  return new;
end
$$;

drop trigger if exists trg_sor_canvasses_stamp_request_made on public.sor_canvasses;
create trigger trg_sor_canvasses_stamp_request_made
  before update of requested_item_id on public.sor_canvasses
  for each row execute function public.canvass_stamp_request_made();

-- Why a Canvass is locked, or null when it is not: 'request_made' or 'item_ordered'. The screen asks
-- this (it may not be allowed to read the item itself), so the rule lives here and nowhere else.
create or replace function public.canvass_lock_reason(p_canvass_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
           when c.lock_released_at is not null then null
           when c.request_made_at is not null then 'request_made'
           when exists (select 1 from public.purchase_request_items i
                         where i.id = c.requested_item_id and i.status in ('ordered', 'received')) then 'item_ordered'
         end
    from public.sor_canvasses c
   where c.id = p_canvass_id
$$;

revoke all on function public.canvass_lock_reason(uuid) from public, anon;
grant execute on function public.canvass_lock_reason(uuid) to authenticated;

create or replace function public.canvass_is_locked(p_canvass_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.canvass_lock_reason(p_canvass_id) is not null
$$;

revoke all on function public.canvass_is_locked(uuid) from public, anon;
grant execute on function public.canvass_is_locked(uuid) to authenticated;

create or replace function public.canvass_refuse_offer_change_when_locked()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_canvass uuid := case when tg_op = 'DELETE' then old.canvass_id else new.canvass_id end;
begin
  if public.canvass_is_locked(v_canvass) then
    raise exception 'This Canvass is locked, so its offers and winner can''t change. A Super Admin can unlock it.'
      using errcode = '55000';
  end if;
  return coalesce(new, old);
end
$$;

drop trigger if exists trg_sor_canvass_offers_locked on public.sor_canvass_offers;
create trigger trg_sor_canvass_offers_locked
  before insert or update or delete on public.sor_canvass_offers
  for each row execute function public.canvass_refuse_offer_change_when_locked();

create or replace function public.canvass_refuse_edit_when_locked()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if (new.reason is distinct from old.reason or new.product_name is distinct from old.product_name)
     and public.canvass_is_locked(old.id) then
    raise exception 'This Canvass is locked, so its reason and product name can''t change. A Super Admin can unlock it.'
      using errcode = '55000';
  end if;
  return new;
end
$$;

drop trigger if exists trg_sor_canvasses_locked on public.sor_canvasses;
create trigger trg_sor_canvasses_locked
  before update of reason, product_name on public.sor_canvasses
  for each row execute function public.canvass_refuse_edit_when_locked();

-- An Offer's prices are part of the Offer, so the winner's price can't change either.
create or replace function public.canvass_refuse_price_change_when_locked()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_offer   uuid := case when tg_op = 'DELETE' then old.offer_id else new.offer_id end;
  v_canvass uuid;
begin
  -- The Offer is gone (it was removed, or its Canvass was): its own guard has spoken.
  select canvass_id into v_canvass from public.sor_canvass_offers where id = v_offer;
  if v_canvass is not null and public.canvass_is_locked(v_canvass) then
    raise exception 'This Canvass is locked, so its prices can''t change. A Super Admin can unlock it.'
      using errcode = '55000';
  end if;
  return coalesce(new, old);
end
$$;

drop trigger if exists trg_sor_canvass_offer_prices_locked on public.sor_canvass_offer_prices;
create trigger trg_sor_canvass_offer_prices_locked
  before insert or update or delete on public.sor_canvass_offer_prices
  for each row execute function public.canvass_refuse_price_change_when_locked();

-- History: an unlock is a row of its own, and always says why.
alter table public.sor_canvass_signoff_events drop constraint if exists sor_canvass_signoff_events_kind_chk;
alter table public.sor_canvass_signoff_events
  add constraint sor_canvass_signoff_events_kind_chk check (kind in ('signed', 'cleared', 'unlocked'));
alter table public.sor_canvass_signoff_events drop constraint if exists sor_canvass_signoff_events_cleared_reason_chk;
alter table public.sor_canvass_signoff_events
  add constraint sor_canvass_signoff_events_cleared_reason_chk
  check (kind = 'signed' or length(btrim(coalesce(reason, ''))) > 0);

create or replace function public.canvass_unlock(p_canvass_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  if public.get_employee_id() is null then
    raise exception 'canvass_unlock: sign in first' using errcode = '42501';
  end if;
  if not coalesce(public.is_super_admin(), false) then
    raise exception 'canvass_unlock: only a Super Admin can unlock a Canvass' using errcode = '42501';
  end if;
  if v_reason = '' then
    raise exception 'canvass_unlock: say why it is being unlocked' using errcode = '22023';
  end if;

  -- The same lock the winner functions take, so an unlock never interleaves with a pick.
  perform pg_advisory_xact_lock(hashtext('canvass_winner:' || p_canvass_id::text));

  if not exists (select 1 from public.sor_canvasses where id = p_canvass_id) then
    raise exception 'canvass_unlock: not found' using errcode = 'P0002';
  end if;
  if not public.canvass_is_locked(p_canvass_id) then
    return jsonb_build_object('canvass_id', p_canvass_id, 'unlocked', false);
  end if;

  update public.sor_canvasses
     set lock_released_at = now(), lock_released_by = public.get_employee_id()
   where id = p_canvass_id;

  insert into public.sor_canvass_signoff_events (canvass_id, kind, actor_id, reason, offer_count)
  values (
    p_canvass_id, 'unlocked', public.get_employee_id(), v_reason,
    (select count(*) from public.sor_canvass_offers where canvass_id = p_canvass_id)
  );

  return jsonb_build_object('canvass_id', p_canvass_id, 'unlocked', true);
end;
$$;

revoke all on function public.canvass_unlock(uuid, text) from public, anon;
grant execute on function public.canvass_unlock(uuid, text) to authenticated;

drop function if exists public.canvass_list();

create function public.canvass_list()
returns table (
  id uuid,
  number text,
  kind text,
  product_name text,
  subject_name text,
  component_id uuid,
  component_number text,
  requested_item_id uuid,
  request_id uuid,
  request_label text,
  request_item_status text,
  opportunity_id uuid,
  sales_reference text,
  project_title text,
  canvasser_id uuid,
  canvasser_name text,
  offer_count integer,
  winner_offer_id uuid,
  winner_supplier text,
  winner_brand text,
  signed_off_at timestamptz,
  signer_name text,
  created_by uuid,
  created_at timestamptz,
  updated_at timestamptz,
  locked boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select c.id,
         c.number,
         case when c.component_id is not null then 'component'
              when c.requested_item_id is not null then 'requested_item'
              else 'none' end,
         c.product_name,
         coalesce(comp.name, item.name, c.product_name),
         c.component_id,
         case when comp.id is not null then
           (select count(*) from public.costing_tender_lines t2
             where t2.matrix_id = t.matrix_id and t2.position <= t.position)::text
           || '.' ||
           (select count(*) from public.costing_components c2
             where c2.tender_line_id = comp.tender_line_id and c2.position <= comp.position)::text
         end,
         c.requested_item_id,
         req.id,
         case when req.id is not null then public._purchase_request_label(req.id) end,
         item.status,
         opp.id,
         opp.sales_reference,
         opp.project_title,
         coalesce(c.canvasser_id, comp.purchasing_incharge_id, m.purchasing_incharge_id, req.buyer_id),
         canvasser.name,
         (select count(*)::integer from public.sor_canvass_offers o where o.canvass_id = c.id),
         w.id,
         w.supplier_name,
         w.brand,
         c.signed_off_at,
         signer.name,
         c.created_by,
         c.created_at,
         c.updated_at,
         public.canvass_is_locked(c.id)
    from public.sor_canvasses c
    left join public.costing_components comp on comp.id = c.component_id
    left join public.costing_tender_lines t on t.id = comp.tender_line_id
    left join public.costing_matrices m on m.id = t.matrix_id
    left join public.purchase_request_items item on item.id = c.requested_item_id
    left join public.purchase_requests req on req.id = item.request_id
    left join public.sales_opportunities opp on opp.id = coalesce(m.opportunity_id, req.opportunity_id)
    left join public.sor_canvass_offers w on w.canvass_id = c.id and w.is_winner
    left join public.employees canvasser
      on canvasser.id = coalesce(c.canvasser_id, comp.purchasing_incharge_id, m.purchasing_incharge_id, req.buyer_id)
    left join public.employees signer on signer.id = c.signed_off_by
   where public.canvass_can_read(c.id)
   order by c.created_at desc, c.id
$$;

revoke all on function public.canvass_list() from public, anon;
grant execute on function public.canvass_list() to authenticated;
