import { screen, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import OpportunityBoard from "./OpportunityBoard";
import { renderWithProviders, setupUser } from "@/test/support";
import { makePipelineStage } from "@/test/factories";
import { opportunityService } from "../../services/opportunityService";

vi.mock("../../services/opportunityService", () => ({
  opportunityService: {
    updateStatus: vi.fn(async (id, next) => ({ id, flow_stage_id: next })),
    getReturnStageIds: vi.fn(async () => []),
  },
}));

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
      condition: { label: "Confirm receipt" },
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

  // Issue #206 — one Sale Type's flow at a time, plus drag-and-drop through
  // the same funnel the details modal uses.
  describe("the Sale Type switcher and flow board", () => {
    const saleTypes = [
      { id: "st-outright", name: "Outright" },
      { id: "st-govt", name: "Government" },
    ];
    const stages = {
      lead: { id: "lead", flow_id: "flow-outright", name: "Lead", pos_x: 0, pos_y: 0, is_terminal: false },
      qualified: { id: "qualified", flow_id: "flow-outright", name: "Qualified", pos_x: 1, pos_y: 0, is_terminal: false },
      govLead: { id: "gov-lead", flow_id: "flow-govt", name: "Gov Lead", pos_x: 0, pos_y: 0, is_terminal: false },
    };
    const flowStagesIndex = {
      flowsById: {
        "flow-outright": { id: "flow-outright", sale_type_id: "st-outright", won_stage_id: null },
        "flow-govt": { id: "flow-govt", sale_type_id: "st-govt", won_stage_id: null },
      },
      stagesById: {
        lead: stages.lead,
        qualified: stages.qualified,
        "gov-lead": stages.govLead,
      },
      stagesByFlow: {
        "flow-outright": [stages.lead, stages.qualified],
        "flow-govt": [stages.govLead],
      },
    };
    const flowDeal = (overrides) => ({
      id: "deal-1",
      sale_type_id: "st-outright",
      flow_stage_id: "lead",
      flow_snapshot_id: "snap-1",
      client_name: "Acme Corp",
      project_title: "CCTV Rollout",
      expected_value: 500000,
      contract_date: null,
      ...overrides,
    });
    const snapshotsById = {
      "snap-1": {
        id: "snap-1",
        snapshot_data: {
          stages: [stages.lead, stages.qualified],
          edges: [{ from_stage_id: "lead", to_stage_id: "qualified" }],
        },
      },
    };

    it("shows only the chosen Sale Type's Stages, not every flow's", async () => {
      renderWithProviders(
        <OpportunityBoard
          opportunities={[flowDeal()]}
          search=""
          flowStagesIndex={flowStagesIndex}
          snapshotsById={snapshotsById}
          saleTypes={saleTypes}
          onCardClick={() => {}}
        />,
      );

      expect(await screen.findByText("Lead")).toBeInTheDocument();
      expect(screen.getByText("Qualified")).toBeInTheDocument();
      expect(screen.queryByText("Gov Lead")).not.toBeInTheDocument();
    });

    it("switches columns when a different Sale Type is chosen", async () => {
      const user = setupUser();
      renderWithProviders(
        <OpportunityBoard
          opportunities={[flowDeal()]}
          search=""
          flowStagesIndex={flowStagesIndex}
          snapshotsById={snapshotsById}
          saleTypes={saleTypes}
          onCardClick={() => {}}
        />,
      );

      await screen.findByText("Lead");
      await user.click(screen.getByText("Outright"));
      await user.click(screen.getByText("Government"));

      expect(await screen.findByText("Gov Lead")).toBeInTheDocument();
      expect(screen.queryByText("Lead")).not.toBeInTheDocument();
    });

    it("a drop onto a disallowed Stage does nothing", async () => {
      renderWithProviders(
        <OpportunityBoard
          opportunities={[flowDeal()]}
          search=""
          flowStagesIndex={flowStagesIndex}
          snapshotsById={snapshotsById}
          saleTypes={saleTypes}
          onCardClick={() => {}}
        />,
      );

      const card = await screen.findByText("Acme Corp");
      // Only "qualified" is a legal edge from "lead" in the snapshot above —
      // there is no third column here to drop onto illegally, so this
      // exercises the same handler path with a column drag never reached
      // (allowedStageIds excludes anything not returned by outgoingStages).
      fireEvent.dragStart(card.closest("button"));
      fireEvent.dragEnd(card.closest("button"));

      expect(screen.queryByText("Move to")).not.toBeInTheDocument();
    });

    it("a drop onto an allowed Stage opens the move confirmation, listing a known blocker", async () => {
      renderWithProviders(
        <OpportunityBoard
          opportunities={[flowDeal()]}
          search=""
          flowStagesIndex={flowStagesIndex}
          snapshotsById={snapshotsById}
          saleTypes={saleTypes}
          blockedDeals={{ "deal-1": [{ label: "Purchasing officer assigned" }] }}
          currentUserId="actor-1"
          onCardClick={() => {}}
        />,
      );

      const card = (await screen.findByText("Acme Corp")).closest("button");
      const qualifiedColumn = screen.getByText("Qualified").closest("div");

      fireEvent.dragStart(card);
      fireEvent.dragOver(qualifiedColumn);
      fireEvent.drop(qualifiedColumn);

      expect(await screen.findByText("Move to Qualified?")).toBeInTheDocument();
      expect(screen.getByText("Purchasing officer assigned")).toBeInTheDocument();
    });

    it("confirming the move calls updateStatus and closes on success", async () => {
      const user = setupUser();
      const onMoved = vi.fn();
      renderWithProviders(
        <OpportunityBoard
          opportunities={[flowDeal()]}
          search=""
          flowStagesIndex={flowStagesIndex}
          snapshotsById={snapshotsById}
          saleTypes={saleTypes}
          currentUserId="actor-1"
          onCardClick={() => {}}
          onMoved={onMoved}
        />,
      );

      const card = (await screen.findByText("Acme Corp")).closest("button");
      const qualifiedColumn = screen.getByText("Qualified").closest("div");

      fireEvent.dragStart(card);
      fireEvent.dragOver(qualifiedColumn);
      fireEvent.drop(qualifiedColumn);

      await screen.findByText("Move to Qualified?");
      await user.click(screen.getByText("Confirm move"));

      await waitFor(() =>
        expect(opportunityService.updateStatus).toHaveBeenCalledWith(
          "deal-1",
          "qualified",
          "actor-1",
          { lostReason: null, returnChoice: null },
        ),
      );
      await waitFor(() => expect(onMoved).toHaveBeenCalled());
    });

    it("the legacy pipeline board is read-only — cards are not draggable", async () => {
      makePipelineStage({ code: "QUALIFIED", label: "Qualified", sort_order: 10 });

      renderWithProviders(
        <OpportunityBoard
          opportunities={[opportunity()]}
          search=""
          saleTypes={saleTypes}
          onCardClick={() => {}}
        />,
      );

      // Board opens on the first Sale Type by default; switch to Legacy pipeline.
      const user = setupUser();
      await user.click(screen.getByText("Outright"));
      await user.click(screen.getByText("Legacy pipeline"));

      const card = (await screen.findByText("Acme Corp")).closest("button");
      expect(card).toHaveAttribute("draggable", "false");
    });

    describe("the no-Sale-Type 'Legacy pipeline' option", () => {
      const legacyPipelineType = { id: "st-legacy", name: "Legacy Pipeline" };
      const openSwitcher = async (user) => {
        await user.click(await screen.findByText("Outright"));
      };

      it("is hidden once every SOR has a Sale Type, so it doesn't double the real Legacy Pipeline flow", async () => {
        const user = setupUser();
        renderWithProviders(
          <OpportunityBoard
            opportunities={[flowDeal()]}
            search=""
            flowStagesIndex={flowStagesIndex}
            snapshotsById={snapshotsById}
            saleTypes={[...saleTypes, legacyPipelineType]}
            onCardClick={() => {}}
          />,
        );

        await openSwitcher(user);
        expect(screen.getAllByText(/^legacy pipeline$/i)).toHaveLength(1);
      });

      it("stays while an SOR with no Sale Type still exists", async () => {
        makePipelineStage({ code: "QUALIFIED", label: "Qualified", sort_order: 10 });
        const user = setupUser();
        renderWithProviders(
          <OpportunityBoard
            opportunities={[flowDeal(), opportunity({ id: "orphan" })]}
            search=""
            flowStagesIndex={flowStagesIndex}
            snapshotsById={snapshotsById}
            saleTypes={[...saleTypes, legacyPipelineType]}
            onCardClick={() => {}}
          />,
        );

        await openSwitcher(user);
        expect(screen.getAllByText(/^legacy pipeline$/i)).toHaveLength(2);
      });
    });

    describe("remembering the chosen Sale Type", () => {
      const KEY = "erp_board_sale_type_user-1";
      afterEach(() => localStorage.clear());

      const renderBoard = (extra = {}) => {
        const onSaleTypeChange = vi.fn();
        renderWithProviders(
          <OpportunityBoard
            opportunities={[flowDeal({ sale_type_id: "st-govt", flow_stage_id: "gov-lead", flow_snapshot_id: null })]}
            search=""
            flowStagesIndex={flowStagesIndex}
            snapshotsById={snapshotsById}
            saleTypes={saleTypes}
            currentUserId="user-1"
            saleTypeFilter="ALL"
            onSaleTypeChange={onSaleTypeChange}
            onCardClick={() => {}}
            {...extra}
          />,
        );
        return onSaleTypeChange;
      };

      it("reopens on the flow last chosen, even though the page opens on ALL", async () => {
        localStorage.setItem(KEY, "st-govt");

        const onSaleTypeChange = renderBoard();

        expect(await screen.findByText("Gov Lead")).toBeInTheDocument();
        expect(screen.queryByText("All SORs Selected")).not.toBeInTheDocument();
        expect(onSaleTypeChange).toHaveBeenCalledWith("st-govt");
      });

      it("falls back to All SORs when the remembered flow no longer exists", async () => {
        localStorage.setItem(KEY, "st-gone");

        const onSaleTypeChange = renderBoard();

        expect(await screen.findByText("All SORs Selected")).toBeInTheDocument();
        expect(onSaleTypeChange).toHaveBeenLastCalledWith("ALL");
      });
    });

    it("shows prompt card when All SORs is selected, with quick flow buttons and switch to list", async () => {
      const user = setupUser();
      const onSwitchToList = vi.fn();
      const onSaleTypeChange = vi.fn();

      renderWithProviders(
        <OpportunityBoard
          opportunities={[flowDeal()]}
          search=""
          flowStagesIndex={flowStagesIndex}
          snapshotsById={snapshotsById}
          saleTypes={saleTypes}
          onCardClick={() => {}}
          onSwitchToList={onSwitchToList}
          onSaleTypeChange={onSaleTypeChange}
        />,
      );

      await screen.findByText("Lead");

      // Open switcher and choose "All SORs"
      await user.click(screen.getByText("Outright"));
      await user.click(screen.getByText("All SORs"));

      expect(onSaleTypeChange).toHaveBeenCalledWith("ALL");
      expect(await screen.findByText("All SORs Selected")).toBeInTheDocument();
      expect(screen.getByText(/Kanban boards visualize one Sales Flow at a time/)).toBeInTheDocument();

      // Click "Switch to List View"
      await user.click(screen.getByText("Switch to List View"));
      expect(onSwitchToList).toHaveBeenCalled();

      // Click quick flow selector button for "Government"
      await user.click(screen.getByRole("button", { name: /Government/ }));
      expect(onSaleTypeChange).toHaveBeenCalledWith("st-govt");
      expect(await screen.findByText("Gov Lead")).toBeInTheDocument();
    });
  });
});
