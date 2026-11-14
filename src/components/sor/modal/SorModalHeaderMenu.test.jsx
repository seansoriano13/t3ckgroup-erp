import { describe, it, expect, vi, beforeEach } from "vitest"
import { screen } from "@testing-library/react"
import toast, { Toaster } from "react-hot-toast"

import { renderWithProviders, setupUser } from "../../../test/support"
import SorModalHeader from "./SorModalHeader"

vi.mock("../../../services/opportunityService", () => ({
  opportunityService: { markLost: vi.fn() },
}))

const baseProps = () => ({
  opportunity: { id: "opp-1", status: "LEAD", opportunity_no: "SOR-2026-0001", serial_no: 1 },
  isEditing: false,
  editForm: {},
  setEditForm: () => {},
  handleEditToggle: () => {},
  updateMutation: { isPending: false, mutate: vi.fn() },
  deleteMutation: { isPending: false, mutate: vi.fn() },
  onClose: () => {},
  isFlowDeal: false,
  pipelineStages: [
    { code: "LEAD", label: "Lead", sort_order: 10, is_active: true },
    { code: "LOST", label: "Lost", sort_order: 90, is_active: true, is_terminal: true, outcome: "lost" },
  ],
  stageMutation: { isPending: false, mutate: vi.fn() },
  handleStageChange: () => {},
  checklist: [],
  isOpen: true,
  canEdit: true,
})

const openMenu = async (user) => user.click(screen.getByRole("button", { name: "More actions" }))

describe("SOR window More-actions menu (#814)", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    toast.dismiss()
  })

  it("offers Mark as Lost next to Delete and opens the reason picker", async () => {
    const user = setupUser()
    renderWithProviders(<><Toaster /><SorModalHeader {...baseProps()} /></>)

    await openMenu(user)
    expect(screen.getByRole("menuitem", { name: /delete opportunity/i })).toBeInTheDocument()
    // Mark as Lost lives only in the menu now; the header no longer has its own button.
    expect(screen.getAllByRole("menuitem", { name: /^mark as lost$/i })).toHaveLength(1)
    await user.click(screen.getByRole("menuitem", { name: /^mark as lost$/i }))

    expect(await screen.findByRole("radiogroup", { name: "Reason" })).toBeInTheDocument()
  })

  it("the Delete confirm points to Mark as Lost, and Delete still deletes", async () => {
    const user = setupUser()
    const props = baseProps()
    renderWithProviders(<><Toaster /><SorModalHeader {...props} /></>)

    await openMenu(user)
    await user.click(screen.getByRole("menuitem", { name: /delete opportunity/i }))

    expect(
      await screen.findByText(/Client stopped responding\? Mark as Lost instead, so it shows in reports\./),
    ).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: /confirm deletion/i }))
    expect(props.deleteMutation.mutate).toHaveBeenCalled()
  })
})
