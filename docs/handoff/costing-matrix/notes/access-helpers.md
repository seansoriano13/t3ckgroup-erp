# SQL access helpers and patterns to reuse

Latest bodies are in `supabase/schema/staging.sql` (section `-- Functions`, line ~3582).
Quote a body with: `awk -v n="CREATE OR REPLACE FUNCTION public.NAME(" 'index($0,n)==1{p=1} p{print} p&&/^;$/{p=0}' supabase/schema/staging.sql`

## Identity

- `public.get_employee_id()` → uuid. `SELECT id FROM employees WHERE email = auth.jwt()->>'email'`
  (SECURITY DEFINER). Null when not signed in.
- `public.is_super_admin()` → boolean, same lookup (`employees.is_super_admin`). Can be NULL:
  callers write `coalesce(public.is_super_admin(), false)`.

## Flags — NOTE the names

The spec says `has_purchasing_flow` / `has_finance_flow`. Those are **columns on `employees`**.
The SQL helpers are:
- `public.has_purchasing_access()` → `_employee_has_purchasing_access(get_employee_id())`.
- `public._employee_has_purchasing_access(p_employee_id uuid)` →
  `employees.has_purchasing_flow and not coalesce(is_deleted,false)` (use for "does person X
  have Purchasing access", e.g. the Purchasing Incharge check).
- `public.has_finance_access()` → `employees.has_finance_flow and not is_deleted` for the caller.
  (migration `20261013100000_finance_access_flag.sql`). No per-employee variant exists.
- Front end: `getPermissionContext(user)` in `src/utils/permissions.js` gives
  `isSuperAdmin`, `hasPurchasingFlow`, `isIpasApprover`, …

## Deal Team (ADR 0021, #208)

- `public.sor_is_deal_team(p_opp public.sales_opportunities, p_employee_id uuid)` (sql, STABLE):
  registered_by / deal_owner_id / closing_sales_id / support_sales_1_id / support_sales_2_id /
  sales_director_id = employee. Takes the ROW, not the id:
  `exists (select 1 from sales_opportunities o where o.id = p_opp_id and public.sor_is_deal_team(o, public.get_employee_id()))`.
- `public._sor_deal_team_roles(p_opp)` → table(employee_id, role) with roles
  `registrar, deal_owner, closing_sales, support_sales, sales_director` (used to add members).
- Restricted Stages: `public.sor_is_stage_shut_out(p_opp, p_employee_id, p_stage_id)` true when
  every Deal Team role they hold is in `flow_stage_access.shut_out_roles` for that stage, or
  they're in an excluded Employee Group. Super Admins are never shut out (callers check first).
  `sor_access_level` does **not** apply shut-out; `sor_visible_visit_ids` and
  `sor_guard_stage_move` do. ("Deal Team under ADR 0021's rule, Restricted Stages included" →
  the spec wants the Deal Team to read money even on a Restricted Stage.)

## Always sees / Always edits

- `public.sor_always_sees(p_opp, p_employee_id)` (SECURITY DEFINER): any selector in
  `flow_access_settings.always_sees` (jsonb array) of the SOR's Sale Type's flow covers them.
- `public.sor_always_edits(p_opp, p_employee_id)` — same on `always_edits`.
- `public.sor_selector_covers(p_selector jsonb, p_opp, p_employee_id)` — selector types:
  `everyone`, `employee {id}`, `group {id}`, `team {team}`, `department {department}`,
  `role {role: deal_owner|closing_sales|sales_director|registrar|support_sales}`.
- `public.employee_group_member_ids(p_group_id)` → setof uuid (hand-picked members + whole
  Teams by `sub_department`, not deleted).

## Access level and Stage Participants

- `public.sor_access_level(p_opportunity_id uuid)` → `'none' | 'full' | 'participant' | 'locked'`:
  full = Super Admin, Deal Team, Always sees; participant = open `sor_stage_participants` row
  (`closed_at is null`) or open Mention Window; locked = closed window / old mention /
  Purchase Request member. Front end: `opportunityService.getAccessLevel(id)`.
- `public.sor_can_edit_opportunity(p_opportunity_id)`: Deal Team (not closing_sales!), any
  `is_head`, Super Admin, or Always edits ∧ (Deal Team ∨ Always sees).
- Table `sor_stage_participants`: id, opportunity_id, employee_id, `source` CHECK
  (`action`,`assignment`,`purchase_request`), source_id, opened_visit_id (NOT NULL → sor_stage_visits),
  `until_rule` CHECK (`stage_left`,`stage_entered`,`later_stage_left`,`terminal`), until_stage_id,
  closed_at, closed_reason, removed_by, created_at.
  "Stage Participant with an open window" =
  `exists (select 1 from sor_stage_participants p where p.opportunity_id = X and p.employee_id = get_employee_id() and p.closed_at is null)`.
  A new `source` value (e.g. `costing_matrix`) needs the CHECK `sor_stage_participants_source_chk` widened.
- Windows close in trigger `close_stage_participant_windows()` (AFTER UPDATE OF flow_stage_id on
  sales_opportunities) by `until_rule`; terminal closes all.
- Visit-scoped reads: `public.sor_visible_visit_ids(p_opportunity_id)` → setof visit ids.

## Group tasks (Technical band source)

- `committee_tasks` = Group Task: id, title, status (`ACTIVE`,`ON_HOLD`,`CANCELLED`,…),
  `template_id` (→ `group_task_templates.id`), `opportunity_id`, `stage_action_id`,
  `stage_visit_id`, held/cancel columns.
- `committee_task_members`: committee_task_id, employee_id, status, … — removing a member
  DELETES the row (policy test 19), so "current member" = row exists. Consider also
  excluding cancelled tasks (`status <> 'CANCELLED'`) — not decided anywhere.
- `group_task_templates`: id, name, title, description, due_date_offset_days, archived_at.
  **No migration seeds "Evaluation of Specification"** — it exists only in live data, so a
  seed-by-name in a migration finds nothing on a fresh/local DB (must tolerate null).
- Stage Action group tasks are created by `sor_create_stage_group_task_action(p_run_id, p_title,
  p_description, p_members jsonb, p_due_date, p_template_id, p_tag_ids, p_created_by)` which
  stores `template_id`.
- Membership query shape:
  `exists (select 1 from committee_tasks t join committee_task_members m on m.committee_task_id = t.id where t.opportunity_id = X and t.template_id = (select evaluation_template_id from costing_settings) and m.employee_id = get_employee_id())`

## Explicit-column SECURITY DEFINER read (#295) — pattern for tiered reads (#319)

```sql
create or replace function public.sor_participant_record(p_opportunity_id uuid)
returns table (id uuid, opportunity_no text, client_name text, ... sales_director_id uuid)
language sql stable security definer set search_path = public as $$
  select o.id, o.opportunity_no, ... from public.sales_opportunities o
  where o.id = p_opportunity_id
    and public.sor_access_level(p_opportunity_id) in ('full', 'participant')
$$;
```
Latest: `20260928000000_sor_participant_modal_fields.sql`. Sibling `sor_participant_items`
(no `unit_price`). Called by `opportunityService.getParticipantRecord` / `getParticipantItems`
(`src/services/opportunityService.js` ~l.3588). For "keys absent, not null" across tiers,
returning `jsonb` built per tier (`jsonb_build_object` with only allowed keys) is the only way
one function can vary its shape; `returns table` always has every column.

## Money in its own table: `ipas_bank_details` (#245)

`supabase/migrations/20261013100500_ipas_bank_details.sql`:
- `ipas_bank_details (ipas_id uuid primary key references ipas(id) on delete cascade, ...)` —
  one row per parent, PK = parent id.
- narrower read helper `ipas_can_read_bank_details()` (Purchasing, Finance, Super Admin, or
  `ipas_signer_lists` keys `s1_approved`/`s3_approved`), then
  ```sql
  alter table public.ipas_bank_details enable row level security;
  drop policy if exists ipas_bank_details_read on public.ipas_bank_details;
  create policy ipas_bank_details_read on public.ipas_bank_details
    for select to authenticated using (public.ipas_can_read_bank_details());
  ```
- writes only via RPC `ipas_set_bank_details`; sensitive values never copied into `ipas_events`
  (events record WHICH field changed). The parent readers are wider: `ipas_can_read()`.
- Policy test: `src/test/policy/59-ipas-bank-details.test.js` (custom read probe, because the
  table has no `id` column — `support/access.js` helpers filter on `id`).

## Append-only history: `ipas_events` (20261013100100_ipas.sql ~l.212)

```sql
create or replace function public.ipas_events_append_only() returns trigger language plpgsql as $$
begin raise exception 'ipas_events is append-only: history can''t be changed (% refused)', tg_op using errcode = '42501'; end; $$;
create trigger ipas_events_no_change before update or delete on public.ipas_events for each row execute function public.ipas_events_append_only();
create trigger ipas_events_no_truncate before truncate on public.ipas_events for each statement execute function public.ipas_events_append_only();
revoke insert, update, delete, truncate on public.ipas_events from anon, authenticated;
```
Written by `_ipas_write_event(ipas_id, actor, kind, detail jsonb)` (internal, revoked).
CAUTION: the trigger also refuses cascade deletes from the parent — teardown needs
`session_replication_role = replica` (see services-and-tests.md, `support/ipas.js`).

## Signer lists and sign-offs (IPAS #247) — `20261013100700_ipas_signoffs.sql`

- `employees.call_sign` text (unique where set) — "employee code" in the spec = **call_sign**
  (101 Boss Lito; 1001 used for Transmittal check-by in `20261015100000_transmittals_tracer.sql`).
- `ipas_signer_lists (id, list_key text CHECK in (...), employee_id → employees on delete cascade,
  created_at, unique (list_key, employee_id))`; RLS read = `ipas_can_read()`, write policy
  `for all using/with check (coalesce(is_super_admin(), false))`.
- `ipas_signer_list_log (list_key, employee_id, action 'added'|'removed', actor_id, created_at)`,
  append-only (`ipas_signer_list_log_append_only`).
- RPC `ipas_set_signer_list(p_list_key text, p_employee_ids uuid[]) returns jsonb` — Super Admin
  only; validates key; `pg_advisory_xact_lock(hashtext('ipas_signer_list:'||key))`; diffs wanted
  vs have; refuses inactive employee (P0002); writes log; returns `{list_key, added, removed}`.
- `_ipas_on_list(p_list_key, p_employee_id)` — member and not soft-deleted.
- Seed by call sign in a `do $seed$ ... $seed$;` block: look up `employees.call_sign`, `raise notice`
  when absent (never fail), `insert ... on conflict (list_key, employee_id) do nothing`.
- `ipas_signoffs`: id, ipas_id, section, role, signed_by, signed_at, signature_declined,
  `signature_version` (copy of `employees.signature_path` at signing; null if declined/none),
  cleared_at, cleared_by, cleared_reason. CHECK `ipas_signoffs_cleared_chk` (all three null, or
  cleared_at + non-blank reason). Live = uncleared:
  `create unique index ipas_signoffs_live_key on ipas_signoffs (ipas_id, section, role) where cleared_at is null;`
  Guard trigger `ipas_signoffs_guard` (BEFORE UPDATE): a cleared row never changes; only clearing
  columns may move. Read policy = parent's reader; writes revoked from clients.
- `ipas_sign(p_ipas_id, p_section, p_role, p_decline_signature boolean default false) returns jsonb`:
  validates pair (22023); role check (Purchasing for prepared; `_ipas_on_list` otherwise —
  "a Super Admin is no exception: they sign when they are on it"); refuses duplicate live
  (55000); **no self-approval**: approved refused when the live prepared row's `signed_by = actor`
  (42501); snapshots signature; writes event; returns `{signoff, ipas, section, role, notify_ids}`.
- `_ipas_clear_approvals(p_ipas_id, p_actor, p_reason, out sections int[], out preparer_ids uuid[])`:
  `update ... set cleared_at = now(), cleared_by = p_actor, cleared_reason = p_reason where ... and cleared_at is null returning ...`,
  writes an `approvals_cleared` event; called by the RPCs that change cleared-on data.
- Error codes used across IPAS/Transmittal RPCs: `42501` not allowed, `22023` bad argument,
  `55000` wrong state, `P0002` not found. Messages are prefixed `fn_name: ...`.

## Column-level guard triggers comparing OLD/NEW (prior art for band triggers)

No existing trigger checks per-column bands per actor. Closest shapes:
- `sor_guard_non_editor_update()` (BEFORE UPDATE on sales_opportunities, SECURITY DEFINER):
  ```sql
  if auth.role() = 'service_role' or auth.uid() is null then return NEW; end if;
  if public.sor_can_edit_opportunity(OLD.id) then return NEW; end if;
  if (to_jsonb(NEW) - 'flow_stage_id' - 'contract_date' - 'updated_at' - 'sor_code')
     is distinct from (to_jsonb(OLD) - 'flow_stage_id' - ...) then
    raise exception 'You can move this SOR, but not edit it.' using errcode = '42501';
  end if;
  ```
  (service-role bypass idiom: `auth.role() = 'service_role'`; migrations run with no JWT, so
  `auth.uid() is null` also passes.)
- `prevent_role_escalation()` (BEFORE UPDATE on employees): `IF NEW.col IS DISTINCT FROM OLD.col
  AND NOT (caller is super admin) THEN RAISE EXCEPTION '...' USING ERRCODE = '42501'`, per column.
- `ipas_guard()`: `if new.number is distinct from old.number then raise exception 'ipas: ...'`.
- `ipas_signoffs_guard()`, `packing_lists_guard()` (also refuses DELETE: `if tg_op = 'DELETE'`).
- Settings-table RLS (Purchasing or Super Admin write): `20261017210000_order_ageing_rules.sql`
  (read: `get_employee_id() is not null`; insert/update policies
  `public.has_purchasing_access() or coalesce(public.is_super_admin(), false)`; delete revoked).
No codebase precedent puts the column name into an error field (no `using column =`/`hint`);
services surface `error.message` as-is.
