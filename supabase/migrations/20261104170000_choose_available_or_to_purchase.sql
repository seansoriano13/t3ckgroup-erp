-- ==============================================================================
-- 20261104170000_choose_available_or_to_purchase.sql
--
-- #681 (spec #675): mark a product Available or To purchase from the stock check.
--
-- By hand, people choose only Available, To purchase, Cannot source and Cancelled:
--   * Available / To purchase: Purchasing, the sales side and any other deal member
--     (a Direct request's Requester has no deal and may only cancel);
--   * Cannot source: Purchasing only;
--   * Cancelled: unchanged.
-- Choosing again is allowed between Not checked, Available and To purchase, so a
-- line whose stock warning is up can be confirmed or changed. Still canvassing,
-- Purchased and Received are never chosen by a deal member.
--
-- "Now x free of y": when a fresh stock check shows an Available line has fewer
-- free than it needs, the line stores the two figures. Any status choice (the same
-- one again included) clears them.
-- ==============================================================================

alter table public.purchase_request_items
  add column if not exists stock_short_free numeric,
  add column if not exists stock_short_needed numeric;

comment on column public.purchase_request_items.stock_short_free is
  'Free stock a fresh stock check found for an Available line that now needs more (the x of "Now x free of y"). Null = no warning. Cleared by any status choice. #681.';
comment on column public.purchase_request_items.stock_short_needed is
  'The quantity the line needs (the y of "Now x free of y"), as it stood at that stock check. #681.';

-- ------------------------------------------------------------------------------
-- Who may choose what
-- ------------------------------------------------------------------------------

create or replace function public._purchase_request_item_transition_ok(p_from text, p_to text, p_side text)
returns boolean
language sql
immutable
set search_path to 'public'
as $$
  select case
    when p_to in ('available', 'to_purchase')
         and p_from in ('not_checked', 'available', 'to_purchase')
         and p_side in ('purchasing', 'sales', 'other') then true
    when public._purchase_request_item_is_closed(p_from) then false
    when p_side = 'purchasing' then
      p_to in ('cannot_source', 'cancelled')
      or (p_from = 'to_purchase'      and p_to in ('still_canvassing', 'purchased'))
      or (p_from = 'still_canvassing' and p_to = 'purchased')
      or (p_from = 'purchased'        and p_to = 'received')
    when p_side in ('sales', 'requester') then p_to = 'cancelled'
    else false
  end;
$$;

-- ------------------------------------------------------------------------------
-- Any status choice clears the warning; choosing Available again is allowed
-- while a warning is up (it is how the warning is cleared without changing status).
-- ------------------------------------------------------------------------------

do $patch$
declare
  v_def text := pg_get_functiondef('public._purchase_request_item_move(public.purchase_request_items,text,text,uuid,jsonb,text)'::regprocedure);
  v_new text;
begin
  if v_def like '%stock_short_free%' then return; end if;
  v_new := replace(v_def, 'if p_item.status = p_to then',
                   'if p_item.status = p_to and not (p_to = ''available'' and p_item.stock_short_free is not null) then');
  if v_new = v_def then
    raise exception '#681: _purchase_request_item_move no longer has the "already" check this patch expects';
  end if;
  v_def := v_new;
  v_new := replace(v_def, 'set status = p_to,', 'set status = p_to, stock_short_free = null, stock_short_needed = null,');
  if v_new = v_def then
    raise exception '#681: _purchase_request_item_move no longer has the status update this patch expects';
  end if;
  execute v_new;
end
$patch$;

-- ------------------------------------------------------------------------------
-- A fresh stock check flags Available lines that are no longer covered
-- ------------------------------------------------------------------------------

create or replace function public._flag_short_available_items()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.purchase_request_items i
     set stock_short_free = coalesce((NEW.data->'products'->(i.odoo_product_id::text)->>'free')::numeric, 0),
         stock_short_needed = i.quantity
    from public.purchase_requests r
   where r.id = i.request_id
     and r.opportunity_id = NEW.opportunity_id
     and i.status = 'available'
     and i.odoo_product_id is not null
     and NEW.data->'products'->(i.odoo_product_id::text)->>'type' = 'product'
     and coalesce((NEW.data->'products'->(i.odoo_product_id::text)->>'free')::numeric, 0) < i.quantity;
  return null;
end;
$$;

revoke all on function public._flag_short_available_items() from public, anon, authenticated;

drop trigger if exists sor_stock_snapshots_flag_short_available on public.sor_stock_snapshots;
create trigger sor_stock_snapshots_flag_short_available
  after insert or update of data on public.sor_stock_snapshots
  for each row execute function public._flag_short_available_items();
