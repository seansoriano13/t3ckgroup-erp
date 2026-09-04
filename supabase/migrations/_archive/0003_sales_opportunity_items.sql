-- ============================================================================
-- Sales Opportunity Items — the product/service line items behind an
-- opportunity's Expected Value, so a quotation can be built directly from
-- what was registered instead of retyping it elsewhere.
--
-- Expected Value on sales_opportunities is no longer entered directly. Once
-- this migration runs, it is maintained by a trigger as the sum of these
-- line items (quantity × unit price). An opportunity with no items yet shows
-- ₱0.00, matching the column's existing default.
--
-- Run this once in the Supabase SQL editor, after 0001 and 0002.
-- ============================================================================

create table if not exists public.sales_opportunity_items (
  id              uuid primary key default gen_random_uuid(),
  opportunity_id  uuid not null references public.sales_opportunities(id) on delete cascade,
  product_name    text not null,
  unit            text,
  quantity        numeric(12,2) not null default 1,
  unit_price      numeric(18,2) not null default 0,
  sort_order      int not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists sales_opportunity_items_opp_idx
  on public.sales_opportunity_items (opportunity_id, sort_order);

create or replace function public.sales_opportunity_items_touch()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists trg_sales_opportunity_items_touch on public.sales_opportunity_items;
create trigger trg_sales_opportunity_items_touch
  before update on public.sales_opportunity_items
  for each row execute function public.sales_opportunity_items_touch();

-- ── Keep sales_opportunities.expected_value in sync ─────────────────────────
-- SECURITY DEFINER: this recomputation is a derived, system-maintained value,
-- not a user edit — it must succeed regardless of whether the caller's role
-- individually passes the parent table's UPDATE policy (e.g. a Support Sales
-- participant editing items should not need standalone UPDATE rights on the
-- parent row just because the trigger writes to it).
create or replace function public.sor_recalc_expected_value()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  target_id uuid := coalesce(new.opportunity_id, old.opportunity_id);
begin
  update public.sales_opportunities
  set expected_value = coalesce((
    select sum(quantity * unit_price)
    from public.sales_opportunity_items
    where opportunity_id = target_id
  ), 0)
  where id = target_id;
  return null; -- AFTER trigger; return value is ignored
end $$;

drop trigger if exists trg_sor_items_recalc on public.sales_opportunity_items;
create trigger trg_sor_items_recalc
  after insert or update or delete on public.sales_opportunity_items
  for each row execute function public.sor_recalc_expected_value();

-- ── RLS ──────────────────────────────────────────────────────────────────
-- Assumes 0002 has been run (public.get_employee_id() must exist — it does,
-- independent of 0002, since it predates this project; 0002 only depends on
-- it for the parent table's policies). Read is org-wide, matching the parent
-- opportunity's visibility. Write is limited to whoever can already edit the
-- parent: the registrant, any listed participant, or a head/super admin.
create or replace function public.sor_can_edit_opportunity(p_opportunity_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.sales_opportunities o
    where o.id = p_opportunity_id
      and (
        o.registered_by = public.get_employee_id()
        or o.deal_owner_id = public.get_employee_id()
        or o.support_sales_1_id = public.get_employee_id()
        or o.support_sales_2_id = public.get_employee_id()
        or o.sales_director_id = public.get_employee_id()
        or exists (
          select 1 from public.employees e
          where e.id = public.get_employee_id()
            and (e.is_head or e.is_super_admin)
        )
      )
  )
$$;

alter table public.sales_opportunity_items enable row level security;

drop policy if exists sor_items_read on public.sales_opportunity_items;
create policy sor_items_read on public.sales_opportunity_items
  for select to authenticated using (true);

drop policy if exists sor_items_insert on public.sales_opportunity_items;
create policy sor_items_insert on public.sales_opportunity_items
  for insert to authenticated
  with check (public.sor_can_edit_opportunity(opportunity_id));

drop policy if exists sor_items_update on public.sales_opportunity_items;
create policy sor_items_update on public.sales_opportunity_items
  for update to authenticated
  using (public.sor_can_edit_opportunity(opportunity_id));

drop policy if exists sor_items_delete on public.sales_opportunity_items;
create policy sor_items_delete on public.sales_opportunity_items
  for delete to authenticated
  using (public.sor_can_edit_opportunity(opportunity_id));

-- Items are real deletes, not soft-deletes — editing a draft product list is
-- a normal edit, not something that needs the audit trail the parent
-- opportunity's registration_date/opportunity_no carry.
