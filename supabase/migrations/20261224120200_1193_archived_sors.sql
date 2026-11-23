-- #1193 (spec #1187): Archived SORs. A new state beside Deleted, never using is_deleted.
-- An archived SOR is hidden from My work, the List and the Board by the app; it still counts everywhere
-- and still opens. Nothing on it is locked. Only a Super Admin archives or un-archives.
-- Add-only: two columns, one guard trigger, one function.

alter table public.sales_opportunities
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by uuid references public.employees(id);

comment on column public.sales_opportunities.archived_at is
  '#1193: when the SOR was archived (put away from the daily lists, still counted). Null = live. Not is_deleted.';
comment on column public.sales_opportunities.archived_by is '#1193: the Super Admin who archived the SOR.';

-- Direct writes of the archive columns by a signed-in user are refused unless they are a Super Admin.
-- The function below runs as its owner, so it passes this guard after its own Super Admin check;
-- the service role and a database owner (the one-off bulk script) are not signed-in roles.
create or replace function public.sor_guard_archive()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if (NEW.archived_at is distinct from OLD.archived_at or NEW.archived_by is distinct from OLD.archived_by)
     and current_user in ('authenticated', 'anon')
     and not public.is_super_admin() then
    raise exception 'Only a Super Admin can archive or un-archive an SOR.' using errcode = '42501', hint = 'forbidden';
  end if;
  return NEW;
end;
$$;

drop trigger if exists sor_guard_archive on public.sales_opportunities;
create trigger sor_guard_archive
  before update of archived_at, archived_by on public.sales_opportunities
  for each row execute function public.sor_guard_archive();

create or replace function public.sor_set_archived(p_opportunity_id uuid, p_archived boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := public.get_employee_id();
  v_opp public.sales_opportunities%rowtype;
  v_meta jsonb;
  v_text text;
begin
  if not public.is_super_admin() then
    raise exception 'Only a Super Admin can archive or un-archive an SOR.' using errcode = '42501', hint = 'forbidden';
  end if;

  update public.sales_opportunities
     set archived_at = case when p_archived then now() else null end,
         archived_by = case when p_archived then v_actor else null end
   where id = p_opportunity_id
   returning * into v_opp;
  if v_opp.id is null then
    raise exception 'SOR not found.' using errcode = 'P0002';
  end if;

  v_text := case when p_archived then 'SOR archived.' else 'SOR un-archived.' end;
  v_meta := jsonb_build_object(
    'event', case when p_archived then 'OPPORTUNITY_ARCHIVED' else 'OPPORTUNITY_UNARCHIVED' end,
    'employeeId', v_actor);
  insert into public.sales_opportunity_logs (opportunity_id, author_id, type, content, metadata)
  values (v_opp.id, v_actor, 'SYSTEM', v_text, v_meta);
  insert into public.system_audit_logs (author_id, entity_type, entity_id, content, type, metadata)
  values (v_actor, 'OPPORTUNITY', v_opp.id::text,
    'Sales opportunity for ' || v_opp.client_name || ' ' || lower(v_text), 'SYSTEM', v_meta);

  return to_jsonb(v_opp);
end;
$$;

comment on function public.sor_set_archived(uuid, boolean) is
  '#1193: archives or un-archives an SOR. Super Admin only. Writes a note and an audit entry. Never touches is_deleted.';

revoke all on function public.sor_set_archived(uuid, boolean) from public, anon;
grant execute on function public.sor_set_archived(uuid, boolean) to authenticated, service_role;
