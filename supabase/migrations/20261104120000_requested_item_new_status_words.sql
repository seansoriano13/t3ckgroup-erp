-- #676 (spec #675): Requested Items use the new status words.
--
--   requested -> not_checked     from_stock -> available    to_order   -> to_purchase
--   canvassing -> still_canvassing   ordered -> purchased   substituted -> cancelled
--   (received, cannot_source and cancelled keep their names)
--
-- The status CHECK holds only the new set. Substituted is dropped; the
-- "substitute for" link between items stays, and the substitute action now
-- cancels the old item. Same transitions as before, under the new words.

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

-- 3. The small rule functions, written out in full.
create or replace function public._purchase_request_item_status_label(p_status text)
returns text
language sql
immutable
set search_path to 'public'
as $$
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
$$;

create or replace function public._purchase_request_item_is_closed(p_status text)
returns boolean
language sql
immutable
set search_path to 'public'
as $$
  select p_status in ('available', 'received', 'cannot_source', 'cancelled');
$$;

create or replace function public._purchase_request_item_transition_ok(p_from text, p_to text, p_side text)
returns boolean
language sql
immutable
set search_path to 'public'
as $$
  select case
    when public._purchase_request_item_is_closed(p_from) then false
    when p_side = 'purchasing' then
      p_to in ('cannot_source', 'cancelled')
      or (p_from = 'not_checked'      and p_to in ('available', 'to_purchase'))
      or (p_from = 'to_purchase'      and p_to in ('still_canvassing', 'purchased'))
      or (p_from = 'still_canvassing' and p_to = 'purchased')
      or (p_from = 'purchased'        and p_to = 'received')
    when p_side in ('sales', 'requester') then p_to = 'cancelled'
    else false
  end;
$$;

-- 4. Every other function that names a status: rewrite its body in place.
--    _ipas_po_state_class is an IPAS class, not an item status; it stays.
do $migration$
declare
  r record;
  v_def text;
begin
  for r in
    select p.oid, p.proname
      from pg_proc p
     where p.pronamespace = 'public'::regnamespace
       and p.prokind = 'f'
       and p.proname not in ('_ipas_po_state_class', '_purchase_request_item_status_label',
                             '_purchase_request_item_is_closed', '_purchase_request_item_transition_ok')
       and pg_get_functiondef(p.oid) ~ '(''requested''|''ordered''|''from_stock''|''to_order''|''canvassing''|''substituted''|Ordered|Substituted|stays Canvassing)'
  loop
    v_def := pg_get_functiondef(r.oid);
    if r.proname = 'purchase_request_add_substitute' then
      -- The old item is Cancelled, and keeps its link to the substitute.
      v_def := replace(v_def, '''substituted''', '''cancelled''');
    end if;
    v_def := replace(v_def, '''substituted'', ', '');
    v_def := replace(v_def, ', ''substituted''', '');
    v_def := replace(v_def, '''requested''', '''not_checked''');
    v_def := replace(v_def, '''from_stock''', '''available''');
    v_def := replace(v_def, '''to_order''', '''to_purchase''');
    v_def := replace(v_def, '''canvassing''', '''still_canvassing''');
    v_def := replace(v_def, '''ordered''', '''purchased''');
    v_def := replace(v_def, 'Ordered', 'Purchased');
    v_def := replace(v_def, 'Substituted', 'Cancelled');
    v_def := replace(v_def, 'stays Canvassing', 'stays Still canvassing');
    execute v_def;
  end loop;
end
$migration$;
