-- Hotfix: the IPAS stale-save check looped forever on prod and kept the database CPU high.
--
-- Cause: ipas_assert_unchanged (#581, #585) refused a stale Save all with errcode 40001
-- (serialization_failure). PostgREST treats 40001 as "retry the transaction" and retries
-- with no limit. The check is deterministic, so it failed the same way every time: the
-- browser never got an answer, and the loop kept running on the server after the browser
-- gave up. Three such requests ran from 2026-11-20 to 2026-11-26, about 950 rolled-back
-- transactions a second, none of them visible in pg_stat_statements.
--
-- Fix: refuse with PT409 instead. PostgREST answers PT409 at once with HTTP 409 Conflict
-- and never retries it. Same signature, same sentence; the screen shows the sentence, not
-- the code. Safe to run twice (create or replace, revoke and grant).

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
  if exists (
    select 1 from public.ipas_events e
     where e.ipas_id = p_ipas_id
       and e.created_at > p_since
       and e.kind not in ('odoo_copy_changed', 'filled_from_odoo', 'odoo_changed_since_filing')
       and not (e.kind = 'approvals_cleared' and e.detail ->> 'reason' = 'PO changed in Odoo')
  ) then
    raise exception 'ipas_assert_unchanged: someone else saved this IPAS after you opened it. Nothing was saved. Reload to see their changes; what you typed is still here.'
      using errcode = 'PT409';
  end if;
end;
$$;

revoke all on function public.ipas_assert_unchanged(uuid, timestamptz) from public, anon;
grant execute on function public.ipas_assert_unchanged(uuid, timestamptz) to authenticated;
