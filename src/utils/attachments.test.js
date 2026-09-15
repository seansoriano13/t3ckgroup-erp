import { describe, expect, it } from "vitest"
import {
  acceptsLabel,
  attachmentAcceptType,
  formatBytes,
  isAllowedAttachment,
  isImageAttachment,
  MAX_ATTACHMENTS,
  MAX_ATTACHMENT_BYTES,
  toDescriptor,
} from "./attachments"

// Issue #203 — the Accepts picker's group-to-extension/MIME mapping.
describe("attachmentAcceptType", () => {
  it("resolves a group from the MIME type", () => {
    expect(attachmentAcceptType({ type: "application/pdf", name: "notice.pdf" })).toBe("pdf")
  })

  it("falls back to the extension when the MIME type is missing", () => {
    expect(attachmentAcceptType({ type: "", name: "photo.PNG" })).toBe("image")
  })

  it("returns null for a file matching no known group", () => {
    expect(attachmentAcceptType({ type: "application/x-weird", name: "thing.xyz" })).toBeNull()
  })
})

describe("acceptsLabel", () => {
  it("reads as Any when the list is empty", () => {
    expect(acceptsLabel([])).toBe("Any")
    expect(acceptsLabel()).toBe("Any")
  })

  it("joins group labels in order", () => {
    expect(acceptsLabel(["pdf", "image"])).toBe("PDF, Images")
  })
})

/**
 * Attachments are stored two ways depending on their age: task comments kept a
 * bare URL string, everything since keeps a descriptor object. Every reader
 * goes through toDescriptor(), so it has to handle both without losing the
 * filename an employee sees.
 */
describe("toDescriptor", () => {
  it("wraps a legacy bare URL into a descriptor", () => {
    expect(toDescriptor("https://res.cloudinary.com/demo/image/upload/v1/receipt.png")).toEqual({
      url: "https://res.cloudinary.com/demo/image/upload/v1/receipt.png",
      name: "receipt.png",
      type: "",
    })
  })

  it("decodes a percent-encoded filename", () => {
    expect(toDescriptor("https://res.cloudinary.com/demo/raw/upload/Site%20Report.pdf").name).toBe(
      "Site Report.pdf",
    )
  })

  it("keeps the stored descriptor fields", () => {
    expect(
      toDescriptor({
        url: "https://example.test/a.pdf",
        name: "Contract.pdf",
        type: "application/pdf",
        bytes: 2048,
      }),
    ).toEqual({
      url: "https://example.test/a.pdf",
      name: "Contract.pdf",
      type: "application/pdf",
      bytes: 2048,
    })
  })

  it("derives a name for a descriptor that lost its filename", () => {
    expect(toDescriptor({ url: "https://example.test/files/report.docx" }).name).toBe(
      "report.docx",
    )
  })

  it("falls back to a generic name when the URL is unparseable", () => {
    expect(toDescriptor("not-a-url").name).toBe("Attachment")
  })

  it("returns null for nothing, or for a descriptor with no URL", () => {
    expect(toDescriptor(null)).toBeNull()
    expect(toDescriptor(undefined)).toBeNull()
    expect(toDescriptor({ name: "orphan.pdf" })).toBeNull()
  })
})

describe("isImageAttachment", () => {
  it("trusts an image MIME type", () => {
    expect(isImageAttachment({ type: "image/png", url: "https://example.test/x" })).toBe(true)
  })

  it("falls back to the file extension when the type is unknown", () => {
    expect(isImageAttachment({ type: "", url: "https://example.test/photo.JPG" })).toBe(true)
    expect(isImageAttachment({ url: "https://example.test/diagram.webp" })).toBe(true)
  })

  it("recognises an image URL that carries a query string", () => {
    expect(isImageAttachment({ url: "https://example.test/photo.png?v=2" })).toBe(true)
  })

  it("rejects a document", () => {
    expect(isImageAttachment({ type: "application/pdf", url: "https://example.test/a.pdf" })).toBe(
      false,
    )
  })

  it("handles a missing descriptor", () => {
    expect(isImageAttachment(null)).toBe(false)
    expect(isImageAttachment({})).toBe(false)
  })
})

describe("formatBytes", () => {
  it("shows plain bytes below a kilobyte", () => {
    expect(formatBytes(0)).toBe("0 B")
    expect(formatBytes(512)).toBe("512 B")
  })

  it("rounds to whole kilobytes below a megabyte", () => {
    expect(formatBytes(1024)).toBe("1 KB")
    expect(formatBytes(2048)).toBe("2 KB")
    expect(formatBytes(1536)).toBe("2 KB")
  })

  it("shows one decimal place at megabyte scale", () => {
    expect(formatBytes(1048576)).toBe("1.0 MB")
    expect(formatBytes(5242880)).toBe("5.0 MB")
  })

  it("shows nothing when the size was never recorded", () => {
    expect(formatBytes(null)).toBe("")
    expect(formatBytes(undefined)).toBe("")
  })
})

describe("isAllowedAttachment", () => {
  it("allows a common document type", () => {
    expect(isAllowedAttachment({ name: "Contract.pdf", type: "application/pdf" })).toBe(true)
  })

  it("allows a short video by MIME type", () => {
    expect(isAllowedAttachment({ name: "walkthrough.mp4", type: "video/mp4" })).toBe(true)
  })

  it("allows a short video by extension when the browser reports no MIME type", () => {
    expect(isAllowedAttachment({ name: "clip.mov", type: "" })).toBe(true)
  })

  it("rejects an unsupported executable", () => {
    expect(isAllowedAttachment({ name: "installer.exe", type: "application/x-msdownload" })).toBe(
      false,
    )
  })
})

describe("attachment limits", () => {
  it("caps an upload set at five files of ten megabytes", () => {
    expect(MAX_ATTACHMENTS).toBe(5)
    expect(MAX_ATTACHMENT_BYTES).toBe(10 * 1024 * 1024)
  })
})
