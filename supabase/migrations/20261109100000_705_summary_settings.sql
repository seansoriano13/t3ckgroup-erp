-- #705 (spec #699): the Costing Matrix summary's final VAT rate and which summary lines show
-- are set in Settings. Adds two columns to the single costing_settings row. Writes keep the
-- existing policy (Finance access or a Super Admin). Idempotent.

alter table public.costing_settings
  add column if not exists final_vat_rate numeric(10,6) not null default 0.12,
  add column if not exists summary_hidden_lines text[] not null default '{finalVat}'::text[];

alter table public.costing_settings drop constraint if exists costing_settings_final_vat_chk;
alter table public.costing_settings
  add constraint costing_settings_final_vat_chk check (final_vat_rate >= 0 and final_vat_rate <= 1);

comment on column public.costing_settings.final_vat_rate is
  '#705: the summary''s Final VAT rate, worked on the VAT-exclusive figure.';
comment on column public.costing_settings.summary_hidden_lines is
  '#705: keys of the summary lines Settings has switched off (the screen and the print skip them).';
