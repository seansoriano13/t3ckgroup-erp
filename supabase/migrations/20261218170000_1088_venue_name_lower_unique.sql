-- #1088 (spec #1083, tracker C2): a Venue name is the same name whatever its capitals.
-- calendar_venues.name was unique only for the exact spelling, so "conference room" was accepted next to
-- "Conference Room". The key becomes lower(name). The old exact-name unique constraint is dropped first.
--
-- BEFORE this runs on staging or prod, look for existing pairs that differ only by capitals:
--
--   select lower(name) as same_name, array_agg(name order by name) as spellings, count(*)
--     from public.calendar_venues
--    group by lower(name)
--   having count(*) > 1;
--
-- No rows means the migration is safe. If any rows come back, the migration stops with a message that
-- names them and changes nothing; it never picks a winner. HR renames or deletes one of each pair in
-- Settings > Venues (a Venue that has Activities cannot be deleted, rename it instead), then the
-- migration is run again. Prod migrations run only through the manual workflow (ADR 0008).
--
-- Written as a file only. Apply it through the normal staging/prod path.

do $$
declare
  v_pairs text;
  v_name_attnum smallint;
  v_con record;
  v_idx record;
begin
  select string_agg(format('%s (%s)', same_name, spellings), '; ')
    into v_pairs
    from (
      select lower(name) as same_name, string_agg('"' || name || '"', ', ' order by name) as spellings
        from public.calendar_venues
       group by lower(name)
      having count(*) > 1
    ) d;

  if v_pairs is not null then
    raise exception 'Venue names that differ only by capitals exist: %. Rename or delete one of each pair in Settings > Venues, then run this migration again.', v_pairs
      using errcode = '23505';
  end if;

  select a.attnum into v_name_attnum
    from pg_attribute a
   where a.attrelid = 'public.calendar_venues'::regclass and a.attname = 'name';

  -- Drop the exact-name unique constraint, whatever it is called in this database.
  for v_con in
    select c.conname
      from pg_constraint c
     where c.conrelid = 'public.calendar_venues'::regclass
       and c.contype = 'u'
       and c.conkey = array[v_name_attnum]
  loop
    execute format('alter table public.calendar_venues drop constraint %I', v_con.conname);
  end loop;

  -- And any plain unique index on name alone that was not made by a constraint.
  for v_idx in
    select i.indexrelid::regclass as idx
      from pg_index i
     where i.indrelid = 'public.calendar_venues'::regclass
       and i.indisunique
       and not i.indisprimary
       and i.indexprs is null
       and i.indpred is null
       and i.indkey::text = v_name_attnum::text
  loop
    execute format('drop index %s', v_idx.idx);
  end loop;
end $$;

create unique index if not exists calendar_venues_name_lower_key
  on public.calendar_venues (lower(name));
