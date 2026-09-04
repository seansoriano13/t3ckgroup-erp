-- Ticket #25 (part of #24): Add SSP to commission_splits, correct seed
-- percentages to match regulation CCPR-2026-001, and migrate any SOR
-- records that were incorrectly left as SSP despite having supporting
-- salespeople assigned.

-- 1. Widen the CHECK constraint to accept 'SSP'.
alter table public.commission_splits
  drop constraint if exists commission_splits_project_type_chk;

alter table public.commission_splits
  add constraint commission_splits_project_type_chk
    check (project_type in ('SSP', 'CP', 'STRATEGIC'));

-- 2. Insert SSP rows (deal_owner 80%, sales_director 20%).
--    SSP has no supporting_salesperson row by definition.
insert into public.commission_splits (project_type, share_role, percent) values
  ('SSP', 'deal_owner', 80),
  ('SSP', 'sales_director', 20)
on conflict (project_type, share_role) do nothing;

-- 3. Correct CP seeds to match regulation: 60 / 20 / 20.
update public.commission_splits set percent = 60
  where project_type = 'CP' and share_role = 'deal_owner';
update public.commission_splits set percent = 20
  where project_type = 'CP' and share_role = 'supporting_salesperson';
update public.commission_splits set percent = 20
  where project_type = 'CP' and share_role = 'sales_director';

-- 4. Correct Strategic seeds to match regulation: 40 / 20 / 40.
--    Regulation maps: Opportunity Originator → deal_owner,
--    Closing Salesperson → supporting_salesperson (combined share),
--    Sales Director → sales_director.
update public.commission_splits set percent = 40
  where project_type = 'STRATEGIC' and share_role = 'deal_owner';
update public.commission_splits set percent = 20
  where project_type = 'STRATEGIC' and share_role = 'supporting_salesperson';
update public.commission_splits set percent = 40
  where project_type = 'STRATEGIC' and share_role = 'sales_director';

-- 5. Data migration: flip SSP opportunities that have support salespeople to CP.
update public.sales_opportunities
  set project_type = 'CP'
  where project_type = 'SSP'
    and (support_sales_1_id is not null or support_sales_2_id is not null);
