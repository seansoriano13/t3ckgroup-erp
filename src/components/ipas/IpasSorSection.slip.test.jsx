import { describe, expect, it, vi } from "vitest"
import { screen } from "@testing-library/react"

import { renderWithProviders } from "@/test/support"
import IpasSorSection from "./IpasSorSection"

vi.mock("../../context/AuthContext", () => ({ useAuth: () => ({ user: { id: "emp-1" } }) }))

const base = {
  id: "ipas-1",
  number: "TGIPAS_052",
  poNumber: "P05123",
  supplier: "Scorpe Technologies",
  purpose: "project",
  state: "open",
  buyerTrack: [],
  trackDone: 0,
  trackTotal: 0,
  computationLabel: "Encoded",
  landedCost: null,
  owner: "check_by",
  daysWaiting: 2,
  late: false,
  nextList: null,
  signoffs: [
    { section: 1, name: "Purchasing", steps: [{ role: "approved", label: "Approved", done: true }] },
    { section: 3, name: "Purchasing & Finance", steps: [{ role: "approved", label: "Approved", done: false }] },
    { section: 6, name: "Computation status & Landed Cost", steps: [{ role: "approved", label: "Approved", done: false }] },
    { section: 7, name: "Filing", steps: [{ role: "approved", label: "Filed", done: false }] },
  ],
}

let summaries = []
vi.mock("./useIpasSorSummaries", () => ({ useIpasSorSummaries: () => ({ data: summaries }) }))

describe("IpasSorSection (#584)", () => {
  it("opens the slip when the row names a Transmittal, like the Dashboard", () => {
    summaries = [{ ...base, nextThing: "TG03-0012 needs Check by", nextSlip: { id: "slip-9", number: "TG03-0012" } }]
    const open = vi.spyOn(window, "open").mockImplementation(() => null)
    renderWithProviders(<IpasSorSection opportunityId="sor-1" />)

    screen.getByRole("button", { name: /TG03-0012 needs Check by/ }).click()

    expect(open).toHaveBeenCalledWith("/purchasing/transmittals/slip-9", "_blank", "noopener")
  })

  it("leaves a row with no Transmittal as plain text", () => {
    summaries = [{ ...base, nextThing: "With P.O.P — no payment carries proof", nextSlip: null }]
    renderWithProviders(<IpasSorSection opportunityId="sor-1" />)

    expect(screen.queryByRole("button", { name: /With P.O.P/ })).toBeNull()
    expect(screen.getByTestId("ipas-next-thing")).toHaveTextContent("With P.O.P")
  })

  it("numbers the sign-off sections as the screens do, not by their stored number", () => {
    summaries = [{ ...base, nextThing: null, nextSlip: null }]
    renderWithProviders(<IpasSorSection opportunityId="sor-1" />)

    expect(screen.getByText("Section 1 · Purchasing")).toBeInTheDocument()
    expect(screen.getByText("Section 2 · Purchasing & Finance")).toBeInTheDocument()
    expect(screen.getByText("Section 3 · Computation status & Landed Cost")).toBeInTheDocument()
    expect(screen.getByText("Section 4 · Filing")).toBeInTheDocument()
  })
})
