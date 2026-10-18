-- Canvass and Offers: re-point the tables and record Offers on a Component (#276, spec #275).
--
-- WHAT THIS CHANGES
--   sor_canvasses          no longer hangs off a procurement request or an Inclusion. It hangs off
--                          exactly one Costing Matrix Component (component_id) or exactly one
--                          Requested Item (requested_item_id). Gains number (CNV_0001..., by
--                          trigger, never reused) and reason (why the winner was chosen).
--   sor_canvass_offers     gain supplier_name, odoo_supplier_id, currency (default PHP) and
--                          valid_until. unit_price moves out.
--   sor_canvass_offer_prices (new)
--                          unit_price (as quoted) and comparison_rate (PHP per unit of the quoted
--                          currency; null on a PHP Offer). Money, so a row policy keeps it from a
--                          Stage Participant, the pattern costing_component_costs set.
--   costing_can_read_money(opp) (new)
--                          the caller's Costing tier on the SOR is a money tier: closed_book,
--                          cost or price.
--
-- GUARD: both tables are empty in staging. The migration raises if either holds a row rather than
-- guessing a mapping, and rolls back whole.
--
-- ACCESS
--   Read, Offers and Canvasses: on a Component, costing_can_read(opp); on a Requested Item, the
--     Purchase Request read (can_read_purchase_request).
--   Read, prices: on a Component, costing_can_read_money(opp); on a Requested Item, a reader of the
--     request who also holds Purchasing access, Finance access or Super Admin.
--   Write (all three tables): Purchasing access or Super Admin. is_head no longer writes.
--
-- Written for the fake database too: only additive statements sit above the "-- Functions" marker
-- (the fake reads up to it); the guard, the drops, the exactly-one CHECK, functions, triggers and
-- policies sit below it. Real Postgres runs the file top to bottom, so the guard runs before any
-- destructive statement and the whole file rolls back if it raises.
--
-- SAFE TO RUN AT ANY TIME: idempotent. A re-run finds the old columns gone and skips the guard.

-- ---------------------------------------------------------------------------
-- Schema (additive)
-- ---------------------------------------------------------------------------

alter table public.sor_canvasses drop constraint if exists sor_canvasses_one_subject_chk;

alter table public.sor_canvasses
  add column if not exists component_id      uuid references public.costing_components (id) on delete cascade,
  add column if not exists requested_item_id uuid references public.purchase_request_items (id) on delete cascade,
  add column if not exists number            text,
  add column if not exists reason            text;

create unique index if not exists sor_canvasses_number_key
  on public.sor_canvasses (number);

create unique index if not exists sor_canvasses_component_key
  on public.sor_canvasses (component_id)
  where component_id is not null;

create unique index if not exists sor_canvasses_requested_item_key
  on public.sor_canvasses (requested_item_id)
  where requested_item_id is not null;

alter table public.sor_canvass_offers
  add column if not exists supplier_name    text,
  add column if not exists odoo_supplier_id integer,
  add column if not exists currency         text not null default 'PHP',
  add column if not exists valid_until      date;

alter table public.sor_canvass_offers drop constraint if exists sor_canvass_offers_currency_chk;
alter table public.sor_canvass_offers
  add constraint sor_canvass_offers_currency_chk check (currency ~ '^[A-Z]{3}$');

create table if not exists public.sor_canvass_offer_prices (
  offer_id        uuid primary key references public.sor_canvass_offers (id) on delete cascade,
  unit_price      numeric(14,2),
  comparison_rate numeric(14,6),
  updated_at      timestamptz not null default now(),
  constraint sor_canvass_offer_prices_rate_chk check (comparison_rate is null or comparison_rate > 0)
);

comment on table public.sor_canvass_offer_prices is
  '#276: the money half of an Offer. unit_price is the amount as quoted in the Offer''s currency; comparison_rate is PHP per unit of that currency, only on a foreign Offer. Kept apart so a row policy can hide it from a Stage Participant.';

-- Functions
-- ---------------------------------------------------------------------------
-- Guard, then the destructive part
-- ---------------------------------------------------------------------------

do $guard$
declare
  v_canvasses integer := 0;
  v_offers    integer := 0;
begin
  -- A re-run: the old column is already gone, so the tables were guarded the first time.
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'sor_canvasses' and column_name = 'procurement_request_id'
  ) then
    return;
  end if;

  select count(*) into v_canvasses from public.sor_canvasses;
  select count(*) into v_offers from public.sor_canvass_offers;

  if v_canvasses > 0 or v_offers > 0 then
    raise exception 'sor_canvasses holds % row(s) and sor_canvass_offers holds % row(s) — refusing to re-point them.',
      v_canvasses, v_offers;
  end if;
end
$guard$;

-- The policies read the two columns about to go; they have to go first.
drop policy if exists sor_canvasses_read on public.sor_canvasses;
drop policy if exists sor_canvasses_write on public.sor_canvasses;
drop policy if exists sor_canvass_offers_read on public.sor_canvass_offers;
drop policy if exists sor_canvass_offers_write on public.sor_canvass_offers;

drop index if exists public.sor_canvasses_procurement_request_idx;
drop index if exists public.sor_canvasses_inclusion_idx;

alter table public.sor_canvasses drop column if exists procurement_request_id;
alter table public.sor_canvasses drop column if exists inclusion_id;
alter table public.sor_canvass_offers drop column if exists unit_price;

-- A Canvass has exactly one subject, never both and never neither.
alter table public.sor_canvasses drop constraint if exists sor_canvasses_exactly_one_subject_chk;
alter table public.sor_canvasses
  add constraint sor_canvasses_exactly_one_subject_chk check (
    (component_id is not null)::int + (requested_item_id is not null)::int = 1
  );

-- ---------------------------------------------------------------------------
-- Canvass number: CNV_ and four digits, from a sequence, so a number is never reused
-- ---------------------------------------------------------------------------

create sequence if not exists public.sor_canvass_number_seq;

create or replace function public.sor_canvasses_assign_number()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.number := 'CNV_' || lpad(nextval('public.sor_canvass_number_seq')::text, 4, '0');
  -- Whoever opens it is its creator, whatever the client sent.
  if public.get_employee_id() is not null then
    new.created_by := public.get_employee_id();
  end if;
  return new;
end
$$;

drop trigger if exists trg_sor_canvasses_assign_number on public.sor_canvasses;
create trigger trg_sor_canvasses_assign_number
  before insert on public.sor_canvasses
  for each row execute function public.sor_canvasses_assign_number();

create or replace function public.sor_canvasses_keep_number()
returns trigger
language plpgsql
as $$
begin
  if new.number is distinct from old.number then
    raise exception 'A Canvass number is never changed.' using errcode = '42501';
  end if;
  return new;
end
$$;

drop trigger if exists trg_sor_canvasses_keep_number on public.sor_canvasses;
create trigger trg_sor_canvasses_keep_number
  before update on public.sor_canvasses
  for each row execute function public.sor_canvasses_keep_number();

-- ---------------------------------------------------------------------------
-- A comparison rate belongs to a foreign Offer only
-- ---------------------------------------------------------------------------

create or replace function public.sor_canvass_offer_prices_check_rate()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.updated_at := now();
  if new.comparison_rate is not null and exists (
    select 1 from public.sor_canvass_offers o
    where o.id = new.offer_id and o.currency = 'PHP'
  ) then
    raise exception 'A PHP Offer takes no comparison rate.' using errcode = '23514';
  end if;
  return new;
end
$$;

drop trigger if exists trg_sor_canvass_offer_prices_check_rate on public.sor_canvass_offer_prices;
create trigger trg_sor_canvass_offer_prices_check_rate
  before insert or update on public.sor_canvass_offer_prices
  for each row execute function public.sor_canvass_offer_prices_check_rate();

create or replace function public.sor_canvass_offers_check_currency()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.currency = 'PHP' and new.currency is distinct from old.currency and exists (
    select 1 from public.sor_canvass_offer_prices p
    where p.offer_id = new.id and p.comparison_rate is not null
  ) then
    raise exception 'Clear the comparison rate before changing an Offer to PHP.' using errcode = '23514';
  end if;
  return new;
end
$$;

drop trigger if exists trg_sor_canvass_offers_check_currency on public.sor_canvass_offers;
create trigger trg_sor_canvass_offers_check_currency
  before update of currency on public.sor_canvass_offers
  for each row execute function public.sor_canvass_offers_check_currency();

-- ---------------------------------------------------------------------------
-- Access helpers
-- ---------------------------------------------------------------------------

-- The caller's Costing tier on the SOR is one that may read money.
create or replace function public.costing_can_read_money(p_opportunity_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.costing_tier(p_opportunity_id) in ('closed_book', 'cost', 'price'), false)
$$;

create or replace function public.canvass_component_opportunity(p_component_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select m.opportunity_id
  from public.costing_components c
  join public.costing_tender_lines t on t.id = c.tender_line_id
  join public.costing_matrices m on m.id = t.matrix_id
  where c.id = p_component_id
$$;

-- Purchasing's own job: Purchasing access or a Super Admin. is_head does not write.
create or replace function public.canvass_can_write()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.has_purchasing_access(), false) or coalesce(public.is_super_admin(), false)
$$;

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
    else false
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
      coalesce(public.costing_can_read_money(public.canvass_component_opportunity(p_component_id)), false)
    when p_requested_item_id is not null then
      public.canvass_subject_can_read(null, p_requested_item_id)
      and (
        coalesce(public.has_purchasing_access(), false)
        or coalesce(public.has_finance_access(), false)
        or coalesce(public.is_super_admin(), false)
      )
    else false
  end
$$;

create or replace function public.canvass_can_read(p_canvass_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select public.canvass_subject_can_read(c.component_id, c.requested_item_id)
    from public.sor_canvasses c where c.id = p_canvass_id
  ), false)
$$;

create or replace function public.canvass_offer_can_read_money(p_offer_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select public.canvass_subject_can_read_money(c.component_id, c.requested_item_id)
    from public.sor_canvass_offers o
    join public.sor_canvasses c on c.id = o.canvass_id
    where o.id = p_offer_id
  ), false)
$$;

grant execute on function public.costing_can_read_money(uuid) to authenticated;
grant execute on function public.canvass_component_opportunity(uuid) to authenticated;
grant execute on function public.canvass_can_write() to authenticated;
grant execute on function public.canvass_subject_can_read(uuid, uuid) to authenticated;
grant execute on function public.canvass_subject_can_read_money(uuid, uuid) to authenticated;
grant execute on function public.canvass_can_read(uuid) to authenticated;
grant execute on function public.canvass_offer_can_read_money(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Row security
-- ---------------------------------------------------------------------------

alter table public.sor_canvasses enable row level security;
alter table public.sor_canvass_offers enable row level security;
alter table public.sor_canvass_offer_prices enable row level security;

drop policy if exists sor_canvasses_read on public.sor_canvasses;
create policy sor_canvasses_read on public.sor_canvasses
  for select to authenticated
  using (public.canvass_subject_can_read(component_id, requested_item_id));

drop policy if exists sor_canvasses_insert on public.sor_canvasses;
create policy sor_canvasses_insert on public.sor_canvasses
  for insert to authenticated
  with check (public.canvass_can_write() and public.canvass_subject_can_read(component_id, requested_item_id));

drop policy if exists sor_canvasses_update on public.sor_canvasses;
create policy sor_canvasses_update on public.sor_canvasses
  for update to authenticated
  using (public.canvass_can_write() and public.canvass_subject_can_read(component_id, requested_item_id))
  with check (public.canvass_can_write() and public.canvass_subject_can_read(component_id, requested_item_id));

drop policy if exists sor_canvasses_delete on public.sor_canvasses;
create policy sor_canvasses_delete on public.sor_canvasses
  for delete to authenticated
  using (public.canvass_can_write() and public.canvass_subject_can_read(component_id, requested_item_id));

drop policy if exists sor_canvass_offers_read on public.sor_canvass_offers;
create policy sor_canvass_offers_read on public.sor_canvass_offers
  for select to authenticated
  using (public.canvass_can_read(canvass_id));

drop policy if exists sor_canvass_offers_insert on public.sor_canvass_offers;
create policy sor_canvass_offers_insert on public.sor_canvass_offers
  for insert to authenticated
  with check (public.canvass_can_write() and public.canvass_can_read(canvass_id));

drop policy if exists sor_canvass_offers_update on public.sor_canvass_offers;
create policy sor_canvass_offers_update on public.sor_canvass_offers
  for update to authenticated
  using (public.canvass_can_write() and public.canvass_can_read(canvass_id))
  with check (public.canvass_can_write() and public.canvass_can_read(canvass_id));

drop policy if exists sor_canvass_offers_delete on public.sor_canvass_offers;
create policy sor_canvass_offers_delete on public.sor_canvass_offers
  for delete to authenticated
  using (public.canvass_can_write() and public.canvass_can_read(canvass_id));

drop policy if exists sor_canvass_offer_prices_read on public.sor_canvass_offer_prices;
create policy sor_canvass_offer_prices_read on public.sor_canvass_offer_prices
  for select to authenticated
  using (public.canvass_offer_can_read_money(offer_id));

drop policy if exists sor_canvass_offer_prices_insert on public.sor_canvass_offer_prices;
create policy sor_canvass_offer_prices_insert on public.sor_canvass_offer_prices
  for insert to authenticated
  with check (public.canvass_can_write() and public.canvass_offer_can_read_money(offer_id));

drop policy if exists sor_canvass_offer_prices_update on public.sor_canvass_offer_prices;
create policy sor_canvass_offer_prices_update on public.sor_canvass_offer_prices
  for update to authenticated
  using (public.canvass_can_write() and public.canvass_offer_can_read_money(offer_id))
  with check (public.canvass_can_write() and public.canvass_offer_can_read_money(offer_id));

drop policy if exists sor_canvass_offer_prices_delete on public.sor_canvass_offer_prices;
create policy sor_canvass_offer_prices_delete on public.sor_canvass_offer_prices
  for delete to authenticated
  using (public.canvass_can_write() and public.canvass_offer_can_read_money(offer_id));

grant select, insert, update, delete on public.sor_canvass_offer_prices to authenticated;

comment on table public.sor_canvasses is
  '#276: one Canvass per subject, hanging off exactly one Costing Matrix Component (component_id) or exactly one Requested Item (requested_item_id). number is CNV_ and four digits, never reused.';
