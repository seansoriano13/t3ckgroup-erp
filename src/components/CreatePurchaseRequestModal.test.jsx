/**
 * Create Purchase Request from Canvasses (ADR 0034). A Canvass is not signed off (#728), so there is no
 * "not signed off" warning. Once the request is created the lists are refreshed and the caller told;
 * the Purchase Request list used to go stale until a reload.
 */
import { describe, expect, it, vi } from "vitest"
import { screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { createTestQueryClient, renderWithProviders } from "@/test/support"
import { procurementQueueKey } from "./purchase-request/queryKeys"
import CreatePurchaseRequestModal from "./CreatePurchaseRequestModal"
import { canvassService } from "../services/canvassService"

vi.mock("../services/canvassService", () => ({ canvassService: { createPurchaseRequest: vi.fn() } }))

describe("Create Purchase Request", () => {
  it("finishes the create, refreshes the lists and tells the caller", async () => {
    const made = { requestId: "pr-1", items: [], unsignedCanvassIds: [] }
    canvassService.createPurchaseRequest.mockResolvedValue(made)
    const onCreated = vi.fn()
    const client = createTestQueryClient()
    const invalidate = vi.spyOn(client, "invalidateQueries")
    const canvasses = [{ id: "c1", number: "CNV_0001", winner: { id: "o1" } }]

    renderWithProviders(<CreatePurchaseRequestModal open onOpenChange={() => {}} canvasses={canvasses} onCreated={onCreated} />, { client })
    await userEvent.type(screen.getByLabelText("Purchase Request title"), "Stretchers")
    await userEvent.click(screen.getByRole("button", { name: "Create request" }))

    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(made))
    expect(invalidate).toHaveBeenCalledWith({ queryKey: procurementQueueKey })
  })
})
