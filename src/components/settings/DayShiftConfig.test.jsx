/**
 * Issue #152: the Super Admin surface for editing the working week seeded
 * by #150/#151. Covers what a service test on dayShiftService can't reach —
 * that the switch and the time fields actually call it with the right
 * payload, and that other rows are left alone in the rendered list too.
 */
import { describe, expect, it, vi, beforeEach } from "vitest"
import { screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { renderWithProviders } from "@/test/support"
import { db } from "@/test/db/store"
import { makeSuperAdmin } from "@/test/factories"
import DayShiftConfig from "./DayShiftConfig"
import { dayShiftService } from "../../services/dayShiftService"

const SEED_ROWS = [
  { weekday: 0, start_time: null, end_time: null, is_working_day: false },
  { weekday: 1, start_time: "07:30:00", end_time: "18:00:00", is_working_day: true },
  { weekday: 2, start_time: "07:30:00", end_time: "18:00:00", is_working_day: true },
  { weekday: 3, start_time: "07:30:00", end_time: "18:30:00", is_working_day: true },
  { weekday: 4, start_time: "07:30:00", end_time: "18:00:00", is_working_day: true },
  { weekday: 5, start_time: "07:30:00", end_time: "18:00:00", is_working_day: true },
  { weekday: 6, start_time: null, end_time: null, is_working_day: false },
]

const mockUser = vi.hoisted(() => ({ current: null }))
vi.mock("../../context/AuthContext", () => ({ useAuth: () => ({ user: mockUser.current }) }))

describe("DayShiftConfig", () => {
  beforeEach(() => {
    for (const row of SEED_ROWS) db.seed("hr_day_shift_config", row)
    const admin = makeSuperAdmin({ name: "Boss" })
    mockUser.current = { id: admin.id, name: admin.name }
  })

  it("renders every weekday with its configured times", async () => {
    renderWithProviders(<DayShiftConfig />)

    await screen.findByText("Wednesday")
    expect(screen.getByLabelText("Wednesday end time")).toHaveValue("18:30")
    expect(screen.getByLabelText("Tuesday end time")).toHaveValue("18:00")
    expect(screen.getByLabelText("Sunday is a working day")).toHaveAttribute("aria-checked", "false")
  })

  it("saves an edited start time on blur, leaving the other days untouched", async () => {
    const spy = vi.spyOn(dayShiftService, "updateDayShiftDay")
    const user = userEvent.setup()
    renderWithProviders(<DayShiftConfig />)

    await screen.findByText("Monday")
    const mondayStart = screen.getByLabelText("Monday start time")
    await user.clear(mondayStart)
    await user.type(mondayStart, "08:00")
    await user.tab()

    await waitFor(() => expect(spy).toHaveBeenCalledWith(1, { startTime: "08:00", endTime: "18:00" }, expect.any(String)))

    const rows = db.rows("hr_day_shift_config")
    expect(rows.find((r) => r.weekday === 1).start_time).toBe("08:00")
    expect(rows.find((r) => r.weekday === 2)).toMatchObject({ start_time: "07:30:00", end_time: "18:00:00" })
  })

  it("toggling a day off disables its time fields and persists immediately", async () => {
    const user = userEvent.setup()
    renderWithProviders(<DayShiftConfig />)

    await screen.findByText("Friday")
    await user.click(screen.getByLabelText("Friday is a working day"))

    await waitFor(() => expect(db.rows("hr_day_shift_config").find((r) => r.weekday === 5).is_working_day).toBe(false))
    await waitFor(() => expect(screen.getByLabelText("Friday start time")).toBeDisabled())
  })
})
