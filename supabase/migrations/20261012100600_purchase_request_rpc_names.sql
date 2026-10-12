-- #506 (follow-up to #209): every purchasing RPC answers to a
-- `purchase_request_` name. The #306/#307/#308/#312 RPCs were named `pr_*`
-- while the rest of the Purchase Request functions say `purchase_request_*`.
--
-- Each `pr_*` body moves, unchanged apart from its name and its error prefix,
-- to its `purchase_request_*` twin:
--   pr_actor_side          -> purchase_request_actor_side
--   pr_can_add_substitute  -> purchase_request_can_add_substitute
--   pr_set_item_status     -> purchase_request_set_item_status
--   pr_add_substitute      -> purchase_request_add_substitute
--   pr_take                -> purchase_request_take
--   pr_set_buyer           -> purchase_request_set_buyer
--   pr_item_po_lines       -> purchase_request_item_po_lines
--   pr_pick_po_lines       -> purchase_request_pick_po_lines
--   pr_queue               -> purchase_request_queue
--
-- The old names stay as thin aliases (same arguments, defaults, result,
-- volatility, security definer and grants) that call the new name, so an older
-- frontend on this database keeps working. Nothing is dropped; removing the
-- aliases is a separate ask. The app calls the new names from this release on,
-- so this migration has to reach a database before the frontend that calls
-- them.

-- ------------------------------------------------------------------------------
-- The new names
-- ------------------------------------------------------------------------------

create or replace function public.purchase_request_actor_side(p_request_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when get_employee_id() is null or r.id is null then null
    when coalesce(is_super_admin(), false) then 'purchasing'
    when m.employee_id is not null and has_purchasing_access() then 'purchasing'
    when m.side = 'requester' then 'requester'
    when m.side = 'sales' or r.buyer_id = get_employee_id() then 'sales'
    when m.employee_id is not null then 'other'
    else null
  end
  from (select 1) one
  left join purchase_requests r on r.id = p_request_id
  left join purchase_request_members m
    on m.request_id = r.id and m.employee_id = get_employee_id();
$$;

comment on function public.purchase_request_actor_side(uuid) is
  '#306, #179: the caller''s side for Requested Item status changes — purchasing (Super Admin, or a member with Purchasing access), requester (a Direct request''s Requester: may only cancel), sales (a sales-side member, or the Buyer: may only cancel), other, or null for a non-member.';

create or replace function public.purchase_request_can_add_substitute(p_request_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(is_super_admin(), false)
      or exists (select 1 from purchase_requests r where r.id = p_request_id and r.buyer_id = get_employee_id());
$$;

comment on function public.purchase_request_can_add_substitute(uuid) is
  '#306: whether the caller may add a substitute item — the request''s Buyer (whatever their side), or a Super Admin.';

create or replace function public.purchase_request_set_item_status(
  p_item_id uuid,
  p_status text,
  p_details jsonb default '{}'::jsonb
) returns public.purchase_request_items
language plpgsql
security definer
set search_path = public
as $$
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
    'requested', 'from_stock', 'to_order', 'canvassing', 'ordered', 'received',
    'substituted', 'cannot_source', 'cancelled'
  ) then
    raise exception 'purchase_request_set_item_status: % is not an item status', coalesce(p_status, 'null') using errcode = '22023';
  end if;
  if jsonb_typeof(v_details) <> 'object' then
    raise exception 'purchase_request_set_item_status: details must be an object' using errcode = '22023';
  end if;

  -- Only Ordered takes details: its PO number and what Odoo said about it.
  if p_status <> 'ordered' and v_details <> '{}'::jsonb then
    raise exception 'purchase_request_set_item_status: % takes no details', public._purchase_request_item_status_label(p_status)
      using errcode = '22023';
  end if;
  for v_key in select jsonb_object_keys(v_details) loop
    if v_key not in ('po_number', 'po_verification') then
      raise exception 'purchase_request_set_item_status: Ordered takes a PO number and its check, not %', v_key
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
$$;

comment on function public.purchase_request_set_item_status(uuid, text, jsonb) is
  '#306/#312: moves a Requested Item along its status path. Checks the transition and the caller''s side (purchasing walks the path; the sales side may only cancel), records who and when, and posts the change in the request. Ordered alone takes details: an optional `po_number` (P + digits) and its Odoo check `po_verification`, stored on the item.';

create or replace function public.purchase_request_add_substitute(
  p_item_id uuid,
  p_name text,
  p_quantity numeric,
  p_unit text default null,
  p_description text default null,
  p_images jsonb default '[]'::jsonb
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := public.get_employee_id();
  v_images jsonb := coalesce(p_images, '[]'::jsonb);
  v_original public.purchase_request_items;
  v_req public.purchase_requests;
  v_side text;
  v_item public.purchase_request_items;
  v_amount text;
begin
  if v_actor is null then
    raise exception 'purchase_request_add_substitute: not signed in' using errcode = '42501';
  end if;

  select * into v_original from public.purchase_request_items where id = p_item_id for update;
  if v_original.id is null then
    raise exception 'purchase_request_add_substitute: item % not found', p_item_id using errcode = 'P0002';
  end if;
  select * into v_req from public.purchase_requests where id = v_original.request_id;

  v_side := public.purchase_request_actor_side(v_req.id);
  if not public.purchase_request_can_add_substitute(v_req.id) then
    raise exception 'purchase_request_add_substitute: only the request''s Buyer may add a substitute' using errcode = '42501';
  end if;
  if not public._purchase_request_item_transition_ok(v_original.status, 'substituted', v_side) then
    raise exception 'purchase_request_add_substitute: % is already closed', v_original.name using errcode = '22023';
  end if;

  if nullif(btrim(p_name), '') is null then
    raise exception 'purchase_request_add_substitute: a substitute needs a name' using errcode = '22023';
  end if;
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'purchase_request_add_substitute: the quantity must be more than zero' using errcode = '22023';
  end if;
  if jsonb_typeof(v_images) <> 'array'
     or jsonb_array_length(v_images) > 5
     or exists (
       select 1 from jsonb_array_elements(v_images) img
       where jsonb_typeof(img) <> 'object' or nullif(img->>'url', '') is null
     ) then
    raise exception 'purchase_request_add_substitute: images must be up to 5 uploaded files' using errcode = '22023';
  end if;

  insert into public.purchase_request_items
    (request_id, source, name, unit, quantity, description, images, substitute_for_item_id, requested_by)
  values
    (v_req.id, 'new', btrim(p_name), nullif(btrim(p_unit), ''), p_quantity,
     nullif(btrim(p_description), ''), v_images, v_original.id, v_actor)
  returning * into v_item;

  v_amount := trim_scale(v_item.quantity)::text || coalesce(' ' || v_item.unit, '');
  perform public._purchase_request_post_event(
    v_req.id,
    v_actor,
    format('Offered %s × %s as a substitute for %s.', v_item.name, v_amount, v_original.name),
    jsonb_build_object('event', 'item_added', 'item_id', v_item.id, 'source', v_item.source,
                       'substitute_for_item_id', v_original.id)
  );

  perform public._purchase_request_item_move(
    v_original, 'substituted', v_side, v_actor,
    jsonb_build_object('substitute_item_id', v_item.id), 'purchase_request_add_substitute'
  );

  return v_item.id;
end;
$$;

comment on function public.purchase_request_add_substitute(uuid, text, numeric, text, text, jsonb) is
  '#306: the Buyer adds a new-product Requested Item that replaces another (linked by substitute_for_item_id); the original moves to Substituted. Both post in the request.';

create or replace function public.purchase_request_take(p_request_id uuid)
returns public.purchase_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := public.get_employee_id();
  v_req public.purchase_requests;
  v_name text;
begin
  if v_actor is null then
    raise exception 'purchase_request_take: not signed in' using errcode = '42501';
  end if;
  if not public.has_purchasing_access() then
    raise exception 'purchase_request_take: only someone with Purchasing access may take a request' using errcode = '42501';
  end if;

  select * into v_req from public.purchase_requests where id = p_request_id for update;
  if v_req.id is null then
    raise exception 'purchase_request_take: request % not found', p_request_id using errcode = 'P0002';
  end if;
  if v_req.buyer_id is not null then
    select name into v_name from public.employees where id = v_req.buyer_id;
    raise exception 'purchase_request_take: % is already the Buyer', coalesce(v_name, 'someone else') using errcode = '55000';
  end if;

  update public.purchase_requests set buyer_id = v_actor where id = p_request_id
  returning * into v_req;

  perform public._purchase_request_add_member(p_request_id, v_actor, v_actor);

  select name into v_name from public.employees where id = v_actor;
  perform public._purchase_request_post_event(
    p_request_id, v_actor,
    format('%s took the request as Buyer.', coalesce(v_name, 'Someone')),
    jsonb_build_object('event', 'buyer_set', 'buyer_id', v_actor, 'previous_buyer_id', null, 'taken', true)
  );

  return v_req;
end;
$$;

comment on function public.purchase_request_take(uuid) is
  '#307: the caller, who has Purchasing access, becomes the Buyer of an unassigned request (and a member). Refused once the request has a Buyer.';

create or replace function public.purchase_request_set_buyer(p_request_id uuid, p_employee_id uuid)
returns public.purchase_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := public.get_employee_id();
  v_req public.purchase_requests;
  v_previous uuid;
  v_name text;
begin
  if v_actor is null then
    raise exception 'purchase_request_set_buyer: not signed in' using errcode = '42501';
  end if;
  if not public.purchase_request_can_manage_members(p_request_id) then
    raise exception 'purchase_request_set_buyer: only a purchasing member or a Super Admin may name the Buyer' using errcode = '42501';
  end if;

  select * into v_req from public.purchase_requests where id = p_request_id for update;
  if v_req.id is null then
    raise exception 'purchase_request_set_buyer: request % not found', p_request_id using errcode = 'P0002';
  end if;
  if v_req.buyer_id is not distinct from p_employee_id then
    raise exception 'purchase_request_set_buyer: nothing to change' using errcode = '22023';
  end if;
  if p_employee_id is not null and not public._employee_has_purchasing_access(p_employee_id) then
    raise exception 'purchase_request_set_buyer: the Buyer must have Purchasing access' using errcode = '22023';
  end if;

  v_previous := v_req.buyer_id;
  update public.purchase_requests set buyer_id = p_employee_id where id = p_request_id
  returning * into v_req;

  if p_employee_id is not null then
    perform public._purchase_request_add_member(p_request_id, p_employee_id, v_actor);
    select name into v_name from public.employees where id = p_employee_id;
  end if;

  perform public._purchase_request_post_event(
    p_request_id, v_actor,
    case when p_employee_id is null
      then 'The request has no Buyer now; it is back in the queue.'
      else format('%s is the Buyer.', coalesce(v_name, 'Someone'))
    end,
    jsonb_build_object('event', 'buyer_set', 'buyer_id', p_employee_id, 'previous_buyer_id', v_previous)
  );

  return v_req;
end;
$$;

comment on function public.purchase_request_set_buyer(uuid, uuid) is
  '#307: a purchasing member or Super Admin names the request''s Buyer (someone with Purchasing access, added as a member), or clears it (null) to return the request to the queue.';

create or replace function public.purchase_request_item_po_lines(p_item_id uuid)
returns int[]
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_item public.purchase_request_items;
begin
  if public.get_employee_id() is null then
    raise exception 'purchase_request_item_po_lines: not signed in' using errcode = '42501';
  end if;
  select * into v_item from public.purchase_request_items where id = p_item_id;
  if v_item.id is null or not public.can_read_purchase_request(v_item.request_id) then
    raise exception 'purchase_request_item_po_lines: item % not found', p_item_id using errcode = 'P0002';
  end if;
  if v_item.po_number is null then
    return '{}'::int[];
  end if;
  return coalesce(public._ipas_po_line_ids(v_item.po_number), '{}'::int[]);
end;
$$;

comment on function public.purchase_request_item_po_lines(uuid) is
  '#312: the Odoo PO line ids on the IPAS stored Odoo copy of an item''s PO — what the line picker offers. Empty with no PO number, or while the PO has no IPAS.';

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
    raise exception 'purchase_request_pick_po_lines: only Purchasing picks an item''s PO line' using errcode = '42501';
  end if;
  if v_item.status not in ('ordered', 'received') then
    raise exception 'purchase_request_pick_po_lines: % is %, not Ordered', v_item.name,
      public._purchase_request_item_status_label(v_item.status)
      using errcode = '22023';
  end if;
  if v_item.po_number is null then
    raise exception 'purchase_request_pick_po_lines: % has no PO number', v_item.name using errcode = '22023';
  end if;

  if p_line_ids is null or cardinality(p_line_ids) = 0 or array_position(p_line_ids, null) is not null then
    raise exception 'purchase_request_pick_po_lines: pick at least one PO line' using errcode = '22023';
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
    format('%s: PO line picked on %s.', v_item.name, v_item.po_number),
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

comment on function public.purchase_request_pick_po_lines(uuid, int[]) is
  '#312: Purchasing records the Odoo PO line(s) an Ordered item is bought on. Refuses any line not on the IPAS stored Odoo copy of the item''s PO (all of them while that PO has no IPAS); posts the pick in the request.';



create or replace function public.purchase_request_queue(p_request_id uuid default null)
returns table (
  id uuid,
  opportunity_id uuid,
  sales_reference text,
  project_title text,
  stage_name text,
  sor_closed text,
  buyer_id uuid,
  buyer_name text,
  buyer_avatar_path text,
  created_at timestamptz,
  updated_at timestamptz,
  item_count integer,
  open_count integer,
  last_activity_at timestamptz,
  sor_status text,
  title text
)
language sql
stable
security definer
set search_path = public
as $function$
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
    r.title
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

comment on function public.purchase_request_queue(uuid) is
  '#308, #179: the Purchase Requests list — every Purchase Request the caller may read: a Project request with its SOR''s locked header (reference, project, Stage, and sor_closed: deleted or lost; sor_status, the legacy status for an SOR with no Flow Stage), the Buyer, item counts and last activity. A Direct request (no SOR) carries its title instead. With p_request_id, that one request.';

revoke all on function public.purchase_request_actor_side(uuid) from public, anon;
revoke all on function public.purchase_request_can_add_substitute(uuid) from public, anon;
revoke all on function public.purchase_request_set_item_status(uuid, text, jsonb) from public, anon;
revoke all on function public.purchase_request_add_substitute(uuid, text, numeric, text, text, jsonb) from public, anon;
revoke all on function public.purchase_request_take(uuid) from public, anon;
revoke all on function public.purchase_request_set_buyer(uuid, uuid) from public, anon;
revoke all on function public.purchase_request_item_po_lines(uuid) from public, anon;
revoke all on function public.purchase_request_pick_po_lines(uuid, int[]) from public, anon;
revoke all on function public.purchase_request_queue(uuid) from public, anon;

grant execute on function public.purchase_request_actor_side(uuid) to authenticated;
grant execute on function public.purchase_request_can_add_substitute(uuid) to authenticated;
grant execute on function public.purchase_request_set_item_status(uuid, text, jsonb) to authenticated;
grant execute on function public.purchase_request_add_substitute(uuid, text, numeric, text, text, jsonb) to authenticated;
grant execute on function public.purchase_request_take(uuid) to authenticated;
grant execute on function public.purchase_request_set_buyer(uuid, uuid) to authenticated;
grant execute on function public.purchase_request_item_po_lines(uuid) to authenticated;
grant execute on function public.purchase_request_pick_po_lines(uuid, int[]) to authenticated;
grant execute on function public.purchase_request_queue(uuid) to authenticated;

-- ------------------------------------------------------------------------------
-- The old names: thin aliases of the new ones
-- ------------------------------------------------------------------------------
-- Same signature, defaults, result, volatility and security as before, so
-- `create or replace` keeps their grants. Errors come from the new name; the
-- app strips that prefix before showing a refusal.

create or replace function public.pr_actor_side(p_request_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select public.purchase_request_actor_side(p_request_id);
$$;

create or replace function public.pr_can_add_substitute(p_request_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.purchase_request_can_add_substitute(p_request_id);
$$;

create or replace function public.pr_set_item_status(
  p_item_id uuid,
  p_status text,
  p_details jsonb default '{}'::jsonb
) returns public.purchase_request_items
language sql
security definer
set search_path = public
as $$
  select * from public.purchase_request_set_item_status(p_item_id, p_status, p_details);
$$;

create or replace function public.pr_add_substitute(
  p_item_id uuid,
  p_name text,
  p_quantity numeric,
  p_unit text default null,
  p_description text default null,
  p_images jsonb default '[]'::jsonb
) returns uuid
language sql
security definer
set search_path = public
as $$
  select public.purchase_request_add_substitute(p_item_id, p_name, p_quantity, p_unit, p_description, p_images);
$$;

create or replace function public.pr_take(p_request_id uuid)
returns public.purchase_requests
language sql
security definer
set search_path = public
as $$
  select * from public.purchase_request_take(p_request_id);
$$;

create or replace function public.pr_set_buyer(p_request_id uuid, p_employee_id uuid)
returns public.purchase_requests
language sql
security definer
set search_path = public
as $$
  select * from public.purchase_request_set_buyer(p_request_id, p_employee_id);
$$;

create or replace function public.pr_item_po_lines(p_item_id uuid)
returns int[]
language sql
stable
security definer
set search_path = public
as $$
  select public.purchase_request_item_po_lines(p_item_id);
$$;

create or replace function public.pr_pick_po_lines(p_item_id uuid, p_line_ids int[])
returns public.purchase_request_items
language sql
security definer
set search_path = public
as $$
  select * from public.purchase_request_pick_po_lines(p_item_id, p_line_ids);
$$;

create or replace function public.pr_queue(p_request_id uuid default null)
returns table (
  id uuid,
  opportunity_id uuid,
  sales_reference text,
  project_title text,
  stage_name text,
  sor_closed text,
  buyer_id uuid,
  buyer_name text,
  buyer_avatar_path text,
  created_at timestamptz,
  updated_at timestamptz,
  item_count integer,
  open_count integer,
  last_activity_at timestamptz,
  sor_status text,
  title text
)
language sql
stable
security definer
set search_path = public
as $$
  select * from public.purchase_request_queue(p_request_id);
$$;

comment on function public.pr_actor_side(uuid) is
  '#506: alias of purchase_request_actor_side, kept so an older frontend keeps working.';
comment on function public.pr_can_add_substitute(uuid) is
  '#506: alias of purchase_request_can_add_substitute, kept so an older frontend keeps working.';
comment on function public.pr_set_item_status(uuid, text, jsonb) is
  '#506: alias of purchase_request_set_item_status, kept so an older frontend keeps working.';
comment on function public.pr_add_substitute(uuid, text, numeric, text, text, jsonb) is
  '#506: alias of purchase_request_add_substitute, kept so an older frontend keeps working.';
comment on function public.pr_take(uuid) is
  '#506: alias of purchase_request_take, kept so an older frontend keeps working.';
comment on function public.pr_set_buyer(uuid, uuid) is
  '#506: alias of purchase_request_set_buyer, kept so an older frontend keeps working.';
comment on function public.pr_item_po_lines(uuid) is
  '#506: alias of purchase_request_item_po_lines, kept so an older frontend keeps working.';
comment on function public.pr_pick_po_lines(uuid, int[]) is
  '#506: alias of purchase_request_pick_po_lines, kept so an older frontend keeps working.';
comment on function public.pr_queue(uuid) is
  '#506: alias of purchase_request_queue, kept so an older frontend keeps working.';

-- Reasserted, though `create or replace` keeps them.
revoke all on function public.pr_actor_side(uuid) from public, anon;
revoke all on function public.pr_can_add_substitute(uuid) from public, anon;
revoke all on function public.pr_set_item_status(uuid, text, jsonb) from public, anon;
revoke all on function public.pr_add_substitute(uuid, text, numeric, text, text, jsonb) from public, anon;
revoke all on function public.pr_take(uuid) from public, anon;
revoke all on function public.pr_set_buyer(uuid, uuid) from public, anon;
revoke all on function public.pr_item_po_lines(uuid) from public, anon;
revoke all on function public.pr_pick_po_lines(uuid, int[]) from public, anon;
revoke all on function public.pr_queue(uuid) from public, anon;

grant execute on function public.pr_actor_side(uuid) to authenticated;
grant execute on function public.pr_can_add_substitute(uuid) to authenticated;
grant execute on function public.pr_set_item_status(uuid, text, jsonb) to authenticated;
grant execute on function public.pr_add_substitute(uuid, text, numeric, text, text, jsonb) to authenticated;
grant execute on function public.pr_take(uuid) to authenticated;
grant execute on function public.pr_set_buyer(uuid, uuid) to authenticated;
grant execute on function public.pr_item_po_lines(uuid) to authenticated;
grant execute on function public.pr_pick_po_lines(uuid, int[]) to authenticated;
grant execute on function public.pr_queue(uuid) to authenticated;
