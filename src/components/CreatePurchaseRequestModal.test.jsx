/**
 * Create Purchase Request from Canvasses (ADR 0034). The Canvass is not signed off, so the server
 * answers with `unsignedCanvassIds` and the modal shows a warning. That warning once called
 * `toast.warning`, which react-hot-toast does not have: the request was created, then the handler
 * threw before it refreshed the lists or told the caller. Even without the throw the Purchase
 * Request list was never refreshed, so the new request did not show on its tab until a reload.
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
  it("finishes the create, refreshes the lists and tells the caller, when a Canvass is not signed off", async () => {
    const made = { requestId: "pr-1", items: [], unsignedCanvassIds: ["c1"] }
    canvassService.createPurchaseRequest.mockResolvedValue(made)
    const onCreated = vi.fn()
    const client = createTestQueryClient()
    const invalidate = vi.spyOn(client, "invalidateQueries")
    const canvasses = [{ id: "c1", number: "CNV_0001", winner: { id: "o1" }, signedOffAt: null }]

    renderWithProviders(<CreatePurchaseRequestModal open onOpenChange={() => {}} canvasses={canvasses} onCreated={onCreated} />, { client })
    await userEvent.type(screen.getByLabelText("Purchase Request title"), "Stretchers")
    await userEvent.click(screen.getByRole("button", { name: "Create request" }))

    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(made))
    expect(invalidate).toHaveBeenCalledWith({ queryKey: procurementQueueKey })
  })
})
