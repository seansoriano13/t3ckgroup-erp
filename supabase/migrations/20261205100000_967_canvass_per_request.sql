-- #967 (spec #956): a Canvass belongs to one Purchase Request, not to one product line.
--
-- The per-line Canvass (sor_canvasses, on one Component or one Requested Item, with Offers) is on
-- prod but has not been used for real work, so it is deleted, not converted. This migration:
--
--   1. Clears what points at an old Offer: the Acquire and Offer Specification pointers on a
--      Component (the figure and the text stay, as plain typed values), the Offer citations in a
--      Component's documents (the documents stay), and the price copied onto a Requested Item.
--   2. Drops the old tables, and every function that only served them.
--   3. Makes the new ones:
--        request_canvasses                   one per Purchase Request; it gets its CNV_ number when
--                                            its first supplier is saved (canvass_add_supplier)
--        request_canvass_suppliers           a supplier on the Canvass: currency, how long the quote
--                                            holds, lead time, quality note, position
--        request_canvass_supplier_prices     money: the comparison rate (only for money readers)
--        request_canvass_quotes              one supplier's answer on one line of the request:
--                                            brand, description, source link, brochure, remarks
--        request_canvass_quote_prices        money: the unit price (only for money readers)
--        request_canvass_winners             a line's winning supplier and reason, one per line
--        request_canvass_no_other_supplier   the "No other supplier" note, per Canvass
--      The rules (three suppliers, the lock, status moves, filling a Component) are #969.
--   4. Repoints what read the old tables: accept brand, the actual cost in pesos, the line-removal
--      guard, "is this yours", replace a product, undo a status, the Purchasing Dashboard.
--
-- BEFORE PROD: docs/runbooks/canvass-per-request-prod-count.sql counts the old Canvasses and their
-- winners. Do not apply this on prod if a winner was picked for real work.

-- ---------------------------------------------------------------------------------------------
-- 1. Pointers to old Offers
-- ---------------------------------------------------------------------------------------------

-- The Costing triggers (history, go lock, print clears, the Sales band) are for people's edits.
-- This is a clean-up of a pointer, so they stand aside for it.
alter table public.costing_component_costs disable trigger user;
alter table public.costing_components disable trigger user;

update public.costing_component_costs
   set acquire_from_offer_id = null,
       acquire_source = case when acquire_source = 'canvass' then 'typed' else acquire_source end
 where acquire_from_offer_id is not null or acquire_source = 'canvass';

update public.costing_components
   set offer_specification_from_offer_id = null
 where offer_specification_from_offer_id is not null;

update public.costing_components c
   set documents = (
         select coalesce(jsonb_agg(d - 'offer_id'), '[]'::jsonb)
           from jsonb_array_elements(c.documents) d
       )
 where jsonb_typeof(c.documents) = 'array'
   and exists (
     select 1 from jsonb_array_elements(c.documents) d
      where jsonb_typeof(d) = 'object' and d ? 'offer_id'
   );

alter table public.costing_component_costs enable trigger user;
alter table public.costing_components enable trigger user;

-- The price a Requested Item was bought at was copied from the winning Offer.
delete from public.purchase_request_item_prices;
drop policy if exists purchase_request_item_prices_read on public.purchase_request_item_prices;

alter table public.costing_component_costs
  drop constraint if exists costing_component_costs_acquire_from_offer_id_fkey;
alter table public.costing_components
  drop constraint if exists costing_components_offer_specification_from_offer_id_fkey;

-- ---------------------------------------------------------------------------------------------
-- 2. The old tables and their functions
-- ---------------------------------------------------------------------------------------------

drop table if exists public.sor_canvass_offer_prices cascade;
drop table if exists public.sor_canvass_no_other_supplier cascade;
drop table if exists public.sor_canvass_signoff_events cascade;
drop table if exists public.sor_canvass_offers cascade;
drop table if exists public.sor_canvasses cascade;

drop function if exists public.canvass_add_offer(uuid, jsonb, jsonb);
drop function if exists public.canvass_add_to_purchase_request(uuid, jsonb);
drop function if exists public.canvass_apply_winner(uuid, uuid);
drop function if exists public.canvass_clear_no_other_supplier(uuid, integer);
drop function if exists public.canvass_clear_winner(uuid);
drop function if exists public.canvass_create_purchase_request(text, jsonb);
drop function if exists public.canvass_is_locked(uuid);
drop function if exists public.canvass_list();
drop function if exists public.canvass_offer_can_read_money(uuid);
drop function if exists public.canvass_offer_projection(uuid);
drop function if exists public.canvass_refuse_edit_when_locked();
drop function if exists public.canvass_refuse_offer_change_when_locked();
drop function if exists public.canvass_refuse_price_change_when_locked();
drop function if exists public.canvass_set_no_other_supplier(uuid, integer[], text);
drop function if exists public.canvass_sign(uuid);
drop function if exists public.canvass_slots_covered(uuid);
drop function if exists public.canvass_stamp_request_made();
drop function if exists public.canvass_start(uuid, uuid, text, jsonb, jsonb);
drop function if exists public.canvass_subject_can_read(uuid, uuid);
drop function if exists public.canvass_subject_can_read_money(uuid, uuid);
drop function if exists public.canvass_unlock(uuid, text);
drop function if exists public.canvass_can_read(uuid);
drop function if exists public.sor_canvass_offer_prices_check_rate();
drop function if exists public.sor_canvass_offers_check_currency();
drop function if exists public.sor_canvass_offers_touch();
drop function if exists public.sor_canvass_signoff_events_append_only();
drop function if exists public.sor_canvasses_assign_number();
drop function if exists public.sor_canvasses_default_canvasser();
drop function if exists public.sor_canvasses_guard_signoff();
drop function if exists public.sor_canvasses_keep_number();
drop function if exists public.sor_canvasses_mark_canvassing();
drop function if exists public.sor_canvasses_refuse_component_item();
drop function if exists public.sor_canvasses_refuse_free_standing();
drop function if exists public.sor_canvasses_touch();

-- ---------------------------------------------------------------------------------------------
-- 3. The new tables
-- ---------------------------------------------------------------------------------------------

-- Who may write a Canvass: Purchasing or a Super Admin (unchanged).
create or replace function public.canvass_can_write()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.has_purchasing_access(), false) or coalesce(public.is_super_admin(), false)
$$;

-- Who may read a Purchase Request's Canvass: whoever may read the request.
create or replace function public.canvass_request_can_read(p_request_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.can_read_purchase_request(p_request_id), false)
$$;

-- Who may read its money (unit prices, comparison rates): a reader of the request with Purchasing
-- access, Finance access or Super Admin, or, on a project's request, the Costing tiers that see cost.
create or replace function public.canvass_request_can_read_money(p_request_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.canvass_request_can_read(p_request_id)
     and (
       coalesce(public.has_purchasing_access(), false)
       or coalesce(public.has_finance_access(), false)
       or coalesce(public.is_super_admin(), false)
       or coalesce((
            select public.costing_can_read_cost(r.opportunity_id)
              from public.purchase_requests r
             where r.id = p_request_id and r.opportunity_id is not null
          ), false)
     )
$$;

create table public.request_canvasses (
  id          uuid primary key default gen_random_uuid(),
  request_id  uuid not null references public.purchase_requests (id) on delete cascade,
  number      text not null,
  canvasser_id uuid references public.employees (id) on delete set null,
  attachments jsonb not null default '[]'::jsonb,
  created_by  uuid references public.employees (id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  constraint request_canvasses_one_per_request unique (request_id),
  constraint request_canvasses_number_key unique (number)
);

comment on table public.request_canvasses is
  '#967 (spec #956): the Canvass of one Purchase Request, holding every line. Made only by canvass_add_supplier, when the first supplier is saved, which is when it gets its CNV_ number.';

create or replace function public.canvass_can_read(p_canvass_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select public.canvass_request_can_read(c.request_id)
      from public.request_canvasses c where c.id = p_canvass_id
  ), false)
$$;

create or replace function public.canvass_can_read_money(p_canvass_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select public.canvass_request_can_read_money(c.request_id)
      from public.request_canvasses c where c.id = p_canvass_id
  ), false)
$$;

create table public.request_canvass_suppliers (
  id               uuid primary key default gen_random_uuid(),
  canvass_id       uuid not null references public.request_canvasses (id) on delete cascade,
  supplier_name    text not null,
  odoo_supplier_id integer,
  currency         text not null default 'PHP',
  valid_until      date,
  lead_time        text,
  quality_note     text,
  sort_order       integer not null default 0,
  created_by       uuid references public.employees (id),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  constraint request_canvass_suppliers_name_chk check (length(btrim(supplier_name)) > 0),
  constraint request_canvass_suppliers_currency_chk check (currency ~ '^[A-Z]{3}$'),
  constraint request_canvass_suppliers_id_canvass_key unique (id, canvass_id)
);

create unique index request_canvass_suppliers_name_key
  on public.request_canvass_suppliers (canvass_id, lower(btrim(supplier_name)));
create index request_canvass_suppliers_canvass_idx
  on public.request_canvass_suppliers (canvass_id, sort_order);

comment on table public.request_canvass_suppliers is
  '#967: a supplier added to a Canvass once. Its money (the comparison rate) is in request_canvass_supplier_prices.';

create table public.request_canvass_supplier_prices (
  supplier_id     uuid primary key references public.request_canvass_suppliers (id) on delete cascade,
  comparison_rate numeric(14,6),
  updated_at      timestamptz not null default now(),

  constraint request_canvass_supplier_prices_rate_chk check (comparison_rate is null or comparison_rate > 0)
);

comment on table public.request_canvass_supplier_prices is
  '#967: money half of a Canvass supplier. A row policy shows it only to readers who may see money.';

create table public.request_canvass_quotes (
  id          uuid primary key default gen_random_uuid(),
  canvass_id  uuid not null,
  supplier_id uuid not null,
  item_id     uuid not null references public.purchase_request_items (id) on delete cascade,
  brand       text,
  description text,
  source_link text,
  brochure    jsonb not null default '[]'::jsonb,
  remarks     text,
  created_by  uuid references public.employees (id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  constraint request_canvass_quotes_supplier_fkey
    foreign key (supplier_id, canvass_id)
    references public.request_canvass_suppliers (id, canvass_id) on delete cascade,
  constraint request_canvass_quotes_one_per_line unique (supplier_id, item_id)
);

create index request_canvass_quotes_canvass_idx on public.request_canvass_quotes (canvass_id);
create index request_canvass_quotes_item_idx on public.request_canvass_quotes (item_id);

comment on table public.request_canvass_quotes is
  '#967: one supplier''s answer on one line (a Requested Item) of the request. The unit price is in request_canvass_quote_prices.';

create table public.request_canvass_quote_prices (
  quote_id   uuid primary key references public.request_canvass_quotes (id) on delete cascade,
  unit_price numeric(14,2),
  updated_at timestamptz not null default now(),

  constraint request_canvass_quote_prices_price_chk check (unit_price is null or unit_price >= 0)
);

comment on table public.request_canvass_quote_prices is
  '#967: money half of a quote. A row policy shows it only to readers who may see money.';

create table public.request_canvass_winners (
  item_id     uuid primary key references public.purchase_request_items (id) on delete cascade,
  supplier_id uuid not null,
  reason      text,
  chosen_by   uuid references public.employees (id) on delete set null,
  chosen_at   timestamptz not null default now(),

  constraint request_canvass_winners_quote_fkey
    foreign key (supplier_id, item_id)
    references public.request_canvass_quotes (supplier_id, item_id) on delete cascade on update cascade
);

comment on table public.request_canvass_winners is
  '#967: a line''s winner. At most one per line (item_id is the key), and it has to be a supplier that quoted the line.';

create table public.request_canvass_no_other_supplier (
  canvass_id uuid primary key references public.request_canvasses (id) on delete cascade,
  reason     text not null,
  actor_id   uuid references public.employees (id) on delete set null,
  created_at timestamptz not null default now(),

  constraint request_canvass_no_other_supplier_reason_chk check (length(btrim(reason)) > 0)
);

comment on table public.request_canvass_no_other_supplier is
  '#967: why a Canvass has fewer than three suppliers. One note per Canvass.';

create or replace function public.canvass_supplier_can_read_money(p_supplier_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select public.canvass_can_read_money(s.canvass_id)
      from public.request_canvass_suppliers s where s.id = p_supplier_id
  ), false)
$$;

create or replace function public.canvass_quote_can_read_money(p_quote_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select public.canvass_can_read_money(q.canvass_id)
      from public.request_canvass_quotes q where q.id = p_quote_id
  ), false)
$$;

-- A line's Canvass is its request's Canvass.
create or replace function public.canvass_item_can_read(p_item_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select public.canvass_request_can_read(i.request_id)
      from public.purchase_request_items i where i.id = p_item_id
  ), false)
$$;

-- Triggers --------------------------------------------------------------------------------------

-- CNV_ number from the same sequence as before; the person who opens it is its creator and, until
-- someone else is named, its canvasser.
create or replace function public.request_canvasses_assign_number()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.number := 'CNV_' || lpad(nextval('public.sor_canvass_number_seq')::text, 4, '0');
  if public.get_employee_id() is not null then
    new.created_by := public.get_employee_id();
  end if;
  if new.canvasser_id is null then
    new.canvasser_id := new.created_by;
  end if;
  return new;
end
$$;

create or replace function public.request_canvasses_keep_number()
returns trigger
language plpgsql
as $$
begin
  if new.number is distinct from old.number then
    raise exception 'A Canvass number is never changed.' using errcode = '42501';
  end if;
  if new.request_id is distinct from old.request_id then
    raise exception 'A Canvass stays on its Purchase Request.' using errcode = '42501';
  end if;
  new.updated_at := now();
  return new;
end
$$;

create or replace function public.request_canvass_touch()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end
$$;

-- A comparison rate belongs to a foreign supplier only.
create or replace function public.request_canvass_supplier_prices_check_rate()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.updated_at := now();
  if new.comparison_rate is not null and exists (
    select 1 from public.request_canvass_suppliers s
     where s.id = new.supplier_id and s.currency = 'PHP'
  ) then
    raise exception 'A PHP supplier takes no comparison rate.' using errcode = '23514';
  end if;
  return new;
end
$$;

create or replace function public.request_canvass_suppliers_check_currency()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.currency = 'PHP' and new.currency is distinct from old.currency and exists (
    select 1 from public.request_canvass_supplier_prices p
     where p.supplier_id = new.id and p.comparison_rate is not null
  ) then
    raise exception 'Clear the comparison rate before changing a supplier to PHP.' using errcode = '23514';
  end if;
  return new;
end
$$;

-- A quote is on a line of the Canvass's own request.
create or replace function public.request_canvass_quotes_check_line()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.updated_at := now();
  if not exists (
    select 1
      from public.request_canvasses c
      join public.purchase_request_items i on i.request_id = c.request_id
     where c.id = new.canvass_id and i.id = new.item_id
  ) then
    raise exception 'That line is not on this Canvass''s Purchase Request.' using errcode = '23514';
  end if;
  return new;
end
$$;

create trigger trg_request_canvasses_assign_number before insert on public.request_canvasses
  for each row execute function public.request_canvasses_assign_number();
create trigger trg_request_canvasses_keep_number before update on public.request_canvasses
  for each row execute function public.request_canvasses_keep_number();
create trigger trg_request_canvass_suppliers_touch before update on public.request_canvass_suppliers
  for each row execute function public.request_canvass_touch();
create trigger trg_request_canvass_suppliers_check_currency before update of currency on public.request_canvass_suppliers
  for each row execute function public.request_canvass_suppliers_check_currency();
create trigger trg_request_canvass_supplier_prices_check_rate before insert or update on public.request_canvass_supplier_prices
  for each row execute function public.request_canvass_supplier_prices_check_rate();
create trigger trg_request_canvass_quotes_check_line before insert or update of item_id, canvass_id on public.request_canvass_quotes
  for each row execute function public.request_canvass_quotes_check_line();
create trigger trg_request_canvass_quotes_touch before update on public.request_canvass_quotes
  for each row execute function public.request_canvass_touch();
create trigger trg_request_canvass_quote_prices_touch before update on public.request_canvass_quote_prices
  for each row execute function public.request_canvass_touch();

-- Row level security ------------------------------------------------------------------------------
-- Reading follows the request. Writing is Purchasing or a Super Admin who can read the request.
-- A Canvass itself is made only by canvass_add_supplier (no insert policy).

alter table public.request_canvasses enable row level security;
alter table public.request_canvass_suppliers enable row level security;
alter table public.request_canvass_supplier_prices enable row level security;
alter table public.request_canvass_quotes enable row level security;
alter table public.request_canvass_quote_prices enable row level security;
alter table public.request_canvass_winners enable row level security;
alter table public.request_canvass_no_other_supplier enable row level security;

create policy request_canvasses_read on public.request_canvasses
  for select to authenticated using (public.canvass_request_can_read(request_id));
create policy request_canvasses_update on public.request_canvasses
  for update to authenticated
  using (public.canvass_can_write() and public.canvass_request_can_read(request_id))
  with check (public.canvass_can_write() and public.canvass_request_can_read(request_id));
create policy request_canvasses_delete on public.request_canvasses
  for delete to authenticated
  using (public.canvass_can_write() and public.canvass_request_can_read(request_id));

create policy request_canvass_suppliers_read on public.request_canvass_suppliers
  for select to authenticated using (public.canvass_can_read(canvass_id));
create policy request_canvass_suppliers_insert on public.request_canvass_suppliers
  for insert to authenticated
  with check (public.canvass_can_write() and public.canvass_can_read(canvass_id));
create policy request_canvass_suppliers_update on public.request_canvass_suppliers
  for update to authenticated
  using (public.canvass_can_write() and public.canvass_can_read(canvass_id))
  with check (public.canvass_can_write() and public.canvass_can_read(canvass_id));
create policy request_canvass_suppliers_delete on public.request_canvass_suppliers
  for delete to authenticated
  using (public.canvass_can_write() and public.canvass_can_read(canvass_id));

create policy request_canvass_supplier_prices_read on public.request_canvass_supplier_prices
  for select to authenticated using (public.canvass_supplier_can_read_money(supplier_id));
create policy request_canvass_supplier_prices_insert on public.request_canvass_supplier_prices
  for insert to authenticated
  with check (public.canvass_can_write() and public.canvass_supplier_can_read_money(supplier_id));
create policy request_canvass_supplier_prices_update on public.request_canvass_supplier_prices
  for update to authenticated
  using (public.canvass_can_write() and public.canvass_supplier_can_read_money(supplier_id))
  with check (public.canvass_can_write() and public.canvass_supplier_can_read_money(supplier_id));
create policy request_canvass_supplier_prices_delete on public.request_canvass_supplier_prices
  for delete to authenticated
  using (public.canvass_can_write() and public.canvass_supplier_can_read_money(supplier_id));

create policy request_canvass_quotes_read on public.request_canvass_quotes
  for select to authenticated using (public.canvass_can_read(canvass_id));
create policy request_canvass_quotes_insert on public.request_canvass_quotes
  for insert to authenticated
  with check (public.canvass_can_write() and public.canvass_can_read(canvass_id));
create policy request_canvass_quotes_update on public.request_canvass_quotes
  for update to authenticated
  using (public.canvass_can_write() and public.canvass_can_read(canvass_id))
  with check (public.canvass_can_write() and public.canvass_can_read(canvass_id));
create policy request_canvass_quotes_delete on public.request_canvass_quotes
  for delete to authenticated
  using (public.canvass_can_write() and public.canvass_can_read(canvass_id));

create policy request_canvass_quote_prices_read on public.request_canvass_quote_prices
  for select to authenticated using (public.canvass_quote_can_read_money(quote_id));
create policy request_canvass_quote_prices_insert on public.request_canvass_quote_prices
  for insert to authenticated
  with check (public.canvass_can_write() and public.canvass_quote_can_read_money(quote_id));
create policy request_canvass_quote_prices_update on public.request_canvass_quote_prices
  for update to authenticated
  using (public.canvass_can_write() and public.canvass_quote_can_read_money(quote_id))
  with check (public.canvass_can_write() and public.canvass_quote_can_read_money(quote_id));
create policy request_canvass_quote_prices_delete on public.request_canvass_quote_prices
  for delete to authenticated
  using (public.canvass_can_write() and public.canvass_quote_can_read_money(quote_id));

create policy request_canvass_winners_read on public.request_canvass_winners
  for select to authenticated using (public.canvass_item_can_read(item_id));
create policy request_canvass_winners_insert on public.request_canvass_winners
  for insert to authenticated
  with check (public.canvass_can_write() and public.canvass_item_can_read(item_id));
create policy request_canvass_winners_update on public.request_canvass_winners
  for update to authenticated
  using (public.canvass_can_write() and public.canvass_item_can_read(item_id))
  with check (public.canvass_can_write() and public.canvass_item_can_read(item_id));
create policy request_canvass_winners_delete on public.request_canvass_winners
  for delete to authenticated
  using (public.canvass_can_write() and public.canvass_item_can_read(item_id));

create policy request_canvass_no_other_supplier_read on public.request_canvass_no_other_supplier
  for select to authenticated using (public.canvass_can_read(canvass_id));
create policy request_canvass_no_other_supplier_insert on public.request_canvass_no_other_supplier
  for insert to authenticated
  with check (public.canvass_can_write() and public.canvass_can_read(canvass_id));
create policy request_canvass_no_other_supplier_update on public.request_canvass_no_other_supplier
  for update to authenticated
  using (public.canvass_can_write() and public.canvass_can_read(canvass_id))
  with check (public.canvass_can_write() and public.canvass_can_read(canvass_id));
create policy request_canvass_no_other_supplier_delete on public.request_canvass_no_other_supplier
  for delete to authenticated
  using (public.canvass_can_write() and public.canvass_can_read(canvass_id));

revoke all on public.request_canvasses from public, anon, authenticated;
revoke all on public.request_canvass_suppliers from public, anon, authenticated;
revoke all on public.request_canvass_supplier_prices from public, anon, authenticated;
revoke all on public.request_canvass_quotes from public, anon, authenticated;
revoke all on public.request_canvass_quote_prices from public, anon, authenticated;
revoke all on public.request_canvass_winners from public, anon, authenticated;
revoke all on public.request_canvass_no_other_supplier from public, anon, authenticated;

grant select, update, delete on public.request_canvasses to authenticated;
grant select, insert, update, delete on public.request_canvass_suppliers to authenticated;
grant select, insert, update, delete on public.request_canvass_supplier_prices to authenticated;
grant select, insert, update, delete on public.request_canvass_quotes to authenticated;
grant select, insert, update, delete on public.request_canvass_quote_prices to authenticated;
grant select, insert, update, delete on public.request_canvass_winners to authenticated;
grant select, insert, update, delete on public.request_canvass_no_other_supplier to authenticated;

grant execute on function public.canvass_can_write() to authenticated;
grant execute on function public.canvass_request_can_read(uuid) to authenticated;
grant execute on function public.canvass_request_can_read_money(uuid) to authenticated;
grant execute on function public.canvass_can_read(uuid) to authenticated;
grant execute on function public.canvass_can_read_money(uuid) to authenticated;
grant execute on function public.canvass_supplier_can_read_money(uuid) to authenticated;
grant execute on function public.canvass_quote_can_read_money(uuid) to authenticated;
grant execute on function public.canvass_item_can_read(uuid) to authenticated;

-- Writes with a number or a price row ---------------------------------------------------------------

-- Adds a supplier to a request's Canvass. The first supplier makes the Canvass and gives it its
-- number; reading never does. Two purchasers adding at once end up on the same Canvass.
create or replace function public.canvass_add_supplier(p_request_id uuid, p_supplier jsonb, p_price jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_canvass  public.request_canvasses;
  v_supplier public.request_canvass_suppliers;
  v_rate     numeric;
begin
  p_supplier := coalesce(p_supplier, '{}'::jsonb);
  p_price := coalesce(p_price, '{}'::jsonb);

  if public.get_employee_id() is null then
    raise exception 'canvass_add_supplier: sign in first' using errcode = '42501';
  end if;
  if not (public.canvass_can_write() and public.canvass_request_can_read(p_request_id)) then
    raise exception 'canvass_add_supplier: not allowed' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtext('canvass_request:' || p_request_id::text));

  select * into v_canvass from public.request_canvasses where request_id = p_request_id;
  if not found then
    insert into public.request_canvasses (request_id, number)
    values (p_request_id, 'pending')
    returning * into v_canvass;
  end if;

  insert into public.request_canvass_suppliers (
    canvass_id, supplier_name, odoo_supplier_id, currency, valid_until, lead_time, quality_note,
    sort_order, created_by
  ) values (
    v_canvass.id,
    nullif(btrim(coalesce(p_supplier ->> 'supplier_name', '')), ''),
    nullif(p_supplier ->> 'odoo_supplier_id', '')::integer,
    coalesce(nullif(p_supplier ->> 'currency', ''), 'PHP'),
    nullif(p_supplier ->> 'valid_until', '')::date,
    p_supplier ->> 'lead_time',
    p_supplier ->> 'quality_note',
    (select count(*)::integer from public.request_canvass_suppliers where canvass_id = v_canvass.id),
    public.get_employee_id()
  )
  returning * into v_supplier;

  -- The rate is money: written only for a caller who may read it, and always as a row, so a reader
  -- of money always has a row to read.
  if public.canvass_can_read_money(v_canvass.id) then
    v_rate := nullif(p_price ->> 'comparison_rate', '')::numeric;
    insert into public.request_canvass_supplier_prices (supplier_id, comparison_rate)
    values (v_supplier.id, v_rate);
  end if;

  return jsonb_build_object(
    'canvass_id', v_canvass.id,
    'number', v_canvass.number,
    'supplier', to_jsonb(v_supplier)
  );
end
$$;

-- Saves one supplier's answer on one line (the quote and its price row together, so a failure
-- leaves neither). Only the keys present are written; a quote not there yet is made.
create or replace function public.canvass_save_quote(p_supplier_id uuid, p_item_id uuid, p_quote jsonb, p_price jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_canvass uuid;
  v_quote   public.request_canvass_quotes;
begin
  p_quote := coalesce(p_quote, '{}'::jsonb);
  p_price := coalesce(p_price, '{}'::jsonb);

  select s.canvass_id into v_canvass from public.request_canvass_suppliers s where s.id = p_supplier_id;
  if v_canvass is null then
    raise exception 'canvass_save_quote: that supplier is not on a Canvass you can see' using errcode = 'P0002';
  end if;

  insert into public.request_canvass_quotes (
    canvass_id, supplier_id, item_id, brand, description, source_link, brochure, remarks, created_by
  ) values (
    v_canvass, p_supplier_id, p_item_id,
    p_quote ->> 'brand',
    p_quote ->> 'description',
    p_quote ->> 'source_link',
    case when jsonb_typeof(p_quote -> 'brochure') = 'array' then p_quote -> 'brochure' else '[]'::jsonb end,
    p_quote ->> 'remarks',
    public.get_employee_id()
  )
  on conflict (supplier_id, item_id) do update set
    brand       = case when p_quote ? 'brand' then excluded.brand else request_canvass_quotes.brand end,
    description = case when p_quote ? 'description' then excluded.description else request_canvass_quotes.description end,
    source_link = case when p_quote ? 'source_link' then excluded.source_link else request_canvass_quotes.source_link end,
    brochure    = case when p_quote ? 'brochure' then excluded.brochure else request_canvass_quotes.brochure end,
    remarks     = case when p_quote ? 'remarks' then excluded.remarks else request_canvass_quotes.remarks end
  returning * into v_quote;

  insert into public.request_canvass_quote_prices (quote_id, unit_price)
  values (v_quote.id, nullif(p_price ->> 'unit_price', '')::numeric)
  on conflict (quote_id) do update set
    unit_price = case when p_price ? 'unit_price' then excluded.unit_price else request_canvass_quote_prices.unit_price end;

  return to_jsonb(v_quote);
end
$$;

-- One row per Canvass the caller may read, newest first, for the Canvasses page. Names and counts
-- only, no money.
create or replace function public.canvass_list()
returns table (
  id uuid,
  number text,
  request_id uuid,
  request_label text,
  opportunity_id uuid,
  sales_reference text,
  project_title text,
  canvasser_id uuid,
  canvasser_name text,
  supplier_count integer,
  line_count integer,
  quoted_line_count integer,
  winner_count integer,
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
         req.id,
         public._purchase_request_label(req.id),
         opp.id,
         opp.sales_reference,
         opp.project_title,
         coalesce(c.canvasser_id, req.buyer_id),
         canvasser.name,
         (select count(*)::integer from public.request_canvass_suppliers s where s.canvass_id = c.id),
         (select count(*)::integer from public.purchase_request_items i where i.request_id = req.id and i.status <> 'cancelled'),
         (select count(distinct q.item_id)::integer from public.request_canvass_quotes q where q.canvass_id = c.id),
         (select count(*)::integer from public.request_canvass_winners w
            join public.purchase_request_items i on i.id = w.item_id where i.request_id = req.id),
         c.created_by,
         c.created_at,
         c.updated_at
    from public.request_canvasses c
    join public.purchase_requests req on req.id = c.request_id
    left join public.sales_opportunities opp on opp.id = req.opportunity_id
    left join public.employees canvasser on canvasser.id = coalesce(c.canvasser_id, req.buyer_id)
   where public.canvass_can_read(c.id)
   order by c.created_at desc, c.id
$$;

grant execute on function public.canvass_add_supplier(uuid, jsonb, jsonb) to authenticated;
grant execute on function public.canvass_save_quote(uuid, uuid, jsonb, jsonb) to authenticated;
grant execute on function public.canvass_list() to authenticated;

-- Who may see a Requested Item's price (the policy dropped above): the money gate of its request.
create policy purchase_request_item_prices_read on public.purchase_request_item_prices
  for select to authenticated
  using (public.canvass_request_can_read_money((select i.request_id from public.purchase_request_items i where i.id = item_id)));

-- ---------------------------------------------------------------------------------------------
-- 4. What read the old tables, repointed
-- ---------------------------------------------------------------------------------------------

-- costing_accept_brand: the winner's brand now comes from the winning quote on the request line
-- that names the Component.
create or replace function public.costing_accept_brand(p_component_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_opp   uuid;
  v_brand text;
begin
  if public.get_employee_id() is null then
    raise exception 'costing_accept_brand: sign in first' using errcode = '42501';
  end if;

  v_opp := public.canvass_component_opportunity(p_component_id);
  if v_opp is null then
    raise exception 'costing_accept_brand: not found' using errcode = '22023';
  end if;
  if not (public.costing_can_read(v_opp)
          and (public.costing_in_band(v_opp, 'sales') or public.costing_in_band(v_opp, 'purchasing'))) then
    raise exception 'costing_accept_brand: only the Deal Team or Purchasing can accept a brand' using errcode = '42501';
  end if;

  select nullif(btrim(coalesce(q.brand, '')), '') into v_brand
    from public.purchase_request_items i
    join public.request_canvass_winners w on w.item_id = i.id
    join public.request_canvass_quotes q on q.supplier_id = w.supplier_id and q.item_id = w.item_id
   where i.component_id = p_component_id
   order by w.chosen_at desc
   limit 1;
  if v_brand is null then
    raise exception 'costing_accept_brand: the Canvass has no winning brand' using errcode = '22023';
  end if;

  -- As the caller, so the Sales band trigger judges the write too.
  update public.costing_components set brand = v_brand where id = p_component_id;

  return jsonb_build_object('brand', v_brand);
end;
$function$;

-- costing_set_p0_price: a foreign P0 is turned into pesos at the winning supplier's rate, when the
-- winner quotes in the same currency.
create or replace function public.costing_set_p0_price(p_actor_email text, p_item_id uuid, p_price numeric, p_currency text)
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_actor uuid;
  v_component uuid;
  v_currency text := nullif(upper(btrim(p_currency)), '');
  v_rate numeric;
begin
  if p_actor_email is null or btrim(p_actor_email) = '' then
    raise exception 'costing_set_p0_price: not signed in' using errcode = '42501';
  end if;
  if p_price is not null and p_price < 0 then
    raise exception 'costing_set_p0_price: a price cannot be negative' using errcode = '22023';
  end if;

  perform set_config('request.jwt.claims',
    jsonb_build_object('email', p_actor_email, 'role', 'authenticated')::text, true);
  v_actor := public.get_employee_id();
  if v_actor is null then
    raise exception 'costing_set_p0_price: not signed in' using errcode = '42501';
  end if;

  select component_id into v_component from public.purchase_request_items where id = p_item_id;
  if v_component is null then
    return;
  end if;
  if coalesce(public.purchase_request_actor_side((select request_id from public.purchase_request_items where id = p_item_id)), '') <> 'purchasing' then
    raise exception 'costing_set_p0_price: only Purchasing sets the actual cost' using errcode = '42501';
  end if;

  -- A foreign P0 is turned into pesos at the Canvass winner's rate, when the winner is in the same currency.
  if v_currency is distinct from 'PHP' then
    select sp.comparison_rate into v_rate
      from public.purchase_request_items i
      join public.request_canvass_winners w on w.item_id = i.id
      join public.request_canvass_suppliers s on s.id = w.supplier_id
      join public.request_canvass_supplier_prices sp on sp.supplier_id = s.id
     where i.component_id = v_component and s.currency = v_currency
     order by w.chosen_at desc
     limit 1;
  end if;

  update public.costing_component_costs
     set p0_unit_price = case
           when p_price is null then null
           when v_currency = 'PHP' then p_price
           when v_rate is not null then round(p_price * v_rate, 2)
         end,
         p0_quoted_unit_price = p_price,
         p0_currency = v_currency
   where component_id = v_component;
end;
$function$;

-- costing_tender_line_removal_guard: a line whose products have been quoted can't be removed.
create or replace function public.costing_tender_line_removal_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
begin
  if auth.uid() is null or coalesce(auth.role(), '') = 'service_role'
     or coalesce(current_setting('costing.bypass', true), '') = 'on' then
    return old;
  end if;
  -- The matrix is going (an SOR cascade): nothing left to protect.
  if not exists (select 1 from public.costing_matrices m where m.id = old.matrix_id) then
    return old;
  end if;

  if exists (
    select 1
      from public.request_canvass_quotes q
     where q.item_id in (
             select i.id
               from public.purchase_request_items i
              where i.component_id in (select c.id from public.costing_components c where c.tender_line_id = old.id)
                 or (old.sor_item_id is not null and i.sor_item_id = old.sor_item_id))
  ) then
    raise exception 'costing_line: a line with a Canvass can''t be removed' using errcode = '22023';
  end if;

  if exists (
    select 1
      from public.purchase_request_items i
     where nullif(btrim(i.po_number), '') is not null
       and (i.component_id in (select c.id from public.costing_components c where c.tender_line_id = old.id)
            or (old.sor_item_id is not null and i.sor_item_id = old.sor_item_id))
  ) or exists (
    select 1
      from public.costing_components c
     where c.tender_line_id = old.id and nullif(btrim(c.po_rfq_no), '') is not null
  ) then
    raise exception 'costing_line: a line with a P0 can''t be removed' using errcode = '22023';
  end if;

  return old;
end;
$function$;

-- purchasing_dashboard_rows
CREATE OR REPLACE FUNCTION public.purchasing_dashboard_rows()
 RETURNS TABLE(opportunity_id uuid, sales_reference text, project_title text, grp text, target_kind text, target_id uuid, target_label text, item_count integer, no_canvass_count integer, buyer_id uuid, canvasser_id uuid, since timestamp with time zone, request_id uuid, delivery_note text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with gate as (
    select (
      coalesce(public.has_purchasing_access(), false)
      or coalesce(public.has_finance_access(), false)
      or coalesce(public.is_super_admin(), false)
    ) as ok
  ),
  sors as (
    select o.id, o.sales_reference, o.project_title
      from public.sales_opportunities o, gate
     where gate.ok and not o.is_deleted and not o.is_scratch
  ),
  items as (
    select i.*, r.opportunity_id, r.buyer_id, r.title as request_title,
           coalesce(c.purchasing_incharge_id, cm.purchasing_incharge_id, r.buyer_id) as canvasser_id,
           case when nullif(btrim(i.po_number), '') is not null then public._lc_ipas_for_po(i.po_number) end as ipas_id
      from public.purchase_request_items i
      join public.purchase_requests r on r.id = i.request_id
      cross join gate
      left join public.costing_components c on c.id = i.component_id
      left join public.costing_tender_lines ct on ct.id = c.tender_line_id
      left join public.costing_matrices cm on cm.id = ct.matrix_id
     where gate.ok
       and (r.opportunity_id is null or r.opportunity_id in (select id from sors))
  ),
  matrices as (
    select m.id, m.opportunity_id, m.created_at, m.purchasing_incharge_id, d.verdict, d.decided_at
      from public.costing_matrices m
      join sors s on s.id = m.opportunity_id
      left join lateral (
        select bd.verdict, bd.decided_at from public.costing_bid_decisions bd
         where bd.matrix_id = m.id and bd.cleared_at is null
         order by bd.decided_at desc limit 1
      ) d on true
  ),
  comps as (
    select c.id, c.name, c.created_at, nullif(btrim(c.po_rfq_no), '') as po_rfq_no,
           coalesce(c.purchasing_incharge_id, m.purchasing_incharge_id) as purchasing_incharge_id,
           m.id as matrix_id, m.opportunity_id, m.verdict, m.decided_at,
           cc.acquire_unit,
           (nullif(btrim(c.po_rfq_no), '') is not null
             or exists (select 1 from public.purchase_request_items pi where pi.component_id = c.id and pi.status in ('purchased', 'received'))) as is_ordered
      from public.costing_components c
      join public.costing_tender_lines t on t.id = c.tender_line_id
      join matrices m on m.id = t.matrix_id
      left join public.costing_component_costs cc on cc.component_id = c.id
  ),
  -- A line has a Canvass when a supplier has quoted it (#967: one Canvass per request).
  has_canvass as (
    select i.id as item_id
      from items i
     where exists (select 1 from public.request_canvass_quotes q where q.item_id = i.id)
  ),
  r as (
  -- Not checked: nobody has looked yet. One row per Purchase Request.
  select i.opportunity_id, 'not_checked'::text as grp, 'purchase_request'::text as target_kind, i.request_id as target_id,
         max(i.request_title) as target_label, count(*)::int as item_count, 0 as no_canvass_count,
         max(i.buyer_id::text)::uuid as buyer_id, max(i.canvasser_id::text)::uuid as canvasser_id, min(i.created_at) as since, i.request_id as request_id,
         null::text as delivery_note
    from items i
   where i.status = 'not_checked'
   group by i.opportunity_id, i.request_id
  union all
  -- Still canvassing: lines whose Canvass is open, one row per Purchase Request
  select i.opportunity_id, 'still_canvassing', 'purchase_request', i.request_id,
         max(i.request_title), count(*)::int, 0,
         max(i.buyer_id::text)::uuid, max(i.canvasser_id::text)::uuid, min(coalesce(i.status_changed_at, i.created_at)), i.request_id,
         null::text
    from items i
   where i.status = 'still_canvassing'
   group by i.opportunity_id, i.request_id
  union all
  -- Still canvassing: Components with no Acquire yet, plus the matrix when it still needs a Bid Decision
  select m.opportunity_id, 'still_canvassing', 'costing_matrix', m.opportunity_id, null,
         (select count(*) from comps c where c.matrix_id = m.id and c.acquire_unit is null)::int,
         0, null, m.purchasing_incharge_id, m.created_at, null,
         null::text
    from matrices m
   where coalesce(m.verdict, '') <> 'no_go'
     and ((m.verdict is null or m.verdict = 'revise')
          or exists (select 1 from comps c where c.matrix_id = m.id and c.acquire_unit is null))
  union all
  -- To purchase: lines that need buying and have no confirmed P0 yet. One row per Purchase Request.
  select i.opportunity_id, 'to_purchase', 'purchase_request', i.request_id,
         max(i.request_title), count(*)::int, 0,
         max(i.buyer_id::text)::uuid, max(i.canvasser_id::text)::uuid, min(coalesce(i.status_changed_at, i.created_at)), i.request_id,
         null::text
    from items i
   where i.status = 'to_purchase'
   group by i.opportunity_id, i.request_id
  union all
  -- Purchased (not received): confirmed on a P0, not all here yet. One row per IPAS when the
  -- P0 has one, else per Purchase Request. The delivery note says how much arrived, or when.
  select i.opportunity_id, 'purchased',
         case when i.ipas_id is not null then 'ipas' else 'purchase_request' end,
         coalesce(i.ipas_id, i.request_id),
         coalesce((select ip.number from public.ipas ip where ip.id = i.ipas_id), max(i.request_title)),
         count(*)::int,
         count(*) filter (where i.id not in (select item_id from has_canvass))::int,
         max(i.buyer_id::text)::uuid, max(i.canvasser_id::text)::uuid, min(coalesce(i.status_changed_at, i.created_at)),
         max(i.request_id::text)::uuid,
         case
           when count(*) = 1 then
             case
               when coalesce(max(i.po_received), 0) > 0 and coalesce(max(i.po_received), 0) < coalesce(max(i.po_ordered), 0)
                 then trim_scale(max(i.po_received))::text || ' of ' || trim_scale(max(i.po_ordered))::text || ' received'
               when max(i.po_eta) is not null then 'Not received yet · ETA ' || to_char(max(i.po_eta), 'Mon FMDD')
               else 'Not received yet · no ETA set'
             end
           else concat_ws(' · ',
             case when count(*) filter (where coalesce(i.po_received, 0) = 0) > 0
                  then (count(*) filter (where coalesce(i.po_received, 0) = 0))::text || ' not received yet' end,
             case when count(*) filter (where coalesce(i.po_received, 0) > 0) > 0
                  then (count(*) filter (where coalesce(i.po_received, 0) > 0))::text || ' part received' end,
             case when min(i.po_eta) filter (where coalesce(i.po_received, 0) = 0) is not null
                  then 'ETA ' || to_char(min(i.po_eta) filter (where coalesce(i.po_received, 0) = 0), 'Mon FMDD') end)
         end
    from items i
   where i.status = 'purchased'
   group by i.opportunity_id, i.ipas_id, coalesce(i.ipas_id, i.request_id)
  )
  -- The SOR's name is filled once here rather than in each branch above.
  select r.opportunity_id, s.sales_reference, coalesce(s.project_title, case when r.opportunity_id is null then 'Direct request' end), r.grp, r.target_kind, r.target_id, r.target_label,
         r.item_count, r.no_canvass_count, r.buyer_id, r.canvasser_id, r.since, r.request_id, r.delivery_note
    from r left join sors s on s.id = r.opportunity_id
   -- A matrix row with no count is kept on purpose: it is the pending Bid Decision, shown as its own move.
   where r.item_count > 0 or r.target_kind = 'costing_matrix'
$function$;

-- purchase_request_answer_yours
CREATE OR REPLACE FUNCTION public.purchase_request_answer_yours(p_item_id uuid, p_same boolean)
 RETURNS purchase_request_items
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_actor uuid := public.get_employee_id();
  v_s0 public.purchase_request_items;
  v_other public.purchase_request_items;
  v_po text;
begin
  if v_actor is null then
    raise exception 'purchase_request_answer_yours: not signed in' using errcode = '42501';
  end if;
  if p_same is null then
    raise exception 'purchase_request_answer_yours: answer yes or no' using errcode = '22023';
  end if;

  select * into v_s0 from public.purchase_request_items where id = p_item_id for update;
  if v_s0.id is null then
    raise exception 'purchase_request_answer_yours: item % not found', p_item_id using errcode = 'P0002';
  end if;
  if coalesce(public.purchase_request_actor_side(v_s0.request_id), '') not in ('purchasing', 'sales') then
    raise exception 'purchase_request_answer_yours: only Purchasing or the sales side answers this' using errcode = '42501';
  end if;
  if not v_s0.new_on_s0 then
    raise exception 'purchase_request_answer_yours: % has no open question', v_s0.name using errcode = '22023';
  end if;

  if not p_same then
    update public.purchase_request_items
       set new_on_s0 = false, yours_item_id = null
     where id = v_s0.id
    returning * into v_s0;
    return v_s0;
  end if;

  select * into v_other from public.purchase_request_items where id = v_s0.yours_item_id for update;
  if v_other.id is null or v_other.status = 'cancelled' or v_other.po_number is null then
    raise exception 'purchase_request_answer_yours: the request this was compared with has changed; answer No, or refresh' using errcode = '22023';
  end if;
  if v_s0.po_number is not null then
    raise exception 'purchase_request_answer_yours: % already has a P0', v_s0.name using errcode = '22023';
  end if;
  v_po := v_other.po_number;

  -- The Other request lets go of the P0 first (a P0 sits on one line).
  update public.purchase_request_items
     set status = 'cancelled',
         status_changed_by = v_actor,
         status_changed_at = now(),
         po_number = null,
         po_verification = 'UNVERIFIED',
         po_state = null,
         po_ordered = null,
         po_received = null,
         bought_as = null,
         bought_product_id = null,
         odoo_po_line_ids = '{}',
         closed_note = format('Closed · %s and its delivery moved onto %s', v_po, v_s0.name)
   where id = v_other.id;

  update public.purchase_request_items
     set status = v_other.status,
         status_changed_by = v_actor,
         status_changed_at = now(),
         po_number = v_other.po_number,
         po_verification = v_other.po_verification,
         po_state = v_other.po_state,
         po_ordered = v_other.po_ordered,
         po_received = v_other.po_received,
         bought_as = v_other.bought_as,
         bought_product_id = v_other.bought_product_id,
         odoo_po_line_ids = v_other.odoo_po_line_ids,
         new_on_s0 = false,
         yours_item_id = null
   where id = v_s0.id
  returning * into v_s0;

  -- History, Canvass, price and the links other items hold follow the P0 onto the S0 line.
  update public.purchase_request_messages
     set metadata = metadata || jsonb_build_object('item_id', v_s0.id)
   where request_id = v_s0.request_id and metadata->>'item_id' = v_other.id::text;

  -- (#967) The quotes follow when both lines are on one request's Canvass; a Canvass belongs to
  -- one request, so a quote never moves across requests.
  if v_other.request_id = v_s0.request_id
     and not exists (select 1 from public.request_canvass_quotes q where q.item_id = v_s0.id) then
    update public.request_canvass_quotes set item_id = v_s0.id where item_id = v_other.id;
  end if;

  update public.purchase_request_item_prices set item_id = v_s0.id
   where item_id = v_other.id
     and not exists (select 1 from public.purchase_request_item_prices p where p.item_id = v_s0.id);

  update public.purchase_request_items set substitute_for_item_id = v_s0.id
   where substitute_for_item_id = v_other.id and id <> v_s0.id;

  perform public._purchase_request_post_event(
    v_s0.request_id,
    v_actor,
    format('%s: same product as the request for %s. %s and its delivery moved onto the S0 line; the request is closed.', v_s0.name, v_other.name, v_po),
    jsonb_build_object(
      'event', 'item_yours_merged',
      'item_id', v_s0.id,
      'closed_item_id', v_other.id,
      'po_number', v_po
    )
  );

  return v_s0;
end;
$function$;

-- purchase_request_replace_item
CREATE OR REPLACE FUNCTION public.purchase_request_replace_item(p_item_id uuid, p_name text, p_reason text, p_odoo_product_id integer DEFAULT NULL::integer)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_actor    uuid := public.get_employee_id();
  v_name     text := nullif(btrim(p_name), '');
  v_reason   text := nullif(btrim(p_reason), '');
  v_old      public.purchase_request_items;
  v_new      public.purchase_request_items;
  v_still    boolean;
  v_amount   text;
  v_stopped  integer := 0;
begin
  if v_actor is null then
    raise exception 'purchase_request_replace_item: not signed in' using errcode = '42501';
  end if;

  select * into v_old from public.purchase_request_items where id = p_item_id for update;
  if v_old.id is null then
    raise exception 'purchase_request_replace_item: item % not found', p_item_id using errcode = 'P0002';
  end if;

  if public.purchase_request_actor_side(v_old.request_id) is distinct from 'purchasing' then
    raise exception 'purchase_request_replace_item: only Purchasing can replace a product' using errcode = '42501';
  end if;
  if v_old.status in ('cancelled', 'received') then
    raise exception 'purchase_request_replace_item: % is already %, so it can''t be replaced',
      v_old.name, public._purchase_request_item_status_label(v_old.status) using errcode = '22023';
  end if;
  if v_name is null then
    raise exception 'purchase_request_replace_item: say which product replaces it' using errcode = '22023';
  end if;
  if v_reason is null then
    raise exception 'purchase_request_replace_item: give a short reason for the replacement' using errcode = '22023';
  end if;

  -- B: its own line in Other requests, same quantity, Not checked.
  insert into public.purchase_request_items
    (request_id, source, odoo_product_id, name, unit, quantity, substitute_for_item_id, requested_by)
  values
    (v_old.request_id, 'new', p_odoo_product_id, v_name, v_old.unit, v_old.quantity, v_old.id, v_actor)
  returning * into v_new;

  v_still := v_old.sor_item_id is not null and not v_old.removed_from_s0;

  -- A: Cancelled, with the reason.
  update public.purchase_request_items
     set status = 'cancelled',
         status_changed_by = v_actor,
         status_changed_at = now(),
         replaced_reason = v_reason,
         s0_still_lists = v_still
   where id = v_old.id
  returning * into v_old;

  -- (#967) A's quotes stay on the request's Canvass as the record; there is no per-line Canvass to stop.

  v_amount := trim_scale(v_new.quantity)::text || coalesce(' ' || v_new.unit, '');
  perform public._purchase_request_post_event(
    v_old.request_id,
    v_actor,
    format('%s replaced by %s × %s — %s.', v_old.name, v_new.name, v_amount, v_reason),
    jsonb_build_object(
      'event', 'item_replaced',
      'item_id', v_old.id,
      'replacement_item_id', v_new.id,
      'reason', v_reason,
      'canvass_stopped', v_stopped > 0,
      's0_still_lists', v_still
    )
  );
  if v_still then
    perform public._purchase_request_post_event(
      v_old.request_id,
      v_actor,
      format('S0 still lists %s. Sales to update the S0.', v_old.name),
      jsonb_build_object('event', 's0_still_lists', 'item_id', v_old.id, 'replacement_item_id', v_new.id)
    );
  end if;

  return v_new.id;
end;
$function$;

-- purchase_request_undo_item_status
CREATE OR REPLACE FUNCTION public.purchase_request_undo_item_status(p_item_id uuid, p_changed_at timestamp with time zone)
 RETURNS purchase_request_items
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_actor uuid := public.get_employee_id();
  v_item public.purchase_request_items;
  v_event public.purchase_request_messages;
  v_from text;
  v_to text;
  v_side text;
  v_prev_by uuid;
  v_prev_at timestamptz;
  v_label text;
  v_content text;
  v_read uuid[];
  v_prefix text;
  v_m record;
  v_pos int;
  v_parts jsonb;
begin
  if v_actor is null then
    raise exception 'purchase_request_undo_item_status: not signed in' using errcode = '42501';
  end if;

  select * into v_item from public.purchase_request_items where id = p_item_id for update;
  if v_item.id is null then
    raise exception 'purchase_request_undo_item_status: item % not found', p_item_id using errcode = 'P0002';
  end if;

  if p_changed_at is null or v_item.status_changed_at is distinct from p_changed_at then
    raise exception 'purchase_request_undo_item_status: % has changed since, so there is nothing to undo', v_item.name
      using errcode = '22023';
  end if;
  if v_item.status_changed_by is distinct from v_actor then
    raise exception 'purchase_request_undo_item_status: only whoever made the change can undo it' using errcode = '42501';
  end if;
  if now() - v_item.status_changed_at > interval '15 seconds' then
    raise exception 'purchase_request_undo_item_status: it''s too late to undo that change' using errcode = '22023';
  end if;

  select * into v_event
  from public.purchase_request_messages m
  where m.request_id = v_item.request_id
    and m.metadata->>'event' = 'item_status_changed'
    and m.metadata->>'item_id' = v_item.id::text
    and (m.metadata->>'changed_at')::timestamptz = v_item.status_changed_at
  order by m.created_at desc
  limit 1;
  if v_event.id is null then
    raise exception 'purchase_request_undo_item_status: % has no change to undo', v_item.name using errcode = '22023';
  end if;

  v_from := v_event.metadata->>'from';
  v_to := v_event.metadata->>'to';
  if v_to is distinct from v_item.status then
    raise exception 'purchase_request_undo_item_status: % has changed since, so there is nothing to undo', v_item.name
      using errcode = '22023';
  end if;

  -- Only someone who may still make the change may take it back.
  v_side := public.purchase_request_actor_side(v_item.request_id);
  if v_side is null or not public._purchase_request_item_transition_ok(v_from, v_to, v_side) then
    raise exception 'purchase_request_undo_item_status: you can no longer change this item' using errcode = '42501';
  end if;

  if v_to = 'still_canvassing' and exists (
    select 1 from public.request_canvass_quotes q where q.item_id = v_item.id
  ) then
    raise exception 'purchase_request_undo_item_status: % has a Canvass, so it stays Still canvassing', v_item.name
      using errcode = '22023';
  end if;

  -- Who moved the item to the status it goes back to, and when: the latest
  -- change into it that wasn't itself undone.
  select (m.metadata->>'changed_by')::uuid, (m.metadata->>'changed_at')::timestamptz
    into v_prev_by, v_prev_at
  from public.purchase_request_messages m
  where m.request_id = v_item.request_id
    and m.metadata->>'event' = 'item_status_changed'
    and m.metadata->>'item_id' = v_item.id::text
    and m.metadata->>'to' = v_from
    and m.created_at <= v_event.created_at
    and m.id <> v_event.id
    and not exists (
      select 1 from public.purchase_request_messages u
      where u.request_id = m.request_id
        and u.metadata->>'event' = 'item_status_undone'
        and u.metadata->>'item_id' = m.metadata->>'item_id'
        and u.metadata->>'undone_changed_at' = m.metadata->>'changed_at'
    )
  order by m.created_at desc
  limit 1;

  update public.purchase_request_items
     set status = v_from,
         status_changed_by = v_prev_by,
         status_changed_at = v_prev_at,
         po_number = case when v_to = 'purchased' then null else po_number end,
         po_verification = case when v_to = 'purchased' then 'UNVERIFIED' else po_verification end,
         odoo_po_line_ids = case when v_to = 'purchased' then '{}'::int4[] else odoo_po_line_ids end
   where id = v_item.id
  returning * into v_item;

  v_content := format('%s: %s → %s (undone).', v_item.name,
    public._purchase_request_item_status_label(v_to),
    public._purchase_request_item_status_label(v_from));

  perform public._purchase_request_post_event(
    v_item.request_id,
    v_actor,
    v_content,
    jsonb_build_object(
      'event', 'item_status_undone',
      'item_id', v_item.id,
      'from', v_to,
      'to', v_from,
      'undone_changed_at', v_event.metadata->'changed_at',
      'changed_by', v_actor
    )
  );

  -- The change's notifications: take its part out of each unread one (withdrawing
  -- a row left with none), and tell whoever already read theirs.
  v_label := public._purchase_request_label(v_item.request_id);
  v_prefix := v_label || ': ';
  v_read := '{}';
  for v_m in
    select n.id, n.recipient_id, coalesce(n.is_read, false) as is_read, n.parts
    from public.notifications n
    where n.type = 'PURCHASE_REQUEST_ITEM_STATUS'
      and n.reference_id = v_item.request_id::text
      and n.parts is not null
      and exists (select 1 from jsonb_array_elements(n.parts) x where x->>'content' = v_event.content)
    for update
  loop
    if v_m.is_read then
      v_read := array_append(v_read, v_m.recipient_id);
      continue;
    end if;
    select t.i into v_pos
    from jsonb_array_elements(v_m.parts) with ordinality as t(x, i)
    where t.x->>'content' = v_event.content
    order by t.i desc
    limit 1;
    v_parts := v_m.parts - (v_pos - 1)::int;
    if jsonb_array_length(v_parts) = 0 then
      delete from public.notifications where id = v_m.id;
    else
      update public.notifications
         set parts = v_parts,
             message = public._purchase_request_status_parts_message(v_prefix, v_parts),
             title = case when jsonb_array_length(v_parts) = 1 then 'Requested Item updated' else title end
       where id = v_m.id;
    end if;
  end loop;

  -- A notification written before notifications.parts: its single-change message, as before.
  with sent as (
    select n.id, n.recipient_id, coalesce(n.is_read, false) as is_read
    from public.notifications n
    where n.type = 'PURCHASE_REQUEST_ITEM_STATUS'
      and n.reference_id = v_item.request_id::text
      and n.sender_id = v_actor
      and n.parts is null
      and n.message = left(v_prefix || v_event.content, 280)
  ),
  withdrawn as (
    delete from public.notifications n
    using sent
    where n.id = sent.id and not sent.is_read
    returning n.id
  )
  select v_read || coalesce(array_agg(distinct sent.recipient_id) filter (where sent.is_read), '{}')
    into v_read
  from sent;

  perform public._purchase_request_notify(
    v_item.request_id, v_read, v_actor,
    'PURCHASE_REQUEST_ITEM_STATUS',
    'Requested Item change undone',
    v_label || ': ' || v_content
  );

  return v_item;
end;
$function$;
