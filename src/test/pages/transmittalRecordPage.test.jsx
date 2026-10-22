import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";

import TransmittalDetailPage from "@/pages/purchasing/transmittals/[id]";
import { confirmMove, renderWithProviders, setupUser } from "@/test/support";
import { shapeTransmittal } from "@/utils/transmittals";

const mockUser = vi.hoisted(() => ({ current: null }));
const service = vi.hoisted(() => ({
  get: vi.fn(),
  myStaffLists: vi.fn(),
  stageListMembers: vi.fn(),
  list: vi.fn(),
  submit: vi.fn(),
  checkBy: vi.fn(),
  cancel: vi.fn(),
  undoSignature: vi.fn(),
}));

vi.mock("@/context/AuthContext", () => ({
  useAuth: () => ({ user: mockUser.current, isAuthLoading: false }),
}));
vi.mock("@/services/transmittalService", () => ({ transmittalService: service }));
vi.mock("../../services/transmittalService", () => ({ transmittalService: service }));

/**
 * The Transmittal record page (#538): numbers strip, a row per section, the
 * "Your move" card, and signing only in the card or the drawer's bottom bar.
 */

const ME = { id: "u-me", name: "Maria Check", employee_type: "staff" };
const PREPARER = "u-prep";

function raw(over = {}) {
  return {
    id: "t1",
    number: "TG03_0007",
    prepared_on: "2026-10-01",
    prepared_by: PREPARER,
    preparer: { name: "Pat Prep" },
    origin: "purchasing",
    check_warehouse: true,
    check_technical: false,
    priority: "high",
    entity: "T3CK Trading",
    state: "awaiting_check",
    created_at: "2026-10-01T00:00:00Z",
    products: [],
    references: [],
    lines: [
      { id: "l1", position: 1, kind: "typed", description: "Cutter", quantity: 2, wh_rating: "gc" },
      { id: "l2", position: 2, kind: "typed", description: "Blade", quantity: 1, wh_rating: "na", wh_remark: "bent" },
    ],
    stages: [
      {
        id: "s1",
        stage: "warehouse_checking",
        completed_at: "2026-10-02T01:00:00Z",
        first_signer: { name: "Ann" },
        first_signer_id: PREPARER,
        second_signer_name: "Bob",
      },
    ],
    ...over,
  };
}

function renderPage(id = "t1", search = "") {
  return renderWithProviders(
    <MemoryRouter initialEntries={[`/purchasing/transmittals/${id}${search}`]}>
      <Routes>
        <Route path="/purchasing/transmittals/:id" element={<TransmittalDetailPage />} />
        <Route path="/purchasing/transmittals" element={<p>The Transmittal list</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

/** Stubs the wide breakpoint (xl) on: jsdom reports no match, which collapses the card's moves. */
function stubWide() {
  window.matchMedia = vi.fn().mockImplementation((query) => ({
    matches: true,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
}

describe("Transmittal record page", () => {
  const originalMatchMedia = window.matchMedia;

  afterEach(() => {
    // Keep the stub when there was none: a late re-render still asks for it.
    if (originalMatchMedia) window.matchMedia = originalMatchMedia;
  });

  beforeEach(() => {
    stubWide();
    vi.clearAllMocks();
    mockUser.current = ME;
    service.get.mockResolvedValue(shapeTransmittal(raw()));
    service.myStaffLists.mockResolvedValue(["transmittal_check_by"]);
    service.stageListMembers.mockResolvedValue([]);
    service.list.mockResolvedValue([]);
    service.checkBy.mockResolvedValue({ number: "TG03_0007" });
  });

  it("tells a viewer who is not on the Check by list who the slip waits on", async () => {
    service.myStaffLists.mockResolvedValue([]);
    renderPage();

    expect(await screen.findByRole("heading", { name: "Your move" })).toBeInTheDocument();
    expect(await screen.findByText("Next: Check by, waiting on the Check by list")).toBeInTheDocument();
    expect(screen.queryByText(/^Waiting for you/)).not.toBeInTheDocument();
  });

  it("shows the slip's lines on the desk and a step in the rail for each stage", async () => {
    renderPage();

    expect(await screen.findByRole("heading", { name: "Your move" })).toBeInTheDocument();
    expect(screen.getByText("Waiting for you: Check by")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /^Lines · / })).toBeInTheDocument();
    // One step per stage after the slip; the Checking boxes that were not ticked are hidden.
    for (const title of ["Warehouse checking", "Received in Odoo", "Check by"]) {
      expect(screen.getAllByRole("button", { name: new RegExp(`^${title}`) }).length).toBeGreaterThan(0);
    }
    expect(screen.queryByRole("button", { name: /^Technical inspection/ })).not.toBeInTheDocument();
  });

  it("signs Check by from the card, asking first", async () => {
    const user = setupUser();
    renderPage();

    await user.click(await screen.findByRole("button", { name: "Sign Check by (1)" }));
    await confirmMove(user, "Sign Check by (1)", "Sign");

    await waitFor(() => expect(service.checkBy).toHaveBeenCalledWith("t1", 1));
  });

  it("opens a step in the rail with its one sign button under it", async () => {
    const user = setupUser();
    renderPage();

    await user.click(await screen.findByRole("button", { name: /^Check by/ }));
    // The body names who signed; the one sign button for the slot is under it.
    const buttons = screen.getAllByRole("button", { name: "Sign Check by (1)" });
    expect(buttons).toHaveLength(1);

    await user.click(buttons[0]);
    await confirmMove(user, "Sign Check by (1)", "Sign");
    await waitFor(() => expect(service.checkBy).toHaveBeenCalledWith("t1", 1));
  });

  it("offers the slip's preparer no Check by sign buttons", async () => {
    mockUser.current = { id: PREPARER, name: "Pat Prep", employee_type: "staff" };
    renderPage();

    await screen.findByRole("heading", { name: "Your move" });
    expect(screen.queryByRole("button", { name: /^Sign Check by/ })).not.toBeInTheDocument();
  });

  it("asks before declining my signature, with the same dialog as Sign", async () => {
    const user = setupUser();
    service.get.mockResolvedValue(
      shapeTransmittal(
        raw({
          stages: [
            {
              id: "s1",
              stage: "warehouse_checking",
              completed_at: "2026-10-02T01:00:00Z",
              first_signer: { name: "Ann" },
              first_signer_id: PREPARER,
              second_signer: { name: "Maria Check" },
              second_signer_id: ME.id,
              second_confirmed: false,
            },
          ],
        }),
      ),
    );
    service.confirmSignature = vi.fn().mockResolvedValue({});
    renderPage();

    await user.click(await screen.findByRole("button", { name: "Decline my signature on Warehouse checking" }));
    expect(service.confirmSignature).not.toHaveBeenCalled();
    await confirmMove(user, "Decline my signature on Warehouse checking", "Decline");

    await waitFor(() => expect(service.confirmSignature).toHaveBeenCalledWith("s1", false));
  });

  it("undoes a Check by with a reason, asked in a dialog", async () => {
    const user = setupUser();
    service.get.mockResolvedValue(
      shapeTransmittal(
        raw({
          check_by_first_id: "u-me",
          check_by_first: { name: "Maria Check" },
          check_by_first_at: "2026-10-04T01:00:00Z",
        }),
      ),
    );
    service.undoSignature.mockResolvedValue({ number: "TG03_0007" });
    renderPage();

    await user.click(await screen.findByRole("button", { name: "Undo Check by (1)" }));
    const dialog = await screen.findByRole("dialog", { name: "Undo Check by (1)?" });
    const confirm = within(dialog).getByRole("button", { name: "Undo signature" });
    expect(confirm).toBeDisabled();
    await user.type(within(dialog).getByRole("textbox", { name: "Reason" }), "Wrong slip");
    await user.click(confirm);

    await waitFor(() =>
      expect(service.undoSignature).toHaveBeenCalledWith("t1", { kind: "check_by", stage: undefined, slot: 1, reason: "Wrong slip" }),
    );
  });

  it("moves Print and Cancel into a More menu, and keeps Edit on a draft", async () => {
    const user = setupUser();
    mockUser.current = { ...ME, id: PREPARER };
    service.get.mockResolvedValue(shapeTransmittal(raw({ state: "draft", stages: [] })));
    service.myStaffLists.mockResolvedValue([]);
    renderPage();

    expect(await screen.findByRole("button", { name: "Edit" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Print" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cancel" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "More" }));
    expect(await screen.findByRole("button", { name: "Cancel" })).toBeInTheDocument();
    // Submit is the card's move.
    expect(screen.getByRole("button", { name: "Submit" })).toBeInTheDocument();
  });
});
