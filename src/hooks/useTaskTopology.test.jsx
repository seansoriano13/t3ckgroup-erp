import { renderHook, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it } from "vitest"
import { useTaskTopology } from "./useTaskTopology"
import { makeCategory, makeEmployee } from "@/test/factories"

/**
 * Drives the cascading department → sub-department → employee → category
 * pickers on the log-task form. Each level narrows the next, and the category
 * list additionally always offers the universal committee categories.
 */
describe("useTaskTopology", () => {
  beforeEach(() => {
    makeEmployee({ name: "Ana Reyes", department: "IT", sub_department: "Infra" })
    makeEmployee({ name: "Zed Cruz", department: "IT", sub_department: "Infra" })
    makeEmployee({ name: "Bea Lim", department: "IT", sub_department: "Apps" })
    makeEmployee({ name: "Carl Tan", department: "SALES", sub_department: "Field" })

    makeCategory({ category_id: "IT-INF-1", department: "IT", sub_department: "Infra" })
    makeCategory({ category_id: "IT-APP-1", department: "IT", sub_department: "Apps" })
    makeCategory({ category_id: "SAL-1", department: "SALES", sub_department: "Field" })
    makeCategory({ category_id: "COMMITTEE-1", department: "ALL", sub_department: "ALL" })
  })

  const load = async (formData = {}, { categoryId = null, isEditing = false } = {}) => {
    const { result } = renderHook(() =>
      useTaskTopology(true, formData, categoryId, isEditing),
    )
    await waitFor(() => expect(result.current.topology.cats.length).toBeGreaterThan(0))
    return result
  }

  it("loads nothing while the form is closed", () => {
    const { result } = renderHook(() => useTaskTopology(false, {}, null, false))

    expect(result.current.topology).toEqual({ emps: [], cats: [] })
    expect(result.current.uniqueDepts).toEqual([])
  })

  it("offers each department once, sorted", async () => {
    const result = await load()

    expect(result.current.uniqueDepts).toEqual(["ALL", "IT", "SALES"])
  })

  it("narrows the sub-departments to the chosen department", async () => {
    const result = await load({ department: "IT" })

    expect(result.current.uniqueSubDepts).toEqual(["Apps", "Infra"])
  })

  it("offers no sub-department until a department is chosen", async () => {
    const result = await load({})

    expect(result.current.uniqueSubDepts).toEqual([])
  })

  it("narrows employees to the chosen unit, sorted by name", async () => {
    const result = await load({ department: "IT", subDepartment: "Infra" })

    expect(result.current.filteredEmployees.map((e) => e.name)).toEqual([
      "Ana Reyes",
      "Zed Cruz",
    ])
  })

  it("offers no employee until both levels are chosen", async () => {
    const result = await load({ department: "IT" })

    expect(result.current.filteredEmployees).toEqual([])
  })

  it("offers the categories for the chosen unit plus the universal ones", async () => {
    const result = await load({ department: "IT", subDepartment: "Infra" }, { isEditing: true })

    expect(result.current.filteredCategories.map((c) => c.category_id).sort()).toEqual([
      "COMMITTEE-1",
      "IT-INF-1",
    ])
  })

  it("derives the unit from the task's own category when logging fresh", async () => {
    // Not editing: the form follows the category already on the task rather
    // than whatever the department picker currently shows.
    const result = await load({ department: "SALES", subDepartment: "Field" }, {
      categoryId: "IT-APP-1",
      isEditing: false,
    })

    expect(result.current.filteredCategories.map((c) => c.category_id).sort()).toEqual([
      "COMMITTEE-1",
      "IT-APP-1",
    ])
  })

  it("still offers the universal categories when nothing else matches", async () => {
    const result = await load({ department: "LEGAL", subDepartment: "None" }, {
      isEditing: true,
    })

    expect(result.current.filteredCategories.map((c) => c.category_id)).toEqual(["COMMITTEE-1"])
  })

  it("identifies the person the task is being logged for", async () => {
    const ana = (await load()).current.topology.emps.find((e) => e.name === "Ana Reyes")

    const result = await load({ loggedById: ana.id })

    expect(result.current.taskOwnerInfo).toMatchObject({
      name: "Ana Reyes",
      department: "IT",
      sub_department: "Infra",
    })
  })

  it("leaves the owner undefined when nobody is selected", async () => {
    const result = await load({})

    expect(result.current.taskOwnerInfo).toBeUndefined()
  })

  it("leaves out deactivated employees", async () => {
    makeEmployee({ name: "Former", department: "IT", sub_department: "Infra", is_deleted: true })

    const result = await load({ department: "IT", subDepartment: "Infra" })

    expect(result.current.filteredEmployees.map((e) => e.name)).not.toContain("Former")
  })

  it("reports when the load has finished", async () => {
    const result = await load()

    await waitFor(() => expect(result.current.isLoadingTop).toBe(false))
  })
})
