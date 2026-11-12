-- #973 (spec #956): the Canvasses page lists one row per Purchase Request and needs, per row, what
-- its status badge and lock read from: whether the "No other supplier" note is set, how many lines
-- are open (not cancelled, not locked) and how many of those have a winner, how many lines are
-- locked, and the supplier and product names its search looks through.
--
-- #972: the S0 Evaluation's Canvass button opens the Canvass of the request that carries a line,
-- so costing_component_requests also gives each Requested Item its request's name.

drop function if exists public.canvass_list();

create function public.canvass_list()
returns table (
  id uuid,
  number text,
  request_id uuid,
  request_label text,
  opportunity_id uuid,
  sales_reference text,
  project_title text,
  canvasser_id uuid,
  canvasser_name text,
  supplier_count integer,
  line_count integer,
  quoted_line_count integer,
  winner_count integer,
  open_line_count integer,
  open_winner_count integer,
  locked_line_count integer,
  no_other_supplier boolean,
  supplier_names text[],
  product_names text[],
  created_by uuid,
  created_at timestamptz,
  updated_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  with lines as (
    select i.id, i.request_id, i.name,
           public.canvass_item_is_locked(i.id) as locked,
           exists (select 1 from public.request_canvass_winners w where w.item_id = i.id) as won
      from public.purchase_request_items i
     where i.status <> 'cancelled'
  )
  select c.id,
         c.number,
         req.id,
         public._purchase_request_label(req.id),
         opp.id,
         opp.sales_reference,
         opp.project_title,
         coalesce(c.canvasser_id, req.buyer_id),
         canvasser.name,
         (select count(*)::integer from public.request_canvass_suppliers s where s.canvass_id = c.id),
         (select count(*)::integer from lines l where l.request_id = req.id),
         (select count(distinct q.item_id)::integer from public.request_canvass_quotes q where q.canvass_id = c.id),
         (select count(*)::integer from lines l where l.request_id = req.id and l.won),
         (select count(*)::integer from lines l where l.request_id = req.id and not l.locked),
         (select count(*)::integer from lines l where l.request_id = req.id and not l.locked and l.won),
         (select count(*)::integer from lines l where l.request_id = req.id and l.locked),
         exists (select 1 from public.request_canvass_no_other_supplier n where n.canvass_id = c.id),
         coalesce((select array_agg(s.supplier_name order by s.sort_order, s.created_at)
                     from public.request_canvass_suppliers s where s.canvass_id = c.id), '{}'),
         coalesce((select array_agg(l.name order by l.name) from lines l where l.request_id = req.id), '{}'),
         c.created_by,
         c.created_at,
         c.updated_at
    from public.request_canvasses c
    join public.purchase_requests req on req.id = c.request_id
    left join public.sales_opportunities opp on opp.id = req.opportunity_id
    left join public.employees canvasser on canvasser.id = coalesce(c.canvasser_id, req.buyer_id)
   where public.canvass_can_read(c.id)
   order by coalesce(c.updated_at, c.created_at) desc, c.id
$$;

grant execute on function public.canvass_list() to authenticated;

create or replace function public.costing_component_requests(p_opportunity_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_matrix uuid;
begin
  if not public.costing_can_read(p_opportunity_id) then
    return null;
  end if;
  select id into v_matrix from public.costing_matrices where opportunity_id = p_opportunity_id;
  if v_matrix is null then
    return '[]'::jsonb;
  end if;

  return (
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', i.id,
          'component_id', ic.component_id,
          'status', i.status,
          'request_id', i.request_id,
          'request_label', public._purchase_request_label(i.request_id)
        )
        order by i.created_at, i.id
      ),
      '[]'::jsonb
    )
    from public._costing_item_components(p_opportunity_id) ic
    join public.purchase_request_items i on i.id = ic.item_id
  );
end;
$function$;

grant execute on function public.costing_component_requests(uuid) to authenticated;
