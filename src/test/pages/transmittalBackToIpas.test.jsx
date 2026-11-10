import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import toast, { Toaster } from "react-hot-toast";

import TransmittalForm from "@/components/transmittals/TransmittalForm";
import { renderWithProviders, setupUser } from "@/test/support";

const service = vi.hoisted(() => ({ pickablePoLines: vi.fn(), create: vi.fn(), submit: vi.fn() }));
vi.mock("@/services/transmittalService", () => ({ transmittalService: service }));
vi.mock("@/services/ipasService", () => ({ ipasService: { listOptions: vi.fn().mockResolvedValue([]) } }));
vi.mock("@/services/companyService", () => ({
  companyService: { getCompanies: vi.fn().mockResolvedValue([{ name: "T3CK Trading" }]) },
}));

/** #920: Back to TGIPAS_… after Submit, only when the form was opened from an IPAS. */
describe("Transmittal Submit, back to the IPAS", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    toast.remove();
    service.pickablePoLines.mockResolvedValue([
      { ipasId: "i1", ipasNumber: "TGIPAS_049", poNumber: "P02552", odooPoLineId: 1, productName: "Cutter", quantity: 4, unit: "pcs", entity: "T3ck Trading", sors: [] },
    ]);
    service.create.mockResolvedValue({ id: "t1", number: "TG03-1" });
    service.submit.mockResolvedValue({});
  });

  const open = async (url) => {
    const user = setupUser();
    const onSaved = vi.fn();
    renderWithProviders(
      <MemoryRouter initialEntries={[url]}>
        <Toaster />
        <TransmittalForm defaultOrigin="purchasing" onSaved={onSaved} />
      </MemoryRouter>,
    );
    await user.click(await screen.findByRole("button", { name: /Cutter/ }));
    // A P0 line ticks the checker; the slip still asks for a priority before Submit lights up.
    await user.click(screen.getByRole("button", { name: /Priority/ }));
    await user.click(await screen.findByText(/^High$/));
    return { user, onSaved };
  };

  it("offers the link and passes the IPAS on when opened from an IPAS", async () => {
    const { user, onSaved } = await open("/purchasing/transmittals/new?ipas=TGIPAS_049");
    await user.click(screen.getByRole("button", { name: /^submit$/i }));
    expect(await screen.findByRole("button", { name: "Back to TGIPAS_049" })).toBeInTheDocument();
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith("t1", { backToIpas: { id: "i1", number: "TGIPAS_049" } }));
  });

  it("offers nothing when it was not opened from an IPAS", async () => {
    const { user, onSaved } = await open("/purchasing/transmittals/new");
    await user.click(screen.getByRole("button", { name: /^submit$/i }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith("t1", { backToIpas: null }));
    expect(screen.queryByRole("button", { name: /Back to TGIPAS/ })).toBeNull();
  });
});
