import { screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import SettingsPage from "@/pages/settings/index";
import { renderWithProviders, setupUser } from "@/test/support";
import { makeEmployee, makeSuperAdmin } from "@/test/factories";
import { db } from "@/test/db/store";
import { stubIpasRpcs } from "@/test/stubs/ipasRpc";
import { ipasService } from "@/services/ipasService";

/**
 * The Compliance kinds tab of Settings > Purchasing (#1258, spec #1247): Purchasing access and Super
 * Admins add, rename, reorder and retire the kinds; other people who read the IPAS see the list
 * read-only and nothing else of Purchasing. The database refuses everyone else's write
 * (1251-ipas-compliance-requirements, 66-ipas-options-filed-guard).
 */

const mockUser = vi.hoisted(() => ({ current: null }));

vi.mock("@/context/AuthContext", () => ({
  useAuth: () => ({ user: mockUser.current, logout: vi.fn() }),
}));

const KINDS = ["DENR", "MARINA", "OMB", "NTC", "FDA"];

const seedKinds = () =>
  KINDS.map((label, index) => db.seed("ipas_options", { list: "compliance_kind", label, sort: (index + 1) * 10, active: true }));

const rowLabels = () => screen.getAllByTestId("ipas-option-row").map((row) => row.querySelector("span")?.textContent);

describe("Settings > Purchasing > Compliance kinds, with Purchasing access", () => {
  beforeEach(() => {
    const buyer = makeEmployee({ name: "Buyer", has_purchasing_flow: true });
    mockUser.current = buyer;
    stubIpasRpcs({ actorId: buyer.id });
    seedKinds();
  });

  it("lists the five kinds in order, with the add form and the controls", async () => {
    const user = setupUser();
    renderWithProviders(
      <MemoryRouter initialEntries={["/settings?tab=purchasing"]}>
        <SettingsPage />
      </MemoryRouter>,
    );
    await user.click(await screen.findByRole("tab", { name: "Compliance kinds" }));

    await waitFor(() => expect(rowLabels()).toEqual(KINDS));
    expect(screen.getByLabelText("New compliance kind")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Rename DENR" })).toBeEnabled();
    expect(screen.getByRole("switch", { name: "FDA is offered" })).toBeEnabled();
    expect(screen.queryByTestId("ipas-option-readonly-note")).not.toBeInTheDocument();
  });

  it("adds a kind at the end of the list", async () => {
    const user = setupUser();
    renderWithProviders(
      <MemoryRouter initialEntries={["/settings?tab=purchasing"]}>
        <SettingsPage />
      </MemoryRouter>,
    );
    await user.click(await screen.findByRole("tab", { name: "Compliance kinds" }));
    await user.type(await screen.findByLabelText("New compliance kind"), "BFAR");
    await user.click(screen.getByRole("button", { name: "Add" }));

    await waitFor(async () => expect((await ipasService.complianceKinds()).map((k) => k.label)).toContain("BFAR"));
  });

  it("retires a kind, which leaves the picker's list but stays on the settings list", async () => {
    const user = setupUser();
    renderWithProviders(
      <MemoryRouter initialEntries={["/settings?tab=purchasing"]}>
        <SettingsPage />
      </MemoryRouter>,
    );
    await user.click(await screen.findByRole("tab", { name: "Compliance kinds" }));
    await user.click(await screen.findByRole("switch", { name: "NTC is offered" }));

    await waitFor(async () => expect((await ipasService.complianceKinds()).map((k) => k.label)).toEqual(["DENR", "MARINA", "OMB", "FDA"]));
    await waitFor(() => expect(screen.getByText("Deactivated")).toBeInTheDocument());
    expect(rowLabels()).toContain("NTC");
  });

  it("moves a kind up", async () => {
    const user = setupUser();
    renderWithProviders(
      <MemoryRouter initialEntries={["/settings?tab=purchasing"]}>
        <SettingsPage />
      </MemoryRouter>,
    );
    await user.click(await screen.findByRole("tab", { name: "Compliance kinds" }));
    await user.click(await screen.findByRole("button", { name: "Move MARINA up" }));

    await waitFor(async () => expect((await ipasService.complianceKinds()).map((k) => k.label).slice(0, 2)).toEqual(["MARINA", "DENR"]));
  });

  it("renames a kind", async () => {
    const user = setupUser();
    renderWithProviders(
      <MemoryRouter initialEntries={["/settings?tab=purchasing"]}>
        <SettingsPage />
      </MemoryRouter>,
    );
    await user.click(await screen.findByRole("tab", { name: "Compliance kinds" }));
    await user.click(await screen.findByRole("button", { name: "Rename FDA" }));
    const dialog = await screen.findByRole("dialog");
    const field = within(dialog).getByLabelText("Name");
    await user.clear(field);
    await user.type(field, "FDA Philippines");
    await user.click(within(dialog).getByRole("button", { name: "Rename" }));

    await waitFor(async () => expect((await ipasService.complianceKinds()).map((k) => k.label)).toContain("FDA Philippines"));
  });
});

describe("Settings > Purchasing > Compliance kinds, with Super Admin", () => {
  it("is editable too", async () => {
    const admin = makeSuperAdmin({ name: "Root Access" });
    mockUser.current = admin;
    stubIpasRpcs({ actorId: admin.id, purchasing: false, superAdmin: true });
    seedKinds();
    const user = setupUser();
    renderWithProviders(
      <MemoryRouter initialEntries={["/settings?tab=purchasing"]}>
        <SettingsPage />
      </MemoryRouter>,
    );
    await user.click(await screen.findByRole("tab", { name: "Compliance kinds" }));

    expect(await screen.findByLabelText("New compliance kind")).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "DENR is offered" })).toBeEnabled();
  });
});

describe("Settings > Purchasing > Compliance kinds, read-only", () => {
  beforeEach(() => {
    seedKinds();
  });

  it("shows a Finance person the list with no add form and no controls, and no other Purchasing tab", async () => {
    const finance = makeEmployee({ name: "Finance Fiona", has_finance_flow: true });
    mockUser.current = finance;
    stubIpasRpcs({ actorId: finance.id, purchasing: false, money: true });
    renderWithProviders(
      <MemoryRouter initialEntries={["/settings?tab=purchasing"]}>
        <SettingsPage />
      </MemoryRouter>,
    );

    await waitFor(() => expect(rowLabels()).toEqual(KINDS));
    expect(screen.getByTestId("ipas-option-readonly-note")).toBeInTheDocument();
    expect(screen.queryByLabelText("New compliance kind")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Rename / })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Move / })).not.toBeInTheDocument();
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
    // Nothing else of Purchasing settings is offered.
    for (const name of ["Payment methods", "Document kinds", "IPAS number", "Ageing rules", "Reference rates", "Sign-off lists"]) {
      expect(screen.queryByRole("tab", { name, hidden: true })).not.toBeInTheDocument();
    }
    expect(screen.getByRole("tab", { name: "Purchasing", hidden: true })).toBeInTheDocument();
  });

  it("shows a retired kind as deactivated in the read-only list", async () => {
    db.seed("ipas_options", { list: "compliance_kind", label: "Old Permit", sort: 60, active: false });
    const logistics = makeEmployee({ name: "Logi", has_logistics_flow: true });
    mockUser.current = logistics;
    stubIpasRpcs({ actorId: logistics.id, purchasing: false, logistics: true });
    renderWithProviders(
      <MemoryRouter initialEntries={["/settings?tab=purchasing"]}>
        <SettingsPage />
      </MemoryRouter>,
    );

    await waitFor(() => expect(rowLabels()).toContain("Old Permit"));
    expect(screen.getByText("Deactivated")).toBeInTheDocument();
  });

  it("offers someone who can't read the IPAS no Purchasing tab at all", async () => {
    mockUser.current = makeEmployee({ name: "Plain Pat" });
    renderWithProviders(
      <MemoryRouter initialEntries={["/settings?tab=purchasing"]}>
        <SettingsPage />
      </MemoryRouter>,
    );

    await screen.findByText("App preferences");
    expect(screen.queryByRole("tab", { name: "Purchasing", hidden: true })).not.toBeInTheDocument();
  });
});
