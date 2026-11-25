-- ============================================================================
-- #1223 (spec #1220, ADR 0055): the Payers list.
--
-- A Payer is someone who pays what is asked for on an IPAS. The list lives with the
-- sign-off lists (ipas_signer_lists, key 'payers') and is edited the same way by a Super Admin.
--   * Being a Payer grants no other right: ipas_can_read and _ipas_employee_can_read skip 'payers',
--     exactly as they skip the Transmittal staff lists.
--   * Each new ask for payment rings the bell for every Payer except the asker, from a trigger on
--     ipas_payment_asks (insert only: edit, withdraw and paid notify nobody). It stays put when
--     the ask RPC is reworked (#1224).
--   * The employee with call sign 201 is put on the list (when one exists).
-- SAFE TO RUN more than once.
-- ============================================================================

alter table public.ipas_signer_lists drop constraint if exists ipas_signer_lists_key_chk;
alter table public.ipas_signer_lists add constraint ipas_signer_lists_key_chk check (list_key in (
  's1_approved', 's3_approved', 's6_approved', 's7_received', 's7_noted', 's7_checked', 's7_approved',
  'logistics_signed', 'payers',
  'transmittal_warehouse', 'transmittal_technical', 'transmittal_logistics', 'transmittal_check_by'
));

alter table public.ipas_signer_list_log drop constraint if exists ipas_signer_list_log_key_chk;
alter table public.ipas_signer_list_log add constraint ipas_signer_list_log_key_chk check (list_key in (
  's1_approved', 's3_approved', 's6_approved', 's7_received', 's7_noted', 's7_checked', 's7_approved',
  'logistics_signed', 'payers',
  'transmittal_warehouse', 'transmittal_technical', 'transmittal_logistics', 'transmittal_check_by'
));

-- ipas_set_signer_list (latest: 20261105062000_713); 'payers' added to the keys.
create or replace function public.ipas_set_signer_list(
  p_list_key text,
  p_employee_ids uuid[]
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := public.get_employee_id();
  v_wanted uuid[];
  v_have uuid[];
  v_added uuid[];
  v_removed uuid[];
  v_missing uuid;
begin
  if v_actor is null then
    raise exception 'ipas_set_signer_list: not signed in' using errcode = '42501';
  end if;
  if not coalesce(public.is_super_admin(), false) then
    raise exception 'ipas_set_signer_list: only a Super Admin changes who is on a sign-off list' using errcode = '42501';
  end if;
  if p_list_key is null or p_list_key not in (
    's1_approved', 's3_approved', 's6_approved', 's7_received', 's7_noted', 's7_checked', 's7_approved', 'logistics_signed', 'payers',
    'transmittal_warehouse', 'transmittal_technical', 'transmittal_logistics', 'transmittal_check_by'
  ) then
    raise exception 'ipas_set_signer_list: % isn''t a sign-off list', coalesce(p_list_key, 'null') using errcode = '22023';
  end if;

  select coalesce(array_agg(distinct x), '{}'::uuid[])
    into v_wanted
    from unnest(coalesce(p_employee_ids, '{}'::uuid[])) as x
   where x is not null;

  -- One change to a list at a time.
  perform pg_advisory_xact_lock(hashtext('ipas_signer_list:' || p_list_key));

  select coalesce(array_agg(l.employee_id), '{}'::uuid[])
    into v_have
    from public.ipas_signer_lists l
   where l.list_key = p_list_key;

  select x into v_missing
    from unnest(v_wanted) as x
   where x <> all (v_have)
     and not exists (
       select 1 from public.employees e where e.id = x and not coalesce(e.is_deleted, false)
     )
   limit 1;
  if v_missing is not null then
    raise exception 'ipas_set_signer_list: employee % isn''t an active employee', v_missing using errcode = '22023';
  end if;

  select coalesce(array_agg(x), '{}'::uuid[]) into v_added from unnest(v_wanted) as x where x <> all (v_have);
  select coalesce(array_agg(x), '{}'::uuid[]) into v_removed from unnest(v_have) as x where x <> all (v_wanted);

  if cardinality(v_removed) > 0 then
    delete from public.ipas_signer_lists
     where list_key = p_list_key and employee_id = any (v_removed);
  end if;
  if cardinality(v_added) > 0 then
    insert into public.ipas_signer_lists (list_key, employee_id)
    select p_list_key, x from unnest(v_added) as x;
  end if;

  insert into public.ipas_signer_list_log (list_key, employee_id, action, actor_id)
  select p_list_key, x, 'removed', v_actor from unnest(v_removed) as x
  union all
  select p_list_key, x, 'added', v_actor from unnest(v_added) as x;

  return jsonb_build_object(
    'list_key', p_list_key,
    'added', to_jsonb(v_added),
    'removed', to_jsonb(v_removed)
  );
end;
$$;

-- Payers read nothing extra: leave them out of the "on a sign-off list reads every IPAS" rule.
create or replace function public.ipas_can_read()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from employees e
    where e.id = get_employee_id()
      and not coalesce(e.is_deleted, false)
      and (
        coalesce(e.has_purchasing_flow, false)
        or coalesce(e.has_finance_flow, false)
        or coalesce(e.has_logistics_flow, false)
        or coalesce(e.is_super_admin, false)
        or exists (
          select 1 from ipas_signer_lists l
           where l.employee_id = e.id
             and l.list_key <> 'payers'
             and l.list_key not like 'transmittal\_%' escape '\'
        )
      )
  );
$$;

comment on function public.ipas_can_read() is
  '#242, widened in #252, #1152 and #1223: whether the caller may read every IPAS: Purchasing, Finance or Logistics access, a Super Admin, or anyone on an IPAS sign-off list (never a Transmittal staff list or the Payers list alone; never a soft-deleted employee).';

create or replace function public._ipas_employee_can_read(p_employee_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from employees e
    where e.id = p_employee_id
      and not coalesce(e.is_deleted, false)
      and (
        coalesce(e.has_purchasing_flow, false)
        or coalesce(e.has_finance_flow, false)
        or coalesce(e.has_logistics_flow, false)
        or coalesce(e.is_super_admin, false)
        or exists (
          select 1 from ipas_signer_lists l
           where l.employee_id = e.id
             and l.list_key <> 'payers'
             and l.list_key not like 'transmittal\_%' escape '\'
        )
      )
  );
$$;

-- The bell for a new ask: every Payer but the asker.
create or replace function public._ipas_payers_notify_ask()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ipas public.ipas;
  v_asker text;
begin
  select * into v_ipas from public.ipas where id = new.ipas_id;
  select name into v_asker from public.employees where id = new.asked_by;

  insert into public.notifications (recipient_id, sender_id, type, title, message, reference_id)
  select l.employee_id, new.asked_by, 'IPAS_PAYMENT_ASKED',
         coalesce(v_asker, 'Someone') || ' asked for a payment',
         left(concat_ws(' — ', v_ipas.number, nullif(v_ipas.odoo_copy->'supplier'->>'name', ''))
              || ': ' || to_char(new.amount, 'FM999G999G999G990.00'), 280),
         v_ipas.id::text
    from public.ipas_signer_lists l
    join public.employees e on e.id = l.employee_id
   where l.list_key = 'payers'
     and not coalesce(e.is_deleted, false)
     and l.employee_id is distinct from new.asked_by;
  return null;
end;
$$;

revoke all on function public._ipas_payers_notify_ask() from public, anon, authenticated;

drop trigger if exists ipas_payment_asks_notify_payers on public.ipas_payment_asks;
create trigger ipas_payment_asks_notify_payers
  after insert on public.ipas_payment_asks
  for each row execute function public._ipas_payers_notify_ask();

-- Seed: the employee with call sign 201. Re-runnable. No change-log row: the log needs an actor.
create or replace function public._ipas_seed_payers()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_added integer;
begin
  insert into public.ipas_signer_lists (list_key, employee_id)
  select 'payers', e.id
    from public.employees e
   where e.call_sign = '201'
     and not coalesce(e.is_deleted, false)
  on conflict do nothing;
  get diagnostics v_added = row_count;
  return v_added;
end;
$$;

revoke all on function public._ipas_seed_payers() from public, anon, authenticated;

select public._ipas_seed_payers();
