-- Canvass before the Purchase Request (ADR 0034, purchasing feedback 2026-10-20, batch 2).
--
-- WHAT THIS CHANGES
--   sor_canvasses          may start against nothing: no Component and no Requested Item. "Never
--                          both" stays (an at-most-one CHECK replaces the exactly-one one); an
--                          Inclusion was never a subject column. Gains product_name (what is being
--                          bought, required while there is no subject to borrow a name from) and
--                          canvasser_id (the Canvasser; a subject-less Canvass defaults it to whoever
--                          starts it, a Canvass on a Component or a Requested Item leaves it null
--                          and the Canvasser is derived as CONTEXT.md says).
--   canvass_subject_can_read / canvass_subject_can_read_money
--                          re-created: a Canvass with no subject is read, prices included, by
--                          Purchasing access and Super Admins. The Component and Requested Item
--                          branches are unchanged (20261019100000, 20261023110000).
--   canvass_start(component, requested_item, product_name, offer, price)
--                          the first Offer's save starts the Canvass and gives it its number: one
--                          call inserts the Canvass (or finds the one already on that subject) and
--                          adds the Offer. Opening the panel writes nothing any more.
--   canvass_clear_winner(canvass)
--                          un-picks the winner, leaving none. The winner change clears the sign-off
--                          through the existing trigger. What the winner filled on the Costing Matrix
--                          (Acquire, Offer Specification, documents) stays, still marked, until a
--                          new winner replaces it.
--   canvass_list()         every Canvass the caller may read, for the Canvasses page: number, what
--                          it is for, Canvasser, winner, signed state. Names only, no money.
--   canvass_create_purchase_request(title, items)
--                          Purchasing picks one or more subject-less Canvasses, each with a winner,
--                          and makes one Direct Purchase Request with one Requested Item per Canvass,
--                          filled from its winner. Each Canvass then points at its new item. An
--                          unsigned Canvass is allowed (the screen warns).
--   canvass_pending_signoffs()
--                          re-created so a subject-less Canvass shows its product name.
--
-- Written for the fake database too: only additive statements sit above the "-- Functions"
-- marker (the fake reads up to it); the constraints, functions and triggers sit below it.
--
-- SAFE TO RUN AT ANY TIME: idempotent.

-- ---------------------------------------------------------------------------
-- Schema (additive)
-- ---------------------------------------------------------------------------

alter table public.sor_canvasses
  add column if not exists product_name text,
  add column if not exists canvasser_id uuid references public.employees (id) on delete set null;

comment on column public.sor_canvasses.product_name is
  'ADR 0034: what is being bought, typed by Purchasing. Required while the Canvass has no subject; it names the Requested Item a Purchase Request creates from it.';
comment on column public.sor_canvasses.canvasser_id is
  'ADR 0034: the Canvasser, when set. A subject-less Canvass defaults it to whoever starts it; otherwise null and derived (the Component''s Purchasing Incharge, else the request''s Buyer).';

-- Functions
-- ---------------------------------------------------------------------------
-- At most one subject, and a subject-less Canvass says what it is for
-- ---------------------------------------------------------------------------

alter table public.sor_canvasses drop constraint if exists sor_canvasses_exactly_one_subject_chk;
alter table public.sor_canvasses drop constraint if exists sor_canvasses_at_most_one_subject_chk;
alter table public.sor_canvasses
  add constraint sor_canvasses_at_most_one_subject_chk check (
    (component_id is not null)::int + (requested_item_id is not null)::int <= 1
  );

alter table public.sor_canvasses drop constraint if exists sor_canvasses_says_what_chk;
alter table public.sor_canvasses
  add constraint sor_canvasses_says_what_chk check (
    component_id is not null
    or requested_item_id is not null
    or nullif(btrim(coalesce(product_name, '')), '') is not null
  );

comment on table public.sor_canvasses is
  'ADR 0034: one Canvass per subject, hanging off at most one Costing Matrix Component (component_id) or one Requested Item (requested_item_id), or none yet (buying outside a project, canvassed before its Purchase Request). number is CNV_ and four digits, never reused, given when the first Offer is saved.';

-- ---------------------------------------------------------------------------
-- The Canvasser of a subject-less Canvass is whoever starts it
-- ---------------------------------------------------------------------------

-- Runs after trg_sor_canvasses_assign_number (trigger names sort), which has set created_by.
create or replace function public.sor_canvasses_default_canvasser()
returns trigger
language plpgsql
as $$
begin
  if new.canvasser_id is null and new.component_id is null and new.requested_item_id is null then
    new.canvasser_id := new.created_by;
  end if;
  return new;
end
$$;

drop trigger if exists trg_sor_canvasses_default_canvasser on public.sor_canvasses;
create trigger trg_sor_canvasses_default_canvasser
  before insert on public.sor_canvasses
  for each row execute function public.sor_canvasses_default_canvasser();

-- ---------------------------------------------------------------------------
-- Read: every Purchasing holder reads a Canvass that has no subject yet
-- ---------------------------------------------------------------------------

create or replace function public.canvass_subject_can_read(p_component_id uuid, p_requested_item_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when p_component_id is not null then
      coalesce(public.costing_can_read(public.canvass_component_opportunity(p_component_id)), false)
    when p_requested_item_id is not null then
      exists (
        select 1 from public.purchase_request_items i
        where i.id = p_requested_item_id and public.can_read_purchase_request(i.request_id)
      )
    else
      coalesce(public.has_purchasing_access(), false) or coalesce(public.is_super_admin(), false)
  end
$$;

create or replace function public.canvass_subject_can_read_money(p_component_id uuid, p_requested_item_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when p_component_id is not null then
      coalesce(public.costing_can_read_cost(public.canvass_component_opportunity(p_component_id)), false)
    when p_requested_item_id is not null then
      public.canvass_subject_can_read(null, p_requested_item_id)
      and (
        coalesce(public.has_purchasing_access(), false)
        or coalesce(public.has_finance_access(), false)
        or coalesce(public.is_super_admin(), false)
      )
    else
      coalesce(public.has_purchasing_access(), false) or coalesce(public.is_super_admin(), false)
  end
$$;

-- ---------------------------------------------------------------------------
-- canvass_start: the first Offer starts the Canvass
-- ---------------------------------------------------------------------------

-- Security invoker, like canvass_add_offer: the Canvass and Offer row policies judge both inserts.
-- A second purchaser saving a first Offer on the same subject at the same moment adds to the
-- Canvass the first one started: one Canvass per subject.
create or replace function public.canvass_start(
  p_component_id uuid,
  p_requested_item_id uuid,
  p_product_name text,
  p_offer jsonb,
  p_price jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_id    uuid;
  v_name  text := nullif(btrim(coalesce(p_product_name, '')), '');
  v_offer jsonb;
begin
  if p_component_id is not null and p_requested_item_id is not null then
    raise exception 'canvass_start: a Canvass is on one Component or one Requested Item, never both'
      using errcode = '22023';
  end if;
  if p_component_id is null and p_requested_item_id is null and v_name is null then
    raise exception 'canvass_start: say what is being bought' using errcode = '22023';
  end if;

  if p_component_id is not null or p_requested_item_id is not null then
    select c.id into v_id from public.sor_canvasses c
     where (p_component_id is not null and c.component_id = p_component_id)
        or (p_requested_item_id is not null and c.requested_item_id = p_requested_item_id);
  end if;

  if v_id is null then
    begin
      insert into public.sor_canvasses (component_id, requested_item_id, product_name, created_by)
      values (p_component_id, p_requested_item_id, v_name, public.get_employee_id())
      returning id into v_id;
    exception when unique_violation then
      select c.id into v_id from public.sor_canvasses c
       where (p_component_id is not null and c.component_id = p_component_id)
          or (p_requested_item_id is not null and c.requested_item_id = p_requested_item_id);
      if v_id is null then
        raise;
      end if;
    end;
  end if;

  v_offer := public.canvass_add_offer(v_id, p_offer, p_price);

  return jsonb_build_object(
    'canvass_id', v_id,
    'number', (select c.number from public.sor_canvasses c where c.id = v_id),
    'offer', v_offer
  );
end;
$$;

revoke all on function public.canvass_start(uuid, uuid, text, jsonb, jsonb) from public, anon;
grant execute on function public.canvass_start(uuid, uuid, text, jsonb, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- canvass_clear_winner: no winner
-- ---------------------------------------------------------------------------

create or replace function public.canvass_clear_winner(p_canvass_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cleared integer;
begin
  if public.get_employee_id() is null then
    raise exception 'canvass_clear_winner: sign in first' using errcode = '42501';
  end if;

  -- The same lock canvass_apply_winner takes, so a pick and an un-pick never interleave.
  perform pg_advisory_xact_lock(hashtext('canvass_winner:' || p_canvass_id::text));

  if not exists (select 1 from public.sor_canvasses where id = p_canvass_id) then
    raise exception 'canvass_clear_winner: not found' using errcode = 'P0002';
  end if;
  if not (public.canvass_can_write() and public.canvass_can_read(p_canvass_id)) then
    raise exception 'canvass_clear_winner: not allowed' using errcode = '42501';
  end if;

  -- The winner change unsigns the Canvass (trg_canvass_clear_on_offer_change). The Costing Matrix
  -- keeps what the winner filled, marked, until canvass_apply_winner replaces it.
  update public.sor_canvass_offers set is_winner = false
   where canvass_id = p_canvass_id and is_winner;
  get diagnostics v_cleared = row_count;

  return jsonb_build_object('canvass_id', p_canvass_id, 'cleared', v_cleared > 0);
end;
$$;

revoke all on function public.canvass_clear_winner(uuid) from public, anon;
grant execute on function public.canvass_clear_winner(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- canvass_list: the Canvasses page
-- ---------------------------------------------------------------------------

-- kind: 'component' (project canvassing on the Costing Matrix), 'requested_item', or 'none'.
-- The Canvasser: the one set on the Canvass, else the Component's Purchasing Incharge (else the
-- matrix's), else the request's Buyer.
create or replace function public.canvass_list()
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
  updated_at timestamptz
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
         c.updated_at
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

-- ---------------------------------------------------------------------------
-- canvass_create_purchase_request: one Direct request from one or more Canvasses
-- ---------------------------------------------------------------------------

-- p_items: [{ canvass_id, quantity?, unit? }]. Every Canvass is checked before anything is made:
-- it has no subject yet, it has a winner, and it is picked once. The request is opened through
-- purchase_request_open, and the rest of the items through purchase_request_add_new_item, so the
-- request gets its members, its messages and its item events like any Direct request. No price
-- goes onto the item: a Requested Item is read by members who may not see prices.
create or replace function public.canvass_create_purchase_request(p_title text, p_items jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor   uuid := public.get_employee_id();
  v_entry   jsonb;
  v_id      uuid;
  v_seen    uuid[] := '{}';
  v_canvass public.sor_canvasses;
  v_winner  public.sor_canvass_offers;
  v_name    text;
  v_desc    text;
  v_qty     numeric;
  v_unit    text;
  v_req     uuid;
  v_item    uuid;
  v_made    jsonb := '[]'::jsonb;
begin
  if v_actor is null then
    raise exception 'canvass_create_purchase_request: sign in first' using errcode = '42501';
  end if;
  if not public.canvass_can_write() then
    raise exception 'canvass_create_purchase_request: only Purchasing creates a Purchase Request from Canvasses'
      using errcode = '42501';
  end if;
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'canvass_create_purchase_request: pick at least one Canvass' using errcode = '22023';
  end if;
  if jsonb_array_length(p_items) > 50 then
    raise exception 'canvass_create_purchase_request: at most 50 Canvasses at once' using errcode = '22023';
  end if;

  -- Check every Canvass first, locking it so nobody else turns it into a request meanwhile.
  for v_entry in select * from jsonb_array_elements(p_items)
  loop
    v_id := nullif(v_entry ->> 'canvass_id', '')::uuid;
    select * into v_canvass from public.sor_canvasses where id = v_id for update;
    if not found then
      raise exception 'canvass_create_purchase_request: a picked Canvass was not found' using errcode = 'P0002';
    end if;
    if v_id = any (v_seen) then
      raise exception 'canvass_create_purchase_request: % is picked twice', v_canvass.number using errcode = '22023';
    end if;
    v_seen := v_seen || v_id;
    if v_canvass.component_id is not null or v_canvass.requested_item_id is not null then
      raise exception 'canvass_create_purchase_request: % already belongs to a Component or a Requested Item', v_canvass.number
        using errcode = '55000';
    end if;
    if not exists (select 1 from public.sor_canvass_offers o where o.canvass_id = v_id and o.is_winner) then
      raise exception 'canvass_create_purchase_request: % has no winner yet', v_canvass.number using errcode = '22023';
    end if;
  end loop;

  for v_entry in select * from jsonb_array_elements(p_items)
  loop
    v_id := (v_entry ->> 'canvass_id')::uuid;
    select * into v_canvass from public.sor_canvasses where id = v_id;
    select * into v_winner from public.sor_canvass_offers where canvass_id = v_id and is_winner;

    v_name := coalesce(
      nullif(btrim(coalesce(v_canvass.product_name, '')), ''),
      nullif(btrim(coalesce(v_winner.brand, '')), ''),
      v_canvass.number
    );
    v_desc := nullif(concat_ws(E'\n',
      nullif(concat_ws(' · ',
        nullif(btrim(coalesce(v_winner.supplier_name, '')), ''),
        nullif(btrim(coalesce(v_winner.brand, '')), '')
      ), ''),
      nullif(btrim(coalesce(v_winner.description, '')), ''),
      'From Canvass ' || v_canvass.number
    ), '');
    v_qty := coalesce(nullif(v_entry ->> 'quantity', '')::numeric, 1);
    v_unit := nullif(btrim(coalesce(v_entry ->> 'unit', '')), '');

    if v_req is null then
      v_req := public.purchase_request_open(
        p_title,
        jsonb_build_array(jsonb_build_object('name', v_name, 'quantity', v_qty, 'unit', v_unit, 'description', v_desc))
      );
      select i.id into v_item from public.purchase_request_items i where i.request_id = v_req;
    else
      v_item := public.purchase_request_add_new_item(v_req, v_name, v_qty, v_unit, v_desc, '[]'::jsonb);
    end if;

    -- The Canvass re-points at the item it became, keeping its number, Offers and reason.
    update public.sor_canvasses set requested_item_id = v_item where id = v_id;
    v_made := v_made || jsonb_build_array(jsonb_build_object('canvass_id', v_id, 'item_id', v_item));
  end loop;

  return jsonb_build_object('request_id', v_req, 'items', v_made);
end;
$$;

revoke all on function public.canvass_create_purchase_request(text, jsonb) from public, anon;
grant execute on function public.canvass_create_purchase_request(text, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- canvass_pending_signoffs: a subject-less Canvass shows its product name
-- ---------------------------------------------------------------------------

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
           coalesce(comp.name, item.name, c.product_name) as subject_name,
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
