-- Settings > Activities: "Also allowed" on each Activity type. A type set to "Department heads only" can also be
-- filed by the people named here, without making them heads or opening the type to everyone. Empty by default,
-- so nothing changes until HR or a Super Admin adds someone. Add-only: one new column, one function replaced.

alter table public.activity_type_settings
  add column if not exists also_allowed uuid[] not null default '{}';

comment on column public.activity_type_settings.also_allowed is
  'Employees who may file this type even when who_files is HEADS. Ignored when who_files is EVERYONE.';

create or replace function public.activity_can_file(p_employee_id uuid, p_activity_type text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select case
    when p_employee_id is null then false
    else coalesce((
      select case t.who_files
               when 'EVERYONE' then true
               else p_employee_id = any(t.also_allowed)
                 or coalesce((select coalesce(e.is_head, false) from public.employees e where e.id = p_employee_id), false)
             end
        from public.activity_type_settings t
       where t.activity_type = p_activity_type
    ), false)
  end;
$function$;

revoke all on function public.activity_can_file(uuid, text) from public, anon, authenticated;
