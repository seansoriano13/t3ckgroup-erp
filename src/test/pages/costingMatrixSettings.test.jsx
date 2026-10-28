import { screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi, beforeEach } from "vitest";

import SettingsPage from "@/pages/settings/index";
import { renderWithProviders, setupUser } from "@/test/support";
import { makeEmployee, makeSuperAdmin } from "@/test/factories";
import { db } from "@/test/db/store";
import { stubRpc } from "@/test/msw/server";

/**
 * The Costing Matrix tab of Settings (#269), whose markup presets section this file covers (the Rates and the Final Acquire list are #270's, in costingSettings.test.jsx): the markup presets the Final Acquire list picks a
 * matrix's default factor from. Super Admins and that list edit them; Purchasing access opens the tab and is
 * told why it has nothing to edit; the Final Acquire list opens Settings with this tab alone, even without
 * Purchasing access. The database decides who may write (policy 80).
 */

const mockUser = vi.hoisted(() => ({ current: null }));

vi.mock("@/context/AuthContext", () => ({
  useAuth: () => ({ user: mockUser.current, logout: vi.fn() }),
}));

const renderAt = (url) =>
  renderWithProviders(
    <MemoryRouter initialEntries={[url]}>
      <SettingsPage />
    </MemoryRouter>,
  );

const tabNames = () => screen.getAllByRole("tab", { hidden: true }).map((t) => t.textContent);

const seedPresets = () => {
  db.seed("costing_markup_presets", { label: "Government", factor: 1.35, sort: 1, active: true });
  db.seed("costing_markup_presets", { label: "Private", factor: 2.4, sort: 2, active: true });
  db.seed("costing_markup_presets", { label: "Old", factor: 3, sort: 3, active: false });
};

describe("S0 Evaluation settings", () => {
  beforeEach(() => {
    mockUser.current = null;
    vi.restoreAllMocks();
  });

  it("gives a Super Admin the S0 Evaluation tab, with the presets in order and their factor as x and +%", async () => {
    seedPresets();
    stubRpc("costing_can_manage_markup", true);
    mockUser.current = makeSuperAdmin({ name: "Root Access" });
    renderAt("/settings?tab=costing");

        const section = await screen.findByTestId("markup-presets");
    const rows = await within(section).findAllByTestId("markup-preset-row");
    expect(rows).toHaveLength(3);
    expect(within(rows[0]).getByLabelText("Government: name")).toHaveValue("Government");
    expect(within(rows[0]).getByLabelText("Government: factor")).toHaveValue(1.35);
    expect(within(rows[0]).getByText("×1.35 · +35%")).toBeInTheDocument();
    expect(within(rows[1]).getByText("×2.40 · +140%")).toBeInTheDocument();
    expect(within(rows[2]).getByText("Switched off")).toBeInTheDocument();
    expect(within(rows[2]).getByLabelText("Old is offered")).not.toBeChecked();
  });

  it("adds a preset, changes its factor, and switches one off instead of deleting it", async () => {
    seedPresets();
    stubRpc("costing_can_manage_markup", true);
    mockUser.current = makeSuperAdmin({ name: "Root Access" });
    const user = setupUser();
    renderAt("/settings?tab=costing");

        const section = await screen.findByTestId("markup-presets");
    await within(section).findAllByTestId("markup-preset-row");

    await user.type(within(section).getByLabelText("New markup preset name"), "Tender");
    await user.type(within(section).getByLabelText("New markup preset factor"), "2.0644");
    await user.click(within(section).getByRole("button", { name: "Add" }));
    await waitFor(() => expect(db.rows("costing_markup_presets").map((p) => [p.label, p.factor, p.sort])).toContainEqual(["Tender", 2.0644, 4]));
    expect(await within(section).findByText("×2.0644 · +106.44%")).toBeInTheDocument();

    const factor = within(section).getByLabelText("Government: factor");
    await user.clear(factor);
    await user.type(factor, "1.4");
    await user.tab();
    await waitFor(() => expect(db.rows("costing_markup_presets").find((p) => p.label === "Government").factor).toBe(1.4));

    await user.click(within(section).getByLabelText("Private is offered"));
    await waitFor(() => expect(db.rows("costing_markup_presets").find((p) => p.label === "Private").active).toBe(false));
    // Nothing offers a delete.
    expect(within(section).queryByRole("button", { name: /delete|remove/i })).not.toBeInTheDocument();
    expect(db.rows("costing_markup_presets")).toHaveLength(4);
  });

  it("moves a preset up, numbering the list in its new order", async () => {
    seedPresets();
    stubRpc("costing_can_manage_markup", true);
    mockUser.current = makeSuperAdmin({ name: "Root Access" });
    const user = setupUser();
    renderAt("/settings?tab=costing");

        const section = await screen.findByTestId("markup-presets");
    await within(section).findAllByTestId("markup-preset-row");

    await user.click(within(section).getByRole("button", { name: "Move Private up" }));
    await waitFor(() => expect(db.rows("costing_markup_presets").map((p) => [p.label, p.sort]).sort((a, b) => a[1] - b[1])).toEqual([["Private", 1], ["Government", 2], ["Old", 3]]));
    await waitFor(() => expect(within(within(section).getAllByTestId("markup-preset-row")[0]).queryByLabelText("Private: name")).toBeInTheDocument());
  });

  it("tells someone the database keeps the presets from that they are not theirs, with nothing to edit", async () => {
    seedPresets();
    stubRpc("costing_can_manage_markup", false);
    mockUser.current = makeEmployee({ name: "Buyer", has_purchasing_flow: true });
    renderAt("/settings?tab=costing");

        expect(await screen.findByTestId("markup-presets-closed")).toHaveTextContent("Only Super Admins, Purchasing, the Deal Team and the Final Acquire list");
    expect(screen.queryByLabelText("New markup preset name")).not.toBeInTheDocument();
    expect(screen.queryByTestId("markup-preset-row")).not.toBeInTheDocument();
  });

  it("opens Settings for the Final Acquire list without Purchasing access, with the S0 Evaluation alone", async () => {
    seedPresets();
    stubRpc("costing_can_manage_markup", true);
    mockUser.current = makeEmployee({ name: "Final Acquire", has_purchasing_flow: false });
    renderAt("/settings?tab=costing");

    const section = await screen.findByTestId("markup-presets");
    expect(await within(section).findAllByTestId("markup-preset-row")).toHaveLength(3);
    expect(tabNames()).toEqual(["General", "S0 Evaluation"]);
    // The Purchasing tab and its IPAS lists are not theirs, and neither are the rates or the Final Acquire list.
    expect(screen.queryByRole("tab", { name: "Purchasing", hidden: true })).not.toBeInTheDocument();
    expect(screen.queryByTestId("costing-rates")).not.toBeInTheDocument();
    expect(screen.queryByTestId("costing-signer-list-final_acquire")).not.toBeInTheDocument();
  });

  it("shows a plain employee no Purchasing tab", async () => {
    stubRpc("costing_can_manage_markup", false);
    mockUser.current = makeEmployee({ name: "Rank And File" });
    renderAt("/settings?tab=costing");

    await screen.findByText("App preferences");
    await waitFor(() => expect(tabNames()).toEqual(["General"]));
    expect(screen.queryByTestId("markup-presets")).not.toBeInTheDocument();
  });
});
