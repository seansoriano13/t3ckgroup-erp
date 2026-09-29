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

  // Issue #404 — sor_create_stage_action_task
  // (supabase/migrations/20260930230000_stage_action_task_via_rpc.sql)
  // inserts the task and marks the run created atomically. The fake
  // database has no RLS layer to exercise here (that's the policy tier's
  // job — src/test/policy); this stub only needs to reproduce the write
  // shape so unit/component tests exercising buildAndCreateActionTask keep
  // working now that the individual-task path goes through this RPC.
  stubRpc("sor_create_stage_action_task", (args) => {
    const run = findRow("sor_action_runs", args.p_run_id)
    if (!run) throw new Error("sor_create_stage_action_task: run not found")
    if (run.task_id) throw new Error("sor_create_stage_action_task: run already has a task")
    if (!["pending", "created"].includes(run.outcome)) {
      throw new Error("sor_create_stage_action_task: run is not pending")
    }

    const task = insertRow("tasks", {
      task_description: args.p_task_description,
      project_title: args.p_project_title ?? null,
      category_id: args.p_category_id ?? null,
      logged_by: args.p_logged_by ?? null,
      priority: args.p_priority ?? "MEDIUM",
      checklist: args.p_checklist ?? null,
      status: "INCOMPLETE",
      remarks: "",
      end_at: args.p_end_at ?? null,
      reported_to: args.p_reported_to ?? null,
      opportunity_id: run.opportunity_id,
      stage_action_id: run.action_id,
      stage_visit_id: run.stage_visit_id,
    })

    updateRow("sor_action_runs", run, { outcome: "created", task_id: task.id })

    return task
  })

  // Issue #409 — sor_create_stage_group_task_action
  // (supabase/migrations/20260930240000_stage_actions_survive_page_close.sql),
  // the Group Task counterpart of sor_create_stage_action_task above: inserts
  // committee_tasks/committee_task_members/committee_task_tags and marks the
  // run created, atomically.
  stubRpc("sor_create_stage_group_task_action", (args) => {
    const run = findRow("sor_action_runs", args.p_run_id)
    if (!run) throw new Error("sor_create_stage_group_task_action: run not found")
    if (run.group_task_id) throw new Error("sor_create_stage_group_task_action: run already has a group task")
    if (!["pending", "created"].includes(run.outcome)) {
      throw new Error("sor_create_stage_group_task_action: run is not pending")
    }
    if (!args.p_members || args.p_members.length === 0) {
      throw new Error("sor_create_stage_group_task_action: at least one member is required")
    }

    const groupTask = insertRow("committee_tasks", {
      title: args.p_title,
      description: args.p_description ?? "",
      due_date: args.p_due_date ?? null,
      created_by: args.p_created_by ?? null,
      status: "ACTIVE",
      template_id: args.p_template_id ?? null,
      opportunity_id: run.opportunity_id,
      stage_action_id: run.action_id,
      stage_visit_id: run.stage_visit_id,
    })

    for (const member of args.p_members) {
      insertRow("committee_task_members", {
        committee_task_id: groupTask.id,
        employee_id: member.employee_id,
        task_description: member.task_description || "",
        checklist: member.checklist || null,
        role: member.role || null,
        custom_role: member.custom_role || null,
        status: "PENDING",
      })
    }

    for (const tagId of args.p_tag_ids || []) {
      insertRow("committee_task_tags", {
        committee_task_id: groupTask.id,
        tag_id: tagId,
        added_by: null,
      })
    }

    updateRow("sor_action_runs", run, { outcome: "created", group_task_id: groupTask.id })

    return groupTask
  })

  /**
   * Issue #409 — `sor_run_stage_actions`
   * (supabase/migrations/20260930240000_stage_actions_survive_page_close.sql)
   * is the one server-side call moveAlongFlow now makes for a whole Stage's
   * action list, replacing its old per-action client loop. This reproduces
   * the plpgsql function's control flow against the fake database: the
   * fire-once gate, then either a direct notification insert ("when
   * confirmed") or one of the two create-stage-action RPCs above, catching
   * any failure per-action rather than aborting the batch.
   */
  stubRpc("sor_run_stage_actions", (args) => {
    const failed = []
    const created = []

    for (const action of args.p_actions || []) {
      const existing = rowsOf("sor_action_runs").find(
        (r) =>
          r.opportunity_id === args.p_opportunity_id &&
          r.stage_id === args.p_stage_id &&
          r.action_id === action.action_id &&
          !r.closed_off_at,
      )
      if (!existing) {
        insertRow("sor_action_runs", {
          opportunity_id: args.p_opportunity_id,
          stage_id: args.p_stage_id,
          action_id: action.action_id,
          stage_visit_id: args.p_stage_visit_id ?? null,
          decider: action.confirm ? action.decider ?? null : null,
          outcome: "pending",
        })
      }
      // insertRow/updateRow return copies, not the live row object updateRow's
      // own unique check needs to compare `existingRow` against — always
      // re-fetch the actual stored reference (same reason findRow exists
      // above for the other stubs in this file).
      const run = rowsOf("sor_action_runs").find(
        (r) =>
          r.opportunity_id === args.p_opportunity_id &&
          r.stage_id === args.p_stage_id &&
          r.action_id === action.action_id &&
          !r.closed_off_at,
      )

      if (run.outcome !== "pending") continue

      if (action.confirm) {
        for (const recipientId of action.decider_ids || []) {
          insertRow("notifications", {
            recipient_id: recipientId,
            sender_id: null,
            type: "OPPORTUNITY_ACTION_DECISION_DUE",
            title: action.notification_title || action.name || "Stage Action",
            message: `A Stage Action on this deal (${action.stage_name || ""}) needs your decision: Create or Skip.`,
            reference_id: args.p_opportunity_id,
          })
        }
        continue
      }

      try {
        if (action.kind === "create_individual_task") {
          const task = insertRow("tasks", {
            task_description: action.task_description,
            project_title: action.project_title ?? null,
            category_id: action.category_id ?? null,
            logged_by: action.logged_by ?? null,
            priority: action.priority ?? "MEDIUM",
            checklist: action.checklist ?? null,
            status: "INCOMPLETE",
            remarks: "",
            end_at: action.end_at ?? null,
            reported_to: action.reported_to ?? null,
            opportunity_id: run.opportunity_id,
            stage_action_id: run.action_id,
            stage_visit_id: run.stage_visit_id,
          })
          updateRow("sor_action_runs", run, { outcome: "created", task_id: task.id })
          created.push({ action_id: action.action_id, kind: "create_individual_task", task_id: task.id })
        } else if (action.kind === "create_group_task") {
          const groupTask = insertRow("committee_tasks", {
            title: action.group_title,
            description: action.group_description ?? "",
            due_date: action.due_date ?? null,
            created_by: action.created_by ?? null,
            status: "ACTIVE",
            template_id: action.template_id ?? null,
            opportunity_id: run.opportunity_id,
            stage_action_id: run.action_id,
            stage_visit_id: run.stage_visit_id,
          })
          for (const member of action.members || []) {
            insertRow("committee_task_members", {
              committee_task_id: groupTask.id,
              employee_id: member.employee_id,
              task_description: member.task_description || "",
              checklist: member.checklist || null,
              role: member.role || null,
              custom_role: member.custom_role || null,
              status: "PENDING",
            })
          }
          for (const tagId of action.tag_ids || []) {
            insertRow("committee_task_tags", { committee_task_id: groupTask.id, tag_id: tagId, added_by: null })
          }
          updateRow("sor_action_runs", run, { outcome: "created", group_task_id: groupTask.id })
          created.push({ action_id: action.action_id, kind: "create_group_task", group_task_id: groupTask.id })
        } else {
          throw new Error(`sor_run_stage_actions: no builder for kind ${action.kind}`)
        }
      } catch {
        updateRow("sor_action_runs", run, { outcome: "failed" })
        failed.push(action.name || "Stage Action")
      }
    }

    return { failed, created }
  })
}
