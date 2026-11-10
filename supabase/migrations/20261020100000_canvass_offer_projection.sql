-- Offer Projection (#321, spec #316): what a Component's Markup Price would be if each Offer won.
--
-- WHAT THIS DOES
--   canvass_offer_projection(canvass_id)
--                          one entry per Offer on a Component's Canvass: the Acquire in PHP the
--                          Offer would fill (price as quoted, or price x comparison rate, to the
--                          centavo, the same figure canvass_apply_winner writes) and the Markup
--                          Price per unit that follows from it, at the Component's own factor or the
--                          matrix default.
--
-- WHY IN THE DATABASE
--   Purchasing may see the Markup Price but never the factor behind it (the Closed Book). The
--   markup is worked out here as the owner, so the Purchasing tier gets the peso figure and the
--   factor stays server-side, the way costing_component_markup_price already serves the price tier.
--
-- ACCESS
--   Returned only to the Closed Book and Purchasing (cost) tiers on the Component's SOR. Every other
--   caller, a Canvass on a Requested Item, or no Canvass at all, gets null. Nothing is written.
--
-- SAFE TO RUN AT ANY TIME: one function is created.

create or replace function public.canvass_offer_projection(p_canvass_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_component uuid;
  v_factor    numeric;
  v_result    jsonb;
begin
  select c.component_id into v_component from public.sor_canvasses c where c.id = p_canvass_id;
  if v_component is null then
    return null;
  end if;

  if coalesce(public.costing_tier(public.canvass_component_opportunity(v_component)), '') not in ('closed_book', 'cost') then
    return null;
  end if;

  select k.markup_factor into v_factor from public.costing_component_costs k where k.component_id = v_component;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'offer_id', o.id,
      'acquire_unit', a.acquire,
      'markup_price_unit', public.costing_component_markup_price(v_component, a.acquire, v_factor)
    ) order by o.sort_order, o.created_at
  ), '[]'::jsonb)
  into v_result
  from public.sor_canvass_offers o
  left join public.sor_canvass_offer_prices p on p.offer_id = o.id
  cross join lateral (
    select case
      when p.unit_price is null then null
      when o.currency = 'PHP' then round(p.unit_price, 2)
      when p.comparison_rate is null then null
      else round(p.unit_price * p.comparison_rate, 2)
    end as acquire
  ) a
  where o.canvass_id = p_canvass_id;

  return v_result;
end
$$;

comment on function public.canvass_offer_projection(uuid) is
  '#321: per Offer, the Acquire (PHP) and Markup Price per unit if it won. Closed Book and Purchasing tiers only; null otherwise. Computed as the owner so the factor never leaves the database.';

revoke all on function public.canvass_offer_projection(uuid) from public, anon;
grant execute on function public.canvass_offer_projection(uuid) to authenticated, service_role;
