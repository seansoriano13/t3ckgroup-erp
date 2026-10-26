-- 20261104100000_purchase_request_number.sql
-- #683 (spec #675): every Purchase Request, Project or Direct, gets a short number
-- in the Canvass style: PR_ and four digits (PR_0042), from a sequence, so a number
-- is never reused. Purchasing writes it in a P0's Source Document for a Direct
-- request. Existing requests are numbered oldest first.
--
-- Additive: one new column and sequence, and the queue function gains `pr_number`
-- (dropped and recreated because its result type changes). Idempotent.

create sequence if not exists public.purchase_request_number_seq;

alter table public.purchase_requests add column if not exists pr_number text;

comment on column public.purchase_requests.pr_number is
  '#683: the request''s short number, PR_0042. Assigned on insert from purchase_request_number_seq and never changed.';

-- Existing requests, oldest first (only those still without one).
do $$
declare
  r record;
begin
  for r in
    select id from public.purchase_requests
    where pr_number is null
    order by created_at, id
  loop
    update public.purchase_requests
       set pr_number = 'PR_' || lpad(nextval('public.purchase_request_number_seq')::text, 4, '0')
     where id = r.id;
  end loop;
end
$$;

create unique index if not exists purchase_requests_pr_number_key
  on public.purchase_requests (pr_number);

create or replace function public.purchase_requests_assign_number()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Whatever the client sent, the number is the next one.
  new.pr_number := 'PR_' || lpad(nextval('public.purchase_request_number_seq')::text, 4, '0');
  return new;
end
$$;

drop trigger if exists trg_purchase_requests_assign_number on public.purchase_requests;
create trigger trg_purchase_requests_assign_number
  before insert on public.purchase_requests
  for each row execute function public.purchase_requests_assign_number();

create or replace function public.purchase_requests_keep_number()
returns trigger
language plpgsql
as $$
begin
  if new.pr_number is distinct from old.pr_number then
    raise exception 'A Purchase Request number is never changed.' using errcode = '42501';
  end if;
  return new;
end
$$;

drop trigger if exists trg_purchase_requests_keep_number on public.purchase_requests;
create trigger trg_purchase_requests_keep_number
  before update on public.purchase_requests
  for each row execute function public.purchase_requests_keep_number();

-- ------------------------------------------------------------------------------
-- The queue (and its old-name alias) carry the number
-- ------------------------------------------------------------------------------

drop function if exists public.pr_queue(uuid);
drop function if exists public.purchase_request_queue(uuid);

create function public.purchase_request_queue(p_request_id uuid default null)
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
  title text,
  pr_number text
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
  '#308, #179, #683: the Purchase Requests list — every Purchase Request the caller may read: a Project request with its SOR''s locked header (reference, project, Stage, and sor_closed: deleted or lost; sor_status, the legacy status for an SOR with no Flow Stage), the Buyer, item counts and last activity. A Direct request (no SOR) carries its title instead. Every request carries its pr_number (PR_0042). With p_request_id, that one request.';

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
  title text,
  pr_number text
)
language sql
stable
security definer
set search_path = public
as $$
  select * from public.purchase_request_queue(p_request_id);
$$;

comment on function public.pr_queue(uuid) is
  '#506: alias of purchase_request_queue, kept so an older frontend keeps working.';

revoke all on function public.purchase_request_queue(uuid) from public, anon;
revoke all on function public.pr_queue(uuid) from public, anon;
grant execute on function public.purchase_request_queue(uuid) to authenticated;
grant execute on function public.pr_queue(uuid) to authenticated;
