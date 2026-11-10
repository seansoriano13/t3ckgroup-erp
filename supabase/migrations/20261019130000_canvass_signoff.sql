-- Canvass: sign-off by the purchasing approver (#279, spec #275).
--
-- WHAT THIS ADDS
--   sor_canvass_signoff_events
--                          append-only history of a Canvass's sign-off: kind 'signed' or 'cleared',
--                          who, why, and how many Offers there were. Nothing updates or deletes a
--                          row; it goes only when its Canvass goes.
--   canvass_sign(canvass_id)
--                          the one way to sign. The caller must be on the Transmittal "Check by"
--                          list (ipas_signer_lists.transmittal_check_by, the list that approves
--                          Transmittals), must not be the Canvass's creator, and the Canvass must
--                          have a winner and a non-blank reason. A Super Admin off the list is
--                          refused. Records offer_count; fewer than three Offers warns on the
--                          client and never blocks here.
--   canvass_clear_signoff(canvass_id, reason)
--                          trigger-only: unsigns a signed Canvass and records why. No client grant.
--   Triggers               any insert, update or delete on a Canvass's Offers or their prices (bar
--                          a plain re-ordering), a winner change, or a change to the reason, while
--                          signed, clears the sign-off. Nothing locks; editing simply unsigns.
--   Guard                  sor_canvasses.signed_off_by / signed_off_at are written only by these
--                          functions (#276 left them writable by Purchasing).
--   canvass_pending_signoffs()
--                          the Approval Center's queue: Canvasses with a winner and a reason that
--                          are unsigned, for a member of the list. Anyone else gets none.
--   canvass_signoff_audience(canvass_id)
--                          who to tell that a Canvass is ready to sign (the list, read here because
--                          the list is not readable to a purchaser), or nobody when it is not ready.
--
-- ACCESS
--   Events: read where the Canvass can be read (canvass_can_read); no direct insert, update or
--   delete for anyone.
--
-- SAFE TO RUN AT ANY TIME: idempotent.

-- ---------------------------------------------------------------------------
-- Table (additive; the fake database reads up to the marker below)
-- ---------------------------------------------------------------------------

create table if not exists public.sor_canvass_signoff_events (
  id          uuid primary key default gen_random_uuid(),
  canvass_id  uuid not null references public.sor_canvasses (id) on delete cascade,
  kind        text not null,
  actor_id    uuid references public.employees (id) on delete set null,
  reason      text,
  offer_count integer not null default 0,
  created_at  timestamptz not null default now(),

  constraint sor_canvass_signoff_events_kind_chk check (kind in ('signed', 'cleared')),
  constraint sor_canvass_signoff_events_cleared_reason_chk
    check (kind <> 'cleared' or length(btrim(coalesce(reason, ''))) > 0)
);

create index if not exists sor_canvass_signoff_events_canvass_idx
  on public.sor_canvass_signoff_events (canvass_id, created_at);

comment on table public.sor_canvass_signoff_events is
  '#279: append-only history of a Canvass''s sign-off. kind is signed or cleared; a cleared row always says why; offer_count is the number of Offers at that moment.';

-- Functions
-- ---------------------------------------------------------------------------
-- Append-only
-- ---------------------------------------------------------------------------

create or replace function public.sor_canvass_signoff_events_append_only()
returns trigger
language plpgsql
as $$
begin
  -- A cascade from the Canvass (or the Component above it) runs one trigger level down; a direct
  -- delete does not.
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then
    return old;
  end if;
  -- Deleting an employee sets actor_id to null (the foreign key's own update, one level down).
  if tg_op = 'UPDATE' and pg_trigger_depth() > 1 and new.actor_id is null
     and (to_jsonb(new) - 'actor_id') = (to_jsonb(old) - 'actor_id') then
    return new;
  end if;
  raise exception 'The sign-off history is append-only.' using errcode = '42501';
end
$$;

drop trigger if exists trg_sor_canvass_signoff_events_append_only on public.sor_canvass_signoff_events;
create trigger trg_sor_canvass_signoff_events_append_only
  before update or delete on public.sor_canvass_signoff_events
  for each row execute function public.sor_canvass_signoff_events_append_only();

alter table public.sor_canvass_signoff_events enable row level security;

drop policy if exists sor_canvass_signoff_events_read on public.sor_canvass_signoff_events;
create policy sor_canvass_signoff_events_read on public.sor_canvass_signoff_events
  for select to authenticated
  using (public.canvass_can_read(canvass_id));

revoke all on public.sor_canvass_signoff_events from public, anon, authenticated;
grant select on public.sor_canvass_signoff_events to authenticated;

-- ---------------------------------------------------------------------------
-- signed_off_by / signed_off_at are written only by the functions here
-- ---------------------------------------------------------------------------

create or replace function public.sor_canvasses_guard_signoff()
returns trigger
language plpgsql
as $$
begin
  if coalesce(current_setting('canvass.signoff', true), '') = 'on' then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if new.signed_off_by is not null or new.signed_off_at is not null then
      raise exception 'A Canvass is signed only through canvass_sign.' using errcode = '42501';
    end if;
  elsif new.signed_off_by is distinct from old.signed_off_by
     or new.signed_off_at is distinct from old.signed_off_at then
    raise exception 'A Canvass is signed only through canvass_sign.' using errcode = '42501';
  end if;
  return new;
end
$$;

drop trigger if exists trg_sor_canvasses_guard_signoff on public.sor_canvasses;
create trigger trg_sor_canvasses_guard_signoff
  before insert or update on public.sor_canvasses
  for each row execute function public.sor_canvasses_guard_signoff();

-- ---------------------------------------------------------------------------
-- canvass_clear_signoff: trigger-only
-- ---------------------------------------------------------------------------

create or replace function public.canvass_clear_signoff(p_canvass_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_signed timestamptz;
begin
  select signed_off_at into v_signed from public.sor_canvasses where id = p_canvass_id;
  -- Gone (a cascade) or not signed: nothing to clear.
  if not found or v_signed is null then
    return;
  end if;
  if nullif(btrim(coalesce(p_reason, '')), '') is null then
    raise exception 'canvass_clear_signoff: a reason is required' using errcode = '22023';
  end if;

  perform set_config('canvass.signoff', 'on', true);
  update public.sor_canvasses set signed_off_by = null, signed_off_at = null where id = p_canvass_id;
  perform set_config('canvass.signoff', 'off', true);

  insert into public.sor_canvass_signoff_events (canvass_id, kind, actor_id, reason, offer_count)
  values (
    p_canvass_id, 'cleared', public.get_employee_id(), btrim(p_reason),
    (select count(*) from public.sor_canvass_offers where canvass_id = p_canvass_id)
  );
end
$$;

revoke all on function public.canvass_clear_signoff(uuid, text) from public, anon, authenticated;

create or replace function public.canvass_clear_on_offer_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_canvass uuid;
  v_reason  text;
begin
  if tg_op = 'INSERT' then
    v_canvass := new.canvass_id;
    v_reason := 'An Offer was added';
  elsif tg_op = 'DELETE' then
    v_canvass := old.canvass_id;
    v_reason := 'An Offer was removed';
  else
    v_canvass := new.canvass_id;
    -- A plain re-ordering changes nothing the approver signed.
    if (to_jsonb(new) - 'sort_order' - 'updated_at') = (to_jsonb(old) - 'sort_order' - 'updated_at') then
      return new;
    end if;
    v_reason := case when new.is_winner is distinct from old.is_winner then 'The winner changed' else 'An Offer was changed' end;
  end if;

  perform public.canvass_clear_signoff(v_canvass, v_reason);
  return coalesce(new, old);
end
$$;

drop trigger if exists trg_canvass_clear_on_offer_change on public.sor_canvass_offers;
create trigger trg_canvass_clear_on_offer_change
  after insert or update or delete on public.sor_canvass_offers
  for each row execute function public.canvass_clear_on_offer_change();

create or replace function public.canvass_clear_on_price_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_offer   uuid;
  v_canvass uuid;
begin
  if tg_op = 'UPDATE'
     and new.unit_price is not distinct from old.unit_price
     and new.comparison_rate is not distinct from old.comparison_rate then
    return new;
  end if;

  v_offer := case when tg_op = 'DELETE' then old.offer_id else new.offer_id end;
  select canvass_id into v_canvass from public.sor_canvass_offers where id = v_offer;
  -- The Offer is gone (it was removed, or its Canvass was): the Offer's own trigger has spoken.
  if v_canvass is not null then
    perform public.canvass_clear_signoff(v_canvass, 'A price changed');
  end if;
  return coalesce(new, old);
end
$$;

drop trigger if exists trg_canvass_clear_on_price_change on public.sor_canvass_offer_prices;
create trigger trg_canvass_clear_on_price_change
  after insert or update or delete on public.sor_canvass_offer_prices
  for each row execute function public.canvass_clear_on_price_change();

create or replace function public.canvass_clear_on_reason_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.reason is distinct from old.reason then
    perform public.canvass_clear_signoff(new.id, 'The reason changed');
  end if;
  return new;
end
$$;

drop trigger if exists trg_canvass_clear_on_reason_change on public.sor_canvasses;
create trigger trg_canvass_clear_on_reason_change
  after update of reason on public.sor_canvasses
  for each row execute function public.canvass_clear_on_reason_change();

-- ---------------------------------------------------------------------------
-- canvass_sign
-- ---------------------------------------------------------------------------

create or replace function public.canvass_sign(p_canvass_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor   uuid := public.get_employee_id();
  v_canvass public.sor_canvasses;
  v_count   integer;
  v_at      timestamptz := now();
begin
  if v_actor is null then
    raise exception 'canvass_sign: sign in first' using errcode = '42501';
  end if;
  if not public.transmittal_on_list('transmittal_check_by') then
    raise exception 'canvass_sign: only the purchasing approver list can sign a Canvass' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtext('canvass_signoff:' || p_canvass_id::text));

  select * into v_canvass from public.sor_canvasses where id = p_canvass_id;
  if not found then
    raise exception 'canvass_sign: not found' using errcode = 'P0002';
  end if;
  if v_canvass.created_by is not distinct from v_actor then
    raise exception 'canvass_sign: you can''t sign a Canvass you opened' using errcode = '42501';
  end if;
  if v_canvass.signed_off_at is not null then
    raise exception 'canvass_sign: already signed' using errcode = '55000';
  end if;
  if not exists (select 1 from public.sor_canvass_offers where canvass_id = p_canvass_id and is_winner) then
    raise exception 'canvass_sign: pick a winner first' using errcode = '22023';
  end if;
  if nullif(btrim(coalesce(v_canvass.reason, '')), '') is null then
    raise exception 'canvass_sign: give the reason for the winner first' using errcode = '22023';
  end if;

  select count(*) into v_count from public.sor_canvass_offers where canvass_id = p_canvass_id;

  perform set_config('canvass.signoff', 'on', true);
  update public.sor_canvasses set signed_off_by = v_actor, signed_off_at = v_at where id = p_canvass_id;
  perform set_config('canvass.signoff', 'off', true);

  insert into public.sor_canvass_signoff_events (canvass_id, kind, actor_id, reason, offer_count, created_at)
  values (p_canvass_id, 'signed', v_actor, btrim(v_canvass.reason), v_count, v_at);

  return jsonb_build_object('canvass_id', p_canvass_id, 'number', v_canvass.number, 'signed_off_at', v_at, 'offer_count', v_count);
end
$$;

revoke all on function public.canvass_sign(uuid) from public, anon;
grant execute on function public.canvass_sign(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- The queue, and who to tell
-- ---------------------------------------------------------------------------

-- A Canvass is ready to sign when it has a winner and a non-blank reason.
create or replace function public.canvass_is_ready(p_canvass_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.sor_canvasses c
    where c.id = p_canvass_id
      and c.signed_off_at is null
      and nullif(btrim(coalesce(c.reason, '')), '') is not null
      and exists (select 1 from public.sor_canvass_offers o where o.canvass_id = c.id and o.is_winner)
  )
$$;

revoke all on function public.canvass_is_ready(uuid) from public, anon, authenticated;

create or replace function public.canvass_pending_signoffs()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(row_to_json(q)::jsonb order by q.waiting_since, q.canvass_id), '[]'::jsonb)
  from (
    select c.id as canvass_id,
           c.number,
           c.component_id,
           c.requested_item_id,
           c.reason,
           c.created_by as creator_id,
           creator.name as creator_name,
           coalesce(comp.name, item.name) as subject_name,
           opp.id as opportunity_id,
           opp.project_title,
           opp.client_name,
           (select count(*) from public.sor_canvass_offers o where o.canvass_id = c.id) as offer_count,
           w.brand as winner_brand,
           w.supplier_name as winner_supplier,
           coalesce(
             greatest(c.updated_at, (select max(o.updated_at) from public.sor_canvass_offers o where o.canvass_id = c.id)),
             c.created_at
           ) as waiting_since
    from public.sor_canvasses c
    join public.sor_canvass_offers w on w.canvass_id = c.id and w.is_winner
    left join public.employees creator on creator.id = c.created_by
    left join public.costing_components comp on comp.id = c.component_id
    left join public.purchase_request_items item on item.id = c.requested_item_id
    left join public.purchase_requests req on req.id = item.request_id
    left join public.sales_opportunities opp
      on opp.id = case when c.component_id is not null then public.canvass_component_opportunity(c.component_id) else req.opportunity_id end
    where public.transmittal_on_list('transmittal_check_by')
      and c.signed_off_at is null
      and nullif(btrim(coalesce(c.reason, '')), '') is not null
      and c.created_by is distinct from public.get_employee_id()
  ) q
$$;

revoke all on function public.canvass_pending_signoffs() from public, anon;
grant execute on function public.canvass_pending_signoffs() to authenticated;

-- The list is not readable to a purchaser, so the people to tell are read here. Not ready, no one.
create or replace function public.canvass_signoff_audience(p_canvass_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_number text;
  v_creator uuid;
begin
  if not public.canvass_can_read(p_canvass_id) or not public.canvass_is_ready(p_canvass_id) then
    return jsonb_build_object('ready', false, 'number', null, 'notify_ids', '[]'::jsonb);
  end if;

  select number, created_by into v_number, v_creator from public.sor_canvasses where id = p_canvass_id;

  return jsonb_build_object(
    'ready', true,
    'number', v_number,
    'notify_ids', coalesce((
      select jsonb_agg(l.employee_id)
        from public.ipas_signer_lists l
        join public.employees e on e.id = l.employee_id
       where l.list_key = 'transmittal_check_by'
         and not coalesce(e.is_deleted, false)
         and l.employee_id is distinct from v_creator
    ), '[]'::jsonb)
  );
end
$$;

revoke all on function public.canvass_signoff_audience(uuid) from public, anon;
grant execute on function public.canvass_signoff_audience(uuid) to authenticated;
