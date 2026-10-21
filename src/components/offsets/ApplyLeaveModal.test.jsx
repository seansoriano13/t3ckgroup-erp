import { screen, waitFor, within } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import toast from "react-hot-toast"
import ApplyLeaveModal from "./ApplyLeaveModal"
import { chooseOption, renderWithProviders, setupUser } from "@/test/support"
import { db } from "@/test/db/store"
import { waitForNetworkIdle } from "@/test/network"
import { makeEmployee, makeHead, makeLeaveCategory } from "@/test/factories"

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
  let defaultCategory

  beforeEach(() => {
    employee = makeEmployee({
      name: "Ana Reyes",
      offset_hours_balance: 16,
      sil_hours_balance: 40,
    })
    defaultCategory = makeLeaveCategory({ label: "Medical" })
    // Every apply form now carries a required Department Head field (issue
    // #137) that auto-fills only when exactly one head matches the
    // applicant's department — a head is seeded here so the self-service
    // forms below can submit without selecting one by hand. The mock user
    // needs the department itself, since the self-service path resolves the
    // head straight off `user`, not a fetched employee row.
    makeHead({ name: "Dept Head", department: employee.department })
    mockUser.current = { id: employee.id, name: employee.name, department: employee.department }
    onClose = vi.fn()
    onSuccess = vi.fn()
    vi.spyOn(toast, "error").mockImplementation(() => "id")
    vi.spyOn(toast, "success").mockImplementation(() => "id")
  })

  const open = (props = {}) =>
    renderWithProviders(
      <ApplyLeaveModal isOpen onClose={onClose} onSuccess={onSuccess} {...props} />,
    )

  /** Fills the visible tab's fields. */
  const fillForm = async ({ date, startTime, endTime, reason, categoryLabel }) => {
    const user = setupUser()
    const form = screen.getByRole("button", { name: /submit|apply/i }).closest("form")
    const dateField = form.querySelector('input[type="date"]')
    const timeFields = form.querySelectorAll('input[type="time"]')
    const reasonField = form.querySelector("textarea")
    // The overtime tab's only combobox is the required Department Head field
    // (issue #137), so the category picker (offset/SIL only) is picked out by
    // its own placeholder instead of by position.
    const categoryField = within(form)
      .queryAllByRole("combobox")
      .find((c) => c.textContent.startsWith("Select category..."))

    await user.clear(dateField)
    await user.type(dateField, date)
    
    if (timeFields.length >= 2) {
      if (startTime !== undefined) {
        await user.clear(timeFields[0])
        await user.type(timeFields[0], startTime)
      }
      if (endTime !== undefined) {
        await user.clear(timeFields[1])
        await user.type(timeFields[1], endTime)
      }
    }
    
    if (categoryField) {
      await chooseOption(user, categoryField, categoryLabel || defaultCategory.label)
    }

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

    expect(screen.getByRole("tab", { name: "Overtime" })).toBeInTheDocument()
    expect(screen.getByPlaceholderText("Reason for the overtime request")).toBeInTheDocument()
  })

  describe("claiming overtime", () => {
    it("files the request", async () => {
      open()
      const { user } = await fillForm({
        date: "2026-03-10",
        startTime: "09:00",
        endTime: "13:00",
        reason: "Server migration",
      })

      await submit(user)
      await waitFor(() => expect(db.rows("overtime_requests")).toHaveLength(1))

      expect(db.rows("overtime_requests")[0]).toMatchObject({
        employee_id: employee.id,
        start_time: "09:00",
        end_time: "13:00",
        reason: "Server migration",
        status: "PENDING",
      })
    })

    it("confirms and closes once the request is filed", async () => {
      open()
      const { user } = await fillForm({ date: "2026-03-10", startTime: "09:00", endTime: "13:00", reason: "Migration" })

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
      const user = setupUser()

      await submit(user)
      await waitForNetworkIdle()

      expect(db.rows("overtime_requests")).toEqual([])
      expect(onClose).not.toHaveBeenCalled()
    })

    it("will not accept fewer hours than the half-hour step allows", async () => {
      open()
      const { user } = await fillForm({ date: "2026-03-10", startTime: "09:00", endTime: "09:00", reason: "Nothing" })

      await submit(user)
      await waitForNetworkIdle()

      expect(db.rows("overtime_requests")).toEqual([])
      expect(onClose).not.toHaveBeenCalled()
    })

    it("accepts a half-hour claim", async () => {
      open()
      const { user } = await fillForm({ date: "2026-03-10", startTime: "09:00", endTime: "09:30", reason: "Short fix" })

      await submit(user)
      await waitFor(() => expect(db.rows("overtime_requests")).toHaveLength(1))

      expect(db.rows("overtime_requests")[0].hours).toBe(0.5)
    })
  })

  describe("spending offset leave", () => {
    const goToOffset = async () => {
      const user = setupUser()
      await user.click(screen.getByRole("tab", { name: "Offset" }))
      return user
    }

    it("files the application", async () => {
      open()
      await goToOffset()
      const { user } = await fillForm({
        date: "2026-03-12",
        startTime: "09:00",
        endTime: "17:00",
        reason: "Family matter",
      })

      await submit(user)
      await waitFor(() => expect(db.rows("offset_leaves")).toHaveLength(1))

      // 8-hour window minus the 1-hour lunch deduction (issue #91).
      expect(db.rows("offset_leaves")[0]).toMatchObject({ hours: 7, status: "PENDING" })
    })

    it("tells the employee when they do not have the hours", async () => {
      open()
      await goToOffset()
      // A time input cannot express more than one day, so the widest window
      // available is 00:00–23:59. That derives 23.98 hrs against a 16 hr
      // balance, which is what the insufficient-balance guard is here to catch.
      const { user } = await fillForm({ date: "2026-03-12", startTime: "00:00", endTime: "23:59", reason: "Long break" })

      await submit(user)

      await waitFor(() =>
        expect(toast.error).toHaveBeenCalledWith(
          "Insufficient offset hours. 0 hrs already committed to pending applications, leaving 16 hrs available.",
        ),
      )
    })

    it("refuses a weekend", async () => {
      open()
      await goToOffset()
      // 2026-03-14 is a Saturday.
      const { user } = await fillForm({ date: "2026-03-14", startTime: "09:00", endTime: "17:00", reason: "Weekend" })

      await submit(user)

      await waitFor(() =>
        expect(toast.error).toHaveBeenCalledWith(
          "Leaves cannot be applied on weekends (Saturday / Sunday).",
        ),
      )
    })
  })

  describe("taking SIL", () => {
    const goToSil = async () => {
      const user = setupUser()
      await user.click(screen.getByRole("tab", { name: "Leave" }))
      return user
    }

    it("files the application", async () => {
      open()
      await goToSil()
      const { user } = await fillForm({
        date: "2026-03-10",
        startTime: "09:00",
        endTime: "17:00",
        reason: "Medical appointment",
      })

      await submit(user)
      await waitFor(() => expect(db.rows("sil_leaves")).toHaveLength(1))

      expect(db.rows("sil_leaves")[0]).toMatchObject({
        hours: 7,
        reason: "Medical appointment",
        status: "PENDING",
      })
    })

    it("tells the employee when their balance is short", async () => {
      // The guard reads the balance from the database, not from the signed-in
      // context, so the short balance has to be the one on the row.
      const short = makeEmployee({ name: "Ben Cruz", sil_hours_balance: 5 })
      mockUser.current = { id: short.id, name: short.name, department: short.department }

      open()
      await goToSil()
      const { user } = await fillForm({ date: "2026-03-10", startTime: "09:00", endTime: "17:00", reason: "Long trip" })

      await submit(user)

      await waitFor(() =>
        expect(toast.error).toHaveBeenCalledWith(
          "Insufficient SIL hours. 0 hrs already committed to pending applications, leaving 5 hrs available.",
        ),
      )
    })

    it("does not touch the balance until HR decides", async () => {
      open()
      await goToSil()
      const { user } = await fillForm({ date: "2026-03-10", startTime: "09:00", endTime: "17:00", reason: "Medical" })

      await submit(user)
      await waitFor(() => expect(db.rows("sil_leaves")).toHaveLength(1))
      await waitForNetworkIdle()

      expect(db.rows("employees").find((e) => e.id === employee.id).sil_hours_balance).toBe(40)
    })

    it("refuses a weekend, matching Offset", async () => {
      open()
      await goToSil()
      // 2026-03-14 is a Saturday.
      const { user } = await fillForm({ date: "2026-03-14", startTime: "09:00", endTime: "17:00", reason: "Weekend" })

      await submit(user)

      await waitFor(() =>
        expect(toast.error).toHaveBeenCalledWith(
          "Leaves cannot be applied on weekends (Saturday / Sunday).",
        ),
      )
    })

    // Issue #150: picking a date used to fill the start/end times from two
    // literal copies that disagreed about how to read the date — one in
    // local time, one in UTC — so the two could land on different weekdays.
    // Now there is one path, so both a Wednesday and an ordinary weekday
    // pre-fill from the same shared shift configuration.
    it("pre-fills Wednesday's later finish when a Wednesday is picked", async () => {
      const user = setupUser()
      open()
      await goToSil()

      const form = screen.getByRole("button", { name: /submit|apply/i }).closest("form")
      const dateField = form.querySelector('input[type="date"]')
      const timeFields = form.querySelectorAll('input[type="time"]')

      await user.clear(dateField)
      await user.type(dateField, "2026-03-11") // a Wednesday

      await waitFor(() => expect(timeFields[0]).toHaveValue("07:30"))
      expect(timeFields[1]).toHaveValue("18:30")
    })

    it("pre-fills the ordinary finish time for a non-Wednesday weekday", async () => {
      const user = setupUser()
      open()
      await goToSil()

      const form = screen.getByRole("button", { name: /submit|apply/i }).closest("form")
      const dateField = form.querySelector('input[type="date"]')
      const timeFields = form.querySelectorAll('input[type="time"]')

      await user.clear(dateField)
      await user.type(dateField, "2026-03-10") // a Tuesday

      await waitFor(() => expect(timeFields[0]).toHaveValue("07:30"))
      expect(timeFields[1]).toHaveValue("18:00")
    })
  })

  describe("taking LWOP (Leave tab, Without pay)", () => {
    const goToLwop = async () => {
      const user = setupUser()
      await user.click(screen.getByRole("tab", { name: "Leave" }))
      await user.click(screen.getByRole("tab", { name: "Without pay (LWOP)" }))
      return user
    }

    it("hides the available-balance line for LWOP and shows it for SIL", async () => {
      open()
      const user = setupUser()
      await user.click(screen.getByRole("tab", { name: "Leave" }))
      await waitFor(() => expect(screen.getByText(/Available:/)).toBeInTheDocument())

      await user.click(screen.getByRole("tab", { name: "Without pay (LWOP)" }))
      expect(screen.queryByText(/Available:/)).not.toBeInTheDocument()

      await user.click(screen.getByRole("tab", { name: "With pay (SIL)" }))
      expect(screen.getByText(/Available:/)).toBeInTheDocument()
    })

    it("files to lwop_leaves, not sil_leaves, and touches no balance", async () => {
      open()
      await goToLwop()
      const { user } = await fillForm({ date: "2026-03-10", startTime: "09:00", endTime: "17:00", reason: "Family matter" })

      await submit(user)
      await waitFor(() => expect(db.rows("lwop_leaves")).toHaveLength(1))
      await waitForNetworkIdle()

      expect(db.rows("lwop_leaves")[0]).toMatchObject({ hours: 7, reason: "Family matter", status: "PENDING" })
      expect(db.rows("sil_leaves")).toHaveLength(0)
      expect(db.rows("employees").find((e) => e.id === employee.id).sil_hours_balance).toBe(40)
    })

    it("can be filed with an empty SIL balance", async () => {
      const broke = makeEmployee({ name: "Ben Cruz", sil_hours_balance: 0, department: employee.department })
      mockUser.current = { id: broke.id, name: broke.name, department: broke.department }

      open()
      await goToLwop()
      const { user } = await fillForm({ date: "2026-03-10", startTime: "09:00", endTime: "17:00", reason: "No leave left" })

      await submit(user)
      await waitFor(() => expect(db.rows("lwop_leaves")).toHaveLength(1))
    })
  })

  it("closes without filing anything when dismissed", async () => {
    open()
    const user = setupUser()

    await user.click(screen.getAllByRole("button").find((b) => b.querySelector("svg")))

    expect(db.rows("overtime_requests")).toEqual([])
  })

  describe("with the employee selector (HR variant)", () => {
    let hrOfficer
    let targetEmployee
    let targetHead

    beforeEach(() => {
      hrOfficer = makeEmployee({ name: "HR Manager", is_hr: true })
      targetEmployee = makeEmployee({ name: "Alice Worker" })
      // The Department Head field is required (issue #137); a head matching
      // the target employee's department lets the field be filled. Named
      // distinctly from the top-level describe's own seeded head, since both
      // beforeEach hooks stack and both heads land in the same employee pool.
      targetHead = makeHead({ name: "Alice's Dept Head", department: targetEmployee.department })
      mockUser.current = { id: hrOfficer.id, name: hrOfficer.name }
    })

    const openForHr = () => open({ showEmployeeSelector: true })

    it("offers 'Record as absent' only for HR filing on someone's behalf with Without pay chosen", async () => {
      openForHr()
      const user = setupUser()
      await user.click(screen.getByRole("tab", { name: /^leave$/i }))
      expect(screen.queryByText("Record as absent (already approved)")).not.toBeInTheDocument()

      await user.click(screen.getByRole("tab", { name: /without pay/i }))
      expect(screen.getByText("Record as absent (already approved)")).toBeInTheDocument()
    })

    it("files an overtime request for the selected employee", async () => {
      openForHr()
      const user = setupUser()

      // Two comboboxes exist once the tab body mounts: the Employee picker
      // (DOM-first, since it sits above the tab forms) and the Department
      // Head picker inside the active tab's form — so this can't be
      // getByRole singular.
      await waitFor(() => {
        expect(screen.getAllByRole("combobox").length).toBeGreaterThan(0)
      })
      const employeeSelect = screen.getAllByRole("combobox")[0]

      await chooseOption(user, employeeSelect, targetEmployee.name)

      const headSelect = screen.getAllByRole("combobox")[1]
      await chooseOption(user, headSelect, targetHead.name)

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

      openForHr()
      await waitFor(() => {
        expect(screen.getAllByRole("combobox").length).toBeGreaterThan(0)
      })

      const employeeSelect = screen.getAllByRole("combobox")[0]

      await setupUser().click(employeeSelect)
      const options = (await screen.findAllByRole("option")).map((opt) => opt.textContent)
      expect(options).toContain("Active Worker")
      expect(options).not.toContain("Deactivated Worker")
    })

    it("does not show the employee selector for the self-service variant", () => {
      open()

      expect(screen.queryByText("Employee")).not.toBeInTheDocument()
    })
  })
})
