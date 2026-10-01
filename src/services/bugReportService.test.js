import { describe, expect, it } from "vitest"
import { bugReportService, isPastRetention } from "./bugReportService"
import { db } from "@/test/db/store"
import { stubRpc } from "@/test/msw/server"
import { seedStorageObject, storageObjects } from "@/test/msw/storage"
import { makeEmployee } from "@/test/factories"

/**
 * Bug Reports: any employee sends one (text plus files in the private
 * `bug-reports` bucket); readers list them, open the files through signed
 * URLs, tick them Resolved, and purge files once a report is a year old.
 */
describe("bugReportService", () => {
  const YEAR = 365 * 24 * 60 * 60 * 1000

  describe("uploading an attachment", () => {
    it("stores the file under the sender's folder and describes it by its original name", async () => {
      const file = new File(["boom"], "screen recording.mp4", { type: "video/mp4" })

      const descriptor = await bugReportService.uploadAttachment("emp-1", file)

      expect(descriptor).toMatchObject({ name: "screen recording.mp4", type: "video/mp4", bytes: 4 })
      expect(descriptor.path).toMatch(/^emp-1\/[0-9a-f-]+\.mp4$/)
      expect(storageObjects.has(`bug-reports/${descriptor.path}`)).toBe(true)
    })

    it("keeps a file with no extension", async () => {
      const descriptor = await bugReportService.uploadAttachment("emp-1", new File(["x"], "README", { type: "" }))
      expect(descriptor.path).toMatch(/^emp-1\/[0-9a-f-]+$/)
    })
  })

  describe("sending", () => {
    it("sends the description, attachments and where it was sent from", async () => {
      let sent
      stubRpc("submit_bug_report", (args) => {
        sent = args
        return "bug-1"
      })

      const id = await bugReportService.submit({
        description: "  Save does nothing  ",
        attachments: [{ path: "emp-1/a.png", name: "a.png", type: "image/png", bytes: 1 }],
        pageUrl: "/tasks?record=9",
      })

      expect(id).toBe("bug-1")
      expect(sent).toMatchObject({
        p_description: "Save does nothing",
        p_attachments: [{ path: "emp-1/a.png", name: "a.png", type: "image/png", bytes: 1 }],
        p_page_url: "/tasks?record=9",
        p_app_version: "test",
      })
      expect(sent.p_user_agent).toBeTruthy()
      expect(sent.p_environment).toBeTruthy()
    })

    it("surfaces the server's refusal", async () => {
      stubRpc("submit_bug_report", () => {
        throw Object.assign(new Error("Describe the bug before sending."), { code: "P0001" })
      })

      await expect(bugReportService.submit({ description: "x", attachments: [] })).rejects.toThrow(
        "Describe the bug before sending.",
      )
    })
  })

  describe("listing", () => {
    it("returns every report newest first with the reporter's name", async () => {
      const ana = makeEmployee({ name: "Ana Reyes" })
      db.seed("bug_reports", [
        { reporter_id: ana.id, description: "older", created_at: "2026-09-01T00:00:00Z" },
        { reporter_id: ana.id, description: "newer", created_at: "2026-09-02T00:00:00Z" },
      ])

      const reports = await bugReportService.list()

      expect(reports.map((r) => r.description)).toEqual(["newer", "older"])
      expect(reports[0].reporter.name).toBe("Ana Reyes")
    })
  })

  describe("resolving", () => {
    it("ticks and unticks through the RPC", async () => {
      const calls = []
      stubRpc("set_bug_report_resolved", (args) => {
        calls.push(args)
        return null
      })

      await bugReportService.setResolved("bug-1", true)
      await bugReportService.setResolved("bug-1", false)

      expect(calls).toEqual([
        { p_id: "bug-1", p_resolved: true },
        { p_id: "bug-1", p_resolved: false },
      ])
    })
  })

  describe("opening attachments", () => {
    it("gives each stored file a signed URL, keeping its name", async () => {
      seedStorageObject("bug-reports", "emp-1/a.png", { bytes: new Uint8Array([1]).buffer })

      const [file] = await bugReportService.withUrls([{ path: "emp-1/a.png", name: "a.png", type: "image/png" }])

      expect(file.name).toBe("a.png")
      expect(file.url).toMatch(/\/object\/sign\/bug-reports\/emp-1\/a\.png\?token=/)
    })

    it("returns nothing for no attachments", async () => {
      expect(await bugReportService.withUrls([])).toEqual([])
    })
  })

  describe("the one-year file purge", () => {
    it("counts a report as past retention only after a full year", () => {
      const now = new Date("2027-10-02T00:00:00Z").getTime()
      expect(isPastRetention({ created_at: new Date(now - YEAR - 1000).toISOString() }, now)).toBe(true)
      expect(isPastRetention({ created_at: new Date(now - YEAR + 60_000).toISOString() }, now)).toBe(false)
    })

    it("deletes the files of year-old reports and marks them purged, leaving newer ones alone", async () => {
      seedStorageObject("bug-reports", "emp-1/old.png", { bytes: new Uint8Array([1]).buffer })
      seedStorageObject("bug-reports", "emp-1/new.png", { bytes: new Uint8Array([1]).buffer })
      const purged = []
      stubRpc("mark_bug_report_files_purged", ({ p_id }) => {
        purged.push(p_id)
        return null
      })
      const now = Date.now()
      const reports = [
        { id: "old", created_at: new Date(now - YEAR - 1000).toISOString(), attachments: [{ path: "emp-1/old.png" }] },
        { id: "new", created_at: new Date(now - 1000).toISOString(), attachments: [{ path: "emp-1/new.png" }] },
        { id: "empty", created_at: new Date(now - YEAR - 1000).toISOString(), attachments: [] },
      ]

      const count = await bugReportService.purgeExpiredFiles(reports, now)

      expect(count).toBe(1)
      expect(purged).toEqual(["old"])
      expect(storageObjects.has("bug-reports/emp-1/old.png")).toBe(false)
      expect(storageObjects.has("bug-reports/emp-1/new.png")).toBe(true)
    })
  })
})
