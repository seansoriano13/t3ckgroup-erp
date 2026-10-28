-- #702 (spec #699): the Import add-on, an estimate of the landed cost until the IPAS has the real one.
--
--   costing_landed_defaults                 one row: the default add-on percent for Import and for Local,
--                                           kept by Purchasing in Settings -> Purchasing. Read by anyone signed in
--                                           (a percentage only), written by Purchasing access and Super Admins.
--   costing_matrices.import_addon_percent   the matrix's own add-on percent. A new matrix starts with the Import
--                                           default. Landed cost is cost: the price side is never sent it.

create table if not exists public.costing_landed_defaults (
  id                   boolean primary key default true,
  import_addon_percent numeric(7,2) not null default 0,
  local_addon_percent  numeric(7,2) not null default 0,
  updated_by           uuid references public.employees (id) on delete set null,
  updated_at           timestamptz not null default now(),

  constraint costing_landed_defaults_one_row_chk check (id = true),
  constraint costing_landed_defaults_import_chk check (import_addon_percent >= 0),
  constraint costing_landed_defaults_local_chk check (local_addon_percent >= 0)
);

comment on table public.costing_landed_defaults is
  '#702: default Import and Local add-on percent for the Costing sheet''s estimated landed cost. One row.';

create or replace function public.costing_landed_defaults_stamp()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  new.updated_by = coalesce(public.get_employee_id(), new.updated_by);
  return new;
end;
$$;

revoke all on function public.costing_landed_defaults_stamp() from public, anon, authenticated;

drop trigger if exists costing_landed_defaults_stamp on public.costing_landed_defaults;
create trigger costing_landed_defaults_stamp
  before insert or update on public.costing_landed_defaults
  for each row execute function public.costing_landed_defaults_stamp();

insert into public.costing_landed_defaults (id) values (true) on conflict (id) do nothing;

alter table public.costing_landed_defaults enable row level security;

drop policy if exists costing_landed_defaults_read on public.costing_landed_defaults;
create policy costing_landed_defaults_read on public.costing_landed_defaults
  for select to authenticated
  using (public.get_employee_id() is not null);

drop policy if exists costing_landed_defaults_insert on public.costing_landed_defaults;
create policy costing_landed_defaults_insert on public.costing_landed_defaults
  for insert to authenticated
  with check (public.has_purchasing_access() or coalesce(public.is_super_admin(), false));

drop policy if exists costing_landed_defaults_update on public.costing_landed_defaults;
create policy costing_landed_defaults_update on public.costing_landed_defaults
  for update to authenticated
  using (public.has_purchasing_access() or coalesce(public.is_super_admin(), false))
  with check (public.has_purchasing_access() or coalesce(public.is_super_admin(), false));

revoke all on table public.costing_landed_defaults from anon;
revoke delete, truncate on public.costing_landed_defaults from authenticated;
grant select, insert, update on public.costing_landed_defaults to authenticated;

-- The matrix's own add-on.
alter table public.costing_matrices
  add column if not exists import_addon_percent numeric(7,2);

alter table public.costing_matrices
  drop constraint if exists costing_matrices_import_addon_chk;
alter table public.costing_matrices
  add constraint costing_matrices_import_addon_chk check (import_addon_percent is null or import_addon_percent >= 0);

comment on column public.costing_matrices.import_addon_percent is
  '#702: the Import add-on percent for this matrix''s estimated landed cost. Starts from costing_landed_defaults. Cost tiers only.';

-- A new matrix starts with the Import default. Named to fire after costing_bands, so the band check
-- sees the caller's own insert, not this fill.
create or replace function public.costing_matrices_default_addon()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.import_addon_percent is null then
    new.import_addon_percent := (select import_addon_percent from public.costing_landed_defaults where id);
  end if;
  return new;
end;
$$;

revoke all on function public.costing_matrices_default_addon() from public, anon, authenticated;

drop trigger if exists trg_zz_costing_matrices_default_addon on public.costing_matrices;
create trigger trg_zz_costing_matrices_default_addon
  before insert on public.costing_matrices
  for each row execute function public.costing_matrices_default_addon();

-- Matrices already open start from the default too.
update public.costing_matrices
   set import_addon_percent = (select import_addon_percent from public.costing_landed_defaults where id)
 where import_addon_percent is null;

-- Cost tiers read it; only the Purchasing band writes it. The price side is never sent it.
insert into public.costing_column_tiers (table_name, column_name, tiers) values
  ('costing_matrices', 'import_addon_percent', '{cost,closed_book}')
on conflict (table_name, column_name) do update set tiers = excluded.tiers;

insert into public.costing_column_bands (table_name, column_name, bands) values
  ('costing_matrices', 'import_addon_percent', '{purchasing}')
on conflict (table_name, column_name) do update set bands = excluded.bands;
