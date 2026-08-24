/**
 * Fixture builders for the fake database.
 *
 * Each one seeds the minimum a row needs to satisfy its table's constraints and
 * returns the stored row, so a test only spells out the fields it is actually
 * asserting on. Foreign keys are created on demand — `makeTask()` with no
 * arguments produces a valid task, its category and its author.
 */

import { db } from "./db/store"

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

export function makeSilLeave(overrides = {}) {
  const employeeId = overrides.employee_id ?? makeEmployee({ sil_hours_balance: 40 }).id
  return db.seed("sil_leaves", {
    date: "2026-03-10",
    hours: 8,
    reason: "Medical appointment",
    status: "PENDING",
    ...overrides,
    employee_id: employeeId,
  })
}

export function makeOvertimeRequest(overrides = {}) {
  const employeeId = overrides.employee_id ?? makeEmployee().id
  return db.seed("overtime_requests", {
    date: "2026-03-10",
    hours: 4,
    status: "PENDING",
    ...overrides,
    employee_id: employeeId,
  })
}

export function makeOffsetLeave(overrides = {}) {
  const employeeId = overrides.employee_id ?? makeEmployee({ offset_hours_balance: 16 }).id
  return db.seed("offset_leaves", {
    date: "2026-03-12",
    hours: 8,
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
    ...overrides,
  })
}

export function seedPipeline() {
  makePipelineStage({ code: "LEAD", label: "Lead", sort_order: 10, is_system: true, is_default: true })
  makePipelineStage({ code: "QUALIFIED", label: "Qualified", sort_order: 20, is_system: true })
  makePipelineStage({ code: "PROPOSAL_SUBMITTED", label: "Proposal Submitted", sort_order: 30, is_system: true })
  makePipelineStage({ code: "FOR_BIDDING", label: "For Bidding", sort_order: 35, is_system: true })
  makePipelineStage({ code: "BID_SUBMITTED", label: "Bid Submitted", sort_order: 40, is_system: true })
  makePipelineStage({ code: "NEGOTIATION", label: "Negotiation", sort_order: 50, is_system: true })
  makePipelineStage({ code: "AWARDED", label: "Awarded", sort_order: 60, is_system: true, is_anchor: true })
  makePipelineStage({ code: "PAYMENT_VERIFICATION", label: "Payment Verification", sort_order: 65, is_system: true })
  makePipelineStage({ code: "PO_RECEIVED", label: "PO Received", sort_order: 70, is_system: true })
  makePipelineStage({ code: "PROJECT_DELIVERY", label: "Project Delivery", sort_order: 80, is_system: true })
  makePipelineStage({ code: "COLLECTION", label: "Collection", sort_order: 90, is_system: true })
  makePipelineStage({ code: "CLOSED_WON", label: "Closed Won", sort_order: 100, is_system: true, is_won: true })
  makePipelineStage({ code: "RETENTION", label: "Retention", sort_order: 110, is_system: true })
  makePipelineStage({ code: "CLOSED_LOST", label: "Closed Lost", sort_order: 120, is_system: true, is_lost: true })
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
