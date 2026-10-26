-- ==============================================================================
-- 20261104140000_direct_request_for_project.sql
--
-- Issue #689 (spec #675): a Direct request can name the SOR it is for.
--
-- A SEPARATE LINK
--   `purchase_requests.for_opportunity_id` is optional and only for a Direct
--   request (one with no `opportunity_id`). It never makes the request a
--   Project request: the kind is still worked out from `opportunity_id`, and
--   "at most one Project request per SOR" is untouched. The request does not
--   join the project's product list.
--
-- OPENING ONE
--   `purchase_request_open` takes an optional third argument, the SOR. Any
--   employee may name any SOR that exists; naming it grants nothing, because
--   reading the list below is checked against the SOR read rule.
--
-- THE SOR'S LIST
--   `direct_requests_for_sor(p_opportunity_id)` returns, per Direct request
--   made for that SOR: id, title, pr_number, p0 (the P0 numbers on its items,
--   comma separated, or null) and status (the least advanced item that is not
--   cancelled, or cancelled when all are, or not_checked with no items). No
--   money. A caller who cannot read the SOR gets nothing.
--
-- SAFE TO RUN AT ANY TIME: one nullable column, one function recreated with a
-- defaulted argument (an older frontend's two-argument call still works), one
-- new function. Idempotent.
-- ==============================================================================

alter table public.purchase_requests
  add column if not exists for_opportunity_id uuid
  references public.sales_opportunities (id) on delete set null;

alter table public.purchase_requests drop constraint if exists purchase_requests_for_opportunity_chk;
alter table public.purchase_requests add constraint purchase_requests_for_opportunity_chk
  check (for_opportunity_id is null or opportunity_id is null);

comment on column public.purchase_requests.for_opportunity_id is
  '#689: the SOR a Direct request is for, optional. Distinct from opportunity_id: a request with this set is still Direct and not part of the project''s product list.';

create index if not exists purchase_requests_for_opportunity_idx
  on public.purchase_requests (for_opportunity_id)
  where for_opportunity_id is not null;

drop function if exists public.purchase_request_open(text, jsonb);

create or replace function public.purchase_request_open(
  p_title text,
  p_items jsonb,
  p_for_opportunity_id uuid default null
)
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
  if p_for_opportunity_id is not null
     and not exists (select 1 from public.sales_opportunities o where o.id = p_for_opportunity_id) then
    raise exception 'purchase_request_open: that project does not exist' using errcode = '22023';
  end if;

  insert into public.purchase_requests (title, created_by, for_opportunity_id)
  values (v_title, v_actor, p_for_opportunity_id)
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

comment on function public.purchase_request_open(text, jsonb, uuid) is
  '#179, #689: any employee opens a Direct Purchase Request (no SOR) with a title and new-product items, optionally naming the SOR it is for (a separate link; it stays Direct). They are its Requester, Purchasing joins and hears. Returns the request id.';

revoke all on function public.purchase_request_open(text, jsonb, uuid) from public, anon;
grant execute on function public.purchase_request_open(text, jsonb, uuid) to authenticated;

create or replace function public.direct_requests_for_sor(p_opportunity_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_actor uuid := public.get_employee_id();
  v_sor public.sales_opportunities;
begin
  select * into v_sor from public.sales_opportunities o where o.id = p_opportunity_id;
  -- coalesce: an empty deal-team column makes sor_is_deal_team NULL, and `not NULL` would leak.
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
  ), '[]'::jsonb);
end;
$$;

comment on function public.direct_requests_for_sor(uuid) is
  '#689: the Direct requests made for one SOR: id, title, pr_number, p0 and status. No money. Empty for a caller who cannot read the SOR (sor_read: super admin, deal team, or sor_always_sees).';

revoke all on function public.direct_requests_for_sor(uuid) from public, anon;
grant execute on function public.direct_requests_for_sor(uuid) to authenticated;
