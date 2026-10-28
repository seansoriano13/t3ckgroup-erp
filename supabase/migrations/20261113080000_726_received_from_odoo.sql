-- #726 (spec #718): a Requested Item becomes Received from the Odoo receipt.
--
-- On every IPAS Odoo refresh, a Purchased (shown "Ordered") item whose picked P0 line(s)
-- have received at least the item's quantity moves to Received. The move is a system
-- change: no actor on the item, and the request's history says it was the system.
-- A partial receipt moves nothing; the count it has so far is kept on the item
-- (`odoo_received_qty`) so the screen can say "n of m received".
--
-- HOW IT HOOKS IN. The refresh (`ipas_record_odoo_copy`) and raising an IPAS both write
-- `ipas.odoo_copy`. A trigger on that column does the work, so every refresh path is
-- covered and `ipas_record_odoo_copy` is not touched. A filed IPAS keeps its frozen copy
-- (the refresh never rewrites it) and a cancelled one is never refreshed, so neither
-- changes anything here.
--
-- The copy's lines now carry `received` (the edge function `odoo-po-ipas` reads Odoo's
-- qty_received). A copy without it (taken before this change) is skipped, never read as zero.
--
-- SAFE TO RUN AT ANY TIME. Idempotent.

alter table public.purchase_request_items
  add column if not exists odoo_received_qty numeric(12,2);

comment on column public.purchase_request_items.odoo_received_qty is
  '#726: how much of this item Odoo''s receipts cover so far (the picked P0 lines'' received quantity), set by the IPAS refresh. Null until a refresh has seen it.';

create or replace function public._ipas_receive_items_from_copy()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item public.purchase_request_items;
  v_lines jsonb;
  v_received numeric;
  v_seen boolean;
  v_moved public.purchase_request_items;
begin
  if new.state in ('filed', 'cancelled') or new.po_number is null then
    return null;
  end if;
  v_lines := case when jsonb_typeof(new.odoo_copy->'lines') = 'array' then new.odoo_copy->'lines' else '[]'::jsonb end;

  for v_item in
    select i.*
      from public.purchase_request_items i
     where i.po_number = new.po_number
       and i.status = 'purchased'
       and cardinality(i.odoo_po_line_ids) > 0
     order by i.created_at
       for update
  loop
    select coalesce(sum((l->>'received')::numeric), 0), count(*) > 0
      into v_received, v_seen
      from jsonb_array_elements(v_lines) l
     where (l->>'line_id') ~ '^[0-9]+$'
       and (l->>'line_id')::integer = any (v_item.odoo_po_line_ids)
       and (l->>'received') ~ '^[0-9]+(\.[0-9]+)?$';

    -- No picked line carried a received figure: an old copy, not "nothing received".
    continue when not v_seen;

    if v_received >= v_item.quantity then
      update public.purchase_request_items
         set status = 'received',
             status_changed_by = null,
             status_changed_at = now(),
             odoo_received_qty = v_received
       where id = v_item.id
      returning * into v_moved;

      perform public._purchase_request_post_event(
        v_moved.request_id,
        null,
        format('%s: %s → %s (the system, from the Odoo receipt).', v_moved.name,
          public._purchase_request_item_status_label('purchased'),
          public._purchase_request_item_status_label('received')),
        jsonb_build_object(
          'event', 'item_status_changed',
          'item_id', v_moved.id,
          'from', 'purchased',
          'to', 'received',
          'changed_by', null,
          'changed_at', v_moved.status_changed_at,
          'system', true,
          'details', jsonb_build_object('source', 'odoo_receipt', 'po_number', new.po_number,
                                        'received', v_received, 'quantity', v_moved.quantity)
        )
      );
    elsif v_item.odoo_received_qty is distinct from v_received then
      update public.purchase_request_items
         set odoo_received_qty = v_received
       where id = v_item.id;
    end if;
  end loop;

  return null;
end;
$$;

comment on function public._ipas_receive_items_from_copy() is
  '#726: after an IPAS''s Odoo copy is written, moves each Purchased item on that PO whose picked P0 lines'' received quantity covers its quantity to Received (a system change, in the request''s history); a partial receipt only records the count.';

revoke all on function public._ipas_receive_items_from_copy() from public, anon, authenticated;

drop trigger if exists ipas_receive_items_from_copy on public.ipas;
create trigger ipas_receive_items_from_copy
  after insert or update of odoo_copy, odoo_fetched_at on public.ipas
  for each row
  execute function public._ipas_receive_items_from_copy();
