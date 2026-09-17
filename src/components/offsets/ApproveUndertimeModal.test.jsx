import { screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import toast from "react-hot-toast"
import ApproveUndertimeModal from "./ApproveUndertimeModal"
import { renderWithProviders, setupUser } from "@/test/support"
import { db } from "@/test/db/store"
import { stubUndertimeDecisionRpcs } from "@/test/stubs/undertimeRpc"
import { makeEmployee, makeHrEmployee, makeUndertimeRequest } from "@/test/factories"

/**
 * HR's editable undertime decision step. Unlike ApproveOvertimeModal, there
 * is no paid/offset choice — just Approve or Reject — and it must never
 * touch offset_hours_balance or sil_hours_balance, on either decision.
 */
describe("ApproveUndertimeModal", () => {
  let employee
  let hr
  let onClose
  let onSuccess

  beforeEach(() => {
    employee = makeEmployee({ name: "Ana Reyes", offset_hours_balance: 16, sil_hours_balance: 40 })
    hr = makeHrEmployee({ name: "HR Officer" })
    onClose = vi.fn()
    onSuccess = vi.fn()
    vi.spyOn(toast, "error").mockImplementation(() => "id")
    vi.spyOn(toast, "success").mockImplementation(() => "id")
    stubUndertimeDecisionRpcs()
  })

  const balancesOf = (id) => {
    const row = db.rows("employees").find((e) => e.id === id)
    return { offset: row.offset_hours_balance, sil: row.sil_hours_balance }
  }

  const open = (request, status = "APPROVED") =>
    renderWithProviders(
      <ApproveUndertimeModal
        isOpen
        onClose={onClose}
        onSuccess={onSuccess}
        request={request}
        status={status}
        hrId={hr.id}
      />,
    )

  it("renders nothing without an open request", () => {
    const { container } = renderWithProviders(
      <ApproveUndertimeModal isOpen={false} onClose={onClose} request={null} status="APPROVED" hrId={hr.id} />,
    )

    expect(container).toBeEmptyDOMElement()
  })

  it("pre-fills the requested hours on approval", () => {
    const request = makeUndertimeRequest({ employee_id: employee.id, hours: 2 })
    open(request)

    expect(screen.getByLabelText(/approved hours/i)).toHaveValue(2)
  })

  it("approves and never touches offset_hours_balance or sil_hours_balance", async () => {
    const request = makeUndertimeRequest({ employee_id: employee.id, hours: 2 })
    const before = balancesOf(employee.id)
    open(request)
    const user = setupUser()

    await user.click(screen.getByRole("button", { name: /confirm approval/i }))

    await waitFor(() => expect(onSuccess).toHaveBeenCalled())
    expect(balancesOf(employee.id)).toEqual(before)
  })

  it("rejects without an hours field", async () => {
    const request = makeUndertimeRequest({ employee_id: employee.id, hours: 2 })
    open(request, "REJECTED")

    expect(screen.queryByLabelText(/approved hours/i)).not.toBeInTheDocument()

    const user = setupUser()
    await user.click(screen.getByRole("button", { name: /confirm rejection/i }))

    await waitFor(() => expect(onSuccess).toHaveBeenCalled())
    expect(db.rows("undertime_requests").find((r) => r.id === request.id).status).toBe("REJECTED")
  })

  it("will not submit a zero approved-hours value", async () => {
    const request = makeUndertimeRequest({ employee_id: employee.id, hours: 2 })
    open(request)
    const user = setupUser()

    const hoursField = screen.getByLabelText(/approved hours/i)
    await user.clear(hoursField)
    await user.type(hoursField, "0")

    expect(screen.getByRole("button", { name: /confirm approval/i })).toBeDisabled()
    expect(onSuccess).not.toHaveBeenCalled()
  })
})
