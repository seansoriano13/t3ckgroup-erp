import { screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"
import toast from "react-hot-toast"
import ApproveOvertimeModal from "./ApproveOvertimeModal"
import { renderWithProviders } from "@/test/support"
import { db } from "@/test/db/store"
import { makeEmployee, makeHrEmployee, makeOvertimeRequest } from "@/test/factories"

/**
 * HR's editable approval step. It writes against a real Offset balance, so
 * this covers the whole path: pre-filled default, an override, the paid
 * path crediting nothing, and the non-positive guard.
 */
describe("ApproveOvertimeModal", () => {
  let employee
  let hr
  let onClose
  let onSuccess

  beforeEach(() => {
    employee = makeEmployee({ name: "Ana Reyes", offset_hours_balance: 16 })
    hr = makeHrEmployee({ name: "HR Officer" })
    onClose = vi.fn()
    onSuccess = vi.fn()
    vi.spyOn(toast, "error").mockImplementation(() => "id")
    vi.spyOn(toast, "success").mockImplementation(() => "id")
  })

  const balanceOf = (id) => db.rows("employees").find((e) => e.id === id).offset_hours_balance

  const open = (request, status = "APPROVED_OFFSET") =>
    renderWithProviders(
      <ApproveOvertimeModal
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
      <ApproveOvertimeModal isOpen={false} onClose={onClose} request={null} status="APPROVED_OFFSET" hrId={hr.id} />,
    )

    expect(container).toBeEmptyDOMElement()
  })

  it("pre-fills the requested hours", () => {
    const request = makeOvertimeRequest({ employee_id: employee.id, hours: 4 })
    open(request)

    expect(screen.getByLabelText(/approved hours/i)).toHaveValue(4)
  })

  it("credits the requested hours unchanged", async () => {
    const request = makeOvertimeRequest({ employee_id: employee.id, hours: 4 })
    open(request)
    const user = userEvent.setup()

    await user.click(screen.getByRole("button", { name: /confirm approval/i }))

    await waitFor(() => expect(balanceOf(employee.id)).toBe(20))
    expect(onSuccess).toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()
  })

  it("credits an overridden figure instead of the requested one", async () => {
    // A real TG-12 shows 4hrs struck through and replaced with 3.5.
    const request = makeOvertimeRequest({ employee_id: employee.id, hours: 4 })
    open(request)
    const user = userEvent.setup()

    const hoursField = screen.getByLabelText(/approved hours/i)
    await user.clear(hoursField)
    await user.type(hoursField, "3.5")
    await user.click(screen.getByRole("button", { name: /confirm approval/i }))

    await waitFor(() => expect(balanceOf(employee.id)).toBe(19.5))
  })

  it("credits nothing when approving as paid", async () => {
    const request = makeOvertimeRequest({ employee_id: employee.id, hours: 4 })
    open(request, "APPROVED_PAID")
    const user = userEvent.setup()

    await user.click(screen.getByRole("button", { name: /confirm approval/i }))

    await waitFor(() => expect(onSuccess).toHaveBeenCalled())
    expect(balanceOf(employee.id)).toBe(16)
  })

  it("will not submit a zero approved-hours value", async () => {
    const request = makeOvertimeRequest({ employee_id: employee.id, hours: 4 })
    open(request)
    const user = userEvent.setup()

    const hoursField = screen.getByLabelText(/approved hours/i)
    await user.clear(hoursField)
    await user.type(hoursField, "0")

    expect(screen.getByRole("button", { name: /confirm approval/i })).toBeDisabled()
    expect(db.rows("overtime_requests")[0].status).toBe("PENDING")
    expect(onSuccess).not.toHaveBeenCalled()
  })
})
