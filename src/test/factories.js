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
