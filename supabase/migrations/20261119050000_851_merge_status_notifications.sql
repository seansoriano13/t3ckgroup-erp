-- #851 (spec #844, decision 8): an item status change merges into the
-- recipient's unread status notification for the same Purchase Request from
-- the last 10 minutes, instead of inserting a new row. The merged row moves
-- back to the top (created_at = now()) and is unread again. Chat history is
-- untouched: every change still posts its own event message.
--
-- Known edge: undo_item_status finds the notification to withdraw by its exact
-- single-change message, so it no longer matches a merged row.

create or replace function public._purchase_request_notify_status_merge(
  p_request_id uuid,
  p_recipients uuid[],
  p_sender uuid,
  p_title text,
  p_label text,
  p_content text,   -- the single change, "Fire suit: Requested -> Purchased"
  p_detail text     -- the same change, short: "Fire suit -> Purchased"
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  v_old public.notifications;
  v_rest text;
  v_count int;
  v_details text;
  v_prefix text := p_label || ': ';
begin
  for r in
    select distinct e.id
    from unnest(coalesce(p_recipients, '{}'::uuid[])) as x(id)
    join public.employees e on e.id = x.id
    where not coalesce(e.is_deleted, false)
      and e.id is distinct from p_sender
      and exists (
        select 1 from public.purchase_request_members m
        where m.request_id = p_request_id and m.employee_id = e.id
      )
  loop
    v_old := null;
    select * into v_old
    from public.notifications n
    where n.recipient_id = r.id
      and n.type = 'PURCHASE_REQUEST_ITEM_STATUS'
      and n.reference_id = p_request_id::text
      and not coalesce(n.is_read, false)
      and n.created_at > now() - interval '10 minutes'
    order by n.created_at desc
    limit 1
    for update;

    if v_old.id is null then
      insert into public.notifications (recipient_id, sender_id, type, title, message, reference_id)
      values (r.id, p_sender, 'PURCHASE_REQUEST_ITEM_STATUS', p_title,
              left(v_prefix || p_content, 280), p_request_id::text);
    else
      v_rest := case when left(v_old.message, length(v_prefix)) = v_prefix
                     then substr(v_old.message, length(v_prefix) + 1) else v_old.message end;
      if v_rest ~ '^[0-9]+ products changed: ' then
        v_count := (substring(v_rest from '^([0-9]+) products changed: '))::int + 1;
        v_details := regexp_replace(v_rest, '^[0-9]+ products changed: ', '') || ', ' || p_detail;
      else
        v_count := 2;
        -- "Name: From → To (extra)" becomes "Name → To (extra)"
        v_details := regexp_replace(v_rest, '^(.*?): .*? → (.*)$', E'\\1 → \\2') || ', ' || p_detail;
      end if;
      update public.notifications
         set title = 'Requested Items updated',
             message = left(v_prefix || v_count || ' products changed: ' || v_details, 280),
             sender_id = p_sender,
             is_read = false,
             created_at = now()
       where id = v_old.id;
    end if;
  end loop;
end;
$$;

revoke all on function public._purchase_request_notify_status_merge(uuid, uuid[], uuid, text, text, text, text)
  from public, anon, authenticated;

-- Body as in 20261012100000, but the item_status_changed branch merges.
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

  elsif v_event is null then
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
