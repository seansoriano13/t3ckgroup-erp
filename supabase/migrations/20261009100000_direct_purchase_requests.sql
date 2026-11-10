-- ==============================================================================
-- 20261009100000_direct_purchase_requests.sql
--
-- Issue #179 (follow-up to #209) — any employee opens a Purchase Request with
-- no SOR, a Direct request, for Purchasing to buy something outside a project.
-- A Purchase Request is Project when it has an SOR and Direct when it has
-- none; the kind is never stored.
--
-- THE REQUEST
--   `title` names a Direct request (required there; a Project request shows
--   its SOR). `purchase_request_open(title, items)` opens one: the caller is
--   its Requester and first member; everyone with Purchasing access joins, as
--   they join every live request; an `opened` event tells Purchasing; then
--   each item goes in as a new product. Nobody approves it.
--
-- THE REQUESTER SIDE
--   A new member side, `requester`, for whoever opened a Direct request: the
--   Deal Team's rights on a Project request (add items, cancel them, chat) and
--   nothing more. With Purchasing access they sit on the purchasing side
--   instead, and may take and buy their own request. The side comes from
--   `_purchase_request_side_on(request, employee)`, which the member functions
--   now use; `purchase_request_member_side` stays for its callers.
--
-- RENAMED
--   The Procurement Queue is now Purchase Requests: the two "Take it from"
--   notification texts say so. `pr_queue` returns `title`.
--
-- SAFE TO RUN AT ANY TIME, against a live frontend of any version: one
-- nullable column, one more allowed side, redefinitions with unchanged
-- behaviour for Project requests, `pr_queue` recreated with one more column
-- (an older frontend ignores it), one new function. Idempotent.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- Schema
-- ------------------------------------------------------------------------------

alter table public.purchase_requests
  add column if not exists title text;

alter table public.purchase_requests drop constraint if exists purchase_requests_title_chk;
alter table public.purchase_requests add constraint purchase_requests_title_chk
  check (
    (title is null or char_length(title) between 1 and 120)
    and (opportunity_id is not null or nullif(btrim(title), '') is not null)
  );

comment on column public.purchase_requests.title is
  'What a Direct request (no SOR, #179) is for, as its Requester named it. Required when opportunity_id is null; a Project request shows its SOR instead.';

alter table public.purchase_request_members drop constraint if exists purchase_request_members_side_chk;
alter table public.purchase_request_members add constraint purchase_request_members_side_chk
  check (side in ('purchasing', 'sales', 'requester', 'other'));

-- ------------------------------------------------------------------------------
-- Sides
-- ------------------------------------------------------------------------------

-- The side a person sits on in one request: purchasing with Purchasing access;
-- requester if they opened a Direct request; sales on the SOR's Deal Team;
-- otherwise other.
create or replace function public._purchase_request_side_on(p_req public.purchase_requests, p_employee_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when public._employee_has_purchasing_access(p_employee_id) then 'purchasing'
    when p_req.opportunity_id is null and p_req.created_by = p_employee_id then 'requester'
    else public.purchase_request_member_side(p_req.opportunity_id, p_employee_id)
  end;
$$;

revoke all on function public._purchase_request_side_on(public.purchase_requests, uuid) from public, anon, authenticated;

create or replace function public._purchase_request_add_member(
  p_request_id uuid,
  p_employee_id uuid,
  p_actor uuid
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_req public.purchase_requests;
  v_side text;
  v_added uuid;
begin
  select * into v_req from public.purchase_requests where id = p_request_id;
  v_side := public._purchase_request_side_on(v_req, p_employee_id);

  insert into public.purchase_request_members (request_id, employee_id, side, added_by)
  values (p_request_id, p_employee_id, v_side, p_actor)
  on conflict (request_id, employee_id) do nothing
  returning id into v_added;

  if v_added is null then
    return false;
  end if;

  if v_side = 'purchasing' then
    perform public._purchase_request_open_window(v_req, p_employee_id);
  end if;

  return true;
end;
$$;

revoke all on function public._purchase_request_add_member(uuid, uuid, uuid) from public, anon, authenticated;

-- Who may add items: the Buyer, the sales side (a sales-side member, or a
-- member on the SOR's Deal Team), and a Direct request's Requester, on
-- whichever side their Purchasing access puts them.
create or replace function public.purchase_request_can_add_items(p_request_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from purchase_requests r
    where r.id = p_request_id
      and get_employee_id() is not null
      and (
        r.buyer_id = get_employee_id()
        or (r.opportunity_id is null and r.created_by = get_employee_id())
        or exists (
          select 1 from purchase_request_members m
          where m.request_id = r.id
            and m.employee_id = get_employee_id()
            and (
              m.side in ('sales', 'requester')
              or exists (
                select 1 from sales_opportunities o, public._sor_deal_team_roles(o) t
                where o.id = r.opportunity_id and t.employee_id = m.employee_id
              )
            )
        )
      )
  );
$$;

-- The Requester may only cancel, like the sales side.
create or replace function public._purchase_request_item_transition_ok(p_from text, p_to text, p_side text)
returns boolean
language sql
immutable
set search_path = public
as $$
  select case
    when public._purchase_request_item_is_closed(p_from) then false
    when p_side in ('sales', 'requester') then p_to = 'cancelled'
    when p_side = 'purchasing' then
      p_to in ('substituted', 'cannot_source', 'cancelled')
      or (p_from = 'requested'  and p_to in ('from_stock', 'to_order'))
      or (p_from = 'to_order'   and p_to in ('canvassing', 'ordered'))
      or (p_from = 'canvassing' and p_to = 'ordered')
      or (p_from = 'ordered'    and p_to = 'received')
    else false
  end;
$$;

create or replace function public.pr_actor_side(p_request_id uuid)
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

comment on function public.pr_actor_side(uuid) is
  '#306, #179: the caller''s side for Requested Item status changes — purchasing (Super Admin, or a member with Purchasing access), requester (a Direct request''s Requester: may only cancel), sales (a sales-side member, or the Buyer: may only cancel), other, or null for a non-member.';

-- ------------------------------------------------------------------------------
-- Naming and notifying
-- ------------------------------------------------------------------------------

-- "S01234 — Project title" for a Project request, its title for a Direct one.
create or replace function public._purchase_request_label(p_request_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    nullif(concat_ws(' — ', nullif(coalesce(o.sales_reference, o.opportunity_no), ''), nullif(o.project_title, '')), ''),
    nullif(btrim(r.title), ''),
    'a Purchase Request'
  )
  from (select 1) one
  left join purchase_requests r on r.id = p_request_id
  left join sales_opportunities o on o.id = r.opportunity_id;
$$;

revoke all on function public._purchase_request_label(uuid) from public, anon, authenticated;

-- Body unchanged from 20261005130600 but for the list's new name.
create or replace function public._purchase_request_message_notify()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_req public.purchase_requests;
  v_event text := new.metadata->>'event';
  v_label text;
  v_author text;
  v_mentioned uuid[] := '{}';
  v_requesters uuid[];
  v_item public.purchase_request_items;
  v_buyer uuid;
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
    end if;

  elsif v_event = 'item_status_changed' then
    select * into v_item from public.purchase_request_items
    where id = nullif(new.metadata->>'item_id', '')::uuid;
    perform public._purchase_request_notify(
      v_req.id, array[v_req.buyer_id, v_item.requested_by], new.author_id,
      'PURCHASE_REQUEST_ITEM_STATUS',
      'Requested Item updated',
      v_label || ': ' || new.content
    );

  elsif v_event = 'item_added' then
    perform public._purchase_request_notify(
      v_req.id, array[v_req.buyer_id], new.author_id, 'PURCHASE_REQUEST_ITEM_ADDED',
      'Item requested',
      v_label || ': ' || new.content
    );

  elsif v_event is null then
    select array_agg(distinct x) into v_requesters
    from (
      select v_req.created_by as x
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
$$;

revoke all on function public._purchase_request_message_notify() from public, anon, authenticated;

-- Body unchanged from 20261005131900 but for the side lookup and the list's new name.
create or replace function public._purchase_request_purchasing_access_changed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := public.get_employee_id();
  v_req public.purchase_requests;
begin
  -- An AFTER trigger: the row as changed is what the rule reads.
  if public._employee_has_purchasing_access(new.id) then
    for v_req in
      select r.* from public.purchase_requests r where public._purchase_request_is_live(r)
    loop
      if not public._purchase_request_add_member(v_req.id, new.id, v_actor) then
        update public.purchase_request_members
        set side = 'purchasing'
        where request_id = v_req.id and employee_id = new.id and side <> 'purchasing';
        if found then
          perform public._purchase_request_open_window(v_req, new.id);
        end if;
      end if;
    end loop;
  elsif tg_op = 'UPDATE' then
    -- A Buyer must hold Purchasing access (pr_set_buyer): their live requests go
    -- back to the queue, the way clearing the Buyer does, and Purchasing hears.
    for v_req in
      select r.* from public.purchase_requests r
      where r.buyer_id = new.id and public._purchase_request_is_live(r)
    loop
      update public.purchase_requests set buyer_id = null where id = v_req.id;
      perform public._purchase_request_post_event(
        v_req.id, v_actor,
        format('%s no longer has Purchasing access; the request is back in the queue.', new.name),
        jsonb_build_object('event', 'buyer_set', 'buyer_id', null, 'previous_buyer_id', new.id)
      );
      perform public._purchase_request_notify(
        v_req.id,
        array(select e.id from public.employees e where public._employee_has_purchasing_access(e.id)),
        v_actor, 'PURCHASE_REQUEST_REQUEUED',
        'Back in the queue',
        public._purchase_request_label(v_req.id) || ' needs a Buyer. Take it from Purchase Requests.',
        false
      );
    end loop;

    -- Where they'd now be on the other side and nobody chose them, they were
    -- only there to buy: they leave (the queue that shows those requests needs
    -- the access). The Deal Team, a Buyer of a closed request, and anyone added
    -- by hand or as an action's extra stay, on the side they'd otherwise have.
    delete from public.purchase_request_members m
    using public.purchase_requests r
    where r.id = m.request_id and m.employee_id = new.id and m.side = 'purchasing'
      and r.buyer_id is distinct from new.id
      and public._purchase_request_side_on(r, new.id) = 'other'
      and not public._purchase_request_member_was_chosen(r, new.id);

    update public.purchase_request_members m
    set side = public._purchase_request_side_on(r, new.id)
    from public.purchase_requests r
    where r.id = m.request_id and m.employee_id = new.id and m.side = 'purchasing';

    update public.sor_stage_participants
    set closed_at = now(), closed_reason = 'access_revoked', removed_by = v_actor
    where source = 'purchase_request' and employee_id = new.id and closed_at is null;
  end if;
  return null;
end;
$$;

revoke all on function public._purchase_request_purchasing_access_changed() from public, anon, authenticated;

-- Recreated with `title` (the return type changes); body otherwise unchanged from 20261005132200.
drop function if exists public.pr_queue(uuid);

create function public.pr_queue(p_request_id uuid default null)
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

comment on function public.pr_queue(uuid) is
  '#308, #179: the Purchase Requests list — every Purchase Request the caller may read: a Project request with its SOR''s locked header (reference, project, Stage, and sor_closed: deleted or lost; sor_status, the legacy status for an SOR with no Flow Stage), the Buyer, item counts and last activity. A Direct request (no SOR) carries its title instead. With p_request_id, that one request.';

revoke all on function public.pr_queue(uuid) from public, anon;
grant execute on function public.pr_queue(uuid) to authenticated;

-- ------------------------------------------------------------------------------
-- Opening a Direct request
-- ------------------------------------------------------------------------------

-- p_items: [{name, quantity, unit?, description?, images?}], at least one.
create or replace function public.purchase_request_open(p_title text, p_items jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := public.get_employee_id();
  v_title text := btrim(p_title);
  v_req public.purchase_requests;
  v_item jsonb;
  v_emp uuid;
begin
  if v_actor is null then
    raise exception 'purchase_request_open: not signed in' using errcode = '42501';
  end if;
  if nullif(v_title, '') is null then
    raise exception 'purchase_request_open: a Purchase Request needs a title' using errcode = '22023';
  end if;
  if char_length(v_title) > 120 then
    raise exception 'purchase_request_open: the title must be 120 characters or fewer' using errcode = '22023';
  end if;
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'purchase_request_open: ask for at least one item' using errcode = '22023';
  end if;
  if jsonb_array_length(p_items) > 50 then
    raise exception 'purchase_request_open: at most 50 items at once' using errcode = '22023';
  end if;

  insert into public.purchase_requests (title, created_by)
  values (v_title, v_actor)
  returning * into v_req;

  -- The Requester, then everyone with Purchasing access (a live request).
  perform public._purchase_request_add_member(v_req.id, v_actor, v_actor);
  for v_emp in
    select e.id from public.employees e where public._employee_has_purchasing_access(e.id)
  loop
    perform public._purchase_request_add_member(v_req.id, v_emp, v_actor);
  end loop;

  -- No Buyer yet: the `opened` event tells everyone with Purchasing access.
  insert into public.purchase_request_messages (request_id, author_id, content, metadata)
  values (v_req.id, v_actor, 'Purchase Request opened.', jsonb_build_object('event', 'opened'));

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    if jsonb_typeof(v_item) <> 'object' then
      raise exception 'purchase_request_open: each item must be an object' using errcode = '22023';
    end if;
    perform public.purchase_request_add_new_item(
      v_req.id,
      v_item->>'name',
      nullif(v_item->>'quantity', '')::numeric,
      v_item->>'unit',
      v_item->>'description',
      coalesce(v_item->'images', '[]'::jsonb)
    );
  end loop;

  return v_req.id;
end;
$$;

comment on function public.purchase_request_open(text, jsonb) is
  '#179: any employee opens a Direct Purchase Request (no SOR) with a title and new-product items; they are its Requester, Purchasing joins and hears. Returns the request id.';

revoke all on function public.purchase_request_open(text, jsonb) from public, anon;
grant execute on function public.purchase_request_open(text, jsonb) to authenticated;
