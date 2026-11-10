import { describe, expect, it, vi } from "vitest"
import { fireEvent, render } from "@testing-library/react"

const upload = vi.hoisted(() => vi.fn(async () => "path/a.png"))
vi.mock("../services/storageService", () => ({
  storageService: {
    uploadTaskAttachment: upload,
    getSignedUrls: async () => [],
  },
}))
vi.mock("react-hot-toast", () => {
  const t = Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() })
  return { default: t }
})
import ImageAttachment from "./ImageAttachment"

const pasteImage = (target) => {
  const file = new File(["x"], "s.png", { type: "image/png" })
  fireEvent.paste(target, {
    clipboardData: { items: [{ type: "image/png", getAsFile: () => file }] },
  })
}

describe("ImageAttachment paste", () => {
  it("ignores an image pasted into a chat composer", () => {
    upload.mockClear()
    const { container } = render(
      <div>
        <textarea />
        <ImageAttachment taskId="T1" userId="u1" attachments={[]} onChange={() => {}} />
      </div>,
    )
    pasteImage(container.querySelector("textarea"))
    expect(upload).not.toHaveBeenCalled()
  })

  it("attaches an image pasted in the attachment area", async () => {
    upload.mockClear()
    const { container } = render(
      <ImageAttachment taskId="T1" userId="u1" attachments={[]} onChange={() => {}} />,
    )
    pasteImage(container.firstChild)
    await vi.waitFor(() => expect(upload).toHaveBeenCalledTimes(1))
  })
})
