import { describe, expect, it } from "vitest"
import {
  makeCategory,
  makeGroupTask,
  makeEmployee,
  makeHead,
  makeHrEmployee,
  makeLeadSource,
  makeNotification,
  makeOffsetLeave,
  makeOpportunity,
  makeOpportunityItem,
  makeOpportunityMember,
  makeOvertimeRequest,
  makeRequirementStatus,
  makeSilLeave,
  makeStageRequirement,
  makeSuperAdmin,
  makeTask,
} from "./factories"

/**
 * Every factory has to produce a row the real tables would accept — the store
 * enforces NOT NULL, CHECK and foreign keys at seed time, so a factory that
 * drifts from the schema fails here instead of poisoning a service test with
 * data that could never exist in production.
 */
describe("fixture factories", () => {
  it("builds every entity with its required relationships", () => {
    expect(() => {
      makeEmployee()
      makeHrEmployee()
      makeSuperAdmin()
      makeHead()
      makeCategory()
      makeTask()
      const opportunity = makeOpportunity()
      makeOpportunityItem(opportunity.id)
      makeSilLeave()
      makeOvertimeRequest()
      makeOffsetLeave()
      makeGroupTask()
      makeLeadSource()
      makeNotification()
      makeStageRequirement()
      makeRequirementStatus()
      makeOpportunityMember()
    }).not.toThrow()
  })

  it("lets a test override only the field it cares about", () => {
    const employee = makeEmployee({ name: "Ana Reyes", sil_hours_balance: 24 })

    expect(employee.name).toBe("Ana Reyes")
    expect(employee.sil_hours_balance).toBe(24)
    expect(employee.employment_status).toBe("Regular")
  })

  it("creates the owning rows a task needs when none are supplied", () => {
    const task = makeTask()

    expect(task.logged_by).toBeTruthy()
    expect(task.category_id).toBeTruthy()
  })

  it("reuses a supplied owner instead of inventing one", () => {
    const author = makeEmployee()
    const task = makeTask({ logged_by: author.id })

    expect(task.logged_by).toBe(author.id)
  })
})
