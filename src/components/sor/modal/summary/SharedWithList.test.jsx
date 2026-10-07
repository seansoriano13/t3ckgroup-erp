/**
 * #477 — the SOR lists who it has been shared with by Mention.
 */
import { describe, it, expect } from "vitest"
import { screen } from "@testing-library/react"
import { renderWithProviders } from "../../../../test/support"
import { stubRpc } from "../../../../test/msw/server"
import { waitForNetworkIdle } from "../../../../test/network"
import { SharedWithList } from "./DigestSummary"

describe("SharedWithList", () => {
  it("lists each person with the Stage, who mentioned them, and whether it is open", async () => {
    stubRpc("sor_mention_shares", () => [
      { id: "m1", employee_name: "Raquel Buyer", granted_by_name: "Sean", stage_name: "Costing", is_open: true },
      { id: "m2", employee_name: "Jo Tech", granted_by_name: "Raquel Buyer", stage_name: "Lead", is_open: false },
    ])
    renderWithProviders(<SharedWithList opportunityId="opp-1" />)

    expect(await screen.findByText("Shared with")).toBeInTheDocument()
    const rows = screen.getAllByRole("listitem").map((li) => li.textContent)
    expect(rows[0]).toBe("Raquel Buyerat Costing · by SeanOpen")
    expect(rows[1]).toBe("Jo Techat Lead · by Raquel BuyerEnded")
  })

  it("renders nothing when the SOR is shared with no one", async () => {
    stubRpc("sor_mention_shares", () => [])
    renderWithProviders(<SharedWithList opportunityId="opp-1" />)
    await waitForNetworkIdle()
    expect(screen.queryByText("Shared with")).not.toBeInTheDocument()
  })
})
