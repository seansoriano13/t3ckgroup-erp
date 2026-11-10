-- 20261104210000_combine_hand_moves_681_684.sql
--
-- #681 and #684 both rewrote _purchase_request_item_transition_ok. The later one (#684,
-- 20261104190000) dropped #681's rules (deal members choosing Available / To purchase, and
-- choosing again from Not checked, Available and To purchase). This puts both back:
--
--   * Available / To purchase: Purchasing, the sales side and any other deal member, from
--     Not checked, Available or To purchase (#681);
--   * Cannot source and Cancelled: Purchasing; Still canvassing from To purchase: Purchasing;
--   * Sales and a Direct request's Requester may only cancel;
--   * Purchased and Received are never chosen by hand: they follow the attached P0 (#684).
--
-- Idempotent (create or replace).

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
      or (p_from = 'to_purchase' and p_to = 'still_canvassing')
    when p_side in ('sales', 'requester') then p_to = 'cancelled'
    else false
  end;
$$;
