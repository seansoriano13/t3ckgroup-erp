import { screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"
import toast from "react-hot-toast"
import ApplyLeaveModal from "./ApplyLeaveModal"
import { renderWithProviders } from "@/test/support"
import { db } from "@/test/db/store"
import { waitForNetworkIdle } from "@/test/network"
import { makeEmployee } from "@/test/factories"

/**
 * The one form employees use to claim overtime and spend leave. It writes
 * against real balances, so this covers the whole path: fill in, validate,
 * upload evidence, submit, and what the employee is told when the service
 * refuses.
 */
const mockUser = vi.hoisted(() => ({ current: null }))

vi.mock("../../context/AuthContext", () => ({ useAuth: () => ({ user: mockUser.current }) }))
vi.mock("browser-image-compression", () => ({ default: async (file) => file }))

describe("ApplyLeaveModal", () => {
  let employee
  let onClose
  let onSuccess

  beforeEach(() => {
    employee = makeEmployee({
      name: "Ana Reyes",
      offset_hours_balance: 16,
      sil_hours_balance: 40,
    })
    mockUser.current = { id: employee.id, name: employee.name }
    onClose = vi.fn()
    onSuccess = vi.fn()
    vi.spyOn(toast, "error").mockImplementation(() => "id")
    vi.spyOn(toast, "success").mockImplementation(() => "id")
  })

  const open = (props = {}) =>
    renderWithProviders(
      <ApplyLeaveModal isOpen onClose={onClose} onSuccess={onSuccess} {...props} />,
    )

  /** Fills the visible tab's three fields. Each tab has one of each control. */
  const fillForm = async ({ date, hours, reason }) => {
    const user = userEvent.setup()
    const form = screen.getByRole("button", { name: /submit|apply/i }).closest("form")
    const dateField = form.querySelector('input[type="date"]')
    const hoursField = form.querySelector('input[type="number"]')
    const reasonField = form.querySelector("textarea")

    await user.clear(dateField)
    await user.type(dateField, date)
    await user.clear(hoursField)
    await user.type(hoursField, hours)
    await user.clear(reasonField)
    await user.type(reasonField, reason)
    return { user, form }
  }

  const submit = async (user) => {
    await user.click(screen.getByRole("button", { name: /submit|apply/i }))
  }

  it("renders nothing while closed", () => {
    const { container } = renderWithProviders(
      <ApplyLeaveModal isOpen={false} onClose={onClose} />,
    )

    expect(container).toBeEmptyDOMElement()
  })

  it("opens on the overtime tab", () => {
    open()

    expect(screen.getByRole("button", { name: "Overtime" })).toBeInTheDocument()
    expect(screen.getByPlaceholderText("Reason for the overtime request")).toBeInTheDocument()
  })

  describe("claiming overtime", () => {
    it("files the request", async () => {
      open()
      const { user } = await fillForm({
        date: "2026-03-10",
        hours: "4",
        reason: "Server migration",
      })

      await submit(user)
      await waitFor(() => expect(db.rows("overtime_requests")).toHaveLength(1))

      expect(db.rows("overtime_requests")[0]).toMatchObject({
        employee_id: employee.id,
        hours: 4,
        reason: "Server migration",
        status: "PENDING",
      })
    })

    it("confirms and closes once the request is filed", async () => {
      open()
      const { user } = await fillForm({ date: "2026-03-10", hours: "4", reason: "Migration" })

      await submit(user)

      await waitFor(() =>
        expect(toast.success).toHaveBeenCalledWith("Overtime application submitted!"),
      )
      expect(onSuccess).toHaveBeenCalled()
      expect(onClose).toHaveBeenCalled()
    })

    it("files nothing while the form is incomplete", async () => {
      // Every field is `required`, so the browser blocks the submit before the
      // handler runs; the JS guard behind it is a backstop, not the first line.
      open()
      const user = userEvent.setup()

      await submit(user)
      await waitForNetworkIdle()

      expect(db.rows("overtime_requests")).toEqual([])
      expect(onClose).not.toHaveBeenCalled()
    })

    it("will not accept fewer hours than the half-hour step allows", async () => {
      open()
      const { user } = await fillForm({ date: "2026-03-10", hours: "0", reason: "Nothing" })

      await submit(user)
      await waitForNetworkIdle()

      expect(db.rows("overtime_requests")).toEqual([])
      expect(onClose).not.toHaveBeenCalled()
    })

    it("accepts a half-hour claim", async () => {
      open()
      const { user } = await fillForm({ date: "2026-03-10", hours: "0.5", reason: "Short fix" })

      await submit(user)
      await waitFor(() => expect(db.rows("overtime_requests")).toHaveLength(1))

      expect(db.rows("overtime_requests")[0].hours).toBe(0.5)
    })
  })

  describe("spending offset leave", () => {
    const goToOffset = async () => {
      const user = userEvent.setup()
      await user.click(screen.getByRole("button", { name: "Offset" }))
      return user
    }

    it("files the application", async () => {
      open()
      await goToOffset()
      const { user } = await fillForm({
        date: "2026-03-12",
        hours: "8",
        reason: "Family matter",
      })

      await submit(user)
      await waitFor(() => expect(db.rows("offset_leaves")).toHaveLength(1))

      expect(db.rows("offset_leaves")[0]).toMatchObject({ hours: 8, status: "PENDING" })
    })

    it("tells the employee when they do not have the hours", async () => {
      open()
      await goToOffset()
      const { user } = await fillForm({ date: "2026-03-12", hours: "40", reason: "Long break" })

      await submit(user)

      await waitFor(() =>
        expect(toast.error).toHaveBeenCalledWith(
          "Insufficient offset hours balance. You have 16 hrs remaining.",
        ),
      )
    })

    it("refuses a weekend", async () => {
      open()
      await goToOffset()
      // 2026-03-14 is a Saturday.
      const { user } = await fillForm({ date: "2026-03-14", hours: "8", reason: "Weekend" })

      await submit(user)

      await waitFor(() =>
        expect(toast.error).toHaveBeenCalledWith(
          "Offset leaves cannot be applied on weekends (Saturday / Sunday).",
        ),
      )
    })
  })

  describe("taking SIL", () => {
    const goToSil = async () => {
      const user = userEvent.setup()
      await user.click(screen.getByRole("button", { name: "SIL" }))
      return user
    }

    it("files the application", async () => {
      open()
      await goToSil()
      const { user } = await fillForm({
        date: "2026-03-10",
        hours: "8",
        reason: "Medical appointment",
      })

      await submit(user)
      await waitFor(() => expect(db.rows("sil_leaves")).toHaveLength(1))

      expect(db.rows("sil_leaves")[0]).toMatchObject({
        hours: 8,
        reason: "Medical appointment",
        status: "PENDING",
      })
    })

    it("tells the employee when their balance is short", async () => {
      open()
      await goToSil()
      const { user } = await fillForm({ date: "2026-03-10", hours: "80", reason: "Long trip" })

      await submit(user)

      await waitFor(() =>
        expect(toast.error).toHaveBeenCalledWith(
          "Insufficient SIL hours balance. You have 40 hrs remaining.",
        ),
      )
    })

    it("does not touch the balance until HR decides", async () => {
      open()
      await goToSil()
      const { user } = await fillForm({ date: "2026-03-10", hours: "8", reason: "Medical" })

      await submit(user)
      await waitFor(() => expect(db.rows("sil_leaves")).toHaveLength(1))
      await waitForNetworkIdle()

      expect(db.rows("employees").find((e) => e.id === employee.id).sil_hours_balance).toBe(40)
    })
  })

  it("closes without filing anything when dismissed", async () => {
    open()
    const user = userEvent.setup()

    await user.click(screen.getAllByRole("button").find((b) => b.querySelector("svg")))

    expect(db.rows("overtime_requests")).toEqual([])
  })
})
