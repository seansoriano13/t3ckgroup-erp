-- #933 (spec #927): a Group Task template that a Stage Action uses can't be deleted.
-- Stage Action config is JSON (no foreign key), and SORs run from their flow
-- snapshot, so the check looks at live flows and at every snapshot an open SOR
-- (or a flow's latest version) still runs on.

create or replace function public.group_task_template_usage(p_template_id uuid)
returns table (flow_name text, stage_name text)
language sql
stable
security definer
set search_path = public
as $$
  with live as (
    select st.name as flow_name, s.name as stage_name
    from flow_stage_actions a
    join flow_stages s on s.id = a.stage_id
    join sales_flows f on f.id = s.flow_id
    join sale_types st on st.id = f.sale_type_id
    where a.archived_at is null
      and a.config->>'templateId' = p_template_id::text
  ),
  live_snap as (
    -- latest snapshot per flow (new SORs start on it) plus any snapshot an open SOR is on
    select sn.id, sn.flow_id, sn.snapshot_data
    from flow_snapshots sn
    where sn.version = (select max(x.version) from flow_snapshots x where x.flow_id = sn.flow_id)
       or exists (
         select 1
         from sales_opportunities o
         left join flow_stages fst on fst.id = o.flow_stage_id
         where o.flow_snapshot_id = sn.id
           and coalesce(fst.is_terminal, false) = false
       )
  ),
  snap as (
    select st.name as flow_name,
           coalesce(
             (select e->>'name'
                from jsonb_array_elements(coalesce(ls.snapshot_data->'stages', '[]'::jsonb)) e
               where e->>'id' = act->>'stageId' limit 1),
             'a stage') as stage_name
    from live_snap ls
    join sales_flows f on f.id = ls.flow_id
    join sale_types st on st.id = f.sale_type_id
    cross join lateral jsonb_array_elements(coalesce(ls.snapshot_data->'actions', '[]'::jsonb)) act
    where act->'config'->>'templateId' = p_template_id::text
  )
  select distinct u.flow_name, u.stage_name from (
    select * from live union all select * from snap
  ) u
  order by 1, 2;
$$;

revoke execute on function public.group_task_template_usage(uuid) from public, anon;
grant execute on function public.group_task_template_usage(uuid) to authenticated;

create or replace function public.group_task_templates_block_delete_in_use()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_list text;
begin
  select string_agg(flow_name || ' > ' || stage_name, '; ')
    into v_list
  from group_task_template_usage(old.id);

  if v_list is not null then
    raise exception 'Template "%" is used by a Stage Action: %. Remove it from those stages first.', old.name, v_list
      using errcode = 'P0001';
  end if;
  return old;
end;
$$;

drop trigger if exists group_task_templates_block_delete_in_use on public.group_task_templates;
create trigger group_task_templates_block_delete_in_use
  before delete on public.group_task_templates
  for each row execute function public.group_task_templates_block_delete_in_use();
