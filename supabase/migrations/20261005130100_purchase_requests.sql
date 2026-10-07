-- ==============================================================================
-- 20261005130100_purchase_requests.sql
--
-- Issue #303 (part of #209) — the Purchase Request's four tables and who may
-- read them. Nothing here opens a request, adds an item or moves a status:
-- those writes arrive as RPCs with their own tickets (#304 open, #305 items,
-- #306 status, #307 chat and Buyer). Until then the tables have read policies
-- and one insert policy (a member posting a chat message), and nothing else.
--
-- ONE REQUEST PER SOR
-- `purchase_requests.opportunity_id` is unique but nullable: a request not
-- tied to an SOR (#179, deferred) can reuse the table later. Deleting the SOR
-- takes its request with it, and the request takes its members, items and
-- messages.
--
-- WHO READS
-- A member of the request, or a Super Admin. Anyone with Purchasing access
-- (`employees.has_purchasing_flow`) also reads a request with no Buyer yet,
-- so the Procurement Queue can offer Take; once there is a Buyer, a purchaser
-- who isn't a member stops seeing it. The same rule covers the request's
-- members, items and messages.
--
-- MESSAGES ARE APPEND-ONLY
-- A member posts as themselves; nobody, the author included, may edit or
-- delete a message. There is no update or delete policy on purpose. A message
-- carrying an `event` in its metadata (a status change, a member added) is
-- posted by the RPC that made the change, never by hand.
--
-- ITEM STATUS
-- The nine values mirror `ITEM_STATUSES` in src/constants/purchaseRequest.js.
-- The transitions between them are #306's RPC, not a constraint here.
--
-- SAFE TO RUN AT ANY TIME, against a live frontend of any version: new tables,
-- new functions, nothing existing altered. Idempotent.
-- ==============================================================================

create table if not exists public.purchase_requests (
  id                  uuid primary key default gen_random_uuid(),
  opportunity_id      uuid references public.sales_opportunities (id) on delete cascade,
  opened_by_action_id uuid references public.flow_stage_actions (id) on delete set null,
  opened_visit_id     uuid references public.sor_stage_visits (id) on delete set null,
  buyer_id            uuid references public.employees (id),
  created_by          uuid references public.employees (id),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

comment on table public.purchase_requests is
  'Purchase Request (#209): where Sales and Purchasing coordinate buying for one SOR. At most one per SOR; opportunity_id is nullable for non-SOR requests later (#179). created_by is null when an automatic Stage Action opened it with no signed-in actor.';

create unique index if not exists purchase_requests_opportunity_id_key
  on public.purchase_requests (opportunity_id);
create index if not exists purchase_requests_unassigned_idx
  on public.purchase_requests (created_at) where buyer_id is null;

create or replace function public.set_purchase_requests_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists purchase_requests_updated_at on public.purchase_requests;
create trigger purchase_requests_updated_at
  before update on public.purchase_requests
  for each row execute function public.set_purchase_requests_updated_at();

create table if not exists public.purchase_request_members (
  id          uuid primary key default gen_random_uuid(),
  request_id  uuid not null references public.purchase_requests (id) on delete cascade,
  employee_id uuid not null references public.employees (id),
  side        text not null,
  added_by    uuid references public.employees (id),
  added_at    timestamptz not null default now(),

  constraint purchase_request_members_side_chk check (side in ('purchasing', 'sales', 'other')),
  constraint purchase_request_members_request_employee_key unique (request_id, employee_id)
);

create index if not exists purchase_request_members_employee_id_idx
  on public.purchase_request_members (employee_id);

create table if not exists public.purchase_request_items (
  id                     uuid primary key default gen_random_uuid(),
  request_id             uuid not null references public.purchase_requests (id) on delete cascade,
  source                 text not null,
  odoo_product_id        integer,
  name                   text not null,
  unit                   text,
  quantity               numeric(12,2) not null default 1,
  description            text,
  images                 jsonb not null default '[]'::jsonb,
  sor_line_snapshot      jsonb,
  status                 text not null default 'requested',
  po_number              text,
  po_verification        text not null default 'UNVERIFIED',
  substitute_for_item_id uuid references public.purchase_request_items (id) on delete set null,
  odoo_po_line_ids       integer[] not null default '{}',
  requested_by           uuid not null references public.employees (id),
  status_changed_by      uuid references public.employees (id),
  status_changed_at      timestamptz,
  created_at             timestamptz not null default now(),

  constraint purchase_request_items_source_chk check (source in ('sor_line', 'new')),
  constraint purchase_request_items_name_chk check (length(btrim(name)) > 0),
  constraint purchase_request_items_quantity_chk check (quantity > 0),
  constraint purchase_request_items_images_chk check (jsonb_typeof(images) = 'array'),
  constraint purchase_request_items_status_chk check (status in (
    'requested', 'from_stock', 'to_order', 'canvassing', 'ordered', 'received',
    'substituted', 'cannot_source', 'cancelled'
  )),
  constraint purchase_request_items_po_verification_chk check (
    po_verification in ('UNVERIFIED', 'VERIFIED', 'PENDING_VERIFICATION', 'NOT_FOUND')
  )
);

comment on column public.purchase_request_items.sor_line_snapshot is
  '{ name, quantity, unit } of the SOR Product List line as it was when picked. Never rewritten by later SOR edits; the item compares it against the current line to say "SOR line now says N".';
comment on column public.purchase_request_items.odoo_po_line_ids is
  'The Odoo purchase order lines this item is bought on, picked from the IPAS stored copy of its PO. Empty until picked (#312).';

create index if not exists purchase_request_items_request_id_idx
  on public.purchase_request_items (request_id);

create table if not exists public.purchase_request_messages (
  id         uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.purchase_requests (id) on delete cascade,
  author_id  uuid references public.employees (id),
  content    text not null,
  metadata   jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

comment on table public.purchase_request_messages is
  'The Purchase Request''s own Chat. Append-only: no update or delete policy. author_id is null only on an event posted by an automatic action with no signed-in actor.';

create index if not exists purchase_request_messages_request_id_idx
  on public.purchase_request_messages (request_id, created_at);

-- ------------------------------------------------------------------------------
-- Access helpers
-- ------------------------------------------------------------------------------

create or replace function public.has_purchasing_access()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from employees e
    where e.id = get_employee_id()
      and e.has_purchasing_flow
      and not coalesce(e.is_deleted, false)
  );
$$;

grant execute on function public.has_purchasing_access() to authenticated;

create or replace function public.is_purchase_request_member(p_request_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from purchase_request_members m
    where m.request_id = p_request_id
      and m.employee_id = get_employee_id()
  );
$$;

grant execute on function public.is_purchase_request_member(uuid) to authenticated;

create or replace function public.can_read_purchase_request(p_request_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select coalesce(is_super_admin(), false)
      or is_purchase_request_member(p_request_id)
      or (
        has_purchasing_access()
        and exists (
          select 1 from purchase_requests r
          where r.id = p_request_id and r.buyer_id is null
        )
      );
$$;

grant execute on function public.can_read_purchase_request(uuid) to authenticated;

-- ------------------------------------------------------------------------------
-- Policies
-- ------------------------------------------------------------------------------

alter table public.purchase_requests enable row level security;
alter table public.purchase_request_members enable row level security;
alter table public.purchase_request_items enable row level security;
alter table public.purchase_request_messages enable row level security;

drop policy if exists purchase_requests_read on public.purchase_requests;
create policy purchase_requests_read on public.purchase_requests
  for select to authenticated
  using (can_read_purchase_request(id));

drop policy if exists purchase_request_members_read on public.purchase_request_members;
create policy purchase_request_members_read on public.purchase_request_members
  for select to authenticated
  using (can_read_purchase_request(request_id));

drop policy if exists purchase_request_items_read on public.purchase_request_items;
create policy purchase_request_items_read on public.purchase_request_items
  for select to authenticated
  using (can_read_purchase_request(request_id));

drop policy if exists purchase_request_messages_read on public.purchase_request_messages;
create policy purchase_request_messages_read on public.purchase_request_messages
  for select to authenticated
  using (can_read_purchase_request(request_id));

drop policy if exists purchase_request_messages_insert on public.purchase_request_messages;
create policy purchase_request_messages_insert on public.purchase_request_messages
  for insert to authenticated
  with check (
    author_id = get_employee_id()
    and not (metadata ? 'event')
    and (is_purchase_request_member(request_id) or coalesce(is_super_admin(), false))
  );
