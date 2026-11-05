import { afterEach, describe, expect, it, vi } from "vitest"
import { isLocalSupabaseUrl, LOCAL_UPLOAD_BUCKET, storageService } from "./storageService"
import { supabase } from "@/lib/supabase"
import { stubCloudinaryUpload } from "@/test/msw/server"

/**
 * Ticket #894: uploads from `pnpm dev` (local Supabase) go to the local
 * `attachments` bucket, never to the Cloudinary account. Staging and production
 * keep Cloudinary. The Supabase client is replaced with a fake so the test can
 * see exactly which bucket and path received the file.
 */
const { upload, getPublicUrl } = vi.hoisted(() => ({
  upload: vi.fn(),
  getPublicUrl: vi.fn(),
}))

vi.mock("@/lib/supabase", () => ({
  supabase: {
    storage: {
      from: vi.fn(() => ({ upload, getPublicUrl })),
    },
  },
}))

// Compression is not what these tests are about; pass the file through.
vi.mock("browser-image-compression", () => ({ default: vi.fn(async (file) => file) }))

const LOCAL_URL = "http://127.0.0.1:54321"
const file = (name = "receipt.pdf", type = "application/pdf", size = 2048) =>
  new File(["x".repeat(size)], name, { type })

describe("isLocalSupabaseUrl", () => {
  it("recognises the local stack on every loopback spelling", () => {
    expect(isLocalSupabaseUrl("http://127.0.0.1:54321")).toBe(true)
    expect(isLocalSupabaseUrl("http://localhost:54321")).toBe(true)
    expect(isLocalSupabaseUrl("http://[::1]:54321")).toBe(true)
  })

  it("treats staging, production, the test host and blanks as remote", () => {
    expect(isLocalSupabaseUrl("http://supabase.test")).toBe(false)
    expect(isLocalSupabaseUrl("https://abcdefgh.supabase.co")).toBe(false)
    expect(isLocalSupabaseUrl("https://staging.example.com")).toBe(false)
    expect(isLocalSupabaseUrl("")).toBe(false)
    expect(isLocalSupabaseUrl(undefined)).toBe(false)
    expect(isLocalSupabaseUrl("not a url")).toBe(false)
  })

  it("does not match a hostname that merely contains localhost", () => {
    expect(isLocalSupabaseUrl("https://localhost.evil.example")).toBe(false)
  })
})

describe("storageService upload routing", () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    upload.mockReset()
    getPublicUrl.mockReset()
    supabase.storage.from.mockClear()
  })

  describe("on the local Supabase stack", () => {
    const useLocalStack = () => {
      vi.stubEnv("VITE_SUPABASE_URL", LOCAL_URL)
      upload.mockResolvedValue({ error: null })
      getPublicUrl.mockImplementation((path) => ({
        data: { publicUrl: `${LOCAL_URL}/storage/v1/object/public/${LOCAL_UPLOAD_BUCKET}/${path}` },
      }))
    }

    it("stores a document in the attachments bucket and returns its public URL", async () => {
      useLocalStack()

      const descriptor = await storageService.uploadFileToCloudinary(file("Site Report.pdf"))

      expect(supabase.storage.from).toHaveBeenCalledWith(LOCAL_UPLOAD_BUCKET)
      expect(upload).toHaveBeenCalledTimes(1)
      const [path, sent, options] = upload.mock.calls[0]
      expect(path).toMatch(/-Site_Report\.pdf$/)
      expect(sent).toBeInstanceOf(File)
      expect(options).toEqual({ contentType: "application/pdf", upsert: false })
      expect(descriptor).toEqual({
        url: `${LOCAL_URL}/storage/v1/object/public/attachments/${path}`,
        name: "Site Report.pdf",
        type: "application/pdf",
        bytes: 2048,
      })
    })

    it("stores an image through the same bucket and returns a plain URL", async () => {
      useLocalStack()

      const url = await storageService.uploadToCloudinary(file("photo.png", "image/png"))

      expect(upload.mock.calls[0][0]).toMatch(/-photo\.png$/)
      expect(url.startsWith(`${LOCAL_URL}/storage/v1/object/public/attachments/`)).toBe(true)
    })

    it("replaces characters that are unsafe in a storage path", async () => {
      useLocalStack()

      await storageService.uploadFileToCloudinary(file("Plan (final) #2.pdf"))

      expect(upload.mock.calls[0][0]).toMatch(/-Plan__final___2\.pdf$/)
    })

    it("surfaces a storage rejection as a readable error", async () => {
      useLocalStack()
      upload.mockResolvedValue({ error: { message: "new row violates row-level security" } })

      await expect(storageService.uploadFileToCloudinary(file())).rejects.toThrow(
        "new row violates row-level security",
      )
    })
  })

  describe("on staging, production and the test host", () => {
    it("keeps uploading to Cloudinary and never touches Supabase Storage", async () => {
      vi.stubEnv("VITE_SUPABASE_URL", "http://supabase.test")
      stubCloudinaryUpload({ secure_url: "https://res.cloudinary.test/raw/receipt.pdf", bytes: 2048 })

      const descriptor = await storageService.uploadFileToCloudinary(file())

      expect(descriptor.url).toBe("https://res.cloudinary.test/raw/receipt.pdf")
      expect(supabase.storage.from).not.toHaveBeenCalled()
      expect(upload).not.toHaveBeenCalled()
    })
  })
})
