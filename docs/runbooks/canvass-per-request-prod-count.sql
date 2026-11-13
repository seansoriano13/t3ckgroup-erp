-- Canvass per request (spec #956, ticket #967): count the old per-line Canvasses BEFORE the prod run.
--
-- The migration 20261205100000_967_canvass_per_request.sql deletes every old Canvass, Offer, price,
-- "No other supplier" note and sign-off row. They are not converted. It must NOT be applied on prod
-- if a winner was picked for real work: that case goes back to the user, who decides what to keep.
--
-- READ ONLY. Run it on prod (Supabase SQL editor, or `psql "$PROD_DB_URL" -f` this file) and read the
-- three results. Nothing here writes.
--
--   1. totals       how many old Canvasses, Offers and winners there are
--   2. winners      one row per Canvass that has a winner: what it was for, who made it, and
--                   whether the winner already filled a Component or went into a Purchase Request
--   3. verdict      "SAFE TO RUN" when no winner was picked, otherwise "STOP"
--
-- A winner counts as "picked for real work" when it is not a rehearsal: the answer is in the
-- winners list (the SOR reference, the person, the date). The verdict is deliberately strict: any
-- winner at all is a STOP until the user has looked at the list.

-- 1. Totals ---------------------------------------------------------------------------------------
select
  (select count(*) from public.sor_canvasses)                                      as canvasses,
  (select count(*) from public.sor_canvasses where component_id is not null)       as on_a_component,
  (select count(*) from public.sor_canvasses where requested_item_id is not null)  as on_a_requested_item,
  (select count(*) from public.sor_canvasses
     where component_id is null and requested_item_id is null)                     as with_no_subject,
  (select count(*) from public.sor_canvass_offers)                                 as offers,
  (select count(*) from public.sor_canvass_offers where is_winner)                 as winners,
  (select count(*) from public.sor_canvass_no_other_supplier)                      as no_other_supplier_notes,
  (select count(*) from public.sor_canvass_signoff_events)                         as signoff_events,
  (select count(*) from public.costing_component_costs where acquire_from_offer_id is not null)
                                                                                   as acquire_filled_by_a_winner,
  (select count(*) from public.costing_components where offer_specification_from_offer_id is not null)
                                                                                   as spec_filled_by_a_winner,
  (select count(*) from public.purchase_request_item_prices)                       as request_item_prices;

-- 2. The winners -----------------------------------------------------------------------------------
select
  c.number                                                       as canvass,
  c.created_at::date                                             as made_on,
  creator.name                                                   as made_by,
  case
    when c.component_id is not null then 'component'
    when c.requested_item_id is not null then 'requested item'
    else 'no subject'
  end                                                            as on_a,
  coalesce(comp.name, item.name, c.product_name)                 as for_what,
  coalesce(opp_c.sales_reference, opp_i.sales_reference)         as sor,
  o.supplier_name                                                as winner,
  o.brand                                                        as brand,
  (c.request_made_at is not null)                                as a_request_was_made,
  (cost.acquire_from_offer_id = o.id)                            as filled_acquire,
  (comp.offer_specification_from_offer_id = o.id)                as filled_offer_specification
from public.sor_canvass_offers o
join public.sor_canvasses c on c.id = o.canvass_id
left join public.employees creator on creator.id = c.created_by
left join public.costing_components comp on comp.id = c.component_id
left join public.costing_tender_lines tl on tl.id = comp.tender_line_id
left join public.costing_matrices m on m.id = tl.matrix_id
left join public.sales_opportunities opp_c on opp_c.id = m.opportunity_id
left join public.costing_component_costs cost on cost.component_id = comp.id
left join public.purchase_request_items item on item.id = c.requested_item_id
left join public.purchase_requests req on req.id = item.request_id
left join public.sales_opportunities opp_i on opp_i.id = req.opportunity_id
where o.is_winner
order by c.created_at;

-- 3. Verdict ---------------------------------------------------------------------------------------
select case
         when count(*) = 0 then 'SAFE TO RUN: no Canvass has a winner, so nothing picked for real work is lost.'
         else 'STOP: ' || count(*) || ' winner(s) picked. Take the list above back to the user before applying the migration.'
       end as verdict
from public.sor_canvass_offers
where is_winner;
