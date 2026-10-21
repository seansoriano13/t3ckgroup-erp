-- #597 (spec #595): On-Hold, and the facts the automatic IPAS Status reads.
--
-- The IPAS Status (Pending, Requested, Ongoing, Paid, Done, On-Hold) is worked out
-- in the app from the IPAS itself and is never stored (ADR 0035). Only On-Hold is
-- a person's decision, so only it is stored:
--
-- 1. `ipas.on_hold` (flag) and `ipas.on_hold_note` (optional reason). The note only
--    exists while the flag is on.
--
-- 2. `ipas_set_on_hold(p_ipas_id, p_on_hold, p_note)`: the one function that sets
--    and clears it. Purchasing access or Finance access, on an OPEN IPAS only
--    (filed and cancelled ones are refused). Every real change writes an IPAS
--    history event with who, when and the note: `on_hold_set`, `on_hold_changed`
--    (the note was edited while on hold) or `on_hold_cleared`. Asking for what is
--    already so changes nothing and writes nothing.
--
-- 3. Filing clears it: a row trigger on the state moving to `filed` drops the flag
--    and the note and writes an `on_hold_cleared` event (reason "filed"), so a
--    filed order is always Done. It lives in a trigger, not in the filing function,
--    so every way an IPAS can be filed is covered and `ipas_sign` is untouched.
--
-- 4. `ipas_worked_on(p_ipas_ids)`: which of these IPAS have been worked on since
--    they were raised, i.e. have any history beyond the system's own entries
--    (raised, the Odoo sync, and On-Hold itself). The status reads it as "changed
--    since raising". One call for the whole list, so the list needs no per-IPAS read.
--
-- 5. `ipas_standing_for_sor` also returns `on_hold`, so the SOR's orders and Order
--    Monitoring agree: an On-Hold order waits on someone else and never counts
--    as late. A flag only; the note stays with Purchasing and Finance.
--
-- SAFE TO RUN AT ANY TIME: two columns with defaults, new functions and trigger,
-- and one function widened by a trailing column (dropped and recreated, as a
-- returns-table change needs).

-- ------------------------------------------------------------------------------
-- 1. The flag and its note
-- ------------------------------------------------------------------------------

alter table public.ipas
  add column if not exists on_hold boolean not null default false,
  add column if not exists on_hold_note text;

alter table public.ipas drop constraint if exists ipas_on_hold_note_chk;
alter table public.ipas
  add constraint ipas_on_hold_note_chk check (on_hold or on_hold_note is null);

comment on column public.ipas.on_hold is
  '#597: Purchasing or Finance has stopped this order on purpose (a supplier issue, waiting on the client). The one part of the IPAS Status that is stored; the rest is worked out. Cleared by filing.';
comment on column public.ipas.on_hold_note is
  '#597: why it is On-Hold (optional). Only while on_hold is true.';

-- ------------------------------------------------------------------------------
-- 2. Set and clear
-- ------------------------------------------------------------------------------

create or replace function public.ipas_set_on_hold(
  p_ipas_id uuid,
  p_on_hold boolean,
  p_note text default null
) returns public.ipas
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := public.get_employee_id();
  v_before public.ipas;
  v_row public.ipas;
  v_note text := nullif(btrim(p_note), '');
begin
  if v_actor is null then
    raise exception 'ipas_set_on_hold: not signed in' using errcode = '42501';
  end if;
  if not (public.has_purchasing_access() or public.has_finance_access()) then
    raise exception 'ipas_set_on_hold: only Purchasing or Finance puts an IPAS On-Hold' using errcode = '42501';
  end if;
  if p_on_hold is null then
    raise exception 'ipas_set_on_hold: say whether the IPAS is on hold' using errcode = '22023';
  end if;

  -- Open IPAS only: _ipas_lock_open refuses a filed or cancelled one.
  v_before := public._ipas_lock_open('ipas_set_on_hold', p_ipas_id);

  -- A note only goes with a hold.
  if not p_on_hold then
    v_note := null;
  end if;

  if v_before.on_hold = p_on_hold and v_before.on_hold_note is not distinct from v_note then
    return v_before;
  end if;

  update public.ipas
     set on_hold = p_on_hold, on_hold_note = v_note
   where id = v_before.id
  returning * into v_row;

  perform public._ipas_write_event(
    v_row.id,
    v_actor,
    case
      when not p_on_hold then 'on_hold_cleared'
      when v_before.on_hold then 'on_hold_changed'
      else 'on_hold_set'
    end,
    jsonb_build_object(
      'note', v_note,
      'previous_note', v_before.on_hold_note
    )
  );

  return v_row;
end;
$$;

comment on function public.ipas_set_on_hold(uuid, boolean, text) is
  '#597: Purchasing or Finance puts an open IPAS On-Hold, edits the note, or clears it. Filed and cancelled IPAS are refused (22023). Writes an on_hold_set / on_hold_changed / on_hold_cleared event with the note; asking for what is already so writes nothing. Returns the ipas row.';

revoke all on function public.ipas_set_on_hold(uuid, boolean, text) from public, anon;
grant execute on function public.ipas_set_on_hold(uuid, boolean, text) to authenticated;

-- ------------------------------------------------------------------------------
-- 3. Filing clears it
-- ------------------------------------------------------------------------------

create or replace function public.ipas_filing_clears_hold()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.state = 'filed' and old.state is distinct from 'filed' and new.on_hold then
    new.on_hold := false;
    new.on_hold_note := null;
    perform public._ipas_write_event(
      new.id,
      public.get_employee_id(),
      'on_hold_cleared',
      jsonb_build_object('note', null, 'previous_note', old.on_hold_note, 'reason', 'filed')
    );
  end if;
  return new;
end;
$$;

revoke all on function public.ipas_filing_clears_hold() from public, anon, authenticated;

drop trigger if exists ipas_filing_clears_hold on public.ipas;
create trigger ipas_filing_clears_hold
  before update of state on public.ipas
  for each row execute function public.ipas_filing_clears_hold();

-- ------------------------------------------------------------------------------
-- 4. Worked on since it was raised
-- ------------------------------------------------------------------------------

-- Security invoker: the caller sees the history their own access lets them read,
-- and an IPAS they cannot read is simply not in the answer.
create or replace function public.ipas_worked_on(p_ipas_ids uuid[])
returns setof uuid
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select distinct e.ipas_id
    from public.ipas_events e
   where e.ipas_id = any (coalesce(p_ipas_ids, '{}'::uuid[]))
     and e.kind not in (
       'created',
       'odoo_copy_changed', 'filled_from_odoo', 'odoo_changed_since_filing',
       'on_hold_set', 'on_hold_changed', 'on_hold_cleared'
     )
     and not (e.kind = 'approvals_cleared' and e.detail ->> 'reason' = 'PO changed in Odoo');
$$;

comment on function public.ipas_worked_on(uuid[]) is
  '#597: of these IPAS, the ones with history beyond the system''s own entries (raised, the Odoo sync, On-Hold changes): the "changed since raising" fact the IPAS Status reads. Same ignore list as the stale-save guard (#585).';

revoke all on function public.ipas_worked_on(uuid[]) from public, anon;
grant execute on function public.ipas_worked_on(uuid[]) to authenticated;

-- ------------------------------------------------------------------------------
-- 5. The SOR's orders know when one is On-Hold
-- ------------------------------------------------------------------------------

drop function if exists public.ipas_standing_for_sor(uuid);

create function public.ipas_standing_for_sor(p_opportunity_id uuid)
returns table (
  ipas_id uuid,
  source text,
  created_at timestamptz,
  updated_at timestamptz,
  costs_completed_at timestamptz,
  proof_paid_on date,
  shipped_out_on date,
  onboard_on date,
  arrived_in_ph_on date,
  arrived_in_whs_on date,
  import_clearance_on date,
  delivered_on date,
  actual_checking_stamped boolean,
  actual_checking_at timestamptz,
  slips jsonb,
  on_hold boolean
)
language sql
stable
security definer
set search_path = public
as $function$
  select
    i.id,
    i.source,
    i.created_at,
    i.updated_at,
    (
      select max(e.created_at)
        from public.ipas_events e
       where e.ipas_id = i.id
         and e.kind = 'header_changed'
         and e.detail #>> '{fields,computation_status,to}' in ('lc_odoo_done', 'checked')
    ),
    (
      select max(p.paid_on)
        from public.ipas_payments p
       where p.ipas_id = i.id and coalesce(p.proof_url, '') <> ''
    ),
    i.shipped_out_on,
    i.onboard_on,
    i.arrived_in_ph_on,
    i.arrived_in_whs_on,
    i.import_clearance_on,
    i.delivered_on,
    i.actual_checking_by is not null,
    i.actual_checking_at,
    coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', t.id,
          'number', t.number,
          'prepared_on', t.prepared_on,
          'created_at', t.created_at,
          'submitted_at', t.submitted_at,
          'state', t.state,
          'check_warehouse', t.check_warehouse,
          'check_technical', t.check_technical,
          'stages', coalesce((
            select jsonb_agg(jsonb_build_object('stage', st.stage, 'completed_at', st.completed_at))
              from public.transmittal_stages st
             where st.transmittal_id = t.id
          ), '[]'::jsonb),
          'lines', coalesce((
            select jsonb_agg(jsonb_build_object(
              'ipas_id', l.ipas_id,
              'odoo_po_line_id', l.odoo_po_line_id,
              'wh_rating', l.wh_rating,
              'tech_rating', l.tech_rating
            ))
              from public.transmittal_lines l
             where l.transmittal_id = t.id and l.ipas_id = i.id
          ), '[]'::jsonb)
        )
        order by t.prepared_on, t.created_at, t.number
      )
        from public.transmittals t
       where t.state <> 'cancelled'
         and exists (
           select 1 from public.transmittal_lines l
            where l.transmittal_id = t.id and l.ipas_id = i.id
         )
    ), '[]'::jsonb),
    i.on_hold
  from public.ipas i
  where (select public.sor_access_level(p_opportunity_id)) = 'full'
    and i.purpose = 'project'
    and exists (
      select 1 from public.ipas_sors s
      where s.ipas_id = i.id and s.opportunity_id = p_opportunity_id
    )
  order by i.number;
$function$;

comment on function public.ipas_standing_for_sor(uuid) is
  '#265, #597: the dates and Transmittal facts the SOR''s IPAS section needs to say where each order stands (next thing, owner, days waiting, late), for anyone who can read the SOR (sor_access_level = full), plus whether the order is On-Hold (the flag only, never its note). Never money or bank columns. No SOR access -> no rows. Uncancelled Transmittals, drafts included (a draft only tells the service one has been raised).';

revoke all on function public.ipas_standing_for_sor(uuid) from public, anon;
grant execute on function public.ipas_standing_for_sor(uuid) to authenticated;
