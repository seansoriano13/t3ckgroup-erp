-- Issue #381 (part of #377) — Always edits: a per-flow list of who can edit
-- its SORs.
--
-- `flow_access_settings.always_edits` holds selectors (same shapes as
-- Always sees, including everyone). `sor_always_edits` resolves them through
-- `sor_selector_covers` (#378). `sor_can_edit_opportunity` — the predicate
-- behind Product List, Inclusions, the legacy procurement panel and the
-- sor_update policy — now also passes anyone the flow's Always edits covers.
-- Always edits grants editing only: reading and moving Stages stay with Always
-- sees, the Deal Team and Stage Participants.

alter table public.flow_access_settings
  add column if not exists always_edits jsonb not null default '[]'::jsonb;

comment on column public.flow_access_settings.always_edits is
  '#381: selectors (resolvePeople.js) who can edit every SOR of this flow. '
  'Editing only — they must also be able to see the SOR.';

create or replace function public.sor_always_edits(p_opp public.sales_opportunities, p_employee_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $function$
  select exists (
    select 1
    from public.sales_flows f
    join public.flow_access_settings fas on fas.flow_id = f.id
    cross join lateral jsonb_array_elements(coalesce(fas.always_edits, '[]'::jsonb)) as selector
    where f.sale_type_id = p_opp.sale_type_id
      and public.sor_selector_covers(selector, p_opp, p_employee_id)
  )
$function$;

create or replace function public.sor_can_edit_opportunity(p_opportunity_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $function$
  select exists (
    select 1 from public.sales_opportunities o
    where o.id = p_opportunity_id
      and (
        o.registered_by = public.get_employee_id()
        or o.deal_owner_id = public.get_employee_id()
        or o.support_sales_1_id = public.get_employee_id()
        or o.support_sales_2_id = public.get_employee_id()
        or o.sales_director_id = public.get_employee_id()
        or exists (
          select 1 from public.employees e
          where e.id = public.get_employee_id()
            and (e.is_head or e.is_super_admin)
        )
        or (
          public.sor_always_edits(o, public.get_employee_id())
          and (
            public.sor_is_deal_team(o, public.get_employee_id())
            or public.sor_always_sees(o, public.get_employee_id())
          )
        )
      )
  )
$function$;

-- Moving a Stage stays with anyone who has full access (Deal Team, Always
-- sees, Super Admins), so `sor_update` admits them too. What they may change
-- is narrowed by a guard: a caller who cannot edit may change nothing but the
-- Stage move itself (and the contract date it stamps on Won).
drop policy if exists "sor_update" on public.sales_opportunities;
create policy "sor_update" on public.sales_opportunities
  as permissive
  for update
  to authenticated
  using (
    sor_can_edit_opportunity(id)
    or sor_access_level(id) = 'full'
  );

create or replace function public.sor_guard_non_editor_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
begin
  if auth.role() = 'service_role' or auth.uid() is null then
    return NEW;
  end if;

  if public.sor_can_edit_opportunity(OLD.id) then
    return NEW;
  end if;

  if (to_jsonb(NEW) - 'flow_stage_id' - 'contract_date' - 'updated_at')
     is distinct from (to_jsonb(OLD) - 'flow_stage_id' - 'contract_date' - 'updated_at') then
    raise exception 'You can move this SOR, but not edit it.' using errcode = '42501';
  end if;

  return NEW;
end;
$function$;

comment on function public.sor_guard_non_editor_update() is
  '#381: a caller with full access but no edit right may move the Stage and nothing else.';

drop trigger if exists sor_guard_non_editor_update on public.sales_opportunities;
create trigger sor_guard_non_editor_update
  before update on public.sales_opportunities
  for each row execute function public.sor_guard_non_editor_update();
