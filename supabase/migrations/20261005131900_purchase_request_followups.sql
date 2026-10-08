-- ==============================================================================
-- 20261005131900_purchase_request_followups.sql
--
-- Two gaps left open when #209 shipped:
--
-- 1. THE BUYER ISN'T TOLD WHEN THE SOR GOES AWAY
--    An SOR closes for Purchasing when it is deleted, or moves to a Terminal
--    Stage other than its flow's Won Stage (lost). On the move from open to
--    closed, a request with open items tells its Buyer once
--    (`PURCHASE_REQUEST_SOR_CLOSED`); with no Buyer yet, its purchasing members.
--    Lost then deleted is still one closing. On the move back (restored from the
--    Deleted view, or reverted off the lost Stage) the same people hear
--    `PURCHASE_REQUEST_SOR_REOPENED`. The request and its history stay.
--
-- 2. PURCHASING HOLDERS FOLLOW THE ACCESS
--    Someone granted Purchasing access joins every live request: one whose SOR
--    hasn't closed and which has an open item or no items yet. A member already
--    there on another side moves to the purchasing side and gets the SOR window.
--    Someone who loses the access leaves the requests where they'd now be on
--    the other side; as the Buyer or on the Deal Team they stay, on that side.
--    Their SOR windows close. No chat event is posted.
--
-- 3. THE QUEUE SAYS WHEN THE SOR HAS CLOSED
--    `pr_queue` gains `sor_closed`, and its reference falls back to the SOR
--    Code before "No SOR".
--
-- SAFE TO RUN AT ANY TIME, against a live frontend of any version: helper
-- functions, one redefinition with unchanged behaviour, triggers, and
-- `pr_queue` recreated with one more column (an older frontend ignores it).
-- Idempotent.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- Helpers
-- ------------------------------------------------------------------------------

-- Whether an SOR is closed for Purchasing: deleted, or on a Terminal Stage
-- other than its flow's Won Stage.
create or replace function public._sor_closed_for_purchasing(p_opp public.sales_opportunities)
returns boolean
language sql
stable
set search_path = public
as $$
  select coalesce(p_opp.is_deleted, false) or exists (
    select 1
    from flow_stages s
    join sales_flows f on f.id = s.flow_id
    where s.id = p_opp.flow_stage_id
      and s.is_terminal
      and s.id is distinct from f.won_stage_id
  );
$$;

revoke all on function public._sor_closed_for_purchasing(public.sales_opportunities) from public, anon, authenticated;

create or replace function public._purchase_request_has_open_items(p_request_id uuid)
returns boolean
language sql
stable
set search_path = public
as $$
  select exists (
    select 1 from purchase_request_items i
    where i.request_id = p_request_id
      and not public._purchase_request_item_is_closed(i.status)
  );
$$;

revoke all on function public._purchase_request_has_open_items(uuid) from public, anon, authenticated;

-- Whether a request is still being worked: its SOR (if any) hasn't closed, and
-- it has an open item or no items yet.
create or replace function public._purchase_request_is_live(p_req public.purchase_requests)
returns boolean
language sql
stable
set search_path = public
as $$
  select not exists (
      select 1 from sales_opportunities o
      where o.id = p_req.opportunity_id and public._sor_closed_for_purchasing(o)
    )
    and (
      public._purchase_request_has_open_items(p_req.id)
      or not exists (select 1 from purchase_request_items i where i.request_id = p_req.id)
    );
$$;

revoke all on function public._purchase_request_is_live(public.purchase_requests) from public, anon, authenticated;

-- Opens a purchasing member's window into the SOR (#208), with the action's
-- rule, unless the window is over or already open.
create or replace function public._purchase_request_open_window(p_req public.purchase_requests, p_employee_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_req.opportunity_id is not null
     and not public._purchase_request_window_over(p_req)
     and not exists (
       select 1 from public.sor_stage_participants p
       where p.opportunity_id = p_req.opportunity_id
         and p.employee_id = p_employee_id
         and p.source = 'purchase_request'
         and p.source_id = p_req.id
         and p.closed_at is null
     ) then
    insert into public.sor_stage_participants
      (opportunity_id, employee_id, source, source_id, opened_visit_id, until_rule, until_stage_id)
    values
      (p_req.opportunity_id, p_employee_id, 'purchase_request', p_req.id, p_req.opened_visit_id,
       p_req.access_until, p_req.access_until_stage_id);
  end if;
end;
$$;

revoke all on function public._purchase_request_open_window(public.purchase_requests, uuid) from public, anon, authenticated;

-- Unchanged behaviour; the window now lives in _purchase_request_open_window.
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
  v_side := public.purchase_request_member_side(v_req.opportunity_id, p_employee_id);

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

-- ------------------------------------------------------------------------------
-- 1. SOR closed or reopened -> tell the Buyer
-- ------------------------------------------------------------------------------

drop trigger if exists purchase_request_sor_closed_notify on public.sales_opportunities;
drop function if exists public._purchase_request_sor_closed_notify();

create or replace function public._purchase_request_sor_status_notify()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_closed boolean := public._sor_closed_for_purchasing(new);
  v_req public.purchase_requests;
  v_recipients uuid[];
  v_happened text;
begin
  if v_closed = public._sor_closed_for_purchasing(old) then
    return null;
  end if;

  select * into v_req from public.purchase_requests where opportunity_id = new.id;
  if v_req.id is null or not public._purchase_request_has_open_items(v_req.id) then
    return null;
  end if;

  if v_req.buyer_id is not null then
    v_recipients := array[v_req.buyer_id];
  else
    select array_agg(m.employee_id) into v_recipients
    from public.purchase_request_members m
    where m.request_id = v_req.id and m.side = 'purchasing';
  end if;

  v_happened := case
    when v_closed and coalesce(new.is_deleted, false) then 'was deleted'
    when v_closed then 'was lost'
    when coalesce(old.is_deleted, false) then 'was restored'
    else 'was reopened'
  end;

  perform public._purchase_request_notify(
    v_req.id,
    v_recipients,
    public.get_employee_id(),
    case when v_closed then 'PURCHASE_REQUEST_SOR_CLOSED' else 'PURCHASE_REQUEST_SOR_REOPENED' end,
    'SOR ' || v_happened,
    format('%s %s. Its Purchase Request still has open items.', public._purchase_request_label(v_req.id), v_happened),
    false
  );
  return null;
end;
$$;

revoke all on function public._purchase_request_sor_status_notify() from public, anon, authenticated;

drop trigger if exists purchase_request_sor_status_notify on public.sales_opportunities;
create trigger purchase_request_sor_status_notify
  after update of is_deleted, flow_stage_id on public.sales_opportunities
  for each row execute function public._purchase_request_sor_status_notify();

-- ------------------------------------------------------------------------------
-- 2. Purchasing access granted or lost -> memberships follow
-- ------------------------------------------------------------------------------

drop trigger if exists purchase_request_new_purchaser on public.employees;
drop function if exists public._purchase_request_new_purchaser();

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
    -- Where they'd now be on the other side, they were only there to buy: they
    -- leave (the queue that shows those requests needs the access). The Deal
    -- Team and the Buyer stay, on the side they'd otherwise have.
    delete from public.purchase_request_members m
    using public.purchase_requests r
    where r.id = m.request_id and m.employee_id = new.id and m.side = 'purchasing'
      and r.buyer_id is distinct from new.id
      and public.purchase_request_member_side(r.opportunity_id, new.id) = 'other';

    update public.purchase_request_members m
    set side = public.purchase_request_member_side(r.opportunity_id, new.id)
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

drop trigger if exists purchase_request_access_granted_on_insert on public.employees;
create trigger purchase_request_access_granted_on_insert
  after insert on public.employees
  for each row execute function public._purchase_request_purchasing_access_changed();

drop trigger if exists purchase_request_access_changed on public.employees;
create trigger purchase_request_access_changed
  after update of has_purchasing_flow, is_deleted on public.employees
  for each row
  when (old.has_purchasing_flow is distinct from new.has_purchasing_flow
        or old.is_deleted is distinct from new.is_deleted)
  execute function public._purchase_request_purchasing_access_changed();

-- ------------------------------------------------------------------------------
-- 3. The queue says when the SOR has closed
-- ------------------------------------------------------------------------------
-- `pr_queue` gains `sor_closed` ('deleted', 'lost' or null), so a request on a
-- dead SOR doesn't read as plain Open. Its reference also falls back to the
-- SOR Code, so an SOR with no Sales Reference no longer reads as "No SOR".
-- The return type changes, so the function is dropped and recreated.

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
  last_activity_at timestamptz
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
    case
      when o.id is null or not public._sor_closed_for_purchasing(o) then null
      when coalesce(o.is_deleted, false) then 'deleted'
      else 'lost'
    end,
    r.buyer_id,
    b.name,
    b.avatar_path,
    r.created_at,
    r.updated_at,
    coalesce(i.item_count, 0)::integer,
    coalesce(i.open_count, 0)::integer,
    greatest(r.updated_at, m.last_message_at)
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
  '#308: the Procurement Queue — every Purchase Request the caller may read, with the SOR''s locked header (reference, project, Stage, and sor_closed: deleted or lost), the Buyer, item counts and last activity. With p_request_id, that one request.';

revoke all on function public.pr_queue(uuid) from public, anon;
grant execute on function public.pr_queue(uuid) to authenticated;
