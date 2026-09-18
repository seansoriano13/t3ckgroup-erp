import { describe, expect, it } from "vitest"
import { appSettingsService } from "./appSettingsService"
import { db } from "@/test/db/store"
import { waitForNetworkIdle } from "@/test/network"
import { makeSuperAdmin } from "@/test/factories"

/**
 * App settings are feature switches every screen reads. The important property
 * is that a missing row never breaks the app: it falls back to a conservative
 * default set rather than leaving features undefined.
 */
describe("appSettingsService", () => {
  it("returns a safe default set when no settings row exists", async () => {
    const settings = await appSettingsService.getAppSettings()

    expect(settings).toEqual({
      universal_task_submission: true,
      marketing_approval_by_ops_manager: false,
      enable_self_verification: false,
      enable_bulk_approval: false,
      enable_visual_shaming: false,
      retail_storefronts: ["Shopee", "Lazada"],
    })
  })

  it("returns the stored settings once a row exists", async () => {
    db.seed("app_settings", { id: true, enable_bulk_approval: true })

    const settings = await appSettingsService.getAppSettings()

    expect(settings.enable_bulk_approval).toBe(true)
  })

  it("saves a change", async () => {
    db.seed("app_settings", { id: true, enable_self_verification: false })

    await appSettingsService.updateAppSettings({ enable_self_verification: true })

    expect((await appSettingsService.getAppSettings()).enable_self_verification).toBe(true)
  })

  it("leaves the switches it was not asked to change alone", async () => {
    db.seed("app_settings", { id: true, enable_bulk_approval: true })

    await appSettingsService.updateAppSettings({ enable_visual_shaming: true })

    const settings = await appSettingsService.getAppSettings()
    expect(settings).toMatchObject({ enable_bulk_approval: true, enable_visual_shaming: true })
  })

  it("records which switches were changed in the audit log", async () => {
    const actor = makeSuperAdmin({ name: "Boss" })
    db.seed("app_settings", { id: true })

    await appSettingsService.updateAppSettings({ enable_bulk_approval: true })
    await waitForNetworkIdle()
    void actor

    const [entry] = db.rows("system_audit_logs")
    expect(entry.entity_type).toBe("SETTINGS")
    expect(entry.content).toBe("App settings updated: enable_bulk_approval.")
    expect(entry.metadata.changes).toEqual({ enable_bulk_approval: true })
  })
})
