-- #314 (spec #209): the old way of buying goes.
--
-- `sor_raise_procurement_task` raised the purchasing individual task from the
-- SOR's Purchasing panel. Nothing calls it any more (the panel is gone and
-- `sor_procurement_requests` is read-only since #313).
--
-- Canvass, Offers and Inclusions tables and rows are untouched.

drop function if exists public.sor_raise_procurement_task(uuid, uuid, text, jsonb, text, text, uuid, text);
