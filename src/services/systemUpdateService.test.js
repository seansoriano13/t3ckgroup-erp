import { beforeEach, describe, expect, it } from "vitest"
import { systemUpdateService } from "./systemUpdateService"
import { db } from "@/test/db/store"
import { waitForNetworkIdle } from "@/test/network"
import { makeSuperAdmin } from "@/test/factories"

/**
 * Announcement banners everyone sees on login. They expire on their own, and
 * an expired one must stop showing without anybody having to switch it off.
 */
describe("systemUpdateService", () => {
  let author

  beforeEach(() => {
    author = makeSuperAdmin({ name: "Boss" })
  })

  const hoursFromNow = (hours) => new Date(Date.now() + hours * 3600_000).toISOString()

  const post = (overrides = {}) =>
    systemUpdateService.createUpdate({
      content: "The pipeline board is live.",
      type: "feature",
      user_id: author.id,
      ...overrides,
    })

  describe("posting", () => {
    it("publishes the announcement as active", async () => {
      const update = await post()

      expect(update).toMatchObject({
        content: "The pipeline board is live.",
        type: "feature",
        is_active: true,
        created_by: author.id,
      })
    })

    it("expires in a day unless told otherwise", async () => {
      const update = await post()

      const lifetimeHours = (new Date(update.expires_at) - Date.now()) / 3600_000
      expect(lifetimeHours).toBeGreaterThan(23)
      expect(lifetimeHours).toBeLessThanOrEqual(24)
    })

    it("honours an explicit expiry", async () => {
      const expiry = hoursFromNow(72)

      const update = await post({ expires_at: expiry })

      expect(update.expires_at).toBe(expiry)
    })

    it("records the announcement in the audit log, truncating a long one", async () => {
      await post({ content: "x".repeat(120) })
      await waitForNetworkIdle()

      const entry = db.rows("system_audit_logs").find((e) => e.entity_type === "ANNOUNCEMENT")
      expect(entry.content).toContain("…")
      expect(entry.author_id).toBe(author.id)
    })
  })

  describe("what the banner shows", () => {
    it("shows the newest live announcement", async () => {
      await post({ content: "Older" })
      await post({ content: "Newer" })

      expect((await systemUpdateService.getLatestActiveUpdate()).content).toBe("Newer")
    })

    it("names the author for the banner byline", async () => {
      await post()

      expect((await systemUpdateService.getLatestActiveUpdate()).author.name).toBe("Boss")
    })

    it("shows nothing when there is no live announcement", async () => {
      expect(await systemUpdateService.getLatestActiveUpdate()).toBeNull()
    })

    it("stops showing an announcement once it has expired", async () => {
      db.seed("system_updates", {
        content: "Stale",
        created_by: author.id,
        is_active: true,
        expires_at: hoursFromNow(-1),
      })

      expect(await systemUpdateService.getLatestActiveUpdate()).toBeNull()
    })

    it("switches an expired announcement off, so it stays off", async () => {
      db.seed("system_updates", {
        content: "Stale",
        created_by: author.id,
        is_active: true,
        expires_at: hoursFromNow(-1),
      })

      await systemUpdateService.deactivateExpiredUpdates()

      expect(db.rows("system_updates")[0].is_active).toBe(false)
    })

    it("lists every live announcement", async () => {
      await post({ content: "One" })
      await post({ content: "Two" })
      db.seed("system_updates", {
        content: "Expired",
        created_by: author.id,
        is_active: true,
        expires_at: hoursFromNow(-1),
      })

      const active = await systemUpdateService.getActiveUpdates()

      expect(active.map((u) => u.content).sort()).toEqual(["One", "Two"])
    })
  })

  describe("the announcement archive", () => {
    it("pages the full history with a total count", async () => {
      for (let i = 0; i < 12; i += 1) await post({ content: `Update ${i}` })

      const page = await systemUpdateService.getUpdatesPage({ page: 1, pageSize: 5 })

      expect(page).toMatchObject({ totalCount: 12, page: 1, pageSize: 5, totalPages: 3 })
      expect(page.items).toHaveLength(5)
    })

    it("clamps a nonsensical page or size", async () => {
      await post()

      const page = await systemUpdateService.getUpdatesPage({ page: -3, pageSize: 9999 })

      expect(page).toMatchObject({ page: 1, pageSize: 50 })
    })

    it("filters to live announcements", async () => {
      await post({ content: "Live" })
      db.seed("system_updates", {
        content: "Expired",
        created_by: author.id,
        is_active: true,
        expires_at: hoursFromNow(-1),
      })

      const page = await systemUpdateService.getUpdatesPage({ filter: "active" })

      expect(page.items.map((u) => u.content)).toEqual(["Live"])
    })

    it("filters to announcements that are switched off or past their date", async () => {
      await post({ content: "Live" })
      db.seed("system_updates", {
        content: "Expired",
        created_by: author.id,
        is_active: true,
        expires_at: hoursFromNow(-1),
      })

      const page = await systemUpdateService.getUpdatesPage({ filter: "expired" })

      expect(page.items.map((u) => u.content)).toEqual(["Expired"])
    })
  })

  describe("managing an announcement", () => {
    it("switches one off", async () => {
      const update = await post()

      await systemUpdateService.toggleUpdateStatus(update.id, false)

      expect(await systemUpdateService.getLatestActiveUpdate()).toBeNull()
    })

    it("gives a fresh day of life when switched back on", async () => {
      const update = await post({ expires_at: hoursFromNow(1) })
      await systemUpdateService.toggleUpdateStatus(update.id, false)

      const revived = await systemUpdateService.toggleUpdateStatus(update.id, true)

      const lifetimeHours = (new Date(revived.expires_at) - Date.now()) / 3600_000
      expect(lifetimeHours).toBeGreaterThan(23)
    })

    it("edits the text", async () => {
      const update = await post()

      await systemUpdateService.editUpdate(update.id, { content: "Corrected wording", type: "fix" })

      expect(await systemUpdateService.getLatestActiveUpdate()).toMatchObject({
        content: "Corrected wording",
        type: "fix",
      })
    })

    it("removes one entirely", async () => {
      const update = await post()

      await systemUpdateService.deleteUpdate(update.id)

      expect(db.rows("system_updates")).toEqual([])
    })
  })
})
