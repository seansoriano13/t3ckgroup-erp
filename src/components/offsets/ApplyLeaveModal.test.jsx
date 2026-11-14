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

// The one submit button, whichever tab is open: File overtime / Offset / leave / undertime.
const FILE_BUTTON = /^file (overtime|offset|leave|undertime)$/i

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
    mockUser.current = { id: employee.id, name: employee.name, department: employee.department, offset_hours_balance: 16, sil_hours_balance: 40 }
    onClose = vi.fn()
    onSuccess = vi.fn()
    vi.spyOn(toast, "error").mockImplementation(() => "id")
    vi.spyOn(toast, "success").mockImplementation(() => "id")
  })

  const open = (props = {}) =>
    renderWithProviders(
      <ApplyLeaveModal isOpen onClose={onClose} onSuccess={onSuccess} {...props} />,
    )

  // #957: on a short screen the body scrolls and the header + footer stay pinned.
  it("scrolls the body, not the whole dialog, and keeps the submit button in the pinned footer", () => {
    open()
    const dialog = document.querySelector("[data-slot='dialog-content']")
    const button = screen.getByRole("button", { name: FILE_BUTTON })
    const body = document.querySelector("[data-modal-shell] form > div")
    expect(dialog.className).toContain("overflow-hidden")
    expect(body.className).toContain("overflow-y-auto")
    expect(body.className).toContain("min-h-0")
    expect(body.className).toContain("flex-1")
    expect(body.contains(button)).toBe(false)
    expect(screen.getByRole("button", { name: "Close window" })).toBeInTheDocument()
  })

  it("uses the same button, named for what is filed, on every tab", async () => {
    open()
    const user = setupUser()
    const labels = { Overtime: "File overtime", Offset: "File Offset", Leave: "File leave", Undertime: "File undertime" }
    for (const [tab, label] of Object.entries(labels)) {
      await user.click(screen.getByRole("tab", { name: tab }))
      expect(screen.getByRole("button", { name: label })).toBeInTheDocument()
    }
    expect(screen.queryByText(/Apply for Leave|Submit Request/)).not.toBeInTheDocument()
  })

  it("marks every required field on the Overtime tab with the red asterisk", () => {
    open()
    const form = document.querySelector("[data-modal-shell] form")
    for (const label of ["Date Worked", "Start Time", "End Time", "Reason"]) {
      const caption = within(form).getByText(label, { selector: "label" })
      expect(caption.textContent).toBe(`${label}*`)
    }
    expect(within(form).getByText("Supporting Files").textContent).not.toContain("*")
  })

  describe("filing with fields missing", () => {
    it("names every missing field at once on the Overtime tab and files nothing", async () => {
      open()
      const user = setupUser()

      await submit(user)
      await waitForNetworkIdle()

      const messages = screen.getAllByRole("alert").map((a) => a.textContent)
      expect(messages).toEqual(
        expect.arrayContaining([
          "Enter the date worked.",
          "Enter the start time.",
          "Enter the end time.",
          "Enter the reason.",
        ]),
      )
      expect(toast.error).not.toHaveBeenCalled()
      expect(db.rows("overtime_requests")).toEqual([])
      expect(onClose).not.toHaveBeenCalled()
    })

    it("names the custom selects too: Category and Department Head", async () => {
      // No head matches this department, so Department Head stays empty.
      mockUser.current = { id: employee.id, name: employee.name, department: "Nowhere", offset_hours_balance: 16, sil_hours_balance: 40 }
      open()
      const user = setupUser()
      await user.click(screen.getByRole("tab", { name: "Leave" }))

      await submit(user)

      expect(await screen.findByText("Choose a category.")).toBeInTheDocument()
      expect(screen.getByText("Choose a department head.")).toBeInTheDocument()
      expect(screen.getByText("Enter the leave date.")).toBeInTheDocument()
      expect(toast.error).not.toHaveBeenCalled()
    })

    it("clears a line as soon as its field is filled", async () => {
      open()
      const user = setupUser()
      await submit(user)
      expect(screen.getByText("Enter the date worked.")).toBeInTheDocument()

      const form = document.querySelector("[data-modal-shell] form")
      await user.type(form.querySelector('input[type="date"]'), "2026-03-10")

      expect(screen.queryByText("Enter the date worked.")).not.toBeInTheDocument()
      expect(screen.getByText("Enter the reason.")).toBeInTheDocument()
    })

    it("names the Employee on File for Employee", async () => {
      mockUser.current = { id: makeEmployee({ name: "HR Manager", is_hr: true }).id, name: "HR Manager" }
      open({ showEmployeeSelector: true })
      const user = setupUser()

      expect(within(document.querySelector("[data-modal-shell] form")).getByText("Employee", { selector: "label" }).textContent).toBe("Employee*")
      await submit(user)

      expect(await screen.findByText("Choose an employee.")).toBeInTheDocument()
    })
  })

  /** Fills the visible tab's fields. */
  const fillForm = async ({ date, startTime, endTime, reason, categoryLabel }) => {
    const user = setupUser()
    const form = screen.getByRole("button", { name: FILE_BUTTON }).closest("form")
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
    await user.click(screen.getByRole("button", { name: FILE_BUTTON }))
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

    it("shows the shortfall and disables the button before submit when the hours are not there", async () => {
      open()
      await goToOffset()
      // A time input cannot express more than one day, so the widest window
      // available is 00:00–23:59, far over the 16 hr balance. The server rule
      // (assertWithinAvailableBalance) stays; the form warns earlier.
      await fillForm({ date: "2026-03-12", startTime: "00:00", endTime: "23:59", reason: "Long break" })

      expect(await screen.findByText(/^You have 16 Offset hours\. This needs [\d.]+\.$/)).toBeInTheDocument()
      expect(screen.getByRole("button", { name: FILE_BUTTON })).toBeDisabled()
      expect(db.rows("offset_leaves")).toEqual([])
    })

    it("shows the balance in plain ink, and 0 available with the shortfall line", async () => {
      const none = makeEmployee({ name: "Ben Cruz", offset_hours_balance: 0, department: employee.department })
      mockUser.current = { id: none.id, name: none.name, department: none.department, offset_hours_balance: 0 }
      open()
      await goToOffset()
      await fillForm({ date: "2026-03-12", startTime: "09:00", endTime: "17:00", reason: "Rest" })

      expect(await screen.findByText("You have 0 Offset hours. This needs 7.")).toBeInTheDocument()
      const balance = screen.getByText("0 hrs")
      expect(balance.className).toContain("text-foreground")
      expect(balance.className).not.toMatch(/blue|green/)
      expect(screen.getByRole("button", { name: FILE_BUTTON })).toBeDisabled()
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

    it("warns before submit when their balance is short", async () => {
      const short = makeEmployee({ name: "Ben Cruz", sil_hours_balance: 5, department: employee.department })
      mockUser.current = { id: short.id, name: short.name, department: short.department, sil_hours_balance: 5 }

      open()
      await goToSil()
      await fillForm({ date: "2026-03-10", startTime: "09:00", endTime: "17:00", reason: "Long trip" })

      expect(await screen.findByText("You have 5 SIL hours. This needs 7.")).toBeInTheDocument()
      expect(screen.getByRole("button", { name: FILE_BUTTON })).toBeDisabled()
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

      const form = screen.getByRole("button", { name: FILE_BUTTON }).closest("form")
      const dateField = form.querySelector('input[type="date"]')
      const timeFields = form.querySelectorAll('input[type="time"]')

      await user.clear(dateField)
      await user.type(dateField, "2026-03-11") // a Wednesday

      await waitFor(() => expect(timeFields[0]).toHaveValue("07:30"))
      expect(timeFields[1]).toHaveValue("18:30")
    })

    // A range used to list every calendar day at a flat 8 hours, weekends
    // included, and a weekend inside it made the whole submission fail.
    describe("over a date range", () => {
      const fillRange = async (from, to) => {
        const user = await goToSil()
        await user.click(screen.getByRole("tab", { name: "Date range" }))
        const form = screen.getByRole("button", { name: FILE_BUTTON }).closest("form")
        const [fromField, toField] = form.querySelectorAll('input[type="date"]')
        await user.type(fromField, from)
        await user.type(toField, to)
        await chooseOption(
          user,
          within(form).queryAllByRole("combobox").find((c) => c.textContent.startsWith("Select category...")),
          defaultCategory.label,
        )
        await user.type(form.querySelector("textarea"), "Out of town")
        return user
      }

      it("skips weekends and starts each day at its scheduled shift", async () => {
        open()
        const user = await fillRange("2026-03-13", "2026-03-16") // Friday to Monday

        expect(screen.getByText(/Skipped \(not a working day\): Sat, Mar 14, Sun, Mar 15/)).toBeInTheDocument()
        // 07:30–18:00 is 10.5 hrs, minus the 1-hour lunch.
        expect(screen.getByLabelText("Hours for Fri, Mar 13")).toHaveValue(10.5)

        await submit(user)
        await waitFor(() => expect(db.rows("sil_leaves")).toHaveLength(2))
        expect(db.rows("sil_leaves").map((r) => [r.date, r.hours])).toEqual([
          ["2026-03-13", 9.5],
          ["2026-03-16", 9.5],
        ])
      })

      it("lets the employee remove a day and change another day's hours", async () => {
        open()
        const user = await fillRange("2026-03-10", "2026-03-12") // Tuesday to Thursday

        await user.click(screen.getByRole("button", { name: "Remove Wed, Mar 11" }))
        const tuesday = screen.getByLabelText("Hours for Tue, Mar 10")
        await user.clear(tuesday)
        await user.type(tuesday, "4")

        await submit(user)
        await waitFor(() => expect(db.rows("sil_leaves")).toHaveLength(2))
        expect(db.rows("sil_leaves").map((r) => [r.date, r.hours])).toEqual([
          ["2026-03-10", 4],
          ["2026-03-12", 9.5],
        ])
      })
    })

    it("pre-fills the ordinary finish time for a non-Wednesday weekday", async () => {
      const user = setupUser()
      open()
      await goToSil()

      const form = screen.getByRole("button", { name: FILE_BUTTON }).closest("form")
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

    await user.click(screen.getByRole("button", { name: "Close window" }))
    expect(onClose).toHaveBeenCalled()

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

      const form = screen.getByRole("button", { name: FILE_BUTTON }).closest("form")
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

      await user.click(screen.getByRole("button", { name: FILE_BUTTON }))

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
