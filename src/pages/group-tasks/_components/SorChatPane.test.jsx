import { screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi, beforeEach } from "vitest"
import { renderWithProviders } from "@/test/support"
import SorChatPane from "./SorChatPane"

const svc = vi.hoisted(() => ({
  getAccessLevel: vi.fn(),
  getNotesPage: vi.fn(),
  addNote: vi.fn(),
}))

vi.mock("@/context/AuthContext", () => ({ useAuth: () => ({ user: { id: "u1" } }) }))
vi.mock("@/lib/supabase", () => ({ supabase: {} }))
vi.mock("@/services/opportunityService", () => ({ opportunityService: svc }))
vi.mock("react-hot-toast", () => ({
  default: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}))

beforeEach(() => {
  vi.clearAllMocks()
  svc.getNotesPage.mockResolvedValue([])
  svc.addNote.mockResolvedValue({})
})

const renderPane = (props = {}) =>
  renderWithProviders(<SorChatPane opportunityId="sor-1" isOpen employees={[]} {...props} />)

describe("SorChatPane", () => {
  it("shows the SOR chat to a viewer who can read the SOR", async () => {
    svc.getAccessLevel.mockResolvedValue("participant")
    renderPane()
    expect(await screen.findByTestId("sor-chat-pane")).toBeInTheDocument()
  })

  it("shows nothing to a viewer who can't read the SOR", async () => {
    svc.getAccessLevel.mockResolvedValue("locked")
    renderPane()
    await waitFor(() => expect(svc.getAccessLevel).toHaveBeenCalled())
    expect(screen.queryByTestId("sor-chat-pane")).not.toBeInTheDocument()
  })

  it("shows nothing for a task with no SOR", () => {
    renderPane({ opportunityId: null })
    expect(screen.queryByTestId("sor-chat-pane")).not.toBeInTheDocument()
  })

  it("posting adds a note to the SOR", async () => {
    svc.getAccessLevel.mockResolvedValue("full")
    renderPane()
    const box = await screen.findByPlaceholderText(/add a note/i)
    await userEvent.type(box, "hello sor")
    await userEvent.click(screen.getByRole("button", { name: /send/i }))
    await waitFor(() =>
      expect(svc.addNote).toHaveBeenCalledWith("sor-1", "u1", "hello sor", [], []),
    )
  })
})
