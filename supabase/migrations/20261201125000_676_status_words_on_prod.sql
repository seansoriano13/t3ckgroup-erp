-- #676's status words, for the databases where 20261104120000_requested_item_new_status_words
-- never ran: prod. Prod's ledger holds 20261104120000 for group_task_reopen (applied there before it
-- was renumbered to 20261105060000), so every run since counted the status words as applied. Prod's
-- Requested Items still carry the old words and the old CHECK, while the web app has used the new
-- words since the 2026-11-12 release. Found on 2026-11-16; pnpm db:function-diff now catches this.
--
-- It sorts before the release's Canvass migrations (967 on), which are written for the new words.
-- Where #676 already ran (staging, local, CI) every step changes nothing:
--   1. rows, default and CHECK, as #676;
--   2. the status events in a Purchase Request's chat, as #676;
--   3. the three functions that still say the old words on prod, as staging has them on 2026-11-16.
--      The other functions #676 rewrote were replaced on prod by later migrations already.

-- 1. Rows, then the constraint.
alter table public.purchase_request_items drop constraint if exists purchase_request_items_status_chk;

update public.purchase_request_items
   set status = case status
     when 'requested'   then 'not_checked'
     when 'from_stock'  then 'available'
     when 'to_order'    then 'to_purchase'
     when 'canvassing'  then 'still_canvassing'
     when 'ordered'     then 'purchased'
     when 'substituted' then 'cancelled'
     else status
   end
 where status in ('requested', 'from_stock', 'to_order', 'canvassing', 'ordered', 'substituted');

alter table public.purchase_request_items alter column status set default 'not_checked';

alter table public.purchase_request_items add constraint purchase_request_items_status_chk
  check (status = any (array['not_checked', 'available', 'to_purchase', 'still_canvassing',
                             'purchased', 'received', 'cannot_source', 'cancelled']));

-- 2. The chat's status events: the stored from/to and the sentence people read.
create temporary table _status_words (old_status text primary key, new_status text, old_label text, new_label text);
insert into _status_words values
  ('requested',   'not_checked',      'Requested',   'Not checked'),
  ('from_stock',  'available',        'From stock',  'Available'),
  ('to_order',    'to_purchase',      'To order',    'To purchase'),
  ('canvassing',  'still_canvassing', 'Canvassing',  'Still canvassing'),
  ('ordered',     'purchased',        'Ordered',     'Purchased'),
  ('substituted', 'cancelled',        'Substituted', 'Cancelled');

update public.purchase_request_messages m
   set content = replace(
         m.content,
         coalesce(x.f_old_label, initcap(replace(m.metadata->>'from', '_', ' '))) || ' → ' || coalesce(x.t_old_label, initcap(replace(m.metadata->>'to', '_', ' '))),
         coalesce(x.f_new_label, initcap(replace(m.metadata->>'from', '_', ' '))) || ' → ' || coalesce(x.t_new_label, initcap(replace(m.metadata->>'to', '_', ' ')))
       ),
       metadata = m.metadata
         || case when x.f_new_status is not null then jsonb_build_object('from', x.f_new_status) else '{}'::jsonb end
         || case when x.t_new_status is not null then jsonb_build_object('to', x.t_new_status) else '{}'::jsonb end
  from (
    select msg.id,
           f.old_label as f_old_label, f.new_label as f_new_label, f.new_status as f_new_status,
           t.old_label as t_old_label, t.new_label as t_new_label, t.new_status as t_new_status
      from public.purchase_request_messages msg
      left join _status_words f on f.old_status = msg.metadata->>'from'
      left join _status_words t on t.old_status = msg.metadata->>'to'
     where msg.metadata ? 'item_id'
       and msg.metadata->>'event' in ('item_status_changed', 'item_status_undone')
       and (f.old_status is not null or t.old_status is not null)
  ) x
 where m.id = x.id;

drop table _status_words;

-- 3. The three functions, as staging has them.
CREATE OR REPLACE FUNCTION public._purchase_request_item_status_label(p_status text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  select case p_status
    when 'not_checked'      then 'Not checked'
    when 'available'        then 'Available'
    when 'to_purchase'      then 'To purchase'
    when 'still_canvassing' then 'Still canvassing'
    when 'purchased'        then 'Purchased'
    when 'received'         then 'Received'
    when 'cannot_source'    then 'Cannot source'
    when 'cancelled'        then 'Cancelled'
    else p_status
  end;
$function$;

CREATE OR REPLACE FUNCTION public._purchase_request_item_is_closed(p_status text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  select p_status in ('available', 'received', 'cannot_source', 'cancelled');
$function$;

CREATE OR REPLACE FUNCTION public._purchase_request_set_item_status(p_item_id uuid, p_status text, p_details jsonb, p_server boolean)
 RETURNS purchase_request_items
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_actor uuid := public.get_employee_id();
  v_details jsonb := coalesce(p_details, '{}'::jsonb);
  v_item public.purchase_request_items;
  v_side text;
  v_key text;
  v_po text;
  v_verification text;
begin
  if v_actor is null then
    raise exception 'purchase_request_set_item_status: not signed in' using errcode = '42501';
  end if;
  if p_status is null or p_status not in (
    'not_checked', 'available', 'to_purchase', 'still_canvassing', 'purchased', 'received',
    'cannot_source', 'cancelled'
  ) then
    raise exception 'purchase_request_set_item_status: % is not an item status', coalesce(p_status, 'null') using errcode = '22023';
  end if;
  if jsonb_typeof(v_details) <> 'object' then
    raise exception 'purchase_request_set_item_status: details must be an object' using errcode = '22023';
  end if;
  -- #548: the Odoo check is the server's word, never the browser's.
  if v_details ? 'po_verification' and not p_server then
    raise exception 'purchase_request_set_item_status: only the server may record a PO check; send the PO number and it is checked against Odoo for you'
      using errcode = '42501';
  end if;

  -- Only Purchased takes details: its PO number and what Odoo said about it.
  if p_status <> 'purchased' and v_details <> '{}'::jsonb then
    raise exception 'purchase_request_set_item_status: % takes no details', public._purchase_request_item_status_label(p_status)
      using errcode = '22023';
  end if;
  for v_key in select jsonb_object_keys(v_details) loop
    if v_key not in ('po_number', 'po_verification') then
      raise exception 'purchase_request_set_item_status: Purchased takes a PO number and its check, not %', v_key
        using errcode = '22023';
    end if;
  end loop;

  if v_details ? 'po_number' and jsonb_typeof(v_details->'po_number') not in ('string', 'null') then
    raise exception 'purchase_request_set_item_status: the PO number must be text' using errcode = '22023';
  end if;
  v_po := nullif(upper(btrim(v_details->>'po_number')), '');
  v_verification := nullif(btrim(v_details->>'po_verification'), '');
  if v_po is not null and v_po !~ '^P[0-9]+$' then
    raise exception 'purchase_request_set_item_status: % isn''t an Odoo PO number ("P" then digits, e.g. P01234)', v_po
      using errcode = '22023';
  end if;
  -- A PO number is recorded only by the server path, after it asked Odoo; a signed-in
  -- caller sending one would store it unchecked and skip the Odoo not-found refusal.
  if v_po is not null and not p_server then
    raise exception 'purchase_request_set_item_status: a PO number is saved by the server after Odoo is asked; use the Order / Correct PO action'
      using errcode = '42501';
  end if;
  if v_verification is not null and v_po is null then
    raise exception 'purchase_request_set_item_status: a PO check needs a PO number' using errcode = '22023';
  end if;
  if v_verification is not null
     and v_verification not in ('UNVERIFIED', 'VERIFIED', 'PENDING_VERIFICATION', 'NOT_FOUND') then
    raise exception 'purchase_request_set_item_status: % is not a PO check result', v_verification using errcode = '22023';
  end if;
  if v_po is not null then
    v_verification := coalesce(v_verification, 'UNVERIFIED');
    v_details := jsonb_build_object('po_number', v_po, 'po_verification', v_verification);
  else
    v_details := '{}'::jsonb;
  end if;

  select * into v_item from public.purchase_request_items where id = p_item_id for update;
  if v_item.id is null then
    raise exception 'purchase_request_set_item_status: item % not found', p_item_id using errcode = 'P0002';
  end if;

  v_side := public.purchase_request_actor_side(v_item.request_id);
  if v_side is null then
    raise exception 'purchase_request_set_item_status: only the request''s members may change an item' using errcode = '42501';
  end if;

  v_item := public._purchase_request_item_move(v_item, p_status, v_side, v_actor, v_details, 'purchase_request_set_item_status');

  if v_po is not null then
    update public.purchase_request_items
       set po_number = v_po,
           po_verification = v_verification
     where id = v_item.id
    returning * into v_item;
  end if;

  return v_item;
end;
$function$;

