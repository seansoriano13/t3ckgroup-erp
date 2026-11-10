/** #739: My SORs paints each Stage badge in that Stage's own colour. */
import { describe, it, expect } from "vitest"
import { screen } from "@testing-library/react"
import { renderWithProviders } from "../../test/support"
import MySorsTable from "./MySorsTable"

const row = (id, stage, color) => ({
  opportunityId: id,
  salesReference: id,
  projectTitle: "Job",
  currentStageName: stage,
  currentStageColor: color,
  isOpen: true,
  windows: [],
})

describe("MySorsTable stage colour", () => {
  it("uses the Stage's colour and falls back to neutral when it has none", () => {
    renderWithProviders(
      <MySorsTable
        rows={[row("S1", "Bid Submitted", "tomato"), row("S2", "Quotation", null)]}
        onOpen={() => {}}
      />,
    )
    expect(screen.getByText("Bid Submitted").className).toMatch(/text-tomato-11/)
    expect(screen.getByText("Quotation").className).not.toMatch(/text-blue-11/)
    expect(screen.getByText("Quotation").className).toMatch(/text-muted-foreground/)
  })
})
