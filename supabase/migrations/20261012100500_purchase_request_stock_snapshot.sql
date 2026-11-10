-- #501 (follow-up to #209): a saved Requested Item shows its product's stock.
--
-- The request view read the SOR's stock snapshot (#202) straight from
-- sor_stock_snapshots, whose read policy wants 'full' or 'participant' SOR
-- access. A Buyer (or any purchasing member) is usually only 'locked' on the
-- SOR, so the read came back empty and every saved item said "Not checked".
--
-- This hands the same row to whoever may read the request, the way
-- purchase_request_item_lines hands over the SOR's lines. It is the SOR's one
-- snapshot, not a new stock source: the badge is still judged client-side by
-- stockBadge (src/constants/stock.js). Null when the request has no SOR, the
-- SOR's stock was never read, or the caller may not read the request.

create or replace function public.purchase_request_stock_snapshot(p_request_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object('fetched_at', s.fetched_at, 'data', s.data)
  from purchase_requests r
  join sor_stock_snapshots s on s.opportunity_id = r.opportunity_id
  where r.id = p_request_id
    and can_read_purchase_request(p_request_id);
$$;

comment on function public.purchase_request_stock_snapshot(uuid) is
  '#501: the request''s SOR stock snapshot ({ fetched_at, data }) for anyone who may read the request; null when there is none.';

revoke all on function public.purchase_request_stock_snapshot(uuid) from public, anon;
grant execute on function public.purchase_request_stock_snapshot(uuid) to authenticated;
