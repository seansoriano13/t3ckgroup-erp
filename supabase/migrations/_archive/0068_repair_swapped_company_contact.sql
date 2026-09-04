-- ==============================================================================
-- 0068_repair_swapped_company_contact.sql
--
-- Corrects the 14 SORs whose Company and Contact Person were entered the wrong
-- way round — the person's name in `client_name`, the organisation in
-- `contact_person`.
--
-- The field was labelled "Client" until ADR 0006, which reads just as
-- plausibly as the human you deal with as the agency that signs. 14 of 154
-- live records were filled in on that reading. It is not a second convention:
-- 70 records put the organisation in `client_name` and only 15 put one in
-- `contact_person`, and the swapped set includes four consecutive Sales
-- References (S07192/94/95/97) carrying the same "Mark Ferdinand M. Lucas" /
-- "The Office of Civil Defense" pair — one salesperson repeating one
-- misreading. The rename to "Company" is what stops it recurring; this
-- migration cleans up what it already caused.
--
-- Scoped to an EXPLICIT id list rather than a pattern. A regex that matched
-- "Government|Corp|Office|..." would find these rows today and then keep
-- firing against rows added later, eventually swapping a record that was
-- right. The list is the whole point: it cannot grow.
--
-- No audit-log rows are written. This is a schema-level data correction, not
-- something a user did, and fabricating 14 "someone edited this" entries would
-- pollute the very history those entries exist to make trustworthy. This file
-- is the record.
--
-- SAFE TO RUN AT ANY TIME:
--   * Touches only the two text columns, only on the listed ids.
--   * A no-op anywhere the ids do not exist (staging has none of them).
--   * Guarded so it cannot double-apply: each row is only swapped while it
--     still holds the values this migration was written against, so a second
--     run — or a run after somebody fixed a row by hand — changes nothing.
-- ==============================================================================

update public.sales_opportunities as s
   set client_name    = v.org,
       contact_person = v.person
  from (values
    ('9e5010e9-17ce-4029-9f1f-928f994fcfa4'::uuid, 'Jeffrey Santos',          'Mabalacat City Government, MDRRMO'),
    ('4fb5f69f-6fe7-4787-be06-047281590315'::uuid, 'Marko Emmanuel Longjas',  'Tagbilaran City Government'),
    ('7f8a04dd-d4d6-439f-83a2-93db2d9cd6ef'::uuid, 'Francis Valencia',        'Rizal Medical Center'),
    ('38b7bc8e-39e9-48c2-85d5-f375d38f942c'::uuid, 'Mark Ferdinand M. Lucas', 'The Office of Civil Defense'),
    ('b4c41467-d662-4b12-835b-e41273c41b62'::uuid, 'Mark Ferdinand M. Lucas', 'The Office of Civil Defense'),
    ('b803a810-4ded-4002-8a83-bc685304627a'::uuid, 'Mark Ferdinand M. Lucas', 'The Office of Civil Defense'),
    ('9567190e-b3c1-449a-b9f3-86f90ab47890'::uuid, 'Mark Ferdinand M. Lucas', 'The Office of Civil Defense'),
    ('f2546a79-0a89-4e5a-9a1c-517c0e8ae532'::uuid, 'Marie Jane P. Mansalay',  'Cabadbaran City Government'),
    ('ae35d379-c587-4d0e-b8b3-60dbe4908515'::uuid, 'Milagros Alquiza',        'Vigan City Government'),
    ('b0c935ea-02dd-4eaa-8321-9e67a20d4e3b'::uuid, 'Jeffrey Santos',          'Mabalacat City Government, MDRRMO'),
    ('406c3d93-a180-414a-87b5-27710b0ac80b'::uuid, 'Jennifer',                'Subic Bay Metropolitan Authority, Fire and Rescue team'),
    ('616b1cf4-877a-4bf5-8691-0a63536b6e80'::uuid, 'Mark Gelie Pungtilan',    'Region l Special Rescue Force, BFP'),
    ('7a5a3c4c-3920-4128-9ca9-21c589345e32'::uuid, 'Danila G. Albesa',        'Hindang Municipal Government'),
    ('e66ef695-233c-4caa-8b44-f01c3e3724c6'::uuid, 'Marko Emmanuel Longjas',  'Tagbilaran City Government,')
  ) as v(id, person, org)
 where s.id = v.id
   and s.client_name = v.person
   and s.contact_person = v.org;
