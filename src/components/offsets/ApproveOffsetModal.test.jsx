import { screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"
import toast from "react-hot-toast"
import ApproveOffsetModal from "./ApproveOffsetModal"
import { renderWithProviders } from "@/test/support"
import { db } from "@/test/db/store"
import { makeEmployee, makeHrEmployee, makeOffsetLeave } from "@/test/factories"

/**
 * HR's editable approval step for offset leave. Mirrors ApproveOvertimeModal,
 * except approved hours may not exceed what was requested — this spends a
 * banked balance rather than crediting one.
 */
describe("ApproveOffsetModal", () => {
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

  const open = (request) =>
    renderWithProviders(
      <ApproveOffsetModal isOpen onClose={onClose} onSuccess={onSuccess} request={request} hrId={hr.id} />,
    )

  it("renders nothing without an open request", () => {
    const { container } = renderWithProviders(
      <ApproveOffsetModal isOpen={false} onClose={onClose} request={null} hrId={hr.id} />,
    )

    expect(container).toBeEmptyDOMElement()
  })

  it("pre-fills the requested hours", () => {
    const leave = makeOffsetLeave({ employee_id: employee.id, hours: 8 })
    open(leave)

    expect(screen.getByLabelText(/approved hours/i)).toHaveValue(8)
  })

  it("debits the requested hours unchanged", async () => {
    const leave = makeOffsetLeave({ employee_id: employee.id, hours: 8 })
    open(leave)
    const user = userEvent.setup()

    await user.click(screen.getByRole("button", { name: /confirm approval/i }))

    await waitFor(() => expect(balanceOf(employee.id)).toBe(8))
    expect(onSuccess).toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()
  })

  it("debits a reduced figure instead of the requested one", async () => {
    const leave = makeOffsetLeave({ employee_id: employee.id, hours: 8 })
    open(leave)
    const user = userEvent.setup()

    const hoursField = screen.getByLabelText(/approved hours/i)
    await user.clear(hoursField)
    await user.type(hoursField, "4")
    await user.click(screen.getByRole("button", { name: /confirm approval/i }))

    await waitFor(() => expect(balanceOf(employee.id)).toBe(12))
  })

  it("will not submit a zero approved-hours value", async () => {
    const leave = makeOffsetLeave({ employee_id: employee.id, hours: 8 })
    open(leave)
    const user = userEvent.setup()

    const hoursField = screen.getByLabelText(/approved hours/i)
    await user.clear(hoursField)
    await user.type(hoursField, "0")

    expect(screen.getByRole("button", { name: /confirm approval/i })).toBeDisabled()
    expect(db.rows("offset_leaves")[0].status).toBe("PENDING")
    expect(onSuccess).not.toHaveBeenCalled()
  })

  it("will not submit more hours than were requested", async () => {
    const leave = makeOffsetLeave({ employee_id: employee.id, hours: 8 })
    open(leave)
    const user = userEvent.setup()

    const hoursField = screen.getByLabelText(/approved hours/i)
    await user.clear(hoursField)
    await user.type(hoursField, "8.5")

    expect(screen.getByRole("button", { name: /confirm approval/i })).toBeDisabled()
    expect(db.rows("offset_leaves")[0].status).toBe("PENDING")
    expect(onSuccess).not.toHaveBeenCalled()
  })
})
