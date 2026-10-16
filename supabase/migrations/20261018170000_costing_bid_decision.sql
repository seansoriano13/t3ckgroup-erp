-- Costing Matrix, the Bid Decision (#320, spec #266, Closed Book from #319).
--
-- WHAT THIS ADDS
--   costing_bid_decisions   the boss's judgement on one priced offer: Go, No-go or Revise,
--                           with a reason in their own words, stamped with who decided,
--                           when, and the Final Offer total and ABC total it was taken
--                           against. A decision is "live" while cleared_at is null; a
--                           matrix has at most one live decision. Cleared rows stay, with
--                           why they were cleared, as the record of what was decided.
--   costing_decide_bid      the one way to take a decision (ADR 0013): locks the matrix,
--                           stamps the totals in SQL (the same half-up-to-the-centavo
--                           arithmetic as costingMath), replaces any live decision and,
--                           for No-go and Revise, tells the Deal Team. It moves no stage,
--                           status or flag on the SOR (PMS never moves the deal, #227).
--   costing_bid_totals      the Final Offer total and ABC total of a matrix, as stamped.
--   costing_pending_bid_decisions
--                           the Approval Center's queue: matrices whose Final Offers are
--                           all set and that have no live decision.
--   Triggers                a change to a Final Offer (or a Tender Line's quantity, which
--                           moves the Final Offer total) or to a Final Acquire (a
--                           Component's or a cost-only row's) clears the live decision,
--                           with a reason.
--
-- ACCESS
--   Deciding: a Super Admin or a member of the Final Acquire list (the closed_book tier).
--   There is no self-approval rule: the list starts as 101 alone, who sets Final Acquire
--   and decides the bid (#320 amended).
--   Reading, through costing_matrix_read (the registry): verdict, reason, decider, date,
--   cleared_at and cleared_reason reach the price and closed_book tiers (Sales sees the
--   verdict and the reason, never the numbers); the stamped final_offer_total and
--   abc_total reach closed_book only. The cost and participant tiers read nothing of it.
--   The table is written only by the functions here: no direct insert, update or delete.
--
-- SAFE TO RUN AT ANY TIME. Idempotent: every statement is create-if-missing,
-- create-or-replace, drop-then-create or insert-on-conflict.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists public.costing_bid_decisions (
  id                uuid primary key default gen_random_uuid(),
  matrix_id         uuid not null references public.costing_matrices (id) on delete cascade,
  verdict           text not null,
  reason            text not null,
  decided_by        uuid references public.employees (id) on delete set null,
  decided_at        timestamptz not null default now(),
  -- What the decision was taken against, stamped at that moment. Closed Book only.
  final_offer_total numeric(18,2) not null,
  abc_total         numeric(18,2),
  cleared_at        timestamptz,
  cleared_reason    text,

  constraint costing_bid_decisions_verdict_chk check (verdict in ('go', 'no_go', 'revise')),
  constraint costing_bid_decisions_reason_chk check (length(btrim(reason)) > 0),
  constraint costing_bid_decisions_cleared_chk check ((cleared_at is null) = (cleared_reason is null))
);

create index if not exists costing_bid_decisions_matrix_idx
  on public.costing_bid_decisions (matrix_id, decided_at);

-- At most one live decision per matrix.
create unique index if not exists costing_bid_decisions_live_key
  on public.costing_bid_decisions (matrix_id)
  where cleared_at is null;

comment on table public.costing_bid_decisions is
  '#320: the Bid Decision on a Costing Matrix (Go / No-go / Revise, with a reason), stamped with the Final Offer total and ABC total it was taken against. Live while cleared_at is null; any later Final Offer or Final Acquire change clears it. Written only by costing_decide_bid and the clearing triggers. Read directly at the closed_book tier only; costing_matrix_read serves the price tier the verdict and reason without the stamped figures.';

-- Functions
-- ---------------------------------------------------------------------------
-- Totals
-- ---------------------------------------------------------------------------

-- The matrix's Final Offer total and ABC total, the way costingMath.matrixTotals works them:
-- each Tender Line's unit price times its quantity, exact, rounded half away from zero to the
-- centavo, then added up. A total is null while any Tender Line lacks that price (or there are
-- no Tender Lines): a blank is never zero. Internal: no caller reads it directly.
create or replace function public.costing_bid_totals(p_matrix_id uuid)
returns table (final_offer_total numeric, abc_total numeric, line_count integer, missing_offer integer, missing_abc integer)
language sql
stable
security definer
set search_path = public
as $$
  select
    case when count(*) > 0 and count(*) filter (where p.final_offer_unit is null) = 0
         then sum(round(p.final_offer_unit * l.quantity, 2)) end,
    case when count(*) > 0 and count(*) filter (where p.abc_unit is null) = 0
         then sum(round(p.abc_unit * l.quantity, 2)) end,
    count(*)::integer,
    (count(*) filter (where p.final_offer_unit is null))::integer,
    (count(*) filter (where p.abc_unit is null))::integer
  from public.costing_tender_lines l
  left join public.costing_tender_line_prices p on p.tender_line_id = l.id
  where l.matrix_id = p_matrix_id
$$;

-- ---------------------------------------------------------------------------
-- Taking a decision
-- ---------------------------------------------------------------------------

-- Takes the Bid Decision on a matrix. A Super Admin or the Final Acquire list only; every
-- Tender Line needs a Final Offer first (there is nothing to judge otherwise). A live decision
-- is replaced: it is cleared with the reason "Decided again" and the new one is live. No-go and
-- Revise tell the Deal Team (everyone on it but the decider); Go tells nobody. Nothing on the
-- SOR changes. Returns the new decision's id.
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
    raise exception 'costing_bid: matrix not found' using errcode = 'P0002';
  end if;
  if public.costing_tier(v_opp) is distinct from 'closed_book' then
    raise exception 'costing_bid: only a Super Admin or the Final Acquire list can decide a bid' using errcode = '42501';
  end if;
  if p_verdict is null or p_verdict not in ('go', 'no_go', 'revise') then
    raise exception 'costing_bid: the verdict must be Go, No-go or Revise' using errcode = '23514';
  end if;
  if p_reason is null or length(btrim(p_reason)) = 0 then
    raise exception 'costing_bid: write the reason for the decision' using errcode = '23514';
  end if;

  -- One decision at a time per matrix (ADR 0013).
  perform 1 from public.costing_matrices where id = p_matrix_id for update;

  select * into v_totals from public.costing_bid_totals(p_matrix_id);
  if v_totals.line_count = 0 or v_totals.missing_offer > 0 then
    raise exception 'costing_bid: every Tender Line needs a Final Offer before the bid can be decided' using errcode = '23514';
  end if;

  update public.costing_bid_decisions
     set cleared_at = now(), cleared_reason = 'Decided again'
   where matrix_id = p_matrix_id and cleared_at is null;

  insert into public.costing_bid_decisions (matrix_id, verdict, reason, decided_by, final_offer_total, abc_total)
  values (p_matrix_id, p_verdict, btrim(p_reason), v_actor, v_totals.final_offer_total, v_totals.abc_total)
  returning id into v_id;

  if p_verdict in ('no_go', 'revise') then
    select o.project_title into v_title from public.sales_opportunities o where o.id = v_opp;
    v_label := case p_verdict when 'no_go' then 'No-go' else 'Revise' end;
    -- The Deal Team, once each, never the decider. The message carries the verdict and the
    -- reason, and no figure: Sales never reads the numbers a decision was taken against.
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
-- The Approval Center queue
-- ---------------------------------------------------------------------------

-- Matrices waiting for a decision: every Tender Line has a Final Offer and there is no live
-- decision. Closed Book callers only (a Super Admin, or the Final Acquire list); anyone else
-- gets no rows. Oldest waiting first.
create or replace function public.costing_pending_bid_decisions()
returns table (
  matrix_id         uuid,
  opportunity_id    uuid,
  project_title     text,
  client_name       text,
  deal_owner_id     uuid,
  deal_owner_name   text,
  final_offer_total numeric,
  abc_total         numeric,
  waiting_since     timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select m.id, m.opportunity_id, o.project_title, o.client_name, o.deal_owner_id, own.name,
         t.final_offer_total, t.abc_total,
         coalesce(
           (select max(e.created_at) from public.costing_events e
             where e.matrix_id = m.id and e.detail ->> 'table' = 'costing_tender_line_prices'),
           m.created_at
         )
  from public.costing_matrices m
  join public.sales_opportunities o on o.id = m.opportunity_id
  left join public.employees own on own.id = o.deal_owner_id
  cross join lateral public.costing_bid_totals(m.id) t
  where (coalesce(public.is_super_admin(), false) or public.costing_on_list('final_acquire'))
    and not coalesce(o.is_deleted, false)
    and not coalesce(o.is_scratch, false)
    and t.line_count > 0
    and t.missing_offer = 0
    and not exists (
      select 1 from public.costing_bid_decisions d where d.matrix_id = m.id and d.cleared_at is null
    )
  order by 9, m.id
$$;

-- ---------------------------------------------------------------------------
-- Clearing
-- ---------------------------------------------------------------------------

-- A change to a Final Offer or a Final Acquire clears the matrix's live decision, so a Go
-- always refers to numbers that still stand. trigger arguments: the reason to record, then the
-- column whose change counts ('' = any insert, delete or update of the row).
create or replace function public.costing_bid_decisions_clear()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reason text := tg_argv[0];
  v_column text := coalesce(tg_argv[1], '');
  v_old    jsonb := case when tg_op = 'INSERT' then null else to_jsonb(old) end;
  v_new    jsonb := case when tg_op = 'DELETE' then null else to_jsonb(new) end;
  v_row    jsonb := coalesce(v_new, v_old);
  v_matrix uuid;
begin
  if v_column <> '' then
    if tg_op = 'INSERT' and (v_new -> v_column) is null then
      return null;
    elsif tg_op = 'DELETE' and (v_old -> v_column) is null then
      return null;
    elsif tg_op = 'UPDATE' and (v_new -> v_column) is not distinct from (v_old -> v_column) then
      return null;
    end if;
    if tg_op = 'INSERT' and (v_new -> v_column) = 'null'::jsonb then
      return null;
    elsif tg_op = 'DELETE' and (v_old -> v_column) = 'null'::jsonb then
      return null;
    end if;
  end if;

  v_matrix := public.costing_matrix_of(tg_table_name, v_row);
  -- The matrix is going (an SOR cascade): nothing left to clear.
  if v_matrix is null or not exists (select 1 from public.costing_matrices where id = v_matrix) then
    return null;
  end if;

  update public.costing_bid_decisions
     set cleared_at = now(), cleared_reason = v_reason
   where matrix_id = v_matrix and cleared_at is null;
  return null;
end;
$$;

revoke all on function public.costing_bid_decisions_clear() from public, anon, authenticated;
revoke all on function public.costing_bid_totals(uuid) from public, anon, authenticated;

drop trigger if exists costing_bid_clear_offer on public.costing_tender_line_prices;
create trigger costing_bid_clear_offer after insert or update or delete on public.costing_tender_line_prices
  for each row execute function public.costing_bid_decisions_clear('The Final Offer changed', 'final_offer_unit');

drop trigger if exists costing_bid_clear_quantity on public.costing_tender_lines;
create trigger costing_bid_clear_quantity after update on public.costing_tender_lines
  for each row execute function public.costing_bid_decisions_clear('The Final Offer changed', 'quantity');

drop trigger if exists costing_bid_clear_component on public.costing_component_costs;
create trigger costing_bid_clear_component after insert or update or delete on public.costing_component_costs
  for each row execute function public.costing_bid_decisions_clear('A Final Acquire changed', 'final_acquire_unit');

drop trigger if exists costing_bid_clear_cost_row on public.costing_cost_rows;
create trigger costing_bid_clear_cost_row after insert or update or delete on public.costing_cost_rows
  for each row execute function public.costing_bid_decisions_clear('A Final Acquire changed', 'final_acquire_unit');

-- The history writer: the decision, and its clearing, are recorded like any other change.
drop trigger if exists costing_events_write on public.costing_bid_decisions;
create trigger costing_events_write after insert or update or delete on public.costing_bid_decisions
  for each row execute function public.costing_write_events();

-- ---------------------------------------------------------------------------
-- Row level security and grants
-- ---------------------------------------------------------------------------

alter table public.costing_bid_decisions enable row level security;

-- Written by the functions above only. Read directly at the closed_book tier; everyone else
-- reads the verdict and reason through costing_matrix_read.
revoke all on table public.costing_bid_decisions from anon, authenticated;
grant select on public.costing_bid_decisions to authenticated;

drop policy if exists costing_bid_decisions_read on public.costing_bid_decisions;
create policy costing_bid_decisions_read on public.costing_bid_decisions
  for select to authenticated
  using (public.costing_tier(public.costing_matrix_opp(matrix_id)) = 'closed_book');

revoke all on function public.costing_decide_bid(uuid, text, text) from public, anon;
grant execute on function public.costing_decide_bid(uuid, text, text) to authenticated;
revoke all on function public.costing_pending_bid_decisions() from public, anon;
grant execute on function public.costing_pending_bid_decisions() to authenticated;

-- ---------------------------------------------------------------------------
-- Registry rows
-- ---------------------------------------------------------------------------

-- A money table (it holds stamped totals): no direct reads below closed_book, and no band rows,
-- so costing_set_money refuses it. It carries matrix_id itself.
insert into public.costing_tables (table_name, parent_table, parent_column, parent_key, key_column, order_by, money) values
  ('costing_bid_decisions', null, null, 'id', 'id', 't.decided_at, t.id', true)
on conflict (table_name) do update
  set parent_table = excluded.parent_table, parent_column = excluded.parent_column,
      parent_key = excluded.parent_key, key_column = excluded.key_column,
      order_by = excluded.order_by, money = excluded.money;

-- #320: Sales (the price tier) and Closed Book read the verdict and the reason; the figures it was
-- taken against are Closed Book's alone. Purchasing and a Stage Participant read nothing of it.
insert into public.costing_column_tiers (table_name, column_name, tiers) values
  ('costing_bid_decisions', 'id', '{price,closed_book}'),
  ('costing_bid_decisions', 'matrix_id', '{price,closed_book}'),
  ('costing_bid_decisions', 'verdict', '{price,closed_book}'),
  ('costing_bid_decisions', 'reason', '{price,closed_book}'),
  ('costing_bid_decisions', 'decided_by', '{price,closed_book}'),
  ('costing_bid_decisions', 'decided_at', '{price,closed_book}'),
  ('costing_bid_decisions', 'cleared_at', '{price,closed_book}'),
  ('costing_bid_decisions', 'cleared_reason', '{price,closed_book}'),
  ('costing_bid_decisions', 'final_offer_total', '{closed_book}'),
  ('costing_bid_decisions', 'abc_total', '{closed_book}')
on conflict (table_name, column_name) do update set tiers = excluded.tiers;
