-- ==============================================================================
-- 20261007190300_migrate_legacy_procurement_requests.sql
--
-- Issue #313 (part of #209) — carry the old procurement requests into Purchase
-- Requests, close the old purchasing tasks, and make the old table read-only.
--
-- PER SOR with `sor_procurement_requests` (soft-deleted SORs are skipped; their
-- rows stay in the old table):
--   - one Purchase Request (reused if the SOR already has one). No action, no
--     visit, so no Stage Participant windows. created_by = the earliest
--     requester, created_at = the earliest legacy row.
--   - Buyer = the most frequent assignee who still has Purchasing access (tie:
--     the one assigned most recently). A request that already has a Buyer
--     keeps it; none qualifying leaves it in the queue.
--   - members = the requesters, the assignees (not deleted) and every
--     Purchasing flag holder, each with the side `_purchase_request_add_member`
--     computes.
--
-- PER LEGACY ROW, one Requested Item (source 'new', no SOR line link):
--   outcome → status as `legacyOutcomeToStatus` (src/constants/purchaseRequest.js):
--     null → requested, IN_PROGRESS → canvassing, PURCHASED / ON_ORDER → ordered,
--     DELIVERED → received, ALREADY_EXISTS → from_stock, SUBSTITUTED →
--     substituted, UNAVAILABLE → cannot_source.
--   po_number and verification carried; status_changed_by/at from resolved_by/at
--   (assignee / last update when an answered row has none); created_at kept.
--   The old table allows quantity 0, the new one wants > 0: such an item gets
--   quantity 1 and the migration message says the quantity wasn't given.
--   `legacy_procurement_request_id` remembers the row, so a re-run never
--   duplicates an item (and the later clean-up can trace it).
--
--   A row with an ETA, vendor or note (or the 0 quantity) gets ONE system
--   message in its request's chat, e.g.
--     Migrated from the old request for Cable: ETA 2026-10-02 · vendor ACME
--     Trading · note "waiting on supplier quote"
--   with event `migrated`. No `opened` event is posted: that one fans out to
--   every Purchasing flag holder (#307's `_purchase_request_message_notify`),
--   and `migrated` notifies nobody.
--
-- TASKS linked by `task_id`: each gets one SYSTEM activity entry pointing at
-- the new request (metadata event PURCHASE_REQUEST_MIGRATED, purchaseRequestId)
-- and, unless already Completed / Deleted / Cancelled, is set to COMPLETED.
-- hr_verified is never touched (protect_task_verification would raise).
--
-- THE OLD TABLE stays, read-only: its insert/update/delete policies are dropped;
-- reads keep "sor_procurement_read". Rows are never deleted —
-- sor_canvasses.procurement_request_id cascades on delete.
--
-- Re-runnable: every step skips what it already did. The policy test
-- (45-migrate-legacy-procurement.test.js) re-runs this file against fixtures.
-- ==============================================================================

alter table public.purchase_request_items
  add column if not exists legacy_procurement_request_id uuid;

comment on column public.purchase_request_items.legacy_procurement_request_id is
  'The sor_procurement_requests row this item was migrated from (#313). Null for items raised in a Purchase Request. No FK: the legacy table is due for clean-up.';

create unique index if not exists purchase_request_items_legacy_procurement_request_id_key
  on public.purchase_request_items (legacy_procurement_request_id)
  where legacy_procurement_request_id is not null;

-- ------------------------------------------------------------------------------
-- The old table: read-only
-- ------------------------------------------------------------------------------

drop policy if exists "sor_procurement_insert" on public.sor_procurement_requests;
drop policy if exists "sor_procurement_update" on public.sor_procurement_requests;
drop policy if exists "sor_procurement_delete" on public.sor_procurement_requests;

comment on table public.sor_procurement_requests is
  'LEGACY, read-only (#313): carried into purchase_requests / purchase_request_items (legacy_procurement_request_id). Kept for a later clean-up; never delete rows (sor_canvasses cascade).';

-- ------------------------------------------------------------------------------
-- The migration
-- ------------------------------------------------------------------------------

do $migrate$
declare
  v_opp record;
  v_row record;
  v_req public.purchase_requests;
  v_buyer uuid;
  v_emp uuid;
  v_item uuid;
  v_status text;
  v_parts text[];
  v_label text;
  v_task record;
begin
  for v_opp in
    select l.opportunity_id,
           min(l.created_at) as first_at,
           (array_agg(l.requested_by order by l.created_at, l.id))[1] as first_requester
    from public.sor_procurement_requests l
    join public.sales_opportunities o on o.id = l.opportunity_id
    where not coalesce(o.is_deleted, false)
    group by l.opportunity_id
  loop
    -- The Buyer: most frequent assignee still able to buy.
    select l.assigned_to into v_buyer
    from public.sor_procurement_requests l
    where l.opportunity_id = v_opp.opportunity_id
      and l.assigned_to is not null
      and public._employee_has_purchasing_access(l.assigned_to)
    group by l.assigned_to
    order by count(*) desc, max(l.created_at) desc, l.assigned_to
    limit 1;

    insert into public.purchase_requests (opportunity_id, buyer_id, created_by, created_at)
    values (v_opp.opportunity_id, v_buyer, v_opp.first_requester, v_opp.first_at)
    on conflict (opportunity_id) do nothing;

    update public.purchase_requests
    set buyer_id = v_buyer
    where opportunity_id = v_opp.opportunity_id and buyer_id is null and v_buyer is not null;

    select * into v_req from public.purchase_requests where opportunity_id = v_opp.opportunity_id;

    -- Members: requesters, assignees, every Purchasing flag holder.
    for v_emp in
      select x.id from (
        select l.requested_by as id from public.sor_procurement_requests l
        where l.opportunity_id = v_opp.opportunity_id
        union
        select l.assigned_to from public.sor_procurement_requests l
        where l.opportunity_id = v_opp.opportunity_id
        union
        select e.id from public.employees e where public._employee_has_purchasing_access(e.id)
      ) x
      join public.employees e on e.id = x.id
      where not coalesce(e.is_deleted, false)
    loop
      perform public._purchase_request_add_member(v_req.id, v_emp, null);
    end loop;

    -- Items, one per legacy row not yet carried.
    for v_row in
      select l.* from public.sor_procurement_requests l
      where l.opportunity_id = v_opp.opportunity_id
        and not exists (
          select 1 from public.purchase_request_items i
          where i.legacy_procurement_request_id = l.id
        )
      order by l.created_at, l.id
    loop
      v_status := case v_row.outcome
        when 'IN_PROGRESS'    then 'canvassing'
        when 'PURCHASED'      then 'ordered'
        when 'ON_ORDER'       then 'ordered'
        when 'DELIVERED'      then 'received'
        when 'ALREADY_EXISTS' then 'from_stock'
        when 'SUBSTITUTED'    then 'substituted'
        when 'UNAVAILABLE'    then 'cannot_source'
        else 'requested'
      end;
      if v_row.outcome is not null and v_status = 'requested' then
        raise exception '#313: unknown legacy procurement outcome % on %', v_row.outcome, v_row.id;
      end if;

      insert into public.purchase_request_items (
        request_id, source, name, unit, quantity, description, images, status,
        po_number, po_verification, requested_by, status_changed_by, status_changed_at,
        created_at, legacy_procurement_request_id
      ) values (
        v_req.id,
        'new',
        coalesce(nullif(btrim(v_row.requested_name), ''), 'Unnamed item'),
        nullif(btrim(v_row.requested_unit), ''),
        case when v_row.requested_quantity > 0 then v_row.requested_quantity else 1 end,
        nullif(btrim(v_row.requested_description), ''),
        case when jsonb_typeof(v_row.requested_images) = 'array' then v_row.requested_images else '[]'::jsonb end,
        v_status,
        nullif(btrim(v_row.po_number), ''),
        v_row.verification,
        v_row.requested_by,
        case when v_row.outcome is not null then coalesce(v_row.resolved_by, v_row.assigned_to) end,
        case when v_row.outcome is not null then coalesce(v_row.resolved_at, v_row.updated_at) end,
        v_row.created_at,
        v_row.id
      )
      returning id into v_item;

      v_parts := array_remove(array[
        case when v_row.eta is not null then 'ETA ' || to_char(v_row.eta, 'YYYY-MM-DD') end,
        case when nullif(btrim(v_row.odoo_vendor), '') is not null then 'vendor ' || btrim(v_row.odoo_vendor) end,
        case when nullif(btrim(v_row.outcome_note), '') is not null then 'note "' || btrim(v_row.outcome_note) || '"' end,
        case when not (v_row.requested_quantity > 0) then 'quantity not given (set to 1)' end
      ], null);

      if cardinality(v_parts) > 0 then
        insert into public.purchase_request_messages (request_id, author_id, content, metadata, created_at)
        values (
          v_req.id,
          null,
          format('Migrated from the old request for %s: %s',
                 coalesce(nullif(btrim(v_row.requested_name), ''), 'Unnamed item'),
                 array_to_string(v_parts, ' · ')),
          jsonb_build_object(
            'event', 'migrated',
            'item_id', v_item,
            'legacy_procurement_request_id', v_row.id,
            'eta', v_row.eta,
            'vendor', nullif(btrim(v_row.odoo_vendor), ''),
            'note', nullif(btrim(v_row.outcome_note), '')
          ),
          greatest(v_row.updated_at, v_row.created_at)
        );
      end if;
    end loop;

    -- The old purchasing tasks: note the move, then close.
    v_label := public._purchase_request_label(v_req.id);
    for v_task in
      select distinct t.id, t.status
      from public.sor_procurement_requests l
      join public.tasks t on t.id = l.task_id
      where l.opportunity_id = v_opp.opportunity_id
    loop
      if not exists (
        select 1 from public.task_activity a
        where a.task_id = v_task.id
          and a.metadata->>'event' = 'PURCHASE_REQUEST_MIGRATED'
          and a.metadata->>'purchaseRequestId' = v_req.id::text
      ) then
        insert into public.task_activity (task_id, author_id, type, content, metadata)
        values (
          v_task.id,
          null,
          'SYSTEM',
          format('Moved to the Purchase Request for %s. Purchasing continues there.', v_label),
          jsonb_build_object(
            'event', 'PURCHASE_REQUEST_MIGRATED',
            'purchaseRequestId', v_req.id,
            'opportunityId', v_opp.opportunity_id,
            'link', '/purchasing?request=' || v_req.id,
            'previousStatus', v_task.status
          )
        );
      end if;

      update public.tasks
      set status = 'COMPLETED',
          end_at = coalesce(end_at, now())
      where id = v_task.id
        and coalesce(status, '') not in ('COMPLETED', 'DELETED', 'CANCELLED');
    end loop;
  end loop;
end
$migrate$;
