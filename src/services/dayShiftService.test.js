import { describe, expect, it, beforeEach } from "vitest"
import { dayShiftService } from "./dayShiftService"
import { db } from "@/test/db/store"
import { waitForNetworkIdle } from "@/test/network"
import { makeSuperAdmin } from "@/test/factories"

const SEED_ROWS = [
  { weekday: 0, start_time: null, end_time: null, is_working_day: false },
  { weekday: 1, start_time: "07:30:00", end_time: "18:00:00", is_working_day: true },
  { weekday: 2, start_time: "07:30:00", end_time: "18:00:00", is_working_day: true },
  { weekday: 3, start_time: "07:30:00", end_time: "18:30:00", is_working_day: true },
  { weekday: 4, start_time: "07:30:00", end_time: "18:00:00", is_working_day: true },
  { weekday: 5, start_time: "07:30:00", end_time: "18:00:00", is_working_day: true },
  { weekday: 6, start_time: null, end_time: null, is_working_day: false },
]

describe("dayShiftService", () => {
  beforeEach(() => {
    for (const row of SEED_ROWS) db.seed("hr_day_shift_config", row)
  })

  it("returns all seven days, seeded to what the removed literals held", async () => {
    const config = await dayShiftService.getDayShiftConfig()

    expect(config).toHaveLength(7)
    expect(config.find((d) => d.weekday === 3)).toMatchObject({ startTime: "07:30", endTime: "18:30", isWorkingDay: true })
    expect(config.find((d) => d.weekday === 1)).toMatchObject({ startTime: "07:30", endTime: "18:00", isWorkingDay: true })
    expect(config.find((d) => d.weekday === 0)).toMatchObject({ isWorkingDay: false })
    expect(config.find((d) => d.weekday === 6)).toMatchObject({ isWorkingDay: false })
  })

  it("updates one weekday and leaves the others alone", async () => {
    const before = await dayShiftService.getDayShiftConfig()
    const tuesdayBefore = before.find((d) => d.weekday === 2)

    await dayShiftService.updateDayShiftDay(1, { startTime: "08:00", endTime: "17:00" })

    const after = await dayShiftService.getDayShiftConfig()
    expect(after.find((d) => d.weekday === 1)).toMatchObject({ startTime: "08:00", endTime: "17:00" })
    expect(after.find((d) => d.weekday === 2)).toMatchObject(tuesdayBefore)
  })

  it("can mark a weekday as non-working", async () => {
    await dayShiftService.updateDayShiftDay(5, { isWorkingDay: false })

    const config = await dayShiftService.getDayShiftConfig()
    expect(config.find((d) => d.weekday === 5)).toMatchObject({ isWorkingDay: false })
  })

  it("logs the change to the system audit log", async () => {
    const admin = makeSuperAdmin({ name: "Boss" })

    await dayShiftService.updateDayShiftDay(1, { startTime: "08:00" }, admin.id)
    await waitForNetworkIdle()

    const [entry] = db.rows("system_audit_logs")
    expect(entry.metadata).toMatchObject({ event: "DAY_SHIFT_CONFIG_UPDATED", weekday: 1 })
    expect(entry.author_id).toBe(admin.id)
  })
})
