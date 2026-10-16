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

  it("shows the numbers, a row per section and who it waits on", async () => {
    renderPage();

    expect(await screen.findByRole("heading", { name: "Your move" })).toBeInTheDocument();
    expect(screen.getByText("Waiting for you: Check by")).toBeInTheDocument();
    // Numbers strip: lines, GC, NA, steps done.
    expect(screen.getByText("Steps done")).toBeInTheDocument();
    expect(screen.getByText("1 of 2")).toBeInTheDocument();
    // One row per section; the Checking boxes that were not ticked are hidden.
    for (const title of ["Details", "Lines", "Warehouse checking", "Received in Odoo", "Check by"]) {
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

  it("keeps the sign buttons out of a section's body, and signs from the drawer's bottom bar", async () => {
    const user = setupUser();
    renderPage("t1", "?open=check_by");

    const drawer = await screen.findByRole("dialog");
    expect(within(drawer).getByText("Check by (1)")).toBeInTheDocument();
    // The body names who signed; the one sign button for the slot is the drawer's bar.
    const buttons = within(drawer).getAllByRole("button", { name: "Sign Check by (1)" });
    expect(buttons).toHaveLength(1);

    await user.click(buttons[0]);
    await confirmMove(user, "Sign Check by (1)", "Sign");
    await waitFor(() => expect(service.checkBy).toHaveBeenCalledWith("t1", 1));
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
