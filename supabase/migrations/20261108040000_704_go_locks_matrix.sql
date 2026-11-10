-- Costing Matrix, a Go on the Bid Decision locks the matrix; unlocking is recorded (#704, spec #699).
--
-- WHAT THIS DOES
--   Lock       While a matrix has a live Go, a BEFORE trigger on every table that holds its numbers
--              (lines, prices, components, their costs, inclusions, cost-only rows, the matrix money)
--              refuses any insert, update or delete. Sign-offs and the matrix row itself (in-charge,
--              evaluation) are bookkeeping, not numbers, and stay writable. Sessions with no signed-in
--              user (migrations, tests) pass, as they do for the band trigger.
--   Unlock     costing_unlock_bid(matrix, reason): Closed Book only, a live Go only, a reason required.
--              It clears the Go ("Unlocked: <reason>"), records who unlocked it, and the history trigger
--              on costing_bid_decisions writes the audit row. The Go is then taken again to relock.
--   Planned    costing_decide_bid stamps planned_cost_total (every Component and cost-only row at Final
--              Acquire, the way the Costing Matrix page adds it, null while any is blank) with the
--              decision, so Planned Revenue is worked from the estimate as it stood at the Go.
--   Deciding   A matrix with a live Go cannot be decided again; unlock it first. The "cleared by a later
--              change" triggers stay for a Revise or No-go (a Go can no longer be changed under them).
--
-- Idempotent.

alter table public.costing_bid_decisions
  add column if not exists planned_cost_total numeric(18,2),
  add column if not exists unlocked_by uuid references public.employees (id) on delete set null;

insert into public.costing_column_tiers (table_name, column_name, tiers) values
  ('costing_bid_decisions', 'planned_cost_total', '{closed_book}'),
  ('costing_bid_decisions', 'unlocked_by', '{price,closed_book}')
on conflict (table_name, column_name) do update set tiers = excluded.tiers;

-- ---------------------------------------------------------------------------
-- Planned cost, as the matrix page adds it
-- ---------------------------------------------------------------------------

create or replace function public.costing_planned_cost_total(p_matrix_id uuid)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select case when count(*) > 0 and bool_and(x.fa is not null) then sum(round(x.fa * x.q, 2)) end
  from (
    select cc.final_acquire_unit as fa, c.quantity as q
    from public.costing_components c
    join public.costing_tender_lines t on t.id = c.tender_line_id
    left join public.costing_component_costs cc on cc.component_id = c.id
    where t.matrix_id = p_matrix_id
    union all
    select r.final_acquire_unit, r.quantity
    from public.costing_cost_rows r
    where r.matrix_id = p_matrix_id
  ) x
$$;
revoke all on function public.costing_planned_cost_total(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- The lock
-- ---------------------------------------------------------------------------

create or replace function public.costing_refuse_when_locked()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row    jsonb := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  v_matrix uuid;
begin
  if auth.uid() is null or coalesce(auth.role(), '') = 'service_role' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  v_matrix := public.costing_matrix_of(tg_table_name, v_row);
  -- The matrix is going (an SOR cascade): nothing left to protect.
  if v_matrix is not null
     and exists (select 1 from public.costing_matrices where id = v_matrix)
     and exists (select 1 from public.costing_bid_decisions d
                  where d.matrix_id = v_matrix and d.cleared_at is null and d.verdict = 'go') then
    raise exception 'costing_bid: the sheet is locked by a Go. Unlock it, with a reason, to change it' using errcode = '42501';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;
revoke all on function public.costing_refuse_when_locked() from public, anon, authenticated;

do $$
declare t text;
begin
  foreach t in array array[
    'costing_tender_lines', 'costing_tender_line_prices', 'costing_components',
    'costing_component_costs', 'costing_inclusions', 'costing_cost_rows', 'costing_matrix_money'
  ] loop
    execute format('drop trigger if exists costing_go_lock on public.%I', t);
    execute format('create trigger costing_go_lock before insert or update or delete on public.%I for each row execute function public.costing_refuse_when_locked()', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Deciding (latest: 20261102180000_costing_open_review_fixes.sql), now stamping the planned cost
-- ---------------------------------------------------------------------------

create or replace function public.costing_decide_bid(p_matrix_id uuid, p_verdict text, p_reason text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor  uuid := public.get_employee_id();
  v_opp    uuid := public.costing_matrix_opp(p_matrix_id);
  v_totals record;
  v_id     uuid;
  v_title  text;
  v_label  text;
  v_member record;
begin
  if v_actor is null then
    raise exception 'costing_bid: sign in first' using errcode = '42501';
  end if;
  if v_opp is null then
    raise exception 'costing_bid: matrix not found' using errcode = '22023';
  end if;
  if public.costing_tier(v_opp) is distinct from 'closed_book' then
    raise exception 'costing_bid: only Sales, Purchasing, a Super Admin or the Final Acquire list can decide a bid' using errcode = '42501';
  end if;
  if p_verdict is null or p_verdict not in ('go', 'no_go', 'revise') then
    raise exception 'costing_bid: the verdict must be Go, No-go or Revise' using errcode = '22023';
  end if;
  if p_reason is null or length(btrim(p_reason)) = 0 then
    raise exception 'costing_bid: write the reason for the decision' using errcode = '22023';
  end if;

  -- One decision at a time per matrix (ADR 0013).
  perform 1 from public.costing_matrices where id = p_matrix_id for update;

  if exists (select 1 from public.costing_bid_decisions where matrix_id = p_matrix_id and cleared_at is null and verdict = 'go') then
    raise exception 'costing_bid: the sheet is locked by a Go. Unlock it first' using errcode = '22023';
  end if;

  select * into v_totals from public.costing_bid_totals(p_matrix_id);
  if v_totals.line_count = 0 or v_totals.missing_offer > 0 then
    raise exception 'costing_bid: every Tender Line needs a Final Offer before the bid can be decided' using errcode = '22023';
  end if;

  update public.costing_bid_decisions
     set cleared_at = now(), cleared_reason = 'Decided again'
   where matrix_id = p_matrix_id and cleared_at is null;

  insert into public.costing_bid_decisions (matrix_id, verdict, reason, decided_by, final_offer_total, abc_total, planned_cost_total)
  values (p_matrix_id, p_verdict, btrim(p_reason), v_actor, v_totals.final_offer_total, v_totals.abc_total,
          public.costing_planned_cost_total(p_matrix_id))
  returning id into v_id;

  if p_verdict in ('no_go', 'revise') then
    select o.project_title into v_title from public.sales_opportunities o where o.id = v_opp;
    v_label := case p_verdict when 'no_go' then 'No-go' else 'Revise' end;
    for v_member in
      select distinct t.employee_id
      from public.sales_opportunities o
      cross join lateral public._sor_deal_team_roles(o) t
      join public.employees e on e.id = t.employee_id
      where o.id = v_opp
        and t.employee_id <> v_actor
        and not coalesce(e.is_deleted, false)
    loop
      insert into public.notifications (recipient_id, sender_id, type, title, message, reference_id)
      values (
        v_member.employee_id,
        v_actor,
        'SOR_BID_DECISION',
        format('Bid decision: %s', v_label),
        format('The bid on "%s" is %s: %s', coalesce(v_title, 'this deal'), v_label, btrim(p_reason)),
        v_opp::text
      );
    end loop;
  end if;

  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Unlocking
-- ---------------------------------------------------------------------------

create or replace function public.costing_unlock_bid(p_matrix_id uuid, p_reason text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := public.get_employee_id();
  v_opp   uuid := public.costing_matrix_opp(p_matrix_id);
  v_id    uuid;
begin
  if v_actor is null then
    raise exception 'costing_bid: sign in first' using errcode = '42501';
  end if;
  if v_opp is null then
    raise exception 'costing_bid: matrix not found' using errcode = '22023';
  end if;
  if public.costing_tier(v_opp) is distinct from 'closed_book' then
    raise exception 'costing_bid: only Sales, Purchasing, a Super Admin or the Final Acquire list can unlock a bid' using errcode = '42501';
  end if;
  if p_reason is null or length(btrim(p_reason)) = 0 then
    raise exception 'costing_bid: write the reason for unlocking' using errcode = '22023';
  end if;

  perform 1 from public.costing_matrices where id = p_matrix_id for update;

  update public.costing_bid_decisions
     set cleared_at = now(), cleared_reason = 'Unlocked: ' || btrim(p_reason), unlocked_by = v_actor
   where matrix_id = p_matrix_id and cleared_at is null and verdict = 'go'
  returning id into v_id;
  if v_id is null then
    raise exception 'costing_bid: there is no Go to unlock' using errcode = '22023';
  end if;
  return v_id;
end;
$$;

revoke all on function public.costing_unlock_bid(uuid, text) from public, anon;
grant execute on function public.costing_unlock_bid(uuid, text) to authenticated;
