import { describe, expect, it } from "vitest"
import { DEFAULT_ACTIVITY_SETTINGS, enabledMeetingTypes, fitDefaults, settingsFromRows, timeOptions, timesOfDay } from "./activitySettings"
import { canFileActivityType, fileableActivityTypes, formTypeOptions, newActivityLabel } from "./activityFiling"
import { describeGeneralChange, describeTypeChange } from "@/services/activitySettingsService"

const withTypes = (patch) => ({
  ...DEFAULT_ACTIVITY_SETTINGS,
  types: Object.fromEntries(Object.entries(DEFAULT_ACTIVITY_SETTINGS.types).map(([k, v]) => [k, { ...v, ...(patch[k] ?? {}) }])),
})
const ordinary = { id: "e1" }
const head = { id: "h1", is_head: true }

describe("Activity settings (#1064)", () => {
  it("starts with the rules #1063 and #1056 had in code", () => {
    const g = DEFAULT_ACTIVITY_SETTINGS.general
    expect([g.earliestStart, g.latestEnd, g.timeStep, g.defaultStart, g.defaultEnd, g.reminderMinutes, g.maxDays, g.guestsAllowed]).toEqual([
      "06:00", "21:45", 15, "09:00", "10:00", 15, 31, true,
    ])
    expect(timeOptions(g)).toHaveLength(64)
    expect(timeOptions(g)[0].value).toBe("06:00")
    expect(timeOptions(g).at(-1).value).toBe("21:45")
  })

  it("does not hang on a time step of zero or less", () => {
    const g = { ...DEFAULT_ACTIVITY_SETTINGS.general, timeStep: 0 }
    expect(timeOptions(g)).toHaveLength(64)
    expect(timeOptions({ ...g, timeStep: -15 })).toHaveLength(64)
    expect(timesOfDay(0)).toHaveLength(96)
  })

  it("reads the two tables into the app's shape, trimming seconds off times", () => {
    const s = settingsFromRows(
      [{ activity_type: "EVENT", name: "Party", color: "pink", active: false, who_files: "EVERYONE", needs_hr: true, multi_day: false }],
      { meeting_onsite: true, meeting_online: false, meeting_hybrid: true, earliest_start: "08:00:00", latest_end: "18:00:00", time_step_minutes: 30, default_start: "09:00:00", default_end: "10:00:00", reminder_minutes: 60, max_days: 7, guests_allowed: false },
    )
    expect(s.types.EVENT).toEqual({ name: "Party", color: "pink", active: false, whoFiles: "EVERYONE", needsHr: true, multiDay: false, alsoAllowed: [] })
    expect(s.types.MEETING).toEqual(DEFAULT_ACTIVITY_SETTINGS.types.MEETING)
    expect(s.general).toMatchObject({ earliestStart: "08:00", latestEnd: "18:00", timeStep: 30, reminderMinutes: 60, maxDays: 7, guestsAllowed: false })
    expect(enabledMeetingTypes(s.general)).toEqual(["ONSITE", "HYBRID"])
    expect(timeOptions(s.general).map((o) => o.value).slice(0, 3)).toEqual(["08:00", "08:30", "09:00"])
  })

  it("keeps the default times inside the hours and on the step", () => {
    const g = DEFAULT_ACTIVITY_SETTINGS.general
    expect(fitDefaults({ ...g, earliestStart: "10:00" })).toMatchObject({ defaultStart: "10:00", defaultEnd: "10:15" })
    expect(fitDefaults({ ...g, timeStep: 60, defaultStart: "09:15", defaultEnd: "10:45" })).toMatchObject({ defaultStart: "09:00", defaultEnd: "10:00" })
    expect(fitDefaults({ ...g, latestEnd: "09:30" })).toMatchObject({ defaultStart: "09:00", defaultEnd: "09:30" })
    expect(timesOfDay(60)).toHaveLength(24)
  })

  it("follows who can file and whether a type is on", () => {
    const s = withTypes({ MEETING: { whoFiles: "HEADS" }, EVENT: { whoFiles: "EVERYONE" }, OPERATIONS_TASK: { active: false } })
    expect(canFileActivityType(ordinary, "MEETING", s)).toBe(false)
    expect(canFileActivityType(head, "MEETING", s)).toBe(true)
    expect(canFileActivityType(ordinary, "EVENT", s)).toBe(true)
    expect(canFileActivityType(head, "OPERATIONS_TASK", s)).toBe(false)
    expect(fileableActivityTypes(ordinary, s)).toEqual(["EVENT"])
    expect(fileableActivityTypes(head, s)).toEqual(["MEETING", "ADMIN_TASK", "EVENT"])
  })

  it("lets an edit keep a type that is switched off, but offers nothing else off", () => {
    const s = withTypes({ ADMIN_TASK: { active: false } })
    expect(formTypeOptions(head, "ADMIN_TASK", s)).toEqual(["MEETING", "ADMIN_TASK", "OPERATIONS_TASK", "EVENT"])
    expect(formTypeOptions(head, null, s)).toEqual(["MEETING", "OPERATIONS_TASK", "EVENT"])
  })

  it("names the New button after the one type left, using its name", () => {
    const s = withTypes({ MEETING: { name: "Huddle" } })
    expect(newActivityLabel(ordinary, s)).toBe("New Huddle")
    expect(newActivityLabel(head, s)).toBe("New Activity")
  })

  it("describes each change in plain words for the Activity Log", () => {
    const from = DEFAULT_ACTIVITY_SETTINGS.types.MEETING
    expect(describeTypeChange("name", from, { ...from, name: "Huddle" })).toBe('Renamed Activity type "Meeting" to "Huddle"')
    expect(describeTypeChange("whoFiles", from, { ...from, whoFiles: "HEADS" })).toContain("department heads only")
    expect(describeTypeChange("needsHr", from, { ...from, needsHr: false })).toBe('"Meeting" no longer waits for HR')
    const g = DEFAULT_ACTIVITY_SETTINGS.general
    expect(describeGeneralChange("maxDays", g, { ...g, maxDays: 7 })).toBe("Longest range (days): 31 to 7")
    expect(describeGeneralChange("meetingTypes", g, { ...g, meetingTypes: { ...g.meetingTypes, HYBRID: false } })).toBe("Switched off the Hybrid meeting type")
  })
})
