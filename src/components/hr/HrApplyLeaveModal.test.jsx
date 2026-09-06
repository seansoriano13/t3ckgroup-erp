import { screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"
import toast from "react-hot-toast"
import HrApplyLeaveModal from "./HrApplyLeaveModal"
import { renderWithProviders } from "@/test/support"
import { db } from "@/test/db/store"
import { makeEmployee } from "@/test/factories"

const mockUser = vi.hoisted(() => ({ current: null }))

vi.mock("../../context/AuthContext", () => ({ useAuth: () => ({ user: mockUser.current }) }))
vi.mock("browser-image-compression", () => ({ default: async (file) => file }))

describe("HrApplyLeaveModal", () => {
  let hrOfficer
  let targetEmployee
  let onClose
  let onSuccess

  beforeEach(() => {
    hrOfficer = makeEmployee({ name: "HR Manager", is_hr: true })
    targetEmployee = makeEmployee({ name: "Alice Worker" })
    mockUser.current = { id: hrOfficer.id, name: hrOfficer.name }
    onClose = vi.fn()
    onSuccess = vi.fn()
    vi.spyOn(toast, "error").mockImplementation(() => "id")
    vi.spyOn(toast, "success").mockImplementation(() => "id")
  })

  const open = (props = {}) =>
    renderWithProviders(
      <HrApplyLeaveModal isOpen onClose={onClose} onSuccess={onSuccess} {...props} />,
    )

  it("files an overtime request for the selected employee", async () => {
    open()
    const user = userEvent.setup()

    await waitFor(() => {
      expect(screen.getByRole("combobox")).toBeInTheDocument()
    })
    const employeeSelect = screen.getAllByRole("combobox")[0]
    
    await waitFor(() => {
      expect(employeeSelect.children.length).toBeGreaterThan(1)
    })
    await user.selectOptions(employeeSelect, targetEmployee.id)

    const form = screen.getByRole("button", { name: /submit/i }).closest("form")
    const dateField = form.querySelector('input[type="date"]')
    const timeFields = form.querySelectorAll('input[type="time"]')
    const reasonField = form.querySelector("textarea")

    await user.clear(dateField)
    await user.type(dateField, "2026-03-15")

    await user.clear(timeFields[0])
    await user.type(timeFields[0], "17:00")

    await user.clear(timeFields[1])
    await user.type(timeFields[1], "20:00")

    await user.clear(reasonField)
    await user.type(reasonField, "Crunch time")

    await user.click(screen.getByRole("button", { name: /submit/i }))

    await waitFor(() => expect(db.rows("overtime_requests")).toHaveLength(1))

    expect(db.rows("overtime_requests")[0]).toMatchObject({
      employee_id: targetEmployee.id,
      start_time: "17:00",
      end_time: "20:00",
      reason: "Crunch time",
      status: "PENDING",
    })

    expect(toast.success).toHaveBeenCalledWith("Overtime application submitted!")
    expect(onSuccess).toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()
  })

  it("hides deactivated employees from the employee picker", async () => {
    makeEmployee({ name: "Active Worker", is_deleted: false })
    makeEmployee({ name: "Deactivated Worker", is_deleted: true })

    open()
    const user = userEvent.setup()

    await waitFor(() => {
      expect(screen.getByRole("combobox")).toBeInTheDocument()
    })
    
    const employeeSelect = screen.getAllByRole("combobox")[0]
    
    await waitFor(() => {
      expect(employeeSelect.children.length).toBeGreaterThan(1)
    })

    const options = Array.from(employeeSelect.options).map(opt => opt.text)
    expect(options).toContain("Active Worker")
    expect(options).not.toContain("Deactivated Worker")
  })
})
