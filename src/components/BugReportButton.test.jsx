import { beforeEach, describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import toast from "react-hot-toast"
import { setupUser } from "@/test/support"
import { stubRpc } from "@/test/msw/server"
import { storageObjects } from "@/test/msw/storage"
import BugReportButton from "./BugReportButton"

const mockUser = vi.hoisted(() => ({ current: { id: "emp-1", name: "Ana" } }))
vi.mock("@/context/AuthContext", () => ({ useAuth: () => ({ user: mockUser.current }) }))
vi.mock("browser-image-compression", () => ({ default: async (file) => file }))

/**
 * The floating "Report a bug" button on every page: one text box plus files,
 * sent straight to the Bug Reports list. The sender gets a "Sent" toast and
 * nothing more.
 */
describe("BugReportButton", () => {
  let sent

  beforeEach(() => {
    sent = null
    stubRpc("submit_bug_report", (args) => {
      sent = args
      return "bug-1"
    })
    vi.spyOn(toast, "success").mockImplementation(() => "toast-id")
    vi.spyOn(toast, "error").mockImplementation(() => "toast-id")
    globalThis.URL.createObjectURL = vi.fn(() => "blob:preview")
    globalThis.URL.revokeObjectURL = vi.fn()
    window.history.replaceState(null, "", "/tasks?record=9")
  })

  async function open() {
    const user = setupUser()
    render(<BugReportButton />)
    await user.click(screen.getByRole("button", { name: "Report a bug" }))
    return user
  }

  it("does not send an empty report", async () => {
    await open()
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled()
  })

  it("sends the text with the page it was sent from, then closes", async () => {
    const user = await open()

    await user.type(screen.getByPlaceholderText(/what went wrong/i), "Save does nothing{Enter}on the task form")
    await user.click(screen.getByRole("button", { name: "Send" }))

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Bug report sent. Thank you!"))
    expect(sent.p_description).toBe("Save does nothing\non the task form")
    expect(sent.p_page_url).toBe("/tasks?record=9")
    expect(sent.p_attachments).toEqual([])
    expect(screen.queryByPlaceholderText(/what went wrong/i)).not.toBeInTheDocument()
  })

  it("uploads a pasted screenshot and sends it as an attachment", async () => {
    const user = await open()
    const textbox = screen.getByPlaceholderText(/what went wrong/i)
    const shot = new File(["png"], "image.png", { type: "image/png" })

    fireEvent.paste(textbox, {
      clipboardData: { items: [{ kind: "file", getAsFile: () => shot }] },
    })
    await user.type(textbox, "See screenshot")
    await user.click(screen.getByRole("button", { name: "Send" }))

    await waitFor(() => expect(sent).not.toBeNull())
    expect(sent.p_attachments).toHaveLength(1)
    expect(sent.p_attachments[0]).toMatchObject({ name: "image.png", type: "image/png" })
    expect(storageObjects.has(`bug-reports/${sent.p_attachments[0].path}`)).toBe(true)
  })

  it("keeps the text when sending fails", async () => {
    stubRpc("submit_bug_report", () => {
      throw new Error("Describe the bug before sending.")
    })
    const user = await open()

    await user.type(screen.getByPlaceholderText(/what went wrong/i), "Broken")
    await user.click(screen.getByRole("button", { name: "Send" }))

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Describe the bug before sending."))
    expect(screen.getByPlaceholderText(/what went wrong/i)).toHaveValue("Broken")
  })
})
