import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
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
import { db } from "@/test/db/store";

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
    expect(screen.getByRole("columnheader", { name: "Called in at" })).toBeInTheDocument();
    expect(screen.getByText("Technical Review")).toBeInTheDocument();
    expect(screen.getByText("Bid Submitted")).toBeInTheDocument();
    expect(screen.getByText("Task")).toBeInTheDocument();
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

  it("keeps an ended window listed behind the Access filter, tagged Access ended (#478)", async () => {
    const visit = makeStageVisit({ opportunity_id: deal.id, flow_stage_id: technical.id, sequence: 1 });
    makeStageParticipant({
      opportunity_id: deal.id,
      employee_id: me.id,
      opened_visit_id: visit.id,
      closed_at: new Date().toISOString(),
    });

    renderPage();
    const user = userEvent.setup();

    // Hidden by default, but never silently: the empty state says how many ended.
    expect(await screen.findByText("No open access right now")).toBeInTheDocument();
    expect(screen.getByText(/1 SOR where your access has ended/)).toBeInTheDocument();

    await user.click(screen.getByText("Current access"));
    await user.click(await screen.findByRole("button", { name: "Access ended" }));

    // The SOR someone worked last month is what they come here looking for.
    expect(await screen.findByText("S01234")).toBeInTheDocument();
    expect(screen.getByText("Access ended", { selector: "td span" })).toBeInTheDocument();
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

  it("shows one row for an SOR that called the same person in twice, with a +N chip", async () => {
    const first = makeStageVisit({ opportunity_id: deal.id, flow_stage_id: technical.id, sequence: 1 });
    const second = makeStageVisit({ opportunity_id: deal.id, flow_stage_id: bid.id, sequence: 2 });
    makeStageParticipant({ opportunity_id: deal.id, employee_id: me.id, opened_visit_id: first.id, source: "action" });
    makeStageParticipant({ opportunity_id: deal.id, employee_id: me.id, opened_visit_id: second.id, source: "assignment" });

    renderPage();

    expect(await screen.findAllByText("S01234")).toHaveLength(1);
    expect(screen.getAllByRole("row")).toHaveLength(2); // header + one SOR
    // Two call-ins stay two answers: one on the row, the other behind the chip.
    expect(screen.getByLabelText("1 more windows")).toHaveTextContent("+1");
  });

  it("shows — when there is no Sales Reference", async () => {
    stubRpc("sor_locked_summary", () => [
      { sales_reference: null, project_title: "Unreferenced job", current_stage_name: "Bid Submitted", is_restricted: false },
    ]);
    const visit = makeStageVisit({ opportunity_id: deal.id, flow_stage_id: technical.id, sequence: 1 });
    makeStageParticipant({ opportunity_id: deal.id, employee_id: me.id, opened_visit_id: visit.id });

    renderPage();

    expect(await screen.findByText("Unreferenced job")).toBeInTheDocument();
    const cell = screen.getByText("Unreferenced job").closest("td");
    expect(cell).toHaveTextContent("—");
  });

  it("lists a Mention Window with who mentioned them and on which Stage (#478)", async () => {
    const visit = makeStageVisit({ opportunity_id: deal.id, flow_stage_id: technical.id, sequence: 1 });
    const sender = makeEmployee({ name: "Sean Sender" });
    db.seed("sor_mention_viewers", [
      { opportunity_id: deal.id, employee_id: me.id, granted_by: sender.id, stage_visit_id: visit.id },
    ]);

    renderPage();

    expect(await screen.findByText("S01234")).toBeInTheDocument();
    expect(screen.getByText("Mention")).toBeInTheDocument();
    expect(screen.getByText(/by Sean Sender/)).toBeInTheDocument();
    expect(screen.getByText("Technical Review")).toBeInTheDocument();
  });

  it("lists an SOR I am on the Deal Team of as Deal Team with Full access, and filters by it (#478)", async () => {
    stubRpc("sor_my_deal_team_sor_ids", () => [deal.id]);
    stubRpc("sor_my_sors_facets", () => [
      { opportunity_id: deal.id, sor_code: "SOR-1", sale_type_name: "Government", last_activity_at: "2026-10-06T02:00:00Z" },
    ]);

    renderPage();
    const user = userEvent.setup();

    expect(await screen.findByText("S01234")).toBeInTheDocument();
    const row = screen.getByText("S01234").closest("tr");
    expect(row).toHaveTextContent("Deal Team");
    expect(row).toHaveTextContent(/Sees the whole SOR \(Full access\)/);

    // Access: Full keeps it; Why I'm here: Mentioned drops it.
    await user.click(screen.getByText("Current access"));
    await user.click(await screen.findByRole("button", { name: "Full" }));
    expect(screen.getByText("S01234")).toBeInTheDocument();

    await user.click(screen.getByText("Any reason"));
    await user.click(await screen.findByRole("button", { name: "Mentioned" }));
    expect(screen.queryByText("S01234")).toBeNull();
  });

  it("searches Sales Reference and project", async () => {
    const visit = makeStageVisit({ opportunity_id: deal.id, flow_stage_id: technical.id, sequence: 1 });
    makeStageParticipant({ opportunity_id: deal.id, employee_id: me.id, opened_visit_id: visit.id });

    renderPage();
    const user = userEvent.setup();
    await screen.findByText("S01234");
    const box = screen.getByRole("textbox", { name: "Search reference, SOR code or project" });

    await user.type(box, "equipment");
    expect(screen.getByText("S01234")).toBeInTheDocument();

    await user.clear(box);
    await user.type(box, "s0123");
    expect(screen.getByText("S01234")).toBeInTheDocument();

    await user.clear(box);
    await user.type(box, "zzz");
    expect(screen.queryByText("S01234")).toBeNull();
    expect(screen.getByText(/No SOR matches these filters/)).toBeInTheDocument();
  });
});
