-- ==============================================================================
-- #928: IPAS loads fast
--
-- Opening an IPAS timed out (57014) inside `ipas_worked_on`: it scanned the
-- IPAS history on every read, and the history's read policy asked "who is
-- this, and may they read IPAS?" once per history row (an unindexed e-mail
-- lookup each time). This migration:
--
--   1. makes `get_employee_id()` STABLE and indexes `employees.email`, so the
--      lookup is cheap and can be reused within a statement;
--   2. wraps every IPAS read policy as `(select ipas_can_read())`, so the
--      question is asked once per statement, not once per row;
--   3. keeps "worked on since it was raised" as a saved mark per IPAS
--      (`ipas_work_marks`), set by a trigger on the history and backfilled
--      once. `ipas_worked_on` reads the marks: same answer, no scan;
--   4. adds `ipas_list_copy`, the slice of the Odoo copy the IPAS list reads
--      (everything but the line detail), so the list stops downloading every
--      PO line of every IPAS.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. Who is asking: one indexed lookup, reusable within a statement
-- ------------------------------------------------------------------------------

create or replace function public.get_employee_id()
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select id from public.employees where email = auth.jwt() ->> 'email';
$$;

create index if not exists employees_email_idx on public.employees (email);

-- ------------------------------------------------------------------------------
-- 2. The IPAS read policies ask once per statement
-- ------------------------------------------------------------------------------

alter policy "ipas_read" on public.ipas using ((select public.ipas_can_read()));
alter policy "ipas_charges_read" on public.ipas_charges using ((select public.ipas_can_read()));
alter policy "ipas_documents_read" on public.ipas_documents using ((select public.ipas_can_read()));
alter policy "ipas_events_read" on public.ipas_events using ((select public.ipas_can_read()));
alter policy "ipas_payments_read" on public.ipas_payments using ((select public.ipas_can_read()));
alter policy "ipas_signer_lists_read" on public.ipas_signer_lists using ((select public.ipas_can_read()));
alter policy "ipas_signoffs_read" on public.ipas_signoffs using ((select public.ipas_can_read()));
alter policy "ipas_sors_read" on public.ipas_sors using ((select public.ipas_can_read()));

-- ------------------------------------------------------------------------------
-- 3. Worked on since it was raised: a saved mark
-- ------------------------------------------------------------------------------

-- Whether one history entry is work on the IPAS rather than the system's own
-- entry (raised, the Odoo sync, On-Hold changes). The same list `ipas_worked_on`
-- used since #597, written the same way: an entry the old filter dropped (a null
-- comparison included) is not work here either.
create or replace function public.ipas_event_is_work(p_kind text, p_detail jsonb)
returns boolean
language sql
immutable
set search_path = public, pg_temp
as $$
  select (
    p_kind not in (
      'created',
      'odoo_copy_changed', 'filled_from_odoo', 'odoo_changed_since_filing',
      'on_hold_set', 'on_hold_changed', 'on_hold_cleared'
    )
    and not (p_kind = 'approvals_cleared' and p_detail ->> 'reason' = 'PO changed in Odoo')
  ) is true;
$$;

comment on function public.ipas_event_is_work(text, jsonb) is
  '#928: whether an IPAS history entry counts as work on it (the "worked on since raising" fact). The ignore list of #597 / #585.';

create table if not exists public.ipas_work_marks (
  ipas_id uuid not null,
  marked_at timestamptz not null default now(),
  constraint ipas_work_marks_pkey primary key (ipas_id),
  constraint ipas_work_marks_ipas_id_fkey foreign key (ipas_id) references public.ipas (id) on delete cascade
);

comment on table public.ipas_work_marks is
  '#928: one row per IPAS that has been worked on since it was raised (history beyond the system''s own entries). Written only by the ipas_events trigger; the history is append-only, so a mark is never taken back.';

alter table public.ipas_work_marks enable row level security;

create policy "ipas_work_marks_read" on public.ipas_work_marks
  for select
  to authenticated
  using ((select public.ipas_can_read()));

revoke all on public.ipas_work_marks from public, anon, authenticated;
grant select on public.ipas_work_marks to authenticated;

create or replace function public._ipas_mark_worked_on()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if public.ipas_event_is_work(new.kind, new.detail) then
    insert into public.ipas_work_marks (ipas_id, marked_at)
    values (new.ipas_id, new.created_at)
    on conflict (ipas_id) do nothing;
  end if;
  return null;
end;
$$;

revoke all on function public._ipas_mark_worked_on() from public, anon, authenticated;

drop trigger if exists ipas_events_mark_worked_on on public.ipas_events;
create trigger ipas_events_mark_worked_on
  after insert on public.ipas_events
  for each row execute function public._ipas_mark_worked_on();

-- Backfill once, after the trigger is in place, so no entry falls between them.
insert into public.ipas_work_marks (ipas_id, marked_at)
select e.ipas_id, min(e.created_at)
  from public.ipas_events e
 where public.ipas_event_is_work(e.kind, e.detail)
 group by e.ipas_id
on conflict (ipas_id) do nothing;

-- Security invoker, as before: the caller sees the marks their own access lets
-- them read, and an IPAS they cannot read is simply not in the answer.
create or replace function public.ipas_worked_on(p_ipas_ids uuid[])
returns setof uuid
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select m.ipas_id
    from public.ipas_work_marks m
   where m.ipas_id = any (coalesce(p_ipas_ids, '{}'::uuid[]));
$$;

comment on function public.ipas_worked_on(uuid[]) is
  '#597, #928: of these IPAS, the ones with history beyond the system''s own entries (raised, the Odoo sync, On-Hold changes): the "changed since raising" fact the IPAS Status reads. Reads the saved marks (ipas_work_marks).';

revoke all on function public.ipas_worked_on(uuid[]) from public, anon;
grant execute on function public.ipas_worked_on(uuid[]) to authenticated;

-- ------------------------------------------------------------------------------
-- 4. The slice of the Odoo copy the IPAS list reads
-- ------------------------------------------------------------------------------

-- The copy without its line detail: each line keeps only what the list works
-- with (its analytic accounts, for the SOR check, and its subtotal, for the PO
-- total of an older copy). Selected by the list as `odoo_copy:ipas_list_copy`.
create or replace function public.ipas_list_copy(p_ipas public.ipas)
returns jsonb
language sql
stable
set search_path = public, pg_temp
as $$
  select case
    when jsonb_typeof(p_ipas.odoo_copy) is distinct from 'object' then p_ipas.odoo_copy
    when jsonb_typeof(p_ipas.odoo_copy -> 'lines') is distinct from 'array' then p_ipas.odoo_copy
    else (p_ipas.odoo_copy - 'lines') || jsonb_build_object('lines', (
      select coalesce(jsonb_agg(
               case when jsonb_typeof(l.line) = 'object'
                    then l.line - array(
                           select k from jsonb_object_keys(l.line) k
                            where k not in ('analytic', 'price_subtotal'))
                    else l.line end
               order by l.ord), '[]'::jsonb)
        from jsonb_array_elements(p_ipas.odoo_copy -> 'lines') with ordinality as l(line, ord)
    ))
  end;
$$;

comment on function public.ipas_list_copy(public.ipas) is
  '#928: the IPAS list''s slice of the Odoo copy: everything but line detail (each line keeps analytic and price_subtotal).';

revoke all on function public.ipas_list_copy(public.ipas) from public, anon;
grant execute on function public.ipas_list_copy(public.ipas) to authenticated;
