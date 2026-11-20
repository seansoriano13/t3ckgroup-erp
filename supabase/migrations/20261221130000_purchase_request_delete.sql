-- Delete (soft) and restore a Purchase Request.
-- A deleted request is hidden everywhere a request is read, but keeps its PR
-- number, items, chat and canvass. Purchasing and Super Admin can restore it.

alter table public.purchase_requests
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid references public.employees(id),
  add column if not exists delete_reason text;

-- Hidden for everyone (Super Admin included) once deleted. The Deleted view
-- reads through purchase_request_deleted_list() instead.
create or replace function public.can_read_purchase_request(p_request_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select not exists (
      select 1 from purchase_requests r
      where r.id = p_request_id and r.deleted_at is not null
    )
    and (
      coalesce(is_super_admin(), false)
      or is_purchase_request_member(p_request_id)
      or (
        has_purchasing_access()
        and exists (
          select 1 from purchase_requests r
          where r.id = p_request_id and r.buyer_id is null
        )
      )
    );
$$;

-- A deleted request is not live: it drops out of buyer hand-offs and counts.
create or replace function public._purchase_request_is_live(p_req purchase_requests)
returns boolean
language sql
stable
set search_path to 'public'
as $$
  select p_req.deleted_at is null
    and not exists (
      select 1 from sales_opportunities o
      where o.id = p_req.opportunity_id and public._sor_closed_for_purchasing(o)
    )
    and (
      public._purchase_request_has_open_items(p_req.id)
      or not exists (select 1 from purchase_request_items i where i.request_id = p_req.id)
    );
$$;

-- Direct requests listed on an SOR: leave out deleted ones.
create or replace function public.direct_requests_for_sor(p_opportunity_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
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
            case when exists (select 1 from public.purchase_request_items it where it.request_id = r.id)
                 then 'cancelled' else 'not_checked' end
          ) as status
      ) i on true
     where r.for_opportunity_id = p_opportunity_id
       and r.opportunity_id is null
       and r.deleted_at is null
  ), '[]'::jsonb);
end;
$$;

-- Delete: the requester who opened it, any Purchasing member, or a Super Admin.
-- Refused once a line is purchased, received or on an IPAS.
create or replace function public.purchase_request_delete(p_request_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_actor uuid := public.get_employee_id();
  v_req public.purchase_requests;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_label text;
begin
  if v_actor is null then
    raise exception 'purchase_request_delete: not signed in' using errcode = '42501';
  end if;
  if v_reason = '' then
    raise exception 'Say why you are deleting this request.' using errcode = '22023';
  end if;

  select * into v_req from public.purchase_requests where id = p_request_id for update;
  if not found or v_req.deleted_at is not null then
    raise exception 'That request no longer exists.' using errcode = '22023';
  end if;

  if not (
    coalesce(public.is_super_admin(), false)
    or coalesce(public.has_purchasing_access(), false)
    or v_req.created_by = v_actor
  ) then
    raise exception 'purchase_request_delete: not allowed' using errcode = '42501';
  end if;

  if exists (
    select 1 from public.purchase_request_items i
    where i.request_id = p_request_id
      and (i.status in ('purchased', 'received') or i.ipas_number is not null or i.ipas_pending)
  ) then
    raise exception 'A line is already purchased, received or on an IPAS. Cancel those lines one by one instead.'
      using errcode = '22023';
  end if;

  update public.purchase_requests
     set deleted_at = now(), deleted_by = v_actor, delete_reason = v_reason, updated_at = now()
   where id = p_request_id;

  v_label := coalesce(v_req.pr_number, 'Purchase Request');
  perform public._purchase_request_post_event(
    p_request_id, v_actor,
    'Deleted this request: ' || v_reason,
    jsonb_build_object('event', 'deleted', 'reason', v_reason)
  );
  perform public._purchase_request_notify(
    p_request_id,
    array(select m.employee_id from public.purchase_request_members m where m.request_id = p_request_id),
    v_actor, 'PURCHASE_REQUEST_DELETED',
    v_label || ' was deleted', v_reason, true
  );
end;
$$;

-- Restore: Purchasing or Super Admin only.
create or replace function public.purchase_request_restore(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_actor uuid := public.get_employee_id();
  v_req public.purchase_requests;
begin
  if v_actor is null or not (
    coalesce(public.is_super_admin(), false) or coalesce(public.has_purchasing_access(), false)
  ) then
    raise exception 'purchase_request_restore: not allowed' using errcode = '42501';
  end if;

  select * into v_req from public.purchase_requests where id = p_request_id for update;
  if not found or v_req.deleted_at is null then
    raise exception 'That request is not deleted.' using errcode = '22023';
  end if;

  update public.purchase_requests
     set deleted_at = null, deleted_by = null, delete_reason = null, updated_at = now()
   where id = p_request_id;

  perform public._purchase_request_post_event(
    p_request_id, v_actor, 'Restored this request.', jsonb_build_object('event', 'restored')
  );
  perform public._purchase_request_notify(
    p_request_id,
    array(select m.employee_id from public.purchase_request_members m where m.request_id = p_request_id),
    v_actor, 'PURCHASE_REQUEST_RESTORED',
    coalesce(v_req.pr_number, 'Purchase Request') || ' was restored', 'It is back in the queue.', true
  );
end;
$$;

-- The Deleted view: Purchasing and Super Admin.
create or replace function public.purchase_request_deleted_list()
returns table(
  id uuid, pr_number text, title text, sales_reference text, opportunity_id uuid,
  item_count integer, deleted_at timestamptz, deleted_by_name text, delete_reason text
)
language sql
stable
security definer
set search_path to 'public'
as $$
  select
    r.id,
    r.pr_number,
    r.title,
    coalesce(nullif(o.sales_reference, ''), o.sor_code, o.opportunity_no),
    r.opportunity_id,
    (select count(*)::integer from public.purchase_request_items it where it.request_id = r.id),
    r.deleted_at,
    e.name,
    r.delete_reason
  from public.purchase_requests r
  left join public.sales_opportunities o on o.id = r.opportunity_id
  left join public.employees e on e.id = r.deleted_by
  where r.deleted_at is not null
    and (coalesce(public.is_super_admin(), false) or coalesce(public.has_purchasing_access(), false))
  order by r.deleted_at desc;
$$;

revoke all on function public.purchase_request_delete(uuid, text) from public, anon;
revoke all on function public.purchase_request_restore(uuid) from public, anon;
revoke all on function public.purchase_request_deleted_list() from public, anon;
grant execute on function public.purchase_request_delete(uuid, text) to authenticated;
grant execute on function public.purchase_request_restore(uuid) to authenticated;
grant execute on function public.purchase_request_deleted_list() to authenticated;
