import { describe, expect, it } from "vitest"
import { leadSourceService } from "./leadSourceService"
import { makeLeadSource } from "@/test/factories"

/**
 * Lead sources moved from hard-coded constants into a table, and the service
 * keeps the old list as a fallback so the opportunity form can never render an
 * empty dropdown — even if the table is empty or unreachable.
 */
describe("leadSourceService", () => {
  describe("reading the register", () => {
    it("returns the configured sources in the order they were added", async () => {
      makeLeadSource({ value: "LGU", label: "LGU" })
      makeLeadSource({ value: "REFERRAL", label: "Referral" })

      const sources = await leadSourceService.getAllLeadSources()

      expect(sources.map((s) => s.value)).toEqual(["LGU", "REFERRAL"])
    })

    it("falls back to the built-in list when the table is empty", async () => {
      const sources = await leadSourceService.getAllLeadSources()

      expect(sources.map((s) => s.value)).toContain("LGU")
      expect(sources.map((s) => s.value)).toContain("REPEAT_CLIENT")
    })

    it("offers only active sources for the opportunity form, sorted by label", async () => {
      makeLeadSource({ value: "WEBSITE", label: "Website", is_active: true })
      makeLeadSource({ value: "FACEBOOK", label: "Facebook", is_active: true })
      makeLeadSource({ value: "RETIRED", label: "Retired channel", is_active: false })

      const active = await leadSourceService.getActiveLeadSources()

      expect(active.map((s) => s.label)).toEqual(["Facebook", "Website"])
    })

    it("keeps inactive sources visible to the settings screen", async () => {
      makeLeadSource({ value: "RETIRED", label: "Retired channel", is_active: false })

      const all = await leadSourceService.getAllLeadSources()

      expect(all.map((s) => s.value)).toContain("RETIRED")
    })

    it("falls back rather than returning an empty dropdown when every source is off", async () => {
      makeLeadSource({ value: "RETIRED", label: "Retired channel", is_active: false })

      const active = await leadSourceService.getActiveLeadSources()

      expect(active.length).toBeGreaterThan(0)
      expect(active.every((s) => s.is_active)).toBe(true)
    })
  })

  describe("adding a source", () => {
    it("stores the value upper-cased and the label as typed", async () => {
      await leadSourceService.addLeadSource({ value: " trade show ", label: "  Trade Show " })

      const [source] = await leadSourceService.getAllLeadSources()
      expect(source).toMatchObject({ value: "TRADE SHOW", label: "Trade Show", is_active: true })
    })

    it("requires both a value and a label", async () => {
      await expect(leadSourceService.addLeadSource({ value: "X" })).rejects.toThrow(
        "Both Value and Label are required.",
      )
      await expect(leadSourceService.addLeadSource({ label: "X" })).rejects.toThrow(
        "Both Value and Label are required.",
      )
    })

    it("refuses a value that already exists", async () => {
      makeLeadSource({ value: "LGU", label: "LGU" })

      await expect(
        leadSourceService.addLeadSource({ value: "LGU", label: "Duplicate" }),
      ).rejects.toMatchObject({ code: "23505" })
    })
  })

  describe("retiring a source", () => {
    it("hides it from the form without deleting the historical value", async () => {
      makeLeadSource({ value: "LGU", label: "LGU" })
      makeLeadSource({ value: "TIKTOK", label: "TikTok" })

      await leadSourceService.toggleLeadSource("TIKTOK", false)

      const active = await leadSourceService.getActiveLeadSources()
      const all = await leadSourceService.getAllLeadSources()
      expect(active.map((s) => s.value)).toEqual(["LGU"])
      expect(all.map((s) => s.value)).toContain("TIKTOK")
    })

    it("can bring a source back", async () => {
      makeLeadSource({ value: "TIKTOK", label: "TikTok", is_active: false })

      await leadSourceService.toggleLeadSource("TIKTOK", true)

      expect((await leadSourceService.getActiveLeadSources()).map((s) => s.value)).toContain(
        "TIKTOK",
      )
    })
  })
})
