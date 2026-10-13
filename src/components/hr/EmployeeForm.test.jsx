/**
 * The hidden-from-navigation editor (#133-135). The rule itself
 * (isNavEntryVisible, subtractive-only) is proven in src/utils/permissions.test.js
 * and src/constants/navigation.test.js — this file is the surface: does the
 * editor list only what the toggles above currently permit, does toggling a
 * switch update the saved payload, and does Clear All reset it.
 */
import { describe, expect, it } from "vitest"
import { render, screen } from "@testing-library/react"
import { setupUser } from "@/test/support"
import EmployeeForm from "./EmployeeForm"

async function renderForm(props = {}) {
  const submitted = []
  const onSubmit = (data) => submitted.push(data)
  render(
    <>
      <EmployeeForm formId="test-form" onSubmit={onSubmit} {...props} />
      <button type="submit" form="test-form">
        Save
      </button>
    </>,
  )

  // Required fields the browser's own validation would otherwise block
  // submission on — filled here so each test can focus on the override editor.
  const user = setupUser()
  await user.type(screen.getByPlaceholderText("Employee Full Name"), "Test Employee")
  await user.type(screen.getByPlaceholderText("e.g. juan@t3ckgroup.com"), "test@t3ckgroup.test")

  return { submitted, user }
}

describe("EmployeeForm hidden-from-navigation editor", () => {
  it("only lists entries the current toggles permit", async () => {
    await renderForm({ initialData: { has_sales_flow: false } })

    // Sales flow off: Sales entries aren't offered as things to hide.
    expect(screen.queryByText("SORS")).not.toBeInTheDocument()
    // Dashboard and My Leaves are permitted unconditionally.
    expect(screen.getByText("Dashboard")).toBeInTheDocument()
    expect(screen.getByText("My Requests")).toBeInTheDocument()
  })

  it("adds an entry to the offered list live when a toggle that permits it is turned on", async () => {
    const { user } = await renderForm({ initialData: { has_sales_flow: false } })

    expect(screen.queryByText("SORS")).not.toBeInTheDocument()

    await user.click(screen.getByText("Sales Opportunities"))

    expect(screen.getByText("SORS")).toBeInTheDocument()
  })

  it("toggling an entry off includes its key in the saved hiddenNavKeys", async () => {
    const { submitted, user } = await renderForm({ initialData: {} })

    const dashboardRow = screen.getByText("Dashboard").closest("div[class*='cursor-pointer']")
    await user.click(dashboardRow)
    await user.click(screen.getByRole("button", { name: "Save" }))

    expect(submitted[0].hiddenNavKeys).toContain("workspace.dashboard")
  })

  it("Clear all resets every hidden entry", async () => {
    const { submitted, user } = await renderForm({ initialData: { hiddenNavKeys: ["workspace.dashboard"] } })

    expect(screen.getByText("Clear all")).toBeInTheDocument()
    await user.click(screen.getByText("Clear all"))
    await user.click(screen.getByRole("button", { name: "Save" }))

    expect(submitted[0].hiddenNavKeys).toEqual([])
  })

  it("saves an empty hiddenNavKeys for a new employee by default", async () => {
    const { submitted, user } = await renderForm()

    await user.click(screen.getByRole("button", { name: "Save" }))

    expect(submitted[0].hiddenNavKeys).toEqual([])
  })
})

describe("EmployeeForm Bug Reports access right", () => {
  it("saves the Bug Reports switch", async () => {
    const { submitted, user } = await renderForm({ initialData: { has_bug_report_access: false } })

    await user.click(screen.getByText("Bug Reports", { selector: "p" }))
    await user.click(screen.getByRole("button", { name: "Save" }))

    expect(submitted[0].has_bug_report_access).toBe(true)
  })
})

describe("EmployeeForm Finance access right", () => {
  it("saves the Finance switch beside Purchasing", async () => {
    const { submitted, user } = await renderForm({ initialData: { has_finance_flow: false } })

    await user.click(screen.getByText("Finance", { selector: "p" }))
    await user.click(screen.getByRole("button", { name: "Save" }))

    expect(submitted[0].has_finance_flow).toBe(true)
    expect(submitted[0].has_purchasing_flow).toBe(false)
  })

  it("starts a new employee without Finance access", async () => {
    const { submitted, user } = await renderForm()

    await user.click(screen.getByRole("button", { name: "Save" }))

    expect(submitted[0].has_finance_flow).toBe(false)
  })
})
