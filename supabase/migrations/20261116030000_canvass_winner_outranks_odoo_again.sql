-- A Canvass winner outranks an Odoo fill again (it still never replaces a typed cost).
--
-- #701 (20261107100000_701_cost_source.sql) let the winner replace an Acquire that came from Odoo.
-- #721 (20261113030000_721_canvass_no_other_supplier.sql) redefined canvass_apply_winner from an
-- older copy and lost that clause, so on an S0 line that already had its Odoo cost the winner
-- filled nothing and the sheet kept showing "Odoo". This puts the clause back, the way #701 did.
--
-- SAFE TO RUN AT ANY TIME. Idempotent: a function that already has the clause is left as it is.

-- canvass_apply_winner (latest: 20261113030000_721_canvass_no_other_supplier.sql)
do $$
declare
  v_old text := pg_get_functiondef('public.canvass_apply_winner(uuid,uuid)'::regprocedure);
  v_new text;
begin
  if position('v_cost.acquire_source = ''odoo''' in v_old) > 0 then
    return;
  end if;
  v_new := replace(
    v_old,
    'if v_cost.acquire_from_offer_id is not null or v_cost.acquire_unit is null then',
    'if v_cost.acquire_from_offer_id is not null or v_cost.acquire_unit is null or v_cost.acquire_source = ''odoo'' then'
  );
  if v_new = v_old then
    raise exception 'canvass_apply_winner no longer has the line this migration rewrites';
  end if;
  execute v_new;
end
$$;
