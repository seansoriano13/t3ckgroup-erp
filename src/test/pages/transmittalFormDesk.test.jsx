import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";

import TransmittalForm from "@/components/transmittals/TransmittalForm";
import { renderWithProviders, setupUser } from "@/test/support";

const service = vi.hoisted(() => ({ pickablePoLines: vi.fn(), create: vi.fn(), submit: vi.fn() }));
vi.mock("@/services/transmittalService", () => ({ transmittalService: service }));
vi.mock("@/services/ipasService", () => ({ ipasService: { listOptions: vi.fn().mockResolvedValue([]) } }));
vi.mock("@/services/companyService", () => ({
  companyService: { getCompanies: vi.fn().mockResolvedValue([{ name: "T3CK Trading" }]) },
}));

const pick = (id, name) => ({
  ipasId: "i1",
  ipasNumber: "TGIPAS_049",
  poNumber: "P02552",
  odooPoLineId: id,
  productName: name,
  quantity: 4,
  unit: "pcs",
  entity: "T3ck Trading",
  sors: [{ id: "s1", sales_reference: "SOR-1" }],
});

/** The Transmittal form's two panes (#252): live P0 lines on the left, the slip on the right. */
describe("Transmittal form, P0 lines beside the slip", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    service.pickablePoLines.mockResolvedValue([pick(1, "Cutter"), pick(2, "Blade")]);
  });

  it("puts a clicked P0 line on the slip, fills Company and Project from it, and takes it off on a second click", async () => {
    const user = setupUser();
    renderWithProviders(<TransmittalForm />);

    await user.click(await screen.findByRole("button", { name: /Cutter/ }));

    expect(screen.getByText("On the slip · 1")).toBeInTheDocument();
    // Quantity and unit come from the PO; the one project is already chosen.
    expect(screen.getByLabelText("Quantity")).toHaveValue(4);
    expect(screen.getByRole("button", { name: "SOR-1", pressed: true })).toBeInTheDocument();
    // Company follows the PO.
    expect(screen.getByText(/t3ck trading/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Cutter/, pressed: true }));
    expect(screen.queryByText("On the slip · 1")).not.toBeInTheDocument();
  });

  it("adds every line of a PO at once when its number is typed", async () => {
    const user = setupUser();
    renderWithProviders(<TransmittalForm />);

    await user.type(await screen.findByLabelText("Find a P0 line"), "P02552");
    await user.click(await screen.findByRole("button", { name: /Add all 2 lines of P02552/ }));

    expect(screen.getByText("On the slip · 2")).toBeInTheDocument();
  });

  it("adds what was typed as a typed line when nothing on a PO matches", async () => {
    const user = setupUser();
    service.pickablePoLines.mockResolvedValue([]);
    renderWithProviders(<TransmittalForm />);

    await user.type(await screen.findByLabelText("Find a P0 line"), "Spare cable");
    await user.click(await screen.findByRole("button", { name: /Add “Spare cable” as a typed line/ }));

    await waitFor(() => expect(screen.getByLabelText("Description")).toHaveValue("Spare cable"));
  });

  it("lists everything still missing for Submit, not only the first", async () => {
    renderWithProviders(<TransmittalForm />);

    const strip = await screen.findByRole("status");
    expect(strip).toHaveTextContent("things left before Submit");
    expect(strip).toHaveTextContent("Add at least one line");
    expect(strip).toHaveTextContent("Pick an origin");
    expect(strip).toHaveTextContent("Pick a priority");
  });
});
