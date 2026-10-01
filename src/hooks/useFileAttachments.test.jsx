import { act, renderHook, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import toast from "react-hot-toast"
import { useFileAttachments } from "./useFileAttachments"
import { stubCloudinaryUpload } from "@/test/msw/server"

// browser-image-compression needs a real canvas and a Web Worker; in jsdom it
// simply never resolves. It is an external codec, not our logic — the upload
// path around it is what these tests are for.
vi.mock("browser-image-compression", () => ({ default: async (file) => file }))

/**
 * The pick → validate → preview → upload cycle behind every attachment field.
 *
 * Nothing may reach Cloudinary until the user actually submits: a form they
 * abandon must leave no uploaded files behind. The limits (five files, ten
 * megabytes) are what stops one paste from filling the media account.
 */
const file = (name = "photo.png", type = "image/png", size = 1024) =>
  new File(["x".repeat(size)], name, { type })

describe("useFileAttachments", () => {
  beforeEach(() => {
    vi.spyOn(toast, "error").mockImplementation(() => "toast-id")
    // jsdom has no object URLs.
    globalThis.URL.createObjectURL = vi.fn(() => "blob:preview")
    globalThis.URL.revokeObjectURL = vi.fn()
  })

  describe("picking files", () => {
    it("holds a picked file without uploading it", async () => {
      const { result } = renderHook(() => useFileAttachments())

      act(() => result.current.addFiles([file()]))

      expect(result.current.files).toHaveLength(1)
      expect(result.current.files[0].file.name).toBe("photo.png")
      expect(result.current.isUploading).toBe(false)
    })

    it("makes a preview for an image but not for an allowed document", () => {
      const { result } = renderHook(() => useFileAttachments())

      act(() => result.current.addFiles([file(), file("report.pdf", "application/pdf")]))

      expect(result.current.files[0].preview).toBe("blob:preview")
      expect(result.current.files[1].preview).toBeNull()
    })

    it("rejects unsupported file types by extension", () => {
      const { result } = renderHook(() => useFileAttachments())
      
      act(() => result.current.addFiles([file("script.sh", "application/x-sh"), file("virus.exe", "application/x-msdownload")]))

      expect(result.current.files).toEqual([])
      expect(toast.error).toHaveBeenCalledWith("script.sh is not a supported file type.")
      expect(toast.error).toHaveBeenCalledWith("virus.exe is not a supported file type.")
    })

    it("adds to what is already held rather than replacing it", () => {
      const { result } = renderHook(() => useFileAttachments())

      act(() => result.current.addFiles([file("a.png")]))
      act(() => result.current.addFiles([file("b.png")]))

      expect(result.current.files.map((f) => f.file.name)).toEqual(["a.png", "b.png"])
    })

    it("ignores an empty pick", () => {
      const { result } = renderHook(() => useFileAttachments())

      act(() => result.current.addFiles([]))
      act(() => result.current.addFiles(null))

      expect(result.current.files).toEqual([])
    })

    it("rejects unsupported file types", () => {
      const { result } = renderHook(() => useFileAttachments())

      act(() => result.current.addFiles([file("app.exe", "application/x-msdownload")]))

      expect(result.current.files).toEqual([])
      expect(toast.error).toHaveBeenCalledWith("app.exe is not a supported file type.")
    })
  })

  describe("limits", () => {
    it("stops at five files and says so", () => {
      const { result } = renderHook(() => useFileAttachments())

      act(() => result.current.addFiles(Array.from({ length: 7 }, (_, i) => file(`f${i}.png`))))

      expect(result.current.files).toHaveLength(5)
      expect(toast.error).toHaveBeenCalledWith(
        expect.stringContaining("Only 5 files allowed"),
      )
    })

    it("refuses to add anything once the limit is reached", () => {
      const { result } = renderHook(() => useFileAttachments())
      act(() => result.current.addFiles(Array.from({ length: 5 }, (_, i) => file(`f${i}.png`))))

      act(() => result.current.addFiles([file("one-more.png")]))

      expect(result.current.files).toHaveLength(5)
      expect(toast.error).toHaveBeenLastCalledWith("You can attach at most 5 files.")
    })

    it("honours a lower limit set by the caller", () => {
      const { result } = renderHook(() => useFileAttachments({ max: 2 }))

      act(() => result.current.addFiles([file("a.png"), file("b.png"), file("c.png")]))

      expect(result.current.files).toHaveLength(2)
      expect(result.current.max).toBe(2)
    })

    it("rejects a file over ten megabytes by name", () => {
      const { result } = renderHook(() => useFileAttachments())
      const huge = new File([], "huge.png", { type: "image/png" })
      Object.defineProperty(huge, "size", { value: 11 * 1024 * 1024 })

      act(() => result.current.addFiles([huge]))

      expect(result.current.files).toEqual([])
      expect(toast.error).toHaveBeenCalledWith(
        "huge.png is too large (max 10.0 MB).",
      )
    })

    it("keeps the acceptable files from a mixed pick", () => {
      const { result } = renderHook(() => useFileAttachments())
      const huge = new File([], "huge.png", { type: "image/png" })
      Object.defineProperty(huge, "size", { value: 11 * 1024 * 1024 })

      act(() => result.current.addFiles([file("ok.png"), huge]))

      expect(result.current.files.map((f) => f.file.name)).toEqual(["ok.png"])
    })
  })

  describe("removing", () => {
    it("removes one file and releases its preview", () => {
      const { result } = renderHook(() => useFileAttachments())
      act(() => result.current.addFiles([file("a.png"), file("b.png")]))

      act(() => result.current.removeFile(0))

      expect(result.current.files.map((f) => f.file.name)).toEqual(["b.png"])
      expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:preview")
    })

    it("clears everything and releases every preview", () => {
      const { result } = renderHook(() => useFileAttachments())
      act(() => result.current.addFiles([file("a.png"), file("b.png")]))

      act(() => result.current.clear())

      expect(result.current.files).toEqual([])
      expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2)
    })
  })

  describe("pasting", () => {
    it("takes files out of a paste and reports that it handled it", () => {
      const { result } = renderHook(() => useFileAttachments())
      const event = pasteEventWith([file("pasted.png")])

      let handled
      act(() => {
        handled = result.current.addFromPaste(event)
      })

      expect(handled).toBe(true)
      expect(event.preventDefault).toHaveBeenCalled()
      expect(result.current.files).toHaveLength(1)
    })

    it("leaves a text paste alone", () => {
      const { result } = renderHook(() => useFileAttachments())
      const event = {
        clipboardData: { items: [{ kind: "string", getAsFile: () => null }] },
        preventDefault: vi.fn(),
      }

      let handled
      act(() => {
        handled = result.current.addFromPaste(event)
      })

      expect(handled).toBe(false)
      expect(event.preventDefault).not.toHaveBeenCalled()
      expect(result.current.files).toEqual([])
    })

    it("copes with a paste that carries no clipboard data", () => {
      const { result } = renderHook(() => useFileAttachments())

      let handled
      act(() => {
        handled = result.current.addFromPaste({ preventDefault: vi.fn() })
      })

      expect(handled).toBe(false)
    })
  })

  describe("uploading", () => {
    it("returns the descriptors to store on the record", async () => {
      stubCloudinaryUpload({ secure_url: "https://res.cloudinary.test/photo.png", bytes: 1024 })
      const { result } = renderHook(() => useFileAttachments())
      act(() => result.current.addFiles([file("photo.png")]))

      let descriptors
      await act(async () => {
        descriptors = await result.current.upload()
      })

      expect(descriptors).toEqual([
        {
          url: "https://res.cloudinary.test/photo.png",
          name: "photo.png",
          type: "image/png",
          bytes: 1024,
        },
      ])
    })

    it("uploads nothing and returns an empty list when no file was picked", async () => {
      const { result } = renderHook(() => useFileAttachments())

      let descriptors
      await act(async () => {
        descriptors = await result.current.upload()
      })

      expect(descriptors).toEqual([])
    })

    it("reports that an upload is in progress", async () => {
      stubCloudinaryUpload({ secure_url: "https://res.cloudinary.test/photo.png", bytes: 1024 })
      const { result } = renderHook(() => useFileAttachments())
      act(() => result.current.addFiles([file()]))

      let pending
      act(() => {
        pending = result.current.upload()
      })
      await waitFor(() => expect(result.current.isUploading).toBe(true))

      await act(async () => {
        await pending
      })
      expect(result.current.isUploading).toBe(false)
    })

    it("surfaces a failure and stops reporting progress", async () => {
      stubCloudinaryUpload({ __status: 400, message: "Upload preset not found" })
      const { result } = renderHook(() => useFileAttachments())
      act(() => result.current.addFiles([file()]))

      await expect(
        act(async () => {
          await result.current.upload()
        }),
      ).rejects.toThrow("Upload preset not found")

      expect(result.current.isUploading).toBe(false)
    })
  })
})

describe("useFileAttachments with its own limits and uploader", () => {
  beforeEach(() => {
    vi.spyOn(toast, "error").mockImplementation(() => "toast-id")
    globalThis.URL.createObjectURL = vi.fn(() => "blob:preview")
    globalThis.URL.revokeObjectURL = vi.fn()
  })

  // A file that claims a size without allocating it.
  const sized = (name, type, size) => {
    const f = file(name, type, 1)
    Object.defineProperty(f, "size", { value: size })
    return f
  }

  it("takes any file type when anyType is set", () => {
    const { result } = renderHook(() => useFileAttachments({ anyType: true }))

    act(() => result.current.addFiles([file("dump.har", "application/json"), file("app.exe", "application/x-msdownload")]))

    expect(result.current.files.map((f) => f.file.name)).toEqual(["dump.har", "app.exe"])
  })

  it("uses maxBytes in place of the 10 MB default", () => {
    const { result } = renderHook(() => useFileAttachments({ maxBytes: 50 * 1024 * 1024 }))

    act(() =>
      result.current.addFiles([
        sized("clip.mp4", "video/mp4", 30 * 1024 * 1024),
        sized("long.mp4", "video/mp4", 51 * 1024 * 1024),
      ]),
    )

    expect(result.current.files.map((f) => f.file.name)).toEqual(["clip.mp4"])
    expect(toast.error).toHaveBeenCalledWith("long.mp4 is too large (max 50.0 MB).")
  })

  it("uploads through the given uploader instead of Cloudinary", async () => {
    const uploadFile = vi.fn(async (f) => ({ path: `me/${f.name}`, name: f.name }))
    const { result } = renderHook(() => useFileAttachments({ uploadFile }))
    act(() => result.current.addFiles([file("a.png")]))

    let descriptors
    await act(async () => {
      descriptors = await result.current.upload()
    })

    expect(uploadFile).toHaveBeenCalledTimes(1)
    expect(descriptors).toEqual([{ path: "me/a.png", name: "a.png" }])
  })
})

function pasteEventWith(files) {
  return {
    clipboardData: {
      items: files.map((f) => ({ kind: "file", getAsFile: () => f })),
    },
    preventDefault: vi.fn(),
  }
}
