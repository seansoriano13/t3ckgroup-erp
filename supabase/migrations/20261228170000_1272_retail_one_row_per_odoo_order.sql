-- #1272 (spec #1271): one retail_orders row per Odoo order, real Marketplace Order IDs only.

-- 1. A row whose order number is not a real Odoo name (S01234) is a leftover of the old
--    queue import. Staging has one, named 'false', a second copy of an order that is also
--    stored under its real name. Only a row whose Odoo id is held by another row is removed,
--    so nothing is lost on a database where such a row is the only copy.
delete from public.retail_orders r
where r.odoo_so_number !~ '^S[0-9]+$'
  and r.odoo_so_id is not null
  and exists (
    select 1 from public.retail_orders o
    where o.odoo_so_id = r.odoo_so_id and o.id <> r.id and o.odoo_so_number ~ '^S[0-9]+$'
  );

-- 2. The database refuses a second row for the same Odoo order. (Nulls stay allowed: a row
--    with no Odoo id yet does not clash.) If a clash is left after step 1, this fails loudly
--    on purpose: someone looks at the two rows instead of the migration choosing for them.
create unique index if not exists retail_orders_odoo_so_id_key
  on public.retail_orders (odoo_so_id);

-- 3. The sync keeps a stored Marketplace Order ID when a note gives none, so ids that do not
--    look like one (letters and digits, at least 8, with a digit) are cleared here. The same
--    shape as parseIncomeNote.
update public.retail_orders
set marketplace_order_id = null
where marketplace_order_id is not null
  and (marketplace_order_id !~ '^[0-9A-Za-z]{8,}$' or marketplace_order_id !~ '[0-9]');
