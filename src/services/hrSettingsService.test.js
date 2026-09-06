import { describe, expect, it } from "vitest"
import { hrSettingsService } from "./hrSettingsService"
import { db } from "@/test/db/store"

/**
 * The hr_form_settings row is never seeded by default (unlike app_settings,
 * which ships with a migration default) — see #103. A save must create it
 * on first use rather than requiring someone with database access to insert
 * the singleton row by hand.
 */
describe("hrSettingsService form settings", () => {
  it("returns null when no settings row exists yet", async () => {
    const settings = await hrSettingsService.getFormSettings()
    expect(settings).toBeNull()
  })

  it("creates the singleton row on first save when none exists", async () => {
    const saved = await hrSettingsService.updateFormSettings({
      supervisor_name: "Jane Doe",
      supervisor_title: "Operations Manager",
    })

    expect(saved).toMatchObject({
      id: 1,
      supervisor_name: "Jane Doe",
      supervisor_title: "Operations Manager",
    })
    expect(await hrSettingsService.getFormSettings()).toMatchObject({ supervisor_name: "Jane Doe" })
  })

  it("updates the existing row instead of duplicating it", async () => {
    db.seed("hr_form_settings", { id: 1, supervisor_name: "Old Name" })

    await hrSettingsService.updateFormSettings({ supervisor_name: "New Name" })

    const rows = db.rows("hr_form_settings")
    expect(rows).toHaveLength(1)
    expect(rows[0].supervisor_name).toBe("New Name")
  })
})
