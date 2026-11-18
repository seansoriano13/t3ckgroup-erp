-- ==============================================================================
-- 20261218100000_request_units.sql
--
-- The Unit dropdown of a Purchasing Request (Quantity section) is now a list the
-- business edits in Settings > Purchasing > Request units, instead of nine words
-- fixed in code.
--
--   request_units   one row per unit: label, order, on/off.
--
-- Everyone signed in reads it (any employee can raise a request). Purchasing access
-- and Super Admins add, rename, reorder and switch units off, the same people who
-- edit the IPAS lists. Units are never deleted: a unit switched off is no longer
-- offered for new items and stays on the items that already use it (an item holds
-- its unit as plain text, so a rename changes the list only, not past items).
-- Starting values are the nine units that were in code.
-- Written as a file only. Apply it through the normal staging/prod path.
-- ==============================================================================

create table if not exists public.request_units (
  id         uuid primary key default gen_random_uuid(),
  label      text not null,
  sort       integer not null default 0,
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint request_units_label_chk check (btrim(label) <> '' and char_length(label) <= 24)
);

comment on table public.request_units is
  'The Unit dropdown on a Purchasing Request item. Purchasing access and Super Admins edit; never deleted, only switched off.';
comment on column public.request_units.sort is 'Display order, lowest first.';
comment on column public.request_units.active is 'Off = no longer offered for new items; items that already hold the unit keep it.';

create unique index if not exists request_units_label_key on public.request_units (lower(btrim(label)));
create index if not exists request_units_sort_idx on public.request_units (sort);

create or replace function public.request_units_touch()
returns trigger
language plpgsql
set search_path = public
as $function$
begin
  new.updated_at := now();
  new.label := btrim(new.label);
  return new;
end;
$function$;

drop trigger if exists request_units_touch on public.request_units;
create trigger request_units_touch
  before insert or update on public.request_units
  for each row execute function public.request_units_touch();

-- At least one unit stays on, so the dropdown is never empty.
create or replace function public.request_units_keep_one()
returns trigger
language plpgsql
set search_path = public
as $function$
begin
  if new.active = false and old.active
     and not exists (select 1 from public.request_units u where u.active and u.id <> new.id) then
    raise exception 'request_units: at least one unit must stay on' using errcode = '22023';
  end if;
  return new;
end;
$function$;

drop trigger if exists request_units_keep_one on public.request_units;
create trigger request_units_keep_one
  before update on public.request_units
  for each row execute function public.request_units_keep_one();

alter table public.request_units enable row level security;

drop policy if exists request_units_read on public.request_units;
create policy request_units_read on public.request_units
  for select to authenticated
  using (true);

drop policy if exists request_units_insert on public.request_units;
create policy request_units_insert on public.request_units
  for insert to authenticated
  with check (public.has_purchasing_access() or coalesce(public.is_super_admin(), false));

drop policy if exists request_units_update on public.request_units;
create policy request_units_update on public.request_units
  for update to authenticated
  using (public.has_purchasing_access() or coalesce(public.is_super_admin(), false))
  with check (public.has_purchasing_access() or coalesce(public.is_super_admin(), false));

revoke all on public.request_units from anon, authenticated;
grant select, insert, update on public.request_units to authenticated;

-- The nine units that were in code, in the order they were shown.
insert into public.request_units (label, sort)
select v.label, v.sort
  from (values
    ('unit', 10),
    ('pc', 20),
    ('set', 30),
    ('box', 40),
    ('roll', 50),
    ('meter', 60),
    ('kg', 70),
    ('pair', 80),
    ('lot', 90)
  ) as v(label, sort)
 where not exists (select 1 from public.request_units u where lower(btrim(u.label)) = lower(v.label));
