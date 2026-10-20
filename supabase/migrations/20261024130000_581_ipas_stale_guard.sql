-- #581 follow-up: two people must not silently overwrite each other in the IPAS long form.
--
-- 1. ipas_events joins the supabase_realtime publication. Every change to an IPAS (header,
--    payments, charges, documents, bank details, status, sign-offs) writes one event row in
--    the same transaction, so one table announces them all. The read policy
--    (ipas_events_read) still decides who receives each row. Idempotent.
--
-- 2. ipas_assert_unchanged(ipas, since): the form's Save all calls it before its first write,
--    with the time of the newest event it loaded. If a newer event exists, someone else saved
--    in between and it refuses (40001) with a sentence. Null skips the check. SECURITY
--    INVOKER: the caller reads events through RLS like everywhere else.

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'ipas_events'
  ) then
    alter publication supabase_realtime add table public.ipas_events;
  end if;
end $$;

create or replace function public.ipas_assert_unchanged(p_ipas_id uuid, p_since timestamptz)
returns void
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'ipas_assert_unchanged: not signed in' using errcode = '42501';
  end if;
  if p_since is null then
    return;
  end if;
  if exists (select 1 from public.ipas_events where ipas_id = p_ipas_id and created_at > p_since) then
    raise exception 'ipas_assert_unchanged: someone else saved this IPAS after you opened it. Nothing was saved. Reload to see their changes; what you typed is still here.'
      using errcode = '40001';
  end if;
end;
$$;

revoke all on function public.ipas_assert_unchanged(uuid, timestamptz) from public, anon;
grant execute on function public.ipas_assert_unchanged(uuid, timestamptz) to authenticated;
