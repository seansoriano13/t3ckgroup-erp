-- ==============================================================================
-- 20261005130600_purchase_request_chat_and_buyer.sql
--
-- Issue #307 (part of #209) — the request's Chat, the Buyer, and who hears
-- about what.
--
-- THE CHAT
--   Members post straight into `purchase_request_messages` under its existing
--   insert policy (20261005130100: author is me, no `event`, member or Super
--   Admin). Mentions ride in `metadata.mentions` ([{id, name}]), the Mention
--   model the SOR and task chats use. Reads stay `can_read_purchase_request`.
--
-- THE BUYER
--   `pr_take(request)`      anyone with Purchasing access makes themselves the
--                           Buyer of an unassigned request (the queue's Take).
--                           Refused once someone else has it.
--   `pr_set_buyer(request, employee|null)`
--                           a purchasing member or Super Admin names the Buyer
--                           (someone with Purchasing access), or clears it so
--                           the request goes back to the queue.
--   Both add the Buyer as a member if they aren't one, and post a `buyer_set`
--   event.
--
-- WHO HEARS (one trigger on every message, `_purchase_request_message_notify`)
--   opened               no Buyer: everyone with Purchasing access, once.
--                        A Buyer already (the action's default): the Buyer.
--   buyer_set            the new Buyer, unless they set it themselves.
--   item_status_changed  the Buyer and the item's requester.
--   item_added           the Buyer.
--   a member's message   the Buyer and the requesters (who opened the request,
--                        and who asked for its items).
--   a mention            the person mentioned, whoever they are — instead of
--                        the ordinary message notification. Only members can
--                        be mentioned; a mention of anyone else is ignored
--                        (they couldn't open the request).
--   Nobody hears about their own action; recipients must still be members
--   (except the opening fan-out, which goes to every Purchasing flag holder)
--   and not deleted. Before a Buyer, "the Buyer" is simply nobody: the rest of
--   purchasing already heard once, on open.
--   Notification types all start `PURCHASE_REQUEST_` (never containing
--   "TASK": notificationRouter falls through on that substring); reference_id
--   is the request id.
--
--   Routing lives in a trigger rather than in the RPCs so it never collides
--   with the parallel tickets that redefine `pr_set_item_status` and friends:
--   every change already posts a message, and the message is what notifies.
--
-- LIVE UPDATES
--   A row-id broadcast on `purchase_request_messages-changes` (the tasks /
--   sales_opportunities contract: id + request_id, never content), for
--   `useTableRealtime`. Every item, member and Buyer change posts a message,
--   so this one stream covers the whole request.
--
-- SAFE TO RUN AT ANY TIME: new functions and triggers only (CREATE OR REPLACE,
-- triggers dropped and recreated); nothing existing is redefined. Idempotent.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- Notifying
-- ------------------------------------------------------------------------------

-- "S01234 — Project title", or whatever part of it exists.
create or replace function public._purchase_request_label(p_request_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    nullif(concat_ws(' — ', nullif(coalesce(o.sales_reference, o.opportunity_no), ''), nullif(o.project_title, '')), ''),
    'a Purchase Request'
  )
  from (select 1) one
  left join purchase_requests r on r.id = p_request_id
  left join sales_opportunities o on o.id = r.opportunity_id;
$$;

revoke all on function public._purchase_request_label(uuid) from public, anon, authenticated;

-- Inserts one notification per recipient, skipping nulls, the sender, the
-- deleted, duplicates, and (when `p_members_only`) anyone not a member.
create or replace function public._purchase_request_notify(
  p_request_id uuid,
  p_recipients uuid[],
  p_sender uuid,
  p_type text,
  p_title text,
  p_message text,
  p_members_only boolean default true
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.notifications (recipient_id, sender_id, type, title, message, reference_id)
  select distinct e.id, p_sender, p_type, p_title, left(p_message, 280), p_request_id::text
  from unnest(coalesce(p_recipients, '{}'::uuid[])) as r(id)
  join public.employees e on e.id = r.id
  where not coalesce(e.is_deleted, false)
    and e.id is distinct from p_sender
    and (
      not p_members_only
      or exists (
        select 1 from public.purchase_request_members m
        where m.request_id = p_request_id and m.employee_id = e.id
      )
    );
end;
$$;

revoke all on function public._purchase_request_notify(uuid, uuid[], uuid, text, text, text, boolean)
  from public, anon, authenticated;

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
        v_label || ' needs a Buyer. Take it from the Procurement Queue.',
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

drop trigger if exists purchase_request_messages_notify on public.purchase_request_messages;
create trigger purchase_request_messages_notify
after insert on public.purchase_request_messages
for each row execute function public._purchase_request_message_notify();

-- ------------------------------------------------------------------------------
-- Live updates: a nudge, never content
-- ------------------------------------------------------------------------------

do $$
begin
  if to_regclass('realtime.messages') is not null
     and not exists (
       select 1 from pg_policies
       where schemaname = 'realtime' and tablename = 'messages'
         and policyname = 'authenticated can receive broadcasts'
     ) then
    create policy "authenticated can receive broadcasts"
      on "realtime"."messages"
      for select
      to authenticated
      using (true);
  end if;
end $$;

create or replace function public.purchase_request_messages_broadcast_change()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
begin
  begin
    perform realtime.send(
      jsonb_build_object('id', new.id, 'request_id', new.request_id),
      tg_op,
      'purchase_request_messages-changes',
      true -- private: gated by the realtime.messages policy, not public
    );
  exception when others then
    null;
  end;
  return null;
end;
$function$;

drop trigger if exists purchase_request_messages_broadcast_change_trigger on public.purchase_request_messages;
create trigger purchase_request_messages_broadcast_change_trigger
after insert on public.purchase_request_messages
for each row execute function public.purchase_request_messages_broadcast_change();

-- ------------------------------------------------------------------------------
-- The Buyer
-- ------------------------------------------------------------------------------

create or replace function public.pr_take(p_request_id uuid)
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
    raise exception 'pr_take: not signed in' using errcode = '42501';
  end if;
  if not public.has_purchasing_access() then
    raise exception 'pr_take: only someone with Purchasing access may take a request' using errcode = '42501';
  end if;

  select * into v_req from public.purchase_requests where id = p_request_id for update;
  if v_req.id is null then
    raise exception 'pr_take: request % not found', p_request_id using errcode = 'P0002';
  end if;
  if v_req.buyer_id is not null then
    select name into v_name from public.employees where id = v_req.buyer_id;
    raise exception 'pr_take: % is already the Buyer', coalesce(v_name, 'someone else') using errcode = '55000';
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

comment on function public.pr_take(uuid) is
  '#307: the caller, who has Purchasing access, becomes the Buyer of an unassigned request (and a member). Refused once the request has a Buyer.';

create or replace function public.pr_set_buyer(p_request_id uuid, p_employee_id uuid)
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
    raise exception 'pr_set_buyer: not signed in' using errcode = '42501';
  end if;
  if not public.purchase_request_can_manage_members(p_request_id) then
    raise exception 'pr_set_buyer: only a purchasing member or a Super Admin may name the Buyer' using errcode = '42501';
  end if;

  select * into v_req from public.purchase_requests where id = p_request_id for update;
  if v_req.id is null then
    raise exception 'pr_set_buyer: request % not found', p_request_id using errcode = 'P0002';
  end if;
  if v_req.buyer_id is not distinct from p_employee_id then
    raise exception 'pr_set_buyer: nothing to change' using errcode = '22023';
  end if;
  if p_employee_id is not null and not public._employee_has_purchasing_access(p_employee_id) then
    raise exception 'pr_set_buyer: the Buyer must have Purchasing access' using errcode = '22023';
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

comment on function public.pr_set_buyer(uuid, uuid) is
  '#307: a purchasing member or Super Admin names the request''s Buyer (someone with Purchasing access, added as a member), or clears it (null) to return the request to the queue.';

-- ------------------------------------------------------------------------------
-- Grants: signed-in callers only
-- ------------------------------------------------------------------------------

revoke all on function public.pr_take(uuid) from public, anon;
revoke all on function public.pr_set_buyer(uuid, uuid) from public, anon;
revoke all on function public.purchase_request_messages_broadcast_change() from public, anon, authenticated;

grant execute on function public.pr_take(uuid) to authenticated;
grant execute on function public.pr_set_buyer(uuid, uuid) to authenticated;
