-- Migration to link tasks to sales opportunities

alter table public.tasks
  add column if not exists opportunity_id uuid references public.sales_opportunities(id) on delete set null;

create index if not exists tasks_opportunity_id_idx on public.tasks(opportunity_id);

alter table public.committee_tasks
  add column if not exists opportunity_id uuid references public.sales_opportunities(id) on delete set null;

create index if not exists committee_tasks_opportunity_id_idx on public.committee_tasks(opportunity_id);
