-- #502: once a Purchase Request has a Buyer, a plain chat message notifies
-- only the Buyer and the requesters (whoever requested its items), as #209
-- says. The request's creator (the Stage Action actor on a Project request)
-- is no longer told just for having opened it; a Direct request's creator
-- is its Requester and stays. Before a Buyer, nothing changes. Mentions and
-- the event notifications are untouched.

-- Body unchanged from 20261009100000 but for a plain message's recipients.
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
$$;

revoke all on function public._purchase_request_message_notify() from public, anon, authenticated;
