-- 20261105020000_drop_unused_request_item_functions.sql
--
-- Two request-item functions nothing calls any more (#675):
--   * purchase_request_add_substitute (and its pr_ alias): "Offer a substitute". Replace a product
--     (#687, purchase_request_replace_item) took its place and no screen offers a substitute now.
--   * purchase_request_add_items_from_components: the "add from the Costing Matrix" dialog was
--     deleted (#678); the S0 line's own item is made and kept in step by the database.
--
-- Only the functions go. Existing items, their substitute_for_item_id links, history and every
-- row-conversion/backfill step in earlier migrations are untouched. Idempotent.

drop function if exists public.pr_add_substitute(uuid, text, numeric, text, text, jsonb);
drop function if exists public.purchase_request_add_substitute(uuid, text, numeric, text, text, jsonb);
drop function if exists public.purchase_request_add_items_from_components(uuid, uuid[]);
