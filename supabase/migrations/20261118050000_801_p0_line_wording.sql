-- Spec #798 / ticket #801: the Pick P0 line history post and its refusals say "P0 line" (zero), not "PO line".
--
-- Only wording changes. The body is the live one (supabase/schema/staging.sql; the status words were patched to
-- Purchased in place after 20261012100600); the three texts are the only edits. Identifiers, the
-- event name and the result are unchanged.

create or replace function public.purchase_request_pick_po_lines(p_item_id uuid, p_line_ids int[])
returns public.purchase_request_items
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := public.get_employee_id();
  v_item public.purchase_request_items;
  v_lines int[];
  v_ipas int[];
  v_stray int[];
begin
  if v_actor is null then
    raise exception 'purchase_request_pick_po_lines: not signed in' using errcode = '42501';
  end if;

  select * into v_item from public.purchase_request_items where id = p_item_id for update;
  if v_item.id is null then
    raise exception 'purchase_request_pick_po_lines: item % not found', p_item_id using errcode = 'P0002';
  end if;
  if coalesce(public.purchase_request_actor_side(v_item.request_id), '') <> 'purchasing' then
    raise exception 'purchase_request_pick_po_lines: only Purchasing picks an item''s P0 line' using errcode = '42501';
  end if;
  if v_item.status not in ('purchased', 'received') then
    raise exception 'purchase_request_pick_po_lines: % is %, not Purchased', v_item.name,
      public._purchase_request_item_status_label(v_item.status)
      using errcode = '22023';
  end if;
  if v_item.po_number is null then
    raise exception 'purchase_request_pick_po_lines: % has no PO number', v_item.name using errcode = '22023';
  end if;

  if p_line_ids is null or cardinality(p_line_ids) = 0 or array_position(p_line_ids, null) is not null then
    raise exception 'purchase_request_pick_po_lines: pick at least one P0 line' using errcode = '22023';
  end if;
  select array_agg(distinct l order by l) into v_lines from unnest(p_line_ids) l;

  v_ipas := coalesce(public._ipas_po_line_ids(v_item.po_number), '{}'::int[]);
  if cardinality(v_ipas) = 0 then
    raise exception 'purchase_request_pick_po_lines: PO % has no IPAS yet; pick its line once it does', v_item.po_number
      using errcode = '22023';
  end if;
  select array_agg(l order by l) into v_stray from unnest(v_lines) l where not (l = any (v_ipas));
  if v_stray is not null then
    raise exception 'purchase_request_pick_po_lines: line % isn''t on PO %''s IPAS copy', array_to_string(v_stray, ', '), v_item.po_number
      using errcode = '22023';
  end if;

  update public.purchase_request_items
     set odoo_po_line_ids = v_lines
   where id = v_item.id
  returning * into v_item;

  perform public._purchase_request_post_event(
    v_item.request_id,
    v_actor,
    format('%s: P0 line picked on %s.', v_item.name, v_item.po_number),
    jsonb_build_object(
      'event', 'item_po_lines_picked',
      'item_id', v_item.id,
      'po_number', v_item.po_number,
      'line_ids', to_jsonb(v_lines)
    )
  );

  return v_item;
end;
$$;
