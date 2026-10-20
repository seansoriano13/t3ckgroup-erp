import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";

import TransmittalForm from "@/components/transmittals/TransmittalForm";
import { renderWithProviders, setupUser } from "@/test/support";

vi.mock("@/services/transmittalService", () => ({ transmittalService: {} }));
vi.mock("@/services/ipasService", () => ({ ipasService: { listOptions: vi.fn().mockResolvedValue([]) } }));
vi.mock("@/services/companyService", () => ({ companyService: { getCompanies: vi.fn().mockResolvedValue([]) } }));

const draft = (unit) => ({
  origin: "purchasing",
  checkWarehouse: true,
  checkTechnical: false,
  priority: "high",
  entity: "T3CK Trading",
  products: [],
  references: [],
  lines: [{ kind: "typed", description: "Cutter", unit, quantity: 2 }],
});

describe("Transmittal form Submit reason", () => {
  it("says why Submit is off when a typed line has no unit, and clears once it has one", async () => {
    const user = setupUser();
    renderWithProviders(<TransmittalForm existing={draft("")} />);
    expect(screen.getByRole("button", { name: /submit/i })).toBeDisabled();
    expect(screen.getByTestId("transmittal-submit-reason")).toHaveTextContent(/needs a unit/i);
    await user.type(screen.getByPlaceholderText("Unit"), "pcs");
    expect(screen.getByRole("button", { name: /submit/i })).toBeEnabled();
    expect(screen.queryByTestId("transmittal-submit-reason")).toBeNull();
  });
});
