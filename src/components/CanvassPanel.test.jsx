import { describe, expect, it, vi } from "vitest"
import { screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

import { renderWithProviders } from "../test/support"
import CanvassPanel from "./CanvassPanel"
import { projectEvaluationService } from "../services/projectEvaluationService"
import { makeEmployee, makeOpportunity } from "@/test/factories"

/**
 * Issue #47: marking a winner on an Inclusion's Canvass re-stamps that
 * Inclusion's cost server-side (covered in projectEvaluationService.test.js).
 * This asserts the other half — that the screen showing the Inclusion is told
 * to refetch, rather than sitting on the pre-win figure until something
 * unrelated happens to invalidate its own query.
 */
describe("CanvassPanel — winning an offer refreshes the Inclusion's cost", () => {
  it("invalidates the inclusions query, not just the canvass's own", async () => {
    const purchaser = makeEmployee({ has_purchasing_flow: true })
    const opportunity = makeOpportunity({ registered_by: purchaser.id })
    const inclusion = await projectEvaluationService.addInclusion(
      { opportunityId: opportunity.id, description: "Boom Lift 12m" },
      purchaser.id,
    )
    const canvass = await projectEvaluationService.getOrCreateCanvass(
      { inclusionId: inclusion.id },
      purchaser.id,
    )
    await projectEvaluationService.addOffer(canvass.id, { brand: "Genie", unitPrice: 850000 }, purchaser.id)

    const { client } = renderWithProviders(
      <CanvassPanel
        open
        onOpenChange={() => {}}
        subject={{ inclusionId: inclusion.id }}
        subjectLabel={inclusion.description}
        userId={purchaser.id}
        canEdit
      />,
    )
    const invalidateSpy = vi.spyOn(client, "invalidateQueries")

    await screen.findByText("Genie")
    await userEvent.click(screen.getByRole("button", { name: /mark genie the winner/i }))

    await waitFor(() =>
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["inclusions"] }),
    )
    // Issue #48: base cost and margin roll up from Inclusions, so this has to
    // refresh the Project Evaluation's own cache too.
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["projectEvaluation"] })
  })
})
