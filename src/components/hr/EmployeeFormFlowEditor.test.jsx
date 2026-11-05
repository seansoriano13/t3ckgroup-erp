/**
 * The Flow editor switch (#884). Only a Super Admin sees it, and when they
 * turn it on the saved payload carries canEditSalesFlows. The database is what
 * actually refuses anyone else (prevent_role_escalation and the insert guard,
 * proven in src/test/policy/07-flow-editor-grant.test.js); this file covers the
 * surface only.
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
      <EmployeeForm formId="flow-editor-test-form" onSubmit={onSubmit} {...props} />
      <button type="submit" form="flow-editor-test-form">
        Save
      </button>
    </>,
  )

  // Required fields the browser's own validation would otherwise block
  // submission on.
  const user = setupUser()
  await user.type(screen.getByPlaceholderText("Employee Full Name"), "Test Employee")
  await user.type(screen.getByPlaceholderText("e.g. juan@t3ckgroup.com"), "test@t3ckgroup.test")

  return { submitted, user }
}

describe("EmployeeForm Flow editor switch", () => {
  it("is not shown to someone who cannot grant it", async () => {
    await renderForm({ canGrantFlowEditor: false, initialData: {} })

    expect(screen.queryByText("Flow editor")).not.toBeInTheDocument()
  })

  it("is shown to a Super Admin", async () => {
    await renderForm({ canGrantFlowEditor: true, initialData: {} })

    expect(screen.getByText("Flow editor")).toBeInTheDocument()
  })

  it("turning it on saves canEditSalesFlows as true", async () => {
    const { submitted, user } = await renderForm({ canGrantFlowEditor: true, initialData: {} })

    await user.click(screen.getByText("Flow editor"))
    await user.click(screen.getByRole("button", { name: "Save" }))

    expect(submitted[0].canEditSalesFlows).toBe(true)
  })

  it("keeps an existing grant when the form is saved without touching it", async () => {
    const { submitted, user } = await renderForm({
      canGrantFlowEditor: true,
      initialData: { canEditSalesFlows: true },
    })

    await user.click(screen.getByRole("button", { name: "Save" }))

    expect(submitted[0].canEditSalesFlows).toBe(true)
  })

  it("a new employee starts without the Flow editor flag", async () => {
    const { submitted, user } = await renderForm({ canGrantFlowEditor: true })

    await user.click(screen.getByRole("button", { name: "Save" }))

    expect(submitted[0].canEditSalesFlows).toBe(false)
  })
})
