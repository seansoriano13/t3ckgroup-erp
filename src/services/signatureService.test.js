import { beforeEach, describe, expect, it } from "vitest"
import { signatureService } from "./signatureService"
import { db } from "@/test/db/store"
import { storageObjects } from "@/test/msw/storage"
import { makeEmployee } from "@/test/factories"

/**
 * Signature capture goes through real Supabase Storage rather than
 * Cloudinary — everything else in this app uploads there, but a signature
 * has to be access-scoped (owner, HR, Super Admin only), which an unsigned
 * public preset cannot do. This is the first seam to exercise that boundary,
 * so it's covered against a fake Storage handler rather than a mock of our
 * own code — the same principle the rest of this suite already follows for
 * the database.
 */
describe("signatureService", () => {
  let employee

  beforeEach(() => {
    employee = makeEmployee({ name: "Ana Reyes" })
  })

  const pngFile = (bytes = [1, 2, 3, 4], type = "image/png") =>
    new File([new Uint8Array(bytes)], "signature.png", { type })

  describe("saving a signature", () => {
    it("uploads the file and points the employee record at it", async () => {
      const updated = await signatureService.saveSignature(employee.id, pngFile())

      expect(updated.signature_path).toMatch(new RegExp(`^${employee.id}/`))
      expect(db.rows("employees").find((e) => e.id === employee.id).signature_path).toBe(
        updated.signature_path,
      )
    })

    it("stores the uploaded bytes and content type", async () => {
      const updated = await signatureService.saveSignature(employee.id, pngFile([9, 9, 9]))

      const stored = storageObjects.get(`signatures/${updated.signature_path}`)
      expect(stored.contentType).toBe("image/png")
      expect(new Uint8Array(stored.bytes)).toEqual(new Uint8Array([9, 9, 9]))
    })

    it("replacing a signature writes a new version and leaves the old file in place", async () => {
      const first = await signatureService.saveSignature(employee.id, pngFile([1]))
      const firstPath = first.signature_path

      const second = await signatureService.saveSignature(employee.id, pngFile([2]))

      expect(second.signature_path).not.toBe(firstPath)
      expect(storageObjects.has(`signatures/${firstPath}`)).toBe(true)
      expect(storageObjects.has(`signatures/${second.signature_path}`)).toBe(true)
      expect(
        db.rows("employees").find((e) => e.id === employee.id).signature_path,
      ).toBe(second.signature_path)
    })

    it("refuses a file that is not a PNG", async () => {
      await expect(
        signatureService.saveSignature(employee.id, pngFile([1, 2, 3], "image/jpeg")),
      ).rejects.toThrow(/mime type/i)

      expect(db.rows("employees").find((e) => e.id === employee.id).signature_path).toBeFalsy()
    })

    it("refuses a file over the bucket's size cap", async () => {
      const oversized = new Uint8Array(204801)

      await expect(
        signatureService.saveSignature(employee.id, pngFile(oversized)),
      ).rejects.toThrow(/exceeds the maximum allowed size/i)
    })
  })

  describe("reading a signature back", () => {
    it("returns a URL that resolves to the stored bytes", async () => {
      const updated = await signatureService.saveSignature(employee.id, pngFile([7, 7]))

      const url = await signatureService.getSignatureUrl(updated.signature_path)
      const response = await fetch(url)
      const bytes = new Uint8Array(await response.arrayBuffer())

      expect(Array.from(bytes)).toEqual([7, 7])
    })

    it("returns null for no path rather than throwing", async () => {
      expect(await signatureService.getSignatureUrl(null)).toBeNull()
    })

    it("refuses a path that was never stored", async () => {
      await expect(
        signatureService.getSignatureUrl(`${employee.id}/never-uploaded.png`),
      ).rejects.toThrow(/not found/i)
    })
  })
})
