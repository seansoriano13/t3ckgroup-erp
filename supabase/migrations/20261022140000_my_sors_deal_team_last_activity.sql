-- My SORs (#478 gaps): list the caller's own Deal Team SORs, and give every
-- listed SOR a last-activity time for the period filter.
--
-- `sor_my_deal_team_sor_ids()` answers "which SORs am I on the Deal Team of",
-- using the one Deal Team definition (`sor_is_deal_team`, ADR 0021: the six
-- Deal Team columns on the SOR), read column by column so each can use its own
-- index instead of testing every SOR row. The client
-- cannot ask `sales_opportunities` directly: its read policy also lets Super
-- Admins and Always-sees people read everything, which would flood My SORs.
-- Soft-deleted and scratch SORs are left out, as every other list does.
--
-- `sor_my_sors_facets` gains `last_activity_at`. `sales_opportunities` has no
-- such column and `updated_at` is only a default (nothing bumps it on a stage
-- move or a note), so it is the newest of: updated_at, the latest Stage Visit
-- entered or left, and the latest log entry (notes and system entries).
-- Dropped and recreated because the return type changes. It also returns the
-- client name, for the search box. Both are given to Full and Participant
-- readers only; a locked reader (closed Mention Window) gets null for each.

create or replace function public.sor_my_deal_team_sor_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $function$
  select o.id from public.sales_opportunities o
  where o.registered_by = public.get_employee_id() and not o.is_deleted and not o.is_scratch
  union
  select o.id from public.sales_opportunities o
  where o.deal_owner_id = public.get_employee_id() and not o.is_deleted and not o.is_scratch
  union
  select o.id from public.sales_opportunities o
  where o.closing_sales_id = public.get_employee_id() and not o.is_deleted and not o.is_scratch
  union
  select o.id from public.sales_opportunities o
  where o.support_sales_1_id = public.get_employee_id() and not o.is_deleted and not o.is_scratch
  union
  select o.id from public.sales_opportunities o
  where o.support_sales_2_id = public.get_employee_id() and not o.is_deleted and not o.is_scratch
  union
  select o.id from public.sales_opportunities o
  where o.sales_director_id = public.get_employee_id() and not o.is_deleted and not o.is_scratch
$function$;

revoke all on function public.sor_my_deal_team_sor_ids() from public, anon;
grant execute on function public.sor_my_deal_team_sor_ids() to authenticated;

drop function if exists public.sor_my_sors_facets(uuid[]);

create function public.sor_my_sors_facets(p_opportunity_ids uuid[])
returns table (opportunity_id uuid, sor_code text, sale_type_name text, last_activity_at timestamptz, client_name text)
language sql
stable
security definer
set search_path = public
as $function$
  select o.id, o.sor_code, st.name,
    -- Last activity and the client are shown to Full and Participant readers
    -- only, as elsewhere; a locked reader gets neither.
    case when public.sor_access_level(o.id) in ('full', 'participant') then
      greatest(
        o.updated_at,
        (select max(greatest(v.entered_at, v.left_at)) from public.sor_stage_visits v where v.opportunity_id = o.id),
        (select max(l.created_at) from public.sales_opportunity_logs l where l.opportunity_id = o.id)
      )
    end,
    case when public.sor_access_level(o.id) in ('full', 'participant') then o.client_name end
  from public.sales_opportunities o
  left join public.sale_types st on st.id = o.sale_type_id
  where o.id = any (p_opportunity_ids)
    and public.sor_access_level(o.id) <> 'none'
$function$;

revoke all on function public.sor_my_sors_facets(uuid[]) from public, anon;
grant execute on function public.sor_my_sors_facets(uuid[]) to authenticated;
