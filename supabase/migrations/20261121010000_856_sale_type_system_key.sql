-- 856 follow-up (spec #844, gap 1 of the 2026-11-04 to-do): the Legacy Pipeline
-- is known by a fixed key, not by its name.
--
-- 20261119060000 matched the Sale Type on lower(btrim(name)) = 'legacy pipeline',
-- so a rename silently lifted the block, and on staging (where the cutover rename
-- never ran) it matched nothing. sale_types.system_key is a fixed key the app and
-- the database both read; a name change no longer touches it.
--
-- The names differ by database: production's row is called "Legacy Pipeline (do
-- not use)", so the name match never fired there; staging's is "Legacy Pipeline".
-- So the key goes on production's row by id first (the same id the cutover
-- backfill targets, supabase/scripts/cutover/legacy_pipeline_backfill.sql), and
-- only where that id is absent on the oldest row named exactly Legacy Pipeline
-- (staging, local stacks, test fixtures). The name is read once, here, and never again.

alter table public.sale_types add column if not exists system_key text;

create unique index if not exists sale_types_system_key_key
  on public.sale_types (system_key)
  where system_key is not null;

update public.sale_types
   set system_key = 'legacy_pipeline'
 where not exists (select 1 from public.sale_types where system_key = 'legacy_pipeline')
   and id = (
     select st.id from public.sale_types st
      where st.id = 'f1d4e085-9a13-4c30-a2b7-b9f97f009608'
         or lower(btrim(st.name)) = 'legacy pipeline'
      order by (st.id = 'f1d4e085-9a13-4c30-a2b7-b9f97f009608') desc, st.created_at
      limit 1
   );

create or replace function public.sor_require_live_sale_type()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or coalesce(NEW.is_retail, false) then
    return NEW;
  end if;

  if TG_OP = 'UPDATE' and NEW.sale_type_id is not distinct from OLD.sale_type_id then
    return NEW;
  end if;

  if NEW.sale_type_id is null then
    raise exception 'Choose a Sale Type for this SOR.';
  end if;

  if exists (
    select 1 from public.sale_types st
    where st.id = NEW.sale_type_id and st.system_key = 'legacy_pipeline'
  ) then
    raise exception 'The Legacy Pipeline is closed to new deals. Choose another Sale Type.';
  end if;

  return NEW;
end;
$$;
