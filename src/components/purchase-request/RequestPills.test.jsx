/**
 * The Purchase Request's pills (#640): Buyer, SOR, Stage and Items for a
 * Project request, Kind for a Direct one, and Take beside the Buyer pill.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import { screen, waitFor } from "@testing-library/react"
import { renderWithProviders, setupUser } from "@/test/support"
import { db } from "@/test/db/store"
import { makeEmployee, makeOpportunity } from "@/test/factories"
import { stubProcurementQueueRpcs } from "@/test/stubs/procurementQueueRpc"
import { purchaseRequestService } from "@/services/purchaseRequestService"
import RequestPills from "./RequestPills"

const auth = vi.hoisted(() => ({ user: null }))
vi.mock("@/context/AuthContext", () => ({ useAuth: () => ({ user: auth.user, isAuthLoading: false }) }))

let buyer

beforeEach(() => {
  buyer = makeEmployee({ name: "Pia Buyer", department: "OPERATIONS", has_purchasing_flow: true })
  auth.user = buyer
  stubProcurementQueueRpcs({ actorId: buyer.id })
})

describe("RequestPills", () => {
  it("shows Kind, not SOR, Stage and Items, for a Direct request", async () => {
    const direct = db.seed("purchase_requests", { opportunity_id: null, buyer_id: buyer.id, title: "Office chairs" })
    renderWithProviders(<RequestPills request={await purchaseRequestService.get(direct.id)} />)

    expect(screen.getByText("Kind")).toBeInTheDocument()
    expect(screen.getByText("Direct")).toBeInTheDocument()
    expect(screen.queryByText("SOR")).not.toBeInTheDocument()
    expect(screen.queryByText("Take")).not.toBeInTheDocument()
  })

  it("offers an outline Take beside the Buyer pill, and Take assigns the Buyer", async () => {
    const sor = makeOpportunity({ sales_reference: "S01001", project_title: "Harbour lights" })
    const open = db.seed("purchase_requests", { opportunity_id: sor.id, buyer_id: null })
    renderWithProviders(<RequestPills request={await purchaseRequestService.get(open.id)} />)

    expect(screen.getByText("Buyer")).toBeInTheDocument()
    expect(screen.getByText("No Buyer")).toBeInTheDocument()
    expect(screen.getByText("S01001")).toBeInTheDocument()
    const take = screen.getByRole("button", { name: "Take" })
    expect(take.className).toMatch(/border/)

    await setupUser().click(take)
    await waitFor(() => expect(db.rows("purchase_requests")[0].buyer_id).toBe(buyer.id))
  })
})
