/**
 * #626: the Venues section of Settings is for HR and Super Admins only, and a switched-off
 * Venue leaves the request form's list while Settings still shows it.
 */
import { screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import SettingsPage from "@/pages/settings/index";
import { meetingRequestService } from "@/services/meetingRequestService";
import { renderWithProviders } from "@/test/support";
import { makeEmployee, makeHrEmployee, makeSuperAdmin } from "@/test/factories";
import { insertRow } from "@/test/db/store";

const mocks = vi.hoisted(() => ({ user: null }));
vi.mock("@/context/AuthContext", () => ({
  useAuth: () => ({ user: mocks.user, isAuthLoading: false, logout: vi.fn() }),
}));

const renderSettings = () =>
  renderWithProviders(
    <MemoryRouter initialEntries={["/settings?tab=venues"]}>
      <SettingsPage />
    </MemoryRouter>,
  );

describe("Venues in Settings", () => {
  beforeEach(() => {
    insertRow("calendar_venues", { name: "Conference Room", active: true, sort_order: 1 });
    insertRow("calendar_venues", { name: "Old Annex", active: false, sort_order: 2 });
  });

  it.each([
    ["HR", makeHrEmployee],
    ["Super Admin", makeSuperAdmin],
  ])("shows the section to %s", async (_name, make) => {
    mocks.user = make({ name: "Boss" });
    renderSettings();
    expect(await screen.findByRole("tab", { name: "Venues" })).toBeInTheDocument();
    expect(await screen.findByDisplayValue("Old Annex")).toBeInTheDocument();
  });

  it("hides the section from an ordinary employee", async () => {
    mocks.user = makeEmployee({ name: "Ana" });
    renderSettings();
    expect(await screen.findByText("App preferences")).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Venues" })).not.toBeInTheDocument();
  });

  it("offers only open Venues to the request form, but lists the closed one for Settings", async () => {
    expect((await meetingRequestService.listVenues()).map((v) => v.name)).toEqual(["Conference Room"]);
    expect((await meetingRequestService.listVenues({ includeInactive: true })).map((v) => v.name)).toEqual(["Conference Room", "Old Annex"]);
  });
});
