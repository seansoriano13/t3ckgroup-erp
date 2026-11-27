/**
 * Section 7's checklist after spec #1284: section 5 lost its "Filing item" tags and "Required files" box, but
 * the checklist still lists the same filing documents, ticked as section 5 has them.
 */
import { describe, expect, it } from "vitest"
import { screen, within } from "@testing-library/react"
import { renderWithProviders } from "@/test/support"
import { IpasFilingSection } from "./IpasFiling"
import { IpasDocuments } from "./IpasDocuments"

const doc = (id, label, over = {}) => ({
  id,
  label,
  kind_id: `k-${id}`,
  byHand: false,
  appliesTo: "both",
  usedFor: "filing",
  isFiling: true,
  purchasingHas: false,
  financeHas: false,
  attachmentUrl: null,
  files: [],
  hasFile: false,
  ...over,
})

const ipas = {
  id: "ipas-1",
  state: "open",
  source: "local",
  computationStatus: "lc_odoo_done",
  signoffSections: { 7: { status: "waiting", history: [] } },
  documents: [
    doc("a", "BIR 2307", { purchasingHas: true }),
    doc("b", "Others"),
    doc("c", "Sales Contract", { usedFor: "documentation", isFiling: false }),
  ],
}

describe("section 7's checklist", () => {
  it("lists the same filing documents as section 5, ticked as section 5 has them", () => {
    renderWithProviders(<IpasFilingSection ipas={ipas} rights={{}} />)

    const items = screen.getAllByTestId("ipas-filing-item")
    const names = items.map((item) => item.textContent)
    expect(names.some((text) => text.includes("BIR 2307"))).toBe(true)
    expect(names.some((text) => text.includes("Others"))).toBe(true)
    expect(names.some((text) => text.includes("Sales Contract"))).toBe(false)
    expect(items.find((item) => item.textContent.includes("BIR 2307"))).toHaveAttribute("data-ticked", "true")
    expect(items.find((item) => item.textContent.includes("Others"))).toHaveAttribute("data-ticked", "false")
  })

  it("keeps listing them while section 5 shows no filing tag", () => {
    renderWithProviders(<IpasDocuments ipas={ipas} />)

    const section = screen.getByTestId("ipas-documents")
    expect(within(section).getAllByTestId("ipas-document-row")).toHaveLength(3)
    expect(within(section).queryByText(/Filing item/i)).not.toBeInTheDocument()
  })
})
