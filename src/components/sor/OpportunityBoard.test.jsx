import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import OpportunityBoard from "./OpportunityBoard";
import { renderWithProviders } from "@/test/support";
import { makePipelineStage } from "@/test/factories";

const opportunity = (overrides = {}) => ({
  id: "opp-1",
  client_name: "Acme Corp",
  project_title: "CCTV Rollout",
  expected_value: 500000,
  status: "QUALIFIED",
  ...overrides,
});

describe("OpportunityBoard", () => {
  it("renders one column per configured stage", async () => {
    makePipelineStage({ code: "QUALIFIED", label: "Qualified", sort_order: 10 })
    makePipelineStage({ code: "NEGOTIATION", label: "Negotiation", sort_order: 20 })

    renderWithProviders(
      <OpportunityBoard opportunities={[opportunity()]} search="" onCardClick={() => {}} />,
    )

    expect(await screen.findByText("Qualified")).toBeInTheDocument()
    expect(screen.getByText("Negotiation")).toBeInTheDocument()
  })

  it("still shows an opportunity sitting in a stage that was since deactivated", async () => {
    makePipelineStage({ code: "QUALIFIED", label: "Qualified", sort_order: 10, is_active: true })
    makePipelineStage({ code: "RETIRED_STAGE", label: "Retired Stage", sort_order: 20, is_active: false })

    renderWithProviders(
      <OpportunityBoard
        opportunities={[opportunity({ id: "opp-2", status: "RETIRED_STAGE", client_name: "Legacy Co" })]}
        search=""
        onCardClick={() => {}}
      />,
    )

    // The column itself, and the card inside it, both have to survive
    // deactivation — a column with no opportunities is dropped elsewhere in
    // the board, so this is not the same as the column merely existing.
    expect(await screen.findByText("Retired Stage")).toBeInTheDocument()
    expect(screen.getByText("Legacy Co")).toBeInTheDocument()
  })

  it("drops a deactivated stage nothing occupies", async () => {
    makePipelineStage({ code: "QUALIFIED", label: "Qualified", sort_order: 10, is_active: true })
    makePipelineStage({ code: "RETIRED_STAGE", label: "Retired Stage", sort_order: 20, is_active: false })

    renderWithProviders(
      <OpportunityBoard opportunities={[opportunity()]} search="" onCardClick={() => {}} />,
    )

    await screen.findByText("Qualified")
    expect(screen.queryByText("Retired Stage")).not.toBeInTheDocument()
  })

  describe("the deadline countdown (ticket 7)", () => {
    const deadline = (overrides = {}) => ({
      requirement: { label: "Confirm receipt" },
      daysRemaining: 7,
      isBreached: false,
      isApproaching: false,
      ...overrides,
    })

    it("shows days left on a card whose Stage carries a deadline", async () => {
      makePipelineStage({ code: "QUALIFIED", label: "Qualified", sort_order: 10 })

      renderWithProviders(
        <OpportunityBoard
          opportunities={[opportunity()]}
          search=""
          deadlineStatuses={{ "opp-1": deadline({ daysRemaining: 7 }) }}
          onCardClick={() => {}}
        />,
      )

      expect(await screen.findByText("7d left")).toBeInTheDocument()
    })

    it("reads as overdue once the deadline has breached", async () => {
      makePipelineStage({ code: "QUALIFIED", label: "Qualified", sort_order: 10 })

      renderWithProviders(
        <OpportunityBoard
          opportunities={[opportunity()]}
          search=""
          deadlineStatuses={{ "opp-1": deadline({ daysRemaining: -2, isBreached: true }) }}
          onCardClick={() => {}}
        />,
      )

      expect(await screen.findByText("2d overdue")).toBeInTheDocument()
    })

    it("shows nothing for a deal whose Stage carries no deadline", async () => {
      makePipelineStage({ code: "QUALIFIED", label: "Qualified", sort_order: 10 })

      renderWithProviders(
        <OpportunityBoard opportunities={[opportunity()]} search="" onCardClick={() => {}} />,
      )

      await screen.findByText("Acme Corp")
      expect(screen.queryByText(/left|overdue/)).not.toBeInTheDocument()
    })
  })
})
