-- ==============================================================================
-- 20261007161100_purchasing_settled_condition.sql
--
-- Issue #209, ticket #311: the Purchasing settled condition kind.
--
-- Met when every Requested Item on the SOR's Purchase Request is closed, or
-- when the SOR has no Purchase Request. The old `purchasing` kind ("a
-- procurement request exists") stays in the CHECK so published Flow Snapshots
-- (and a snapshot restore, which re-inserts snapshot kinds) keep working; the
-- picker no longer offers it (client side, NEW_CONDITION_KINDS).
--
-- Re-runnable: the CHECK is dropped and re-added, the function is
-- create-or-replace, and the data update only touches rows still on the old
-- kind.
-- ==============================================================================

alter table public.stage_conditions drop constraint if exists stage_conditions_kind_chk;
alter table public.stage_conditions add constraint stage_conditions_kind_chk check (kind in ('attachment', 'field', 'tickbox', 'assignment', 'deadline', 'project_evaluation', 'inclusions', 'purchasing', 'purchasing_settled'));

-- ------------------------------------------------------------------------------
-- Gate evidence: the SOR's Requested Items, read past RLS
-- ------------------------------------------------------------------------------
-- The stage gate is evaluated client-side. A Deal Team member left out of the
-- request by `leaveOutRoles`, or an Always-edits user, may move the SOR but
-- can't read its Purchase Request; a plain select would show them "no
-- request", which is settled, and let the move through. This reads the items
-- for anyone who can see the SOR at all, and returns only what the gate
-- needs: each item's status and when it was raised and last changed (closed is
-- final, so that is when it closed). Null when the SOR has no request.
create or replace function public.sor_purchase_request_item_states(p_opportunity_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_request_id uuid;
begin
  if public.get_employee_id() is null then
    raise exception 'sor_purchase_request_item_states: sign in first' using errcode = '42501';
  end if;
  if public.sor_access_level(p_opportunity_id) = 'none' then
    raise exception 'sor_purchase_request_item_states: you can''t see this SOR' using errcode = '42501';
  end if;

  select r.id into v_request_id
    from public.purchase_requests r
   where r.opportunity_id = p_opportunity_id;
  if v_request_id is null then
    return null;
  end if;

  return coalesce(
    (select jsonb_agg(
              jsonb_build_object(
                'status', i.status,
                'created_at', i.created_at,
                'status_changed_at', i.status_changed_at
              )
              order by i.created_at, i.id
            )
       from public.purchase_request_items i
      where i.request_id = v_request_id),
    '[]'::jsonb
  );
end;
$$;

revoke all on function public.sor_purchase_request_item_states(uuid) from public, anon;
grant execute on function public.sor_purchase_request_item_states(uuid) to authenticated;

-- ------------------------------------------------------------------------------
-- Live draft conditions of the old kind become Purchasing settled
-- ------------------------------------------------------------------------------
-- Live `stage_conditions` rows are the flow's draft; published versions live in
-- `flow_snapshots` and are not touched, so an SOR pinned to an older version
-- keeps the old check. Archived rows stay as they were. A label still reading
-- the old kind's default name follows the kind; any other label is the
-- Operations Manager's own wording and is kept.
update public.stage_conditions
   set kind = 'purchasing_settled',
       label = case when btrim(label) = 'Purchasing' then 'Purchasing settled' else label end,
       updated_at = now()
 where kind = 'purchasing'
   and archived_at is null;
