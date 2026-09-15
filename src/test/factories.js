/**
 * Fixture builders for the fake database.
 *
 * Each one seeds the minimum a row needs to satisfy its table's constraints and
 * returns the stored row, so a test only spells out the fields it is actually
 * asserting on. Foreign keys are created on demand — `makeTask()` with no
 * arguments produces a valid task, its category and its author.
 */

import { db } from "./db/store"
import { PIPELINE_STAGE_SEED } from "@/constants/sor"
import { safeDeriveHours } from "@/utils/time"

let sequence = 0
const next = () => (sequence += 1)

export function resetFactories() {
  sequence = 0
}

export function makeEmployee(overrides = {}) {
  const n = next()
  return db.seed("employees", {
    name: `Employee ${n}`,
    email: `employee${n}@t3ckgroup.test`,
    department: "IT",
    role: "EMPLOYEE",
    is_deleted: false,
    is_head: false,
    is_hr: false,
    is_super_admin: false,
    employment_status: "Regular",
    offset_hours_balance: 0,
    sil_hours_balance: 0,
    ...overrides,
  })
}

export const makeHrEmployee = (overrides = {}) =>
  makeEmployee({ is_hr: true, department: "HR", role: "HR", ...overrides })

export const makeSuperAdmin = (overrides = {}) =>
  makeEmployee({ is_super_admin: true, role: "SUPER_ADMIN", ...overrides })

export const makeHead = (overrides = {}) => makeEmployee({ is_head: true, ...overrides })

export function makeCategory(overrides = {}) {
  const n = next()
  return db.seed("categories", {
    category_id: `CAT-${n}`,
    description: `Category ${n}`,
    department: "IT",
    ...overrides,
  })
}

export function makeCompany(overrides = {}) {
  const n = next()
  return db.seed("companies", {
    name: `Company ${n}`,
    is_active: true,
    sort_order: n,
    ...overrides,
  })
}

export function makeLeaveCategory(overrides = {}) {
  const n = next()
  return db.seed("hr_leave_categories", {
    id: `LVCAT-${n}`,
    label: `Leave Category ${n}`,
    is_active: true,
    sort_order: n,
    ...overrides,
  })
}

export function makeTask(overrides = {}) {
  const loggedBy = overrides.logged_by ?? makeEmployee().id
  const categoryId = overrides.category_id ?? makeCategory().category_id
  return db.seed("tasks", {
    task_description: `Task ${next()}`,
    status: "INCOMPLETE",
    priority: "LOW",
    grade: 0,
    hr_verified: false,
    ...overrides,
    logged_by: loggedBy,
    category_id: categoryId,
  })
}

export function makeOpportunity(overrides = {}) {
  const registeredBy = overrides.registered_by ?? makeEmployee().id
  const n = next()
  
  if (db.internal.rowsOf("crm_pipeline_stages").length === 0) {
    seedPipeline()
  }

  // opportunity_no is not set: migration 0012 retired it, so production leaves
  // it null too. sales_reference is the only S0#### identifier now.
  return db.seed("sales_opportunities", {
    lead_source: "LGU",
    client_name: `Client ${n}`,
    project_title: `Project ${n}`,
    project_type: "SSP",
    registration_date: "2026-03-01",
    status: "LEAD",
    is_deleted: false,
    ...overrides,
    registered_by: registeredBy,
  })
}

export function makeOpportunityItem(opportunityId, overrides = {}) {
  return db.seed("sales_opportunity_items", {
    opportunity_id: opportunityId,
    product_name: `Product ${next()}`,
    quantity: 1,
    unit_price: 1000,
    sort_order: 0,
    ...overrides,
  })
}

/**
 * A Stage's condition. Required, active, `field`-kind by default — the
 * kind that needs no attachment/member data to satisfy, so a bare call
 * blocks a crossing without a test also having to fake evidence for it.
 */
export function makeStageCondition(overrides = {}) {
  const stageId = overrides.stage_id ?? makeFlowStage().id
  const n = next()
  return db.seed("stage_conditions", {
    kind: "field",
    label: `Condition ${n}`,
    is_required: true,
    sort_order: n,
    config: {},
    archived_at: null,
    ...overrides,
    stage_id: stageId,
  })
}

/**
 * A Stage Field (issue #203) — a custom text field by default, required,
 * kept per Stage Visit.
 */
export function makeStageField(overrides = {}) {
  const stageId = overrides.stage_id ?? makeFlowStage().id
  const n = next()
  return db.seed("flow_stage_fields", {
    label: `Field ${n}`,
    help: null,
    source: "custom",
    sor_field: null,
    field_type: "text",
    options: [],
    is_required: true,
    sort_order: n,
    archived_at: null,
    ...overrides,
    stage_id: stageId,
  })
}

/** A Stage Visit (issue #203) — the record of one stay on a Stage. Open (no `left_at`) by default. */
export function makeStageVisit(overrides = {}) {
  const opportunityId = overrides.opportunity_id ?? makeOpportunity().id
  const stageId = overrides.flow_stage_id ?? makeFlowStage().id
  return db.seed("sor_stage_visits", {
    flow_snapshot_id: null,
    sequence: 1,
    entered_at: new Date().toISOString(),
    entered_by: null,
    left_at: null,
    left_by: null,
    ...overrides,
    opportunity_id: opportunityId,
    flow_stage_id: stageId,
  })
}

/**
 * A Stage's action (automation) — fires when a deal arrives at the stage.
 * An individual task by default, titled so `actionTitle()` has something to show.
 */
export function makeStageAction(overrides = {}) {
  const stageId = overrides.stage_id ?? makeFlowStage().id
  const n = next()
  return db.seed("flow_stage_actions", {
    kind: "create_individual_task",
    config: { title: `Action ${n}` },
    sort_order: n,
    archived_at: null,
    ...overrides,
    stage_id: stageId,
  })
}

/** Satisfies a condition for an opportunity — the row IS the satisfaction. */
export function makeConditionStatus(overrides = {}) {
  const opportunityId = overrides.opportunity_id ?? makeOpportunity().id
  const conditionId = overrides.condition_id ?? makeStageCondition().id
  return db.seed("sor_condition_status", {
    satisfied_by: null,
    ...overrides,
    opportunity_id: opportunityId,
    condition_id: conditionId,
  })
}

/** An SOR Member — someone added to a deal (docs/crm-pipeline-redesign.md's SOR Member). */
export function makeOpportunityMember(overrides = {}) {
  const opportunityId = overrides.opportunity_id ?? makeOpportunity().id
  const employeeId = overrides.employee_id ?? makeEmployee().id
  return db.seed("sales_opportunity_members", {
    added_by: null,
    ...overrides,
    opportunity_id: opportunityId,
    employee_id: employeeId,
  })
}

/**
 * Seeds a leave or overtime row that obeys the rule the product obeys: hours
 * are whatever the window contains.
 *
 * A seeded row carrying a window and an unrelated hours figure is a row the app
 * could never have written, and asserting against one hides real defects — a
 * balance guard looked like it passed because the row said 8 hours while its
 * window said 24. So `hours` is derived here unless a test states it outright,
 * which is how a legacy row with no window at all is still seeded.
 *
 * Windows may be given as `startTime`/`endTime` for readability at the call
 * site; they land on the row under their real column names.
 */
function seedWithWindow(table, attrs, { allowOvernight = false } = {}) {
  const row = { ...attrs }
  if ("startTime" in row) { row.start_time = row.startTime; delete row.startTime }
  if ("endTime" in row) { row.end_time = row.endTime; delete row.endTime }
  if (!("hours" in row)) {
    row.hours = safeDeriveHours(row.start_time, row.end_time, allowOvernight)
  }
  return db.seed(table, row)
}

export function makeSilLeave(overrides = {}) {
  const employeeId = overrides.employee_id ?? makeEmployee({ sil_hours_balance: 40 }).id
  return seedWithWindow("sil_leaves", {
    date: "2026-03-10",
    start_time: "09:00",
    end_time: "17:00",
    reason: "Medical appointment",
    status: "PENDING",
    ...overrides,
    employee_id: employeeId,
  })
}

export function makeOvertimeRequest(overrides = {}) {
  const employeeId = overrides.employee_id ?? makeEmployee().id
  return seedWithWindow(
    "overtime_requests",
    {
      date: "2026-03-10",
      start_time: "09:00",
      end_time: "13:00",
      status: "PENDING",
      ...overrides,
      employee_id: employeeId,
    },
    { allowOvernight: true },
  )
}

export function makeUndertimeRequest(overrides = {}) {
  const employeeId = overrides.employee_id ?? makeEmployee().id
  const row = {
    date: "2026-03-10",
    original_start_time: "08:00",
    original_end_time: "17:00",
    actual_start_time: "08:00",
    actual_end_time: "15:00",
    status: "PENDING",
    ...overrides,
    employee_id: employeeId,
  }
  if (!("hours" in row)) {
    // 8h scheduled (net of lunch) minus 6h actual (net of lunch) = 2h shortfall by default.
    row.hours = 2
  }
  return db.seed("undertime_requests", row)
}

export function makeOffsetLeave(overrides = {}) {
  const employeeId = overrides.employee_id ?? makeEmployee({ offset_hours_balance: 16 }).id
  return seedWithWindow("offset_leaves", {
    date: "2026-03-12",
    start_time: "09:00",
    end_time: "17:00",
    status: "PENDING",
    ...overrides,
    employee_id: employeeId,
  })
}

export function makeGroupTask(overrides = {}) {
  const createdBy = overrides.created_by ?? makeEmployee().id
  return db.seed("committee_tasks", {
    title: `Group task ${next()}`,
    status: "ACTIVE",
    hr_verified: false,
    ...overrides,
    created_by: createdBy,
  })
}

export function makeLeadSource(overrides = {}) {
  const n = next()
  return db.seed("crm_lead_sources", {
    value: `SOURCE_${n}`,
    label: `Source ${n}`,
    is_active: true,
    ...overrides,
  })
}

/**
 * A pipeline stage. Defaults to an ordinary open-region stage — a test that
 * cares about the anchor, the entry point or a terminal stage says so, because
 * at most one row may carry each of those flags.
 */
export function makePipelineStage(overrides = {}) {
  const n = next()
  return db.seed("crm_pipeline_stages", {
    code: `STAGE_${n}`,
    label: `Stage ${n}`,
    sort_order: n * 10,
    theme: "mauve",
    is_active: true,
    is_system: false,
    is_default: false,
    is_anchor: false,
    is_won: false,
    is_lost: false,
    is_itb_gate: false,
    ...overrides,
  })
}

/**
 * Seeds the full default pipeline from PIPELINE_STAGE_SEED — the app's own
 * seed, not a second hand-copied list. A hand-copied list here previously
 * drifted from sor.js (stale stage order, missing is_itb_gate) without any
 * test failing to say so, because nothing compared the two; deriving from the
 * same array makes that drift impossible.
 */
export function seedPipeline() {
  PIPELINE_STAGE_SEED.forEach((stage) => makePipelineStage({ ...stage }))
}

export function makeCommissionRate(overrides = {}) {
  return db.seed("commission_rates", {
    rate_type: "POOL",
    percent: 1,
    effective_from: "2000-01-01",
    ...overrides,
  })
}

export function makeCommissionDepartment(overrides = {}) {
  const n = next()
  return db.seed("commission_departments", {
    key: `department-${n}`,
    name: `Department ${n}`,
    allocation_percent: 0,
    ...overrides,
  })
}

export function makeCommissionPosition(overrides = {}) {
  const departmentId = overrides.department_id ?? makeCommissionDepartment().id
  const n = next()
  return db.seed("commission_positions", {
    name: `Position ${n}`,
    allocation_percent: 0,
    ...overrides,
    department_id: departmentId,
  })
}

export function makeCommissionSplit(overrides = {}) {
  return db.seed("commission_splits", {
    project_type: "CP",
    share_role: "deal_owner",
    percent: 0,
    ...overrides,
  })
}

export function makeNotification(overrides = {}) {
  const recipientId = overrides.recipient_id ?? makeEmployee().id
  return db.seed("notifications", {
    type: "TASK_UPDATE",
    title: "Something happened",
    message: "Details here",
    is_read: false,
    ...overrides,
    recipient_id: recipientId,
  })
}

// ── Sales Flows (issue #36) ─────────────────────────────────────────────────
// A Sale Type owns exactly one Sales Flow. The two factories stay separate so
// that "a Sale Type with no flow" is representable here — the service is what
// guarantees it never happens, and a factory that pre-empted the guarantee
// would make the test proving it impossible to write.

export function makeSaleType(overrides = {}) {
  const n = next()
  return db.seed("sale_types", { name: `Sale Type ${n}`, ...overrides })
}

export function makeSalesFlow(overrides = {}) {
  const saleTypeId = overrides.sale_type_id ?? makeSaleType().id
  return db.seed("sales_flows", { state: "draft", ...overrides, sale_type_id: saleTypeId })
}

export function makeFlowStage(overrides = {}) {
  const flowId = overrides.flow_id ?? makeSalesFlow().id
  const n = next()
  return db.seed("flow_stages", {
    name: `Stage ${n}`,
    sort_order: n,
    is_terminal: false,
    pos_x: 0,
    pos_y: 0,
    ...overrides,
    flow_id: flowId,
  })
}

export function makeFlowEdge(fromStage, toStage, overrides = {}) {
  return db.seed("flow_edges", {
    flow_id: fromStage.flow_id,
    from_stage_id: fromStage.id,
    to_stage_id: toStage.id,
    ...overrides,
  })
}

/**
 * A Flow Snapshot (issue #83) — mirrors exactly what `salesFlowService.
 * lockFlow` assembles, so a snapshot built here behaves identically to one a
 * real lock would have produced. By default it captures whatever is already
 * seeded live for the flow at call time; a test proving an SOR stays frozen
 * to its OWN snapshot builds this first, then edits the live tables
 * afterward, or passes an explicit `snapshot_data` to diverge outright.
 */
export function makeFlowSnapshot(overrides = {}) {
  const flowId = overrides.flow_id ?? makeSalesFlow().id
  const flow = db.internal.rowsOf("sales_flows").find((f) => f.id === flowId)
  const stages = db.internal.rowsOf("flow_stages").filter((s) => s.flow_id === flowId)
  const stageIds = stages.map((s) => s.id)
  const edges = db.internal.rowsOf("flow_edges").filter((e) => e.flow_id === flowId)
  const actions = db.internal
    .rowsOf("flow_stage_actions")
    .filter((a) => stageIds.includes(a.stage_id) && !a.archived_at)
  const conditions = db.internal
    .rowsOf("stage_conditions")
    .filter((c) => stageIds.includes(c.stage_id) && !c.archived_at)
  const stageFields = db.internal
    .rowsOf("flow_stage_fields")
    .filter((f) => stageIds.includes(f.stage_id) && !f.archived_at)

  const existingVersions = db.internal
    .rowsOf("flow_snapshots")
    .filter((s) => s.flow_id === flowId)
    .map((s) => s.version)
  const nextVersion = existingVersions.length > 0 ? Math.max(...existingVersions) + 1 : 1

  // Deep-cloned, not the live rows by reference: a real lock reads through
  // `supabase.from(...).select("*")`, which hands back independent copies —
  // editing the live row afterward (e.g. archiving a condition) must not
  // retroactively change what an already-taken snapshot says.
  const snapshotData = overrides.snapshot_data
    ? structuredClone(overrides.snapshot_data)
    : structuredClone({
        stages,
        edges,
        actions,
        conditions,
        stageFields,
        wonStageId: flow?.won_stage_id ?? null,
        saleTypeId: flow?.sale_type_id ?? null,
      })

  return db.seed("flow_snapshots", {
    version: nextVersion,
    version_minor: 0,
    ...overrides,
    flow_id: flowId,
    snapshot_data: snapshotData,
  })
}
