import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";

import PackingListPageRoute from "@/pages/purchasing/packing-lists/[id]";
import { confirmMove, renderWithProviders, setupUser } from "@/test/support";

const mockUser = vi.hoisted(() => ({ current: null }));
const service = vi.hoisted(() => ({
  get: vi.fn(),
  pack: vi.fn(),
  sorProducts: vi.fn(),
}));

vi.mock("@/context/AuthContext", () => ({
  useAuth: () => ({ user: mockUser.current, isAuthLoading: false }),
}));
vi.mock("../../services/packingListService", async (importOriginal) => ({
  ...(await importOriginal()),
  packingListService: service,
}));

/**
 * The Packing List record page (#538): numbers strip, rows for Details, Boxes
 * and Packed by, and one move, Sign Packed by, from the card or the drawer.
 */

const ME = { id: "u-me", name: "Pat Packer", has_purchasing_flow: true };

function list(over = {}) {
  return {
    id: "pl1",
    number: "TG04_0003",
    state: "draft",
    sorId: "sor1",
    sorReference: "SOR-100",
    projectTitle: "Plant upgrade",
    odooDeliveryRef: "WH/OUT/0042",
    createdById: ME.id,
    creatorName: "Pat Packer",
    packerName: null,
    packedAt: null,
    boxes: [
      { id: "b1", boxNo: 1, marks: "M1", sealNo: null, grossWeightKg: 12.5, contents: [{ id: "c1", description: "Cutter", quantity: 2, unit: "pc" }] },
      { id: "b2", boxNo: 2, marks: null, sealNo: null, grossWeightKg: null, contents: [] },
    ],
    ...over,
  };
}

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

function renderPage(search = "") {
  return renderWithProviders(
    <MemoryRouter initialEntries={[`/purchasing/packing-lists/pl1${search}`]}>
      <Routes>
        <Route path="/purchasing/packing-lists/:id" element={<PackingListPageRoute />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("Packing List record page", () => {
  const originalMatchMedia = window.matchMedia;

  afterEach(() => {
    if (originalMatchMedia) window.matchMedia = originalMatchMedia;
  });

  beforeEach(() => {
    stubWide();
    vi.clearAllMocks();
    mockUser.current = ME;
    service.get.mockResolvedValue(list());
    service.pack.mockResolvedValue({});
    service.sorProducts.mockResolvedValue([]);
  });

  it("shows the boxes and weight, the Packed by step and the one move", async () => {
    renderPage();

    expect(await screen.findByRole("heading", { name: "Your move" })).toBeInTheDocument();
    expect(screen.getByText("Waiting for you: Packed by")).toBeInTheDocument();
    expect(screen.getByText("12.50 kg (1 of 2 weighed)")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Boxes · 2" })).toBeInTheDocument();
    expect(screen.getByText("Packed by")).toBeInTheDocument();
  });

  it("signs Packed by from the card, asking first", async () => {
    const user = setupUser();
    renderPage();

    await user.click(await screen.findByRole("button", { name: "Sign Packed by" }));
    await confirmMove(user, "Sign Packed by", "Sign Packed by");

    await waitFor(() => expect(service.pack).toHaveBeenCalledWith("pl1"));
  });

  it("offers the one sign button, once", async () => {
    renderPage();

    await screen.findByRole("heading", { name: "Your move" });
    expect(screen.getAllByRole("button", { name: "Sign Packed by" })).toHaveLength(1);
  });

  it("says nothing is left once the list is packed", async () => {
    service.get.mockResolvedValue(list({ state: "packed", packerName: "Pat Packer", packedAt: "2026-10-05T03:00:00Z" }));
    renderPage();

    expect(await screen.findByText("Packed. Nothing left to do.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Sign Packed by" })).not.toBeInTheDocument();
  });
});
