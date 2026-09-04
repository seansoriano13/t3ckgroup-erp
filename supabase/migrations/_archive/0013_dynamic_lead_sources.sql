-- Migration to convert hardcoded Lead Sources to a dynamic table.

create table if not exists public.crm_lead_sources (
  value text primary key,
  label text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

-- Insert existing constants to maintain data continuity
insert into public.crm_lead_sources (value, label) values
  ('LGU', 'LGU'),
  ('NGA', 'NGA'),
  ('GOCC', 'GOCC'),
  ('BFP', 'BFP'),
  ('PNP', 'PNP'),
  ('MIL', 'MIL'),
  ('DRRM', 'DRRM'),
  ('CORPORATE', 'Corporate'),
  ('REFERRAL', 'Referral'),
  ('WEBSITE', 'Website'),
  ('FACEBOOK', 'Facebook'),
  ('TIKTOK', 'TikTok'),
  ('SHOPEE', 'Shopee'),
  ('LAZADA', 'Lazada'),
  ('EXHIBITION', 'Exhibition'),
  ('REPEAT_CLIENT', 'Repeat Client')
on conflict (value) do nothing;

-- Drop the hardcoded constraint on the sales_opportunities table
alter table public.sales_opportunities
  drop constraint if exists sales_opportunities_lead_source_chk;

-- We don't add a strict FK to avoid breaking old records if a source is hard-deleted,
-- but the application will soft-delete (is_active = false) anyway.
