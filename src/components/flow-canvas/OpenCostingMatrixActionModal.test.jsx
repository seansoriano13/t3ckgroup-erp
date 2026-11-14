import { screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import OpenCostingMatrixActionModal from "./OpenCostingMatrixActionModal";
import { renderWithProviders, setupUser } from "@/test/support";
import { db } from "@/test/db/store";
import { makeEmployee } from "@/test/factories";

describe("OpenCostingMatrixActionModal", () => {
  it("saves the defaults as an empty-handed config: Deal Owner as Sales in-charge, nobody named, nobody told", async () => {
    const user = setupUser();
    const onSubmit = vi.fn();
    renderWithProviders(<OpenCostingMatrixActionModal isOpen onClose={() => {}} onSubmit={onSubmit} />);

    expect(screen.getByRole("combobox", { name: "Sales in-charge" })).toHaveTextContent("Deal Owner (default)");
    expect(screen.getByRole("combobox", { name: "Purchasing in-charge" })).toHaveTextContent("Not named");
    expect(screen.getByText("Who assigns it")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(onSubmit).toHaveBeenCalledWith({
      salesIncharge: undefined,
      purchasingIncharge: undefined,
      assigners: [],
      markupPresetId: undefined,
      extras: [],
      confirmMode: undefined,
      decider: undefined,
    });
  });

  it("reads a saved config back, and hides 'Who assigns it' once a Purchasing in-charge is named", () => {
    const buyer = makeEmployee({ name: "Rey Santos" });
    const preset = db.seed("costing_markup_presets", { label: "Government", factor: 1.35, sort: 0, active: true });
    renderWithProviders(
      <OpenCostingMatrixActionModal
        isOpen
        onClose={() => {}}
        onSubmit={() => {}}
        initialData={{
          salesIncharge: { type: "role", role: "closing_sales" },
          purchasingIncharge: { type: "employee", id: buyer.id },
          markupPresetId: preset.id,
        }}
      />,
    );

    expect(screen.getByRole("combobox", { name: "Sales in-charge" })).toHaveTextContent("Closing Sales");
    expect(screen.getByRole("combobox", { name: "Purchasing in-charge" })).toHaveTextContent("A person");
    expect(screen.queryByText("Who assigns it")).not.toBeInTheDocument();
  });

  it("will not save a Purchasing in-charge 'A person' with nobody chosen", () => {
    renderWithProviders(
      <OpenCostingMatrixActionModal
        isOpen
        onClose={() => {}}
        onSubmit={() => {}}
        initialData={{ purchasingIncharge: { type: "employee", id: null } }}
      />,
    );

    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("lists the active markup presets the reader can see", async () => {
    const user = setupUser();
    db.seed("costing_markup_presets", { label: "Government", factor: 1.35, sort: 0, active: true });
    db.seed("costing_markup_presets", { label: "Retired", factor: 1.1, sort: 1, active: false });
    renderWithProviders(<OpenCostingMatrixActionModal isOpen onClose={() => {}} onSubmit={() => {}} />);

    await user.click(screen.getByRole("combobox", { name: "Markup preset" }));

    expect(await screen.findByRole("option", { name: "Government · ×1.35" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /Retired/ })).not.toBeInTheDocument();
  });

  // Issue #900 — a Purchasing in-charge is one person, so the picker offers no second one once a person is chosen.
  it("offers no second Purchasing in-charge once one is chosen, and offers the choice again after removal", async () => {
    const user = setupUser();
    const buyer = makeEmployee({ name: "Rey Santos" });
    renderWithProviders(
      <OpenCostingMatrixActionModal
        isOpen
        onClose={() => {}}
        onSubmit={() => {}}
        initialData={{ purchasingIncharge: { type: "employee", id: buyer.id } }}
      />,
    );

    expect(await screen.findByText("Rey Santos")).toBeInTheDocument();
    expect(screen.queryByText("Choose the Purchasing in-charge")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Remove Rey Santos" }));

    expect(await screen.findByText("Choose the Purchasing in-charge")).toBeInTheDocument();
  });
});
