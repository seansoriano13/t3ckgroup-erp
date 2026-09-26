import { stubRpc } from "@/test/msw/server"
import { db, insertRow, updateRow } from "@/test/db/store"

const rowsOf = (table) => db.internal.rowsOf(table)
const findRow = (table, id) => rowsOf(table).find((row) => row.id === id)

/**
 * Issue #204 Part 2 — `sor_action_runs` and its three RPCs live in Postgres
 * (see supabase/migrations/20260916000000_stage_action_runs.sql), which the
 * fake database does not execute. This re-implements their logic in JS
 * against the same in-memory store, the pattern restoreFlowSnapshotRpc.js
 * established for restore_flow_snapshot.
 */
export function stubActionRunRpcs() {
  stubRpc("sor_begin_action_run", (args) => {
    const existing = rowsOf("sor_action_runs").find(
      (r) =>
        r.opportunity_id === args.p_opportunity_id &&
        r.stage_id === args.p_stage_id &&
        r.action_id === args.p_action_id &&
        !r.closed_off_at,
    )
    if (existing) return existing
    return insertRow("sor_action_runs", {
      opportunity_id: args.p_opportunity_id,
      stage_id: args.p_stage_id,
      action_id: args.p_action_id,
      stage_visit_id: args.p_stage_visit_id ?? null,
      decider: args.p_decider ?? null,
      outcome: "pending",
    })
  })

  stubRpc("sor_finish_action_run", (args) => {
    const run = findRow("sor_action_runs", args.p_run_id)
    if (!run) throw new Error("sor_finish_action_run: run not found")
    return updateRow("sor_action_runs", run, {
      outcome: args.p_outcome,
      task_id: args.p_task_id ?? run.task_id ?? null,
      group_task_id: args.p_group_task_id ?? run.group_task_id ?? null,
    })
  })

  stubRpc("sor_decide_action_run", (args) => {
    const run = findRow("sor_action_runs", args.p_run_id)
    if (!run) throw new Error("sor_decide_action_run: run not found")
    if (run.outcome !== "pending") throw new Error("sor_decide_action_run: run already decided")

    const opportunity = findRow("sales_opportunities", run.opportunity_id)
    const dealTeamColumnsByRole = {
      deal_owner: ["deal_owner_id"],
      closing_sales: ["closing_sales_id"],
      support_sales: ["support_sales_1_id", "support_sales_2_id"],
      sales_director: ["sales_director_id"],
      registrar: ["registered_by"],
    }
    const normaliseTeam = (v) => String(v ?? "").trim().toUpperCase()

    const selectors = run.decider || []
    const allowed = selectors.some((s) => {
      if (s.type === "employee") return s.id === args.p_actor_id
      if (s.type === "group") {
        return rowsOf("employee_group_members").some(
          (m) => m.group_id === s.id && m.employee_id === args.p_actor_id,
        )
      }
      if (s.type === "team") {
        const actor = findRow("employees", args.p_actor_id)
        return Boolean(actor) && normaliseTeam(actor.sub_department) === normaliseTeam(s.team)
      }
      if (s.type === "role" && opportunity) {
        const columns = dealTeamColumnsByRole[s.role] || []
        return columns.some((column) => opportunity[column] === args.p_actor_id)
      }
      return false
    })
    if (!allowed) throw new Error("sor_decide_action_run: actor is not a decider for this run")

    return updateRow("sor_action_runs", run, {
      decided_by: args.p_actor_id,
      decided_at: new Date().toISOString(),
      outcome: args.p_decision === "create" ? "created" : "skipped",
    })
  })
}
