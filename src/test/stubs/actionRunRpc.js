import { stubRpc } from "@/test/msw/server"
import { db, insertRow, updateRow } from "@/test/db/store"
import { DEAL_TEAM_ROLES, SELECTOR_TYPES, resolvePeople } from "@/utils/resolvePeople"

const rowsOf = (table) => db.internal.rowsOf(table)
const findRow = (table, id) => rowsOf(table).find((row) => row.id === id)

/**
 * Issue #462 — `sor_open_costing_matrix` + `costing_open_matrix`
 * (supabase/migrations/20261018160000_open_costing_matrix_action.sql) re-implemented on the fake
 * database. Reads the action's config from its `flow_stage_actions` row (the real function reads the
 * Flow Snapshot's copy of the same config) and does what the plpgsql does: creates the SOR's one
 * matrix, or tops it up (blank Incharges, a missing default factor, members with no open window) and
 * never replaces anything, tells "who assigns it" when it opens with no Purchasing Incharge, and marks
 * the run created with its matrix. Returns the matrix id.
 */
function openCostingMatrixOnFake(run, action) {
  const config = action?.config ?? {};
  const opportunity = findRow("sales_opportunities", run.opportunity_id);
  const employees = rowsOf("employees");
  const alive = (id) => (id && employees.some((e) => e.id === id && !e.is_deleted) ? id : null);

  const sel = config.salesIncharge ?? { type: SELECTOR_TYPES.ROLE, role: "deal_owner" };
  const sales = alive(
    sel.type === SELECTOR_TYPES.EMPLOYEE
      ? sel.id
      : (DEAL_TEAM_ROLES[sel.role]?.columns ?? []).map((column) => opportunity?.[column]).find(Boolean),
  );
  const buyer = config.purchasingIncharge?.type === SELECTOR_TYPES.EMPLOYEE ? alive(config.purchasingIncharge.id) : null;

  let matrix = rowsOf("costing_matrices").find((m) => m.opportunity_id === run.opportunity_id);
  const created = !matrix;
  if (created) {
    matrix = insertRow("costing_matrices", {
      opportunity_id: run.opportunity_id,
      sales_incharge_id: sales,
      purchasing_incharge_id: buyer,
    });
  } else {
    const patch = {};
    if (!matrix.sales_incharge_id && sales) patch.sales_incharge_id = sales;
    if (!matrix.purchasing_incharge_id && buyer) patch.purchasing_incharge_id = buyer;
    if (Object.keys(patch).length > 0) matrix = updateRow("costing_matrices", matrix, patch);
  }

  // insertRow returns a copy; updateRow wants the stored row, so read it back.
  if (!rowsOf("costing_matrix_money").some((m) => m.matrix_id === matrix.id)) {
    insertRow("costing_matrix_money", { matrix_id: matrix.id });
  }
  const money = rowsOf("costing_matrix_money").find((m) => m.matrix_id === matrix.id);
  const preset = config.markupPresetId
    ? rowsOf("costing_markup_presets").find((p) => p.id === config.markupPresetId && p.active !== false)
    : null;
  if (preset && money.default_factor == null) {
    updateRow("costing_matrix_money", money, { default_preset_id: preset.id, default_factor: preset.factor });
  }

  const groupMembersById = {};
  for (const member of rowsOf("employee_group_members")) {
    (groupMembersById[member.group_id] ??= { employeeIds: [] }).employeeIds.push(member.employee_id);
  }
  const resolveAll = (selectors) => resolvePeople(selectors, { employees, groupMembersById, opportunity });

  const until = config.access?.until || "stage_left";
  for (const employeeId of resolveAll(config.extras)) {
    const open = rowsOf("sor_stage_participants").some(
      (p) => p.source === "costing_matrix" && p.source_id === matrix.id && p.employee_id === employeeId && !p.closed_at,
    );
    if (open || !run.stage_visit_id) continue;
    insertRow("sor_stage_participants", {
      opportunity_id: run.opportunity_id,
      employee_id: employeeId,
      source: "costing_matrix",
      source_id: matrix.id,
      opened_visit_id: run.stage_visit_id,
      until_rule: until,
      until_stage_id: ["stage_entered", "later_stage_left"].includes(until) ? config.access?.stageId ?? null : null,
    });
  }

  if (created && !matrix.purchasing_incharge_id) {
    for (const recipientId of resolveAll(config.assigners)) {
      insertRow("notifications", {
        recipient_id: recipientId,
        sender_id: null,
        type: "OPPORTUNITY_COSTING_INCHARGE_NEEDED",
        title: "Costing Matrix needs a Purchasing Incharge",
        message: "The Costing Matrix opened with no Purchasing Incharge. Please name one.",
        reference_id: run.opportunity_id,
      });
    }
  }

  const live = rowsOf("sor_action_runs").find((r) => r.id === run.id);
  updateRow("sor_action_runs", live, { outcome: "created", costing_matrix_id: matrix.id });
  return matrix.id;
}

/**
 * Issue #464 — `sor_request_packing_list`
 * (supabase/migrations/20261022100000_request_packing_list.sql) re-implemented on the fake database.
 * Creates one draft Packing List for the SOR unless it already has an open (draft) one, tells the
 * action's `notify` people (or the Warehouse staff list, `ipas_signer_lists` key `transmittal_warehouse`),
 * and marks the run created. Returns the new list's id, or null when it created nothing.
 */
function requestPackingListOnFake(run, action, actorId = null) {
  const config = action?.config ?? {};
  const opportunity = findRow("sales_opportunities", run.opportunity_id);
  const live = rowsOf("sor_action_runs").find((r) => r.id === run.id);
  const open = rowsOf("packing_lists").some((p) => p.opportunity_id === run.opportunity_id && p.state === "draft");
  if (open) {
    updateRow("sor_action_runs", live, { outcome: "created" });
    return null;
  }
  const employees = rowsOf("employees");
  const number = `PKL_${String(rowsOf("packing_lists").length + 1).padStart(3, "0")}`;
  const list = insertRow("packing_lists", {
    number,
    opportunity_id: run.opportunity_id,
    state: "draft",
    // The real function stamps the caller; the stub does not know who called, so the Deal Owner stands in.
    created_by: actorId ?? opportunity?.deal_owner_id ?? null,
  });

  let recipients;
  if (Array.isArray(config.notify) && config.notify.length > 0) {
    const groupMembersById = {};
    for (const member of rowsOf("employee_group_members")) {
      (groupMembersById[member.group_id] ??= { employeeIds: [] }).employeeIds.push(member.employee_id);
    }
    recipients = resolvePeople(config.notify, { employees, groupMembersById, opportunity });
  } else {
    recipients = rowsOf("ipas_signer_lists")
      .filter((l) => l.list_key === "transmittal_warehouse")
      .map((l) => l.employee_id);
  }
  for (const recipientId of new Set(recipients)) {
    if (recipientId === actorId) continue;
    if (!employees.some((e) => e.id === recipientId && !e.is_deleted)) continue;
    insertRow("notifications", {
      recipient_id: recipientId,
      sender_id: actorId,
      type: "PACKING_LIST_REQUESTED",
      title: "Packing List requested",
      message: `Please pack "${opportunity?.project_title ?? "this deal"}": draft Packing List ${number} is ready.`,
      reference_id: list.id,
    });
  }

  updateRow("sor_action_runs", live, { outcome: "created", packing_list_id: list.id });
  return list.id;
}

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

  // Issue #462 — the Decider's Create on an Optional Open Costing Matrix.
  stubRpc("sor_open_costing_matrix", (args) => {
    const run = findRow("sor_action_runs", args.p_run_id);
    if (!run) throw new Error("sor_open_costing_matrix: run not found");
    if (run.costing_matrix_id) throw new Error("sor_open_costing_matrix: run already opened its matrix");
    if (!(run.outcome === "pending" || (run.outcome === "created" && run.decided_by))) {
      throw new Error("sor_open_costing_matrix: run is not pending");
    }
    const action = findRow("flow_stage_actions", run.action_id);
    if (action?.kind !== "open_costing_matrix") throw new Error("sor_open_costing_matrix: not an Open Costing Matrix action");
    return openCostingMatrixOnFake(run, action);
  });

  // Issue #464 — the Decider's Create on an Optional Request Packing List.
  stubRpc("sor_request_packing_list", (args) => {
    const run = findRow("sor_action_runs", args.p_run_id);
    if (!run) throw new Error("sor_request_packing_list: run not found");
    if (run.packing_list_id) throw new Error("sor_request_packing_list: run already created its Packing List");
    if (!(run.outcome === "pending" || (run.outcome === "created" && run.decided_by))) {
      throw new Error("sor_request_packing_list: run is not pending");
    }
    const action = findRow("flow_stage_actions", run.action_id);
    if (action?.kind !== "request_packing_list") throw new Error("sor_request_packing_list: not a Request Packing List action");
    return requestPackingListOnFake(run, action, run.decided_by ?? null);
  });

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
      evaluator_id: args.p_evaluator_id ?? null,
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
        } else if (action.kind === "open_costing_matrix") {
          const matrixId = openCostingMatrixOnFake(run, findRow("flow_stage_actions", action.action_id));
          created.push({ action_id: action.action_id, kind: "open_costing_matrix", matrix_id: matrixId });
        } else if (action.kind === "request_packing_list") {
          const packingListId = requestPackingListOnFake(run, findRow("flow_stage_actions", action.action_id));
          created.push({ action_id: action.action_id, kind: "request_packing_list", packing_list_id: packingListId });
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
