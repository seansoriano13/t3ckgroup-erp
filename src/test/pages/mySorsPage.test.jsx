import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import MySorsPage from "@/pages/my-sors/index";
import { renderWithProviders } from "@/test/support";
import {
  makeEmployee,
  makeFlowStage,
  makeOpportunity,
  makeSaleType,
  makeSalesFlow,
  makeStageParticipant,
  makeStageVisit,
} from "@/test/factories";
import { stubRpc } from "@/test/msw/server";

/**
 * My SORs — the screen that exists because the SORS register structurally
 * cannot list an SOR someone was called into (ADR 0021: `sor_read` is Super
 * Admin, Deal Team or Always-sees, with no participant clause).
 *
 * Asserted through what the person reads on the page, never through the
 * service's shape: the value here is that a called-in employee can find the
 * SOR and see why they can see it.
 */
const mockUser = vi.hoisted(() => ({ current: null }));

vi.mock("@/context/AuthContext", () => ({
  useAuth: () => ({ user: mockUser.current, isAuthLoading: false }),
}));

function renderPage() {
  return renderWithProviders(
    <MemoryRouter initialEntries={["/my-sors"]}>
      <MySorsPage />
    </MemoryRouter>,
  );
}

describe("My SORs", () => {
  let me, technical, bid, deal;

  beforeEach(() => {
    me = makeEmployee({ name: "Techie Tina" });
    mockUser.current = { id: me.id, name: me.name };

    const saleType = makeSaleType({ name: "Government" });
    const flow = makeSalesFlow({ sale_type_id: saleType.id });
    technical = makeFlowStage({ flow_id: flow.id, name: "Technical Review" });
    bid = makeFlowStage({ flow_id: flow.id, name: "Bid Submitted" });
    deal = makeOpportunity({ sale_type_id: saleType.id });

    stubRpc("sor_locked_summary", () => [
      {
        sales_reference: "S01234",
        project_title: "Supply of Equipment",
        current_stage_name: "Bid Submitted",
        is_restricted: false,
      },
    ]);
  });

  it("tells someone who was never called in that there is nothing, without an error", async () => {
    renderPage();

    expect(
      await screen.findByText(/Nobody has called you into an SOR yet/i),
    ).toBeInTheDocument();
  });

  it("lists an SOR the person was called into, and says why they can see it", async () => {
    const visit = makeStageVisit({ opportunity_id: deal.id, flow_stage_id: technical.id, sequence: 1 });
    makeStageParticipant({
      opportunity_id: deal.id,
      employee_id: me.id,
      opened_visit_id: visit.id,
      source: "action",
      until_rule: "stage_left",
    });

    renderPage();

    expect(await screen.findByText("S01234")).toBeInTheDocument();
    expect(screen.getByText("Supply of Equipment")).toBeInTheDocument();
    // The Stage that pulled them in, not the Stage the SOR is on now.
    expect(screen.getByText(/Called in at/)).toBeInTheDocument();
    expect(screen.getByText("Technical Review")).toBeInTheDocument();
    // The reach, in the Flow Canvas's own words.
    expect(screen.getByText(/this Stage only/)).toBeInTheDocument();
  });

  it("names the later Stage a longer window reaches through", async () => {
    const visit = makeStageVisit({ opportunity_id: deal.id, flow_stage_id: technical.id, sequence: 1 });
    makeStageParticipant({
      opportunity_id: deal.id,
      employee_id: me.id,
      opened_visit_id: visit.id,
      until_rule: "later_stage_left",
      until_stage_id: bid.id,
    });

    renderPage();

    expect(await screen.findByText(/through Bid Submitted/)).toBeInTheDocument();
  });

  it("keeps a closed window listed, under its own heading", async () => {
    const visit = makeStageVisit({ opportunity_id: deal.id, flow_stage_id: technical.id, sequence: 1 });
    makeStageParticipant({
      opportunity_id: deal.id,
      employee_id: me.id,
      opened_visit_id: visit.id,
      closed_at: new Date().toISOString(),
    });

    renderPage();

    // The SOR someone worked last month is what they come here looking for.
    expect(await screen.findByText("S01234")).toBeInTheDocument();
    expect(screen.getByText(/^Closed —/)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText(/^Open — 0/)).toBeInTheDocument());
  });

  it("opens a row through the one shared entry path, not a modal of its own", async () => {
    // GlobalDetailManager fetches via getOpportunityForModal, which branches on
    // access level; rendering OpportunityDetailsModal here with only an id
    // would give a Participant an empty modal (the failure 5409ca8 fixed one
    // layer down). Asserting the event is asserting they get a real record.
    const visit = makeStageVisit({ opportunity_id: deal.id, flow_stage_id: technical.id, sequence: 1 });
    makeStageParticipant({ opportunity_id: deal.id, employee_id: me.id, opened_visit_id: visit.id });
    const dispatch = vi.spyOn(window, "dispatchEvent");

    renderPage();
    const user = userEvent.setup();
    await user.click(await screen.findByText("S01234"));

    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "OPEN_ENTITY_DETAILS",
        detail: { id: deal.id, type: "OPPORTUNITY_QUICK_VIEW" },
      }),
    );
    dispatch.mockRestore();
  });

  it("shows one row for an SOR that called the same person in twice", async () => {
    const first = makeStageVisit({ opportunity_id: deal.id, flow_stage_id: technical.id, sequence: 1 });
    const second = makeStageVisit({ opportunity_id: deal.id, flow_stage_id: bid.id, sequence: 2 });
    makeStageParticipant({ opportunity_id: deal.id, employee_id: me.id, opened_visit_id: first.id, source: "action" });
    makeStageParticipant({ opportunity_id: deal.id, employee_id: me.id, opened_visit_id: second.id, source: "assignment" });

    renderPage();

    expect(await screen.findAllByText("S01234")).toHaveLength(1);
    // Two call-ins stay two lines: "why can I see this" has two answers.
    expect(screen.getAllByText(/Called in at/)).toHaveLength(2);
  });
});
