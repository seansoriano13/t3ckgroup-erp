/**
 * #477 — the SOR lists who it has been shared with by Mention.
 */
import { describe, it, expect } from "vitest"
import { screen } from "@testing-library/react"
import { renderWithProviders } from "../../../../test/support"
import { SharedWithList } from "./DigestSummary"

describe("SharedWithList", () => {
  it("lists each person with the Stage, who mentioned them, and whether it is open", () => {
    const shares = [
      { id: "m1", employee_name: "Raquel Buyer", granted_by_name: "Sean", stage_name: "Costing", is_open: true },
      { id: "m2", employee_name: "Jo Tech", granted_by_name: "Raquel Buyer", stage_name: "Lead", is_open: false },
    ]
    renderWithProviders(<SharedWithList shares={shares} />)

    expect(screen.getByText("Shared with")).toBeInTheDocument()
    const rows = screen.getAllByRole("listitem").map((li) => li.textContent)
    expect(rows[0]).toBe("Raquel Buyerat Costing · by SeanOpen")
    expect(rows[1]).toBe("Jo Techat Lead · by Raquel BuyerEnded")
  })

  it("renders nothing when the SOR is shared with no one", () => {
    renderWithProviders(<SharedWithList shares={[]} />)
    expect(screen.queryByText("Shared with")).not.toBeInTheDocument()
  })
})
