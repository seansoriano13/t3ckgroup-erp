-- #752: a Group Task role can carry an optional default checklist, filled in
-- when the role is picked for a member whose checklist is empty.
alter table public.committee_roles
  add column if not exists default_checklist jsonb;
