import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";

import TransmittalCheckByPage from "@/pages/approvals/transmittals";
import NewTransmittalPage from "@/pages/purchasing/transmittals/new";
import PackingListsPage from "@/pages/purchasing/packing-lists";
import { renderWithProviders, setupUser } from "@/test/support";

const mockUser = vi.hoisted(() => ({ current: null }));
const transmittals = vi.hoisted(() => ({
  list: vi.fn(),
  canPrepare: vi.fn(),
  myStaffLists: vi.fn(),
  pickablePoLines: vi.fn(),
  create: vi.fn(),
  submit: vi.fn(),
}));
const packingLists = vi.hoisted(() => ({ list: vi.fn(), create: vi.fn() }));

vi.mock("@/context/AuthContext", () => ({
  useAuth: () => ({ user: mockUser.current, isAuthLoading: false }),
}));
vi.mock("@/services/transmittalService", () => ({ transmittalService: transmittals }));
vi.mock("../../services/transmittalService", () => ({ transmittalService: transmittals }));
vi.mock("@/services/packingListService", () => ({ packingListService: packingLists }));
vi.mock("../../services/packingListService", () => ({ packingListService: packingLists }));
vi.mock("@/services/ipasService", () => ({ ipasService: { listOptions: vi.fn().mockResolvedValue([]) } }));
vi.mock("@/services/companyService", () => ({
  companyService: { getCompanies: vi.fn().mockResolvedValue([{ name: "T3CK Trading" }]) },
}));

/**
 * Spec #1123, ticket #1130: the Transmittal Check by queue says who it is for instead of sending
 * people to the Dashboard, and Esc on Raise a Transmittal and New Packing List asks before it
 * throws away what was entered.
 */

const BUYER = { id: "u-buy", name: "Bea Buyer", has_purchasing_flow: true, employee_type: "staff" };

describe("Transmittal Check by, for someone not on the list (B5)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUser.current = BUYER;
    transmittals.myStaffLists.mockResolvedValue([]);
    transmittals.list.mockResolvedValue([]);
  });

  it("names the Check by list and offers no Dashboard redirect", async () => {
    renderWithProviders(
      <MemoryRouter initialEntries={["/approvals/transmittals"]}>
        <Routes>
          <Route path="/approvals/transmittals" element={<TransmittalCheckByPage />} />
          <Route path="/approvals" element={<p>The Approval Center</p>} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText("You don't have access to this page")).toBeInTheDocument();
    expect(screen.getByText(/needs a place on the Transmittal Check by list/)).toBeInTheDocument();
    expect(screen.queryByText("The Approval Center")).not.toBeInTheDocument();
    expect(transmittals.list).not.toHaveBeenCalled();
  });
});

describe("Esc asks before it throws away a raise form (B4)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUser.current = BUYER;
    transmittals.canPrepare.mockResolvedValue(true);
    transmittals.myStaffLists.mockResolvedValue([]);
    transmittals.list.mockResolvedValue([]);
    transmittals.pickablePoLines.mockResolvedValue([
      {
        ipasId: "i1",
        ipasNumber: "TGIPAS_049",
        poNumber: "P02552",
        odooPoLineId: 1,
        productName: "Cutter",
        quantity: 4,
        left: 4,
        unit: "pcs",
        entity: "T3ck Trading",
        sors: [],
      },
    ]);
    packingLists.list.mockResolvedValue([]);
  });

  it("asks 'Discard this Transmittal?' on Esc once a field was changed, and not before", async () => {
    const user = setupUser();
    renderWithProviders(
      <MemoryRouter initialEntries={["/purchasing/transmittals/new"]}>
        <Routes>
          <Route path="/purchasing/transmittals/new" element={<NewTransmittalPage />} />
          <Route path="/purchasing/transmittals" element={<p>The Transmittal list</p>} />
        </Routes>
      </MemoryRouter>,
    );

    await screen.findByText("Pick the lines, set the slip, then Submit to open its first stage.");
    await user.click(await screen.findByRole("button", { name: /Cutter/ }));
    expect(screen.getByText("On the slip · 1")).toBeInTheDocument();
    await user.keyboard("{Escape}");

    expect(await screen.findByText("Discard this Transmittal?")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Keep editing" }));
    expect(screen.getByText("On the slip · 1")).toBeInTheDocument();
  });

  it("asks 'Discard this Packing List?' on Esc once the delivery reference is typed", async () => {
    const user = setupUser();
    renderWithProviders(
      <MemoryRouter initialEntries={["/purchasing/packing-lists"]}>
        <Routes>
          <Route path="/purchasing/packing-lists" element={<PackingListsPage />} />
        </Routes>
      </MemoryRouter>,
    );

    await user.click(await screen.findByRole("button", { name: "New Packing List" }));
    await user.type(await screen.findByPlaceholderText("e.g. TG En/OUT/03390"), "TG En/OUT/00001");
    await user.keyboard("{Escape}");

    expect(await screen.findByText("Discard this Packing List?")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Keep editing" }));
    expect(screen.getByPlaceholderText("e.g. TG En/OUT/03390")).toHaveValue("TG En/OUT/00001");
  });
});
