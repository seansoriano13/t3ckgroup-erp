-- Edit and remove a product someone asked for (2026-11-28).
--
-- An Other request (a product added by hand, source 'new') could not be changed after it was added:
-- not its name, quantity, unit, what it is for, description or photos, and it could not be taken
-- off; only Cancel, which some members don't have. Now anyone who may add (any member of the
-- request, 20261229160000) may also edit or remove one, until a P0 is attached to it. After that
-- Odoo has the order, so the app stops changing what was asked and Cancel is the way out.
--
-- Remove keeps the row: the product is set to Cancelled and stamped removed_at / removed_by, and
-- the request's list, the Purchase Requests list counts and the SOR's purchase summary leave it
-- out. Being Cancelled, every other count already treats it as closed.
--
-- Each edit and removal posts its own Chat line, written as the person who did it; an edit's line
-- carries the values before and after. The Buyer and whoever first asked for the product are told.
--
-- Safe to run twice: columns are added if missing and every function is created or replaced.

alter table public.purchase_request_items
  add column if not exists removed_at timestamptz,
  add column if not exists removed_by uuid references public.employees(id);

comment on column public.purchase_request_items.removed_at is
  'When a member removed this Other request. It stays Cancelled and the request''s lists leave it out.';

-- The checks shared by edit and remove: signed in, may add to the request, an Other request that
-- is still on it, and no P0 attached yet.
create or replace function public._purchase_request_item_for_changing(p_item_id uuid, p_fn text)
returns public.purchase_request_items
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item public.purchase_request_items;
begin
  if public.get_employee_id() is null then
    raise exception '%: not signed in', p_fn using errcode = '42501';
  end if;
  select * into v_item from public.purchase_request_items where id = p_item_id for update;
  if v_item.id is null then
    raise exception '%: item % not found', p_fn, p_item_id using errcode = 'P0002';
  end if;
  if not public.purchase_request_can_add_items(v_item.request_id) then
    raise exception '%: only the request''s members may change its products', p_fn using errcode = '42501';
  end if;
  if v_item.source <> 'new' then
    raise exception '%: % comes from the S0; change it there', p_fn, v_item.name using errcode = '22023';
  end if;
  if v_item.removed_at is not null then
    raise exception '%: % was already removed', p_fn, v_item.name using errcode = '22023';
  end if;
  if v_item.po_number is not null
     or coalesce(cardinality(v_item.odoo_po_line_ids), 0) > 0
     or v_item.status in ('purchased', 'received') then
    raise exception '%: % is on a P0 already; cancel it instead', p_fn, v_item.name using errcode = '22023';
  end if;
  return v_item;
end;
$$;
revoke all on function public._purchase_request_item_for_changing(uuid, text) from public, anon, authenticated;

-- How a product's amount reads in the Chat: "10 pc", or "10" with no unit.
create or replace function public._purchase_request_item_amount(p_quantity numeric, p_unit text)
returns text
language sql
immutable
set search_path = public
as $$
  select trim_scale(p_quantity)::text || coalesce(' ' || nullif(btrim(p_unit), ''), '');
$$;
revoke all on function public._purchase_request_item_amount(numeric, text) from public, anon, authenticated;

-- Edits an Other request. p_item takes the same fields as purchase_request_add_items: name,
-- quantity, unit, description, images, purpose, odoo_product_id (null or missing when typed).
-- Returns false, and posts nothing, when nothing changed.
create or replace function public.purchase_request_edit_item(p_item_id uuid, p_item jsonb)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old public.purchase_request_items := public._purchase_request_item_for_changing(p_item_id, 'purchase_request_edit_item');
  v_name text;
  v_quantity numeric;
  v_unit text;
  v_description text;
  v_purpose text;
  v_images jsonb;
  v_odoo int;
  v_parts text[] := '{}';
  v_actor uuid := public.get_employee_id();
begin
  if p_item is null or jsonb_typeof(p_item) <> 'object' then
    raise exception 'purchase_request_edit_item: send the product as an object' using errcode = '22023';
  end if;

  v_name := nullif(btrim(p_item->>'name'), '');
  if v_name is null then
    raise exception 'purchase_request_edit_item: a product needs a name' using errcode = '22023';
  end if;

  begin
    v_quantity := (p_item->>'quantity')::numeric;
  exception when others then
    v_quantity := null;
  end;
  if v_quantity is null or v_quantity <= 0 then
    raise exception 'purchase_request_edit_item: the quantity must be more than zero' using errcode = '22023';
  end if;

  v_unit := nullif(btrim(p_item->>'unit'), '');
  v_description := nullif(btrim(p_item->>'description'), '');

  v_purpose := coalesce(nullif(p_item->>'purpose', ''), 'client');
  if v_purpose not in ('client', 'job') then
    raise exception 'purchase_request_edit_item: say whether it is for the client or material for the job' using errcode = '22023';
  end if;

  v_images := coalesce(p_item->'images', '[]'::jsonb);
  if jsonb_typeof(v_images) <> 'array'
     or jsonb_array_length(v_images) > 5
     or exists (
       select 1 from jsonb_array_elements(v_images) img
       where jsonb_typeof(img) <> 'object' or nullif(img->>'url', '') is null
     ) then
    raise exception 'purchase_request_edit_item: images must be up to 5 uploaded files' using errcode = '22023';
  end if;

  v_odoo := null;
  if nullif(p_item->>'odoo_product_id', '') is not null then
    begin
      v_odoo := (p_item->>'odoo_product_id')::int;
    exception when others then
      v_odoo := null;
    end;
    if v_odoo is null or v_odoo <= 0 then
      raise exception 'purchase_request_edit_item: the Odoo product is not valid' using errcode = '22023';
    end if;
  end if;

  if v_name is distinct from v_old.name then
    v_parts := v_parts || format('name to %s', v_name);
  elsif v_odoo is distinct from v_old.odoo_product_id then
    v_parts := v_parts || case when v_odoo is null then 'no longer from Odoo' else 'now from Odoo' end;
  end if;
  if v_quantity is distinct from v_old.quantity or v_unit is distinct from nullif(btrim(v_old.unit), '') then
    v_parts := v_parts || format('quantity %s → %s',
      public._purchase_request_item_amount(v_old.quantity, v_old.unit),
      public._purchase_request_item_amount(v_quantity, v_unit));
  end if;
  if v_purpose is distinct from v_old.purpose then
    v_parts := v_parts || case when v_purpose = 'job' then 'now material for the job' else 'now for the client' end;
  end if;
  if v_description is distinct from nullif(btrim(v_old.description), '') then
    v_parts := v_parts || 'description'::text;
  end if;
  if v_images is distinct from v_old.images then
    v_parts := v_parts || 'photos'::text;
  end if;

  if cardinality(v_parts) = 0 then
    return false;
  end if;

  update public.purchase_request_items
     set name = v_name,
         quantity = v_quantity,
         unit = v_unit,
         description = v_description,
         images = v_images,
         purpose = v_purpose,
         odoo_product_id = v_odoo
   where id = v_old.id;

  perform public._purchase_request_post_event(
    v_old.request_id,
    v_actor,
    format('Changed %s: %s.', v_old.name, array_to_string(v_parts, ', ')),
    jsonb_build_object(
      'event', 'item_edited',
      'item_id', v_old.id,
      'before', jsonb_build_object(
        'name', v_old.name, 'quantity', v_old.quantity, 'unit', v_old.unit, 'description', v_old.description,
        'images', v_old.images, 'purpose', v_old.purpose, 'odoo_product_id', v_old.odoo_product_id),
      'after', jsonb_build_object(
        'name', v_name, 'quantity', v_quantity, 'unit', v_unit, 'description', v_description,
        'images', v_images, 'purpose', v_purpose, 'odoo_product_id', v_odoo)
    )
  );
  return true;
end;
$$;
revoke all on function public.purchase_request_edit_item(uuid, jsonb) from public, anon;
grant execute on function public.purchase_request_edit_item(uuid, jsonb) to authenticated;

-- Removes an Other request: Cancelled, stamped, and left out of the request's lists.
create or replace function public.purchase_request_remove_item(p_item_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old public.purchase_request_items := public._purchase_request_item_for_changing(p_item_id, 'purchase_request_remove_item');
  v_actor uuid := public.get_employee_id();
begin
  update public.purchase_request_items
     set status = 'cancelled',
         stock_short_free = null,
         stock_short_needed = null,
         status_changed_by = v_actor,
         status_changed_at = now(),
         removed_at = now(),
         removed_by = v_actor
   where id = v_old.id;

  perform public._purchase_request_post_event(
    v_old.request_id,
    v_actor,
    format('Removed %s × %s.', v_old.name, public._purchase_request_item_amount(v_old.quantity, v_old.unit)),
    jsonb_build_object('event', 'item_removed', 'item_id', v_old.id, 'from', v_old.status)
  );
end;
$$;
revoke all on function public.purchase_request_remove_item(uuid) from public, anon;
grant execute on function public.purchase_request_remove_item(uuid) to authenticated;

-- A removed product takes no more status changes.
CREATE OR REPLACE FUNCTION public._purchase_request_item_move(p_item purchase_request_items, p_to text, p_side text, p_actor uuid, p_details jsonb, p_fn text)
 RETURNS purchase_request_items
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_item public.purchase_request_items;
begin
  if p_item.removed_at is not null then
    raise exception '%: % was removed from the request', p_fn, p_item.name using errcode = '22023';
  end if;
  if p_item.status = p_to and not (p_to = 'available' and p_item.stock_short_free is not null) then
    raise exception '%: the item is already %', p_fn, public._purchase_request_item_status_label(p_to)
      using errcode = '22023';
  end if;
  if not public._purchase_request_item_transition_ok(p_item.status, p_to, p_side) then
    raise exception '%: % can''t move from % to %', p_fn,
      case p_side
        when 'purchasing' then 'Purchasing'
        when 'sales' then 'the sales side'
        else 'you'
      end,
      public._purchase_request_item_status_label(p_item.status),
      public._purchase_request_item_status_label(p_to)
      using errcode = '42501';
  end if;

  update public.purchase_request_items
     set status = p_to, stock_short_free = null, stock_short_needed = null,
         status_changed_by = p_actor,
         status_changed_at = now()
   where id = p_item.id
  returning * into v_item;

  perform public._purchase_request_post_event(
    v_item.request_id,
    p_actor,
    format('%s: %s → %s.', v_item.name,
      public._purchase_request_item_status_label(p_item.status),
      public._purchase_request_item_status_label(p_to)),
    jsonb_build_object(
      'event', 'item_status_changed',
      'item_id', v_item.id,
      'from', p_item.status,
      'to', p_to,
      'changed_by', p_actor,
      'changed_at', v_item.status_changed_at
    ) || case when p_details = '{}'::jsonb then '{}'::jsonb else jsonb_build_object('details', p_details) end
  );

  return v_item;
end;
$function$;

-- The Buyer and whoever first asked hear about an edit or a removal, as they do about a status change.
CREATE OR REPLACE FUNCTION public._purchase_request_message_notify()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_req public.purchase_requests;
  v_event text := new.metadata->>'event';
  v_label text;
  v_author text;
  v_mentioned uuid[] := '{}';
  v_requesters uuid[];
  v_item public.purchase_request_items;
  v_buyer uuid;
  v_buyer_name text;
begin
  select * into v_req from public.purchase_requests where id = new.request_id;
  if v_req.id is null then
    return null;
  end if;
  v_label := public._purchase_request_label(v_req.id);
  select name into v_author from public.employees where id = new.author_id;

  -- Mentions: only a member's own message carries them; only members count.
  if v_event is null and jsonb_typeof(new.metadata->'mentions') = 'array' then
    select coalesce(array_agg(distinct m.employee_id), '{}') into v_mentioned
    from jsonb_array_elements(new.metadata->'mentions') x
    join public.purchase_request_members m
      on m.request_id = v_req.id
     and m.employee_id::text = x->>'id'
    where jsonb_typeof(x) = 'object'
      and m.employee_id is distinct from new.author_id;

    perform public._purchase_request_notify(
      v_req.id, v_mentioned, new.author_id, 'PURCHASE_REQUEST_MENTION',
      coalesce(v_author, 'Someone') || ' mentioned you',
      v_label || ': ' || new.content
    );
  end if;

  if v_event = 'opened' then
    -- Once per request, however the event came to be posted again.
    if exists (
      select 1 from public.purchase_request_messages p
      where p.request_id = v_req.id and p.id <> new.id and p.metadata->>'event' = 'opened'
    ) then
      return null;
    end if;

    if v_req.buyer_id is null then
      perform public._purchase_request_notify(
        v_req.id,
        array(select e.id from public.employees e where public._employee_has_purchasing_access(e.id)),
        new.author_id, 'PURCHASE_REQUEST_OPENED',
        'New Purchase Request',
        v_label || ' needs a Buyer. Take it from Purchase Requests.',
        false
      );
    else
      perform public._purchase_request_notify(
        v_req.id, array[v_req.buyer_id], new.author_id, 'PURCHASE_REQUEST_BUYER',
        'You''re the Buyer',
        v_label || ': a Purchase Request opened with you as its Buyer.'
      );
    end if;

  elsif v_event = 'buyer_set' then
    v_buyer := nullif(new.metadata->>'buyer_id', '')::uuid;
    if v_buyer is not null then
      perform public._purchase_request_notify(
        v_req.id, array[v_buyer], new.author_id, 'PURCHASE_REQUEST_BUYER',
        'You''re the Buyer',
        v_label || ': ' || coalesce(v_author, 'Someone') || ' made you its Buyer.'
      );

      -- #849: the Requesters hear who is now buying. The creator counts only
      -- as a Direct request's Requester. The sender (the actor) is skipped.
      select name into v_buyer_name from public.employees where id = v_buyer;
      select array_agg(distinct x) into v_requesters
      from (
        select v_req.created_by as x where v_req.opportunity_id is null
        union
        select i.requested_by from public.purchase_request_items i where i.request_id = v_req.id
      ) q
      where x is not null and x is distinct from v_buyer;

      perform public._purchase_request_notify(
        v_req.id, coalesce(v_requesters, '{}'::uuid[]), new.author_id,
        'PURCHASE_REQUEST_BUYER_SET',
        'Buyer assigned',
        coalesce(v_buyer_name, 'Someone') || ' is now buying ' || coalesce(v_req.pr_number, v_label)
      );
    end if;

  elsif v_event = 'item_status_changed' then
    select * into v_item from public.purchase_request_items
    where id = nullif(new.metadata->>'item_id', '')::uuid;
    perform public._purchase_request_notify_status_merge(
      v_req.id, array[v_req.buyer_id, v_item.requested_by], new.author_id,
      'Requested Item updated', v_label, new.content,
      coalesce(v_item.name, 'A product') || ' → '
        || coalesce(public._purchase_request_item_status_label(new.metadata->>'to'), new.metadata->>'to', '?')
    );

  elsif v_event = 'item_added' then
    perform public._purchase_request_notify(
      v_req.id, array[v_req.buyer_id], new.author_id, 'PURCHASE_REQUEST_ITEM_ADDED',
      'Item requested',
      v_label || ': ' || new.content
    );

  elsif v_event in ('item_edited', 'item_removed') then
    select * into v_item from public.purchase_request_items
    where id = nullif(new.metadata->>'item_id', '')::uuid;
    perform public._purchase_request_notify(
      v_req.id, array[v_req.buyer_id, v_item.requested_by], new.author_id, 'PURCHASE_REQUEST_ITEM_ADDED',
      case when v_event = 'item_removed' then 'Item removed' else 'Item changed' end,
      v_label || ': ' || new.content
    );

  elsif v_event is null then
    -- The creator counts only before a Buyer, or as a Direct request's Requester.
    select array_agg(distinct x) into v_requesters
    from (
      select v_req.created_by as x
      where v_req.buyer_id is null or v_req.opportunity_id is null
      union
      select i.requested_by from public.purchase_request_items i where i.request_id = v_req.id
    ) q
    where x is not null;

    perform public._purchase_request_notify(
      v_req.id,
      array(
        select r from unnest(array[v_req.buyer_id] || coalesce(v_requesters, '{}'::uuid[])) r
        where r is not null and not (r = any (v_mentioned))
      ),
      new.author_id, 'PURCHASE_REQUEST_MESSAGE',
      'New message from ' || coalesce(v_author, 'someone'),
      v_label || ': ' || new.content
    );
  end if;

  return null;
end;
$function$;

-- The lists that show or count a request's products leave a removed one out.
CREATE OR REPLACE FUNCTION public.purchase_request_queue(p_request_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(id uuid, opportunity_id uuid, sales_reference text, project_title text, stage_name text, sor_closed text, buyer_id uuid, buyer_name text, buyer_avatar_path text, created_at timestamp with time zone, updated_at timestamp with time zone, item_count integer, open_count integer, last_activity_at timestamp with time zone, sor_status text, title text, pr_number text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select
    r.id,
    r.opportunity_id,
    coalesce(nullif(o.sales_reference, ''), o.sor_code, o.opportunity_no),
    o.project_title,
    fs.name,
    case when o.id is not null then public._sor_purchasing_closed_reason(o) end,
    r.buyer_id,
    b.name,
    b.avatar_path,
    r.created_at,
    r.updated_at,
    coalesce(i.item_count, 0)::integer,
    coalesce(i.open_count, 0)::integer,
    greatest(r.updated_at, m.last_message_at),
    o.status,
    r.title,
    r.pr_number
  from public.purchase_requests r
  left join public.sales_opportunities o on o.id = r.opportunity_id
  left join public.flow_stages fs on fs.id = o.flow_stage_id
  left join public.employees b on b.id = r.buyer_id
  left join lateral (
    select
      count(*) as item_count,
      count(*) filter (where not public._purchase_request_item_is_closed(it.status)) as open_count
    from public.purchase_request_items it
    where it.request_id = r.id
      and it.removed_at is null
  ) i on true
  left join lateral (
    select max(msg.created_at) as last_message_at
    from public.purchase_request_messages msg
    where msg.request_id = r.id
  ) m on true
  where (p_request_id is null or r.id = p_request_id)
    and public.can_read_purchase_request(r.id)
  order by greatest(r.updated_at, m.last_message_at) desc nulls last, r.created_at desc;
$function$;

CREATE OR REPLACE FUNCTION public.sor_purchase_request_overview(p_opportunity_id uuid)
 RETURNS TABLE(request_id uuid, buyer_id uuid, buyer_name text, buyer_avatar_path text, opened_visit_id uuid, created_at timestamp with time zone, items jsonb)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select
    r.id,
    r.buyer_id,
    b.name,
    b.avatar_path,
    r.opened_visit_id,
    r.created_at,
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', it.id,
        'name', it.name,
        'odoo_product_id', it.odoo_product_id,
        'sor_item_id', it.sor_item_id,
        'quantity', it.quantity,
        'unit', it.unit,
        'status', it.status,
        'source', it.source,
        'created_at', it.created_at,
        'po_number', it.po_number,
        'po_state', it.po_state,
        'odoo_po_id', (
          select i.odoo_po_id from public.ipas i
          where i.po_number = it.po_number and i.odoo_po_id is not null
          order by i.created_at desc limit 1
        )
      ) order by it.created_at, it.id)
      from public.purchase_request_items it
      where it.request_id = r.id
        and it.removed_at is null
    ), '[]'::jsonb)
  from public.purchase_requests r
  left join public.employees b on b.id = r.buyer_id
  where r.opportunity_id = p_opportunity_id
    and public.can_read_purchase_request(r.id);
$function$;

CREATE OR REPLACE FUNCTION public.sor_purchase_request_item_states(p_opportunity_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_request_id uuid;
begin
  if public.get_employee_id() is null then
    raise exception 'sor_purchase_request_item_states: sign in first' using errcode = '42501';
  end if;
  if public.sor_access_level(p_opportunity_id) = 'none' then
    raise exception 'sor_purchase_request_item_states: you can''t see this SOR' using errcode = '42501';
  end if;

  select r.id into v_request_id
    from public.purchase_requests r
   where r.opportunity_id = p_opportunity_id;
  if v_request_id is null then
    return null;
  end if;

  return coalesce(
    (select jsonb_agg(
              jsonb_build_object(
                'status', i.status,
                'created_at', i.created_at,
                'status_changed_at', i.status_changed_at
              )
              order by i.created_at, i.id
            )
       from public.purchase_request_items i
      where i.request_id = v_request_id
        and i.removed_at is null),
    '[]'::jsonb
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.direct_requests_for_sor(p_opportunity_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_actor uuid := public.get_employee_id();
  v_sor public.sales_opportunities;
begin
  select * into v_sor from public.sales_opportunities o where o.id = p_opportunity_id;
  if not found or not coalesce(
    public.is_super_admin()
    or public.sor_is_deal_team(v_sor, v_actor)
    or public.sor_always_sees(v_sor, v_actor),
    false
  ) then
    return '[]'::jsonb;
  end if;

  return coalesce((
    select jsonb_agg(
             jsonb_build_object(
               'id', r.id,
               'title', r.title,
               'pr_number', r.pr_number,
               'p0', i.p0,
               'status', i.status
             )
             order by r.created_at desc, r.id
           )
      from public.purchase_requests r
      left join lateral (
        select
          (select string_agg(distinct it.po_number, ', ')
             from public.purchase_request_items it
            where it.request_id = r.id and nullif(btrim(it.po_number), '') is not null) as p0,
          coalesce(
            (select it.status
               from public.purchase_request_items it
              where it.request_id = r.id and it.status <> 'cancelled'
              order by array_position(
                array['not_checked','to_purchase','still_canvassing','purchased','available','received','cannot_source'],
                it.status)
              limit 1),
            case when exists (select 1 from public.purchase_request_items it where it.request_id = r.id and it.removed_at is null)
                 then 'cancelled' else 'not_checked' end
          ) as status
      ) i on true
     where r.for_opportunity_id = p_opportunity_id
       and r.opportunity_id is null
       and r.deleted_at is null
  ), '[]'::jsonb);
end;
$function$;

CREATE OR REPLACE FUNCTION public.purchase_request_deleted_list()
 RETURNS TABLE(id uuid, pr_number text, title text, sales_reference text, opportunity_id uuid, item_count integer, deleted_at timestamp with time zone, deleted_by_name text, delete_reason text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select
    r.id,
    r.pr_number,
    r.title,
    coalesce(nullif(o.sales_reference, ''), o.sor_code, o.opportunity_no),
    r.opportunity_id,
    (select count(*)::integer from public.purchase_request_items it where it.request_id = r.id and it.removed_at is null),
    r.deleted_at,
    e.name,
    r.delete_reason
  from public.purchase_requests r
  left join public.sales_opportunities o on o.id = r.opportunity_id
  left join public.employees e on e.id = r.deleted_by
  where r.deleted_at is not null
    and (coalesce(public.is_super_admin(), false) or coalesce(public.has_purchasing_access(), false))
  order by r.deleted_at desc;
$function$;
