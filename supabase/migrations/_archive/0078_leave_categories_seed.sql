-- ==============================================================================
-- 0078_leave_categories_seed.sql
--
-- Ticket #71: hr_leave_categories (added by 0074) has never been seeded on
-- production. The apply form's category picker reads this table, so with it
-- empty no employee can submit a leave, offset, or overtime application at
-- all. Seeded from the category list this codebase's own pre-#64 hardcoded
-- record.type -> label map used (src/lib/pdf/layout.js), which is the best
-- record of production's real category list.
-- ==============================================================================

INSERT INTO public.hr_leave_categories (label, sort_order) VALUES
  ('Sick Leave', 1),
  ('Vacation Leave', 2),
  ('Maternity Leave', 3),
  ('Paternity Leave', 4),
  ('Bereavement Leave', 5),
  ('Emergency Leave', 6),
  ('Solo Parent Leave', 7),
  ('Magna Carta for Women', 8),
  ('VAWC Leave', 9)
ON CONFLICT DO NOTHING;
