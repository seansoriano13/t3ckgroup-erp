import { renderHook, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it } from "vitest"
import { useLogTaskData } from "./useLogTaskData"
import { makeCategory, makeEmployee, makeHead, makeHrEmployee, makeSuperAdmin } from "@/test/factories"

/**
 * Loads the dropdowns behind the log-task form. Who appears in the "employee"
 * list is a permission decision: an ordinary employee may only log against
 * themselves, a head against their own unit, HR and super admins against
 * anyone. Widening that list by accident lets someone log work in a
 * colleague's name.
 */
describe("useLogTaskData", () => {
  let ana
  let itHead
  let infraHead
  let hr
  let boss
  let salesPerson

  beforeEach(() => {
    ana = makeEmployee({ name: "Ana Reyes", department: "IT", sub_department: "Infra" })
    itHead = makeHead({ name: "IT Head", department: "IT", sub_department: null })
    infraHead = makeHead({ name: "Infra Head", department: "IT", sub_department: "Infra" })
    hr = makeHrEmployee({ name: "HR Officer", department: "HR" })
    boss = makeSuperAdmin({ name: "Boss", department: "EXEC" })
    salesPerson = makeEmployee({ name: "Sales Person", department: "SALES" })
    makeCategory({ category_id: "IT-01", description: "Support" })
    makeCategory({ category_id: "FIN-01", description: "Finance" })
  })

  const load = async (user, isOpen = true) => {
    const { result } = renderHook(() => useLogTaskData(isOpen, user))
    if (isOpen && user) await waitFor(() => expect(result.current.isLoadingData).toBe(false))
    return result
  }

  it("does not load anything while the form is closed", async () => {
    const result = await load(ana, false)

    expect(result.current.categories).toEqual([])
    expect(result.current.employees).toEqual([])
  })

  it("loads the categories in order", async () => {
    const result = await load(ana)

    expect(result.current.categories.map((c) => c.category_id)).toEqual(["FIN-01", "IT-01"])
  })

  it("lets an ordinary employee log only against themselves", async () => {
    const result = await load(ana)

    expect(result.current.employees.map((e) => e.id)).toEqual([ana.id])
  })

  it("lets a sub-department head log against their own unit", async () => {
    const result = await load(infraHead)

    expect(result.current.employees.map((e) => e.name).sort()).toEqual([
      "Ana Reyes",
      "Infra Head",
    ])
  })

  it("lets a department head with no sub-unit log across the department", async () => {
    const result = await load(itHead)

    expect(result.current.employees.map((e) => e.name).sort()).toEqual([
      "Ana Reyes",
      "IT Head",
      "Infra Head",
    ])
  })

  it("lets HR log against anyone", async () => {
    const result = await load(hr)

    expect(result.current.employees.length).toBe(6)
  })

  it("lets a super admin log against anyone except other super admins", async () => {
    const otherBoss = makeSuperAdmin({ name: "Other Boss" })

    const result = await load(boss)

    const names = result.current.employees.map((e) => e.name)
    expect(names).toContain("Boss")
    expect(names).not.toContain("Other Boss")
    void otherBoss
  })

  it("offers every head and super admin as a report-to target", async () => {
    const result = await load(ana)

    expect(result.current.availableHeads.map((h) => h.name).sort()).toEqual([
      "Boss",
      "IT Head",
      "Infra Head",
    ])
  })

  it("leaves deactivated people out of both lists", async () => {
    makeHead({ name: "Former Head", department: "IT", is_deleted: true })
    makeEmployee({ name: "Former Colleague", department: "IT", is_deleted: true })

    const result = await load(itHead)

    expect(result.current.employees.map((e) => e.name)).not.toContain("Former Colleague")
    expect(result.current.availableHeads.map((h) => h.name)).not.toContain("Former Head")
  })

  it("reads the role flags in either naming convention", async () => {
    const snakeCase = await load({ ...hr, is_hr: true })
    const camelCase = await load({ ...hr, is_hr: false, isHr: true })

    expect(snakeCase.current.roles.isHr).toBe(true)
    expect(camelCase.current.roles.isHr).toBe(true)
  })

  it("reports when it has finished loading", async () => {
    const result = await load(ana)

    expect(result.current.isLoadingData).toBe(false)
    void salesPerson
  })
})
