import { screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import toast from "react-hot-toast";
import { http, HttpResponse } from "msw";
import { describe, expect, it, vi, beforeEach } from "vitest";
import SettingsPage from "@/pages/settings/index";
import { useAppSettings } from "@/hooks/useAppSettings";
import { db } from "@/test/db/store";
import { server } from "@/test/msw/server";
import { waitForNetworkIdle } from "@/test/network";
import { renderWithProviders, setupUser } from "@/test/support";
import { makeCategory, makeEmployee, makeSuperAdmin, makeTask } from "@/test/factories";
import { TASK_STATUS } from "@/constants/status.js";
import TaskApprovals from "@/pages/approvals/tasks/index";

const mockUser = vi.hoisted(() => ({ current: null }));
vi.mock("@/context/AuthContext", () => ({
  useAuth: () => ({ user: mockUser.current, logout: vi.fn() }),
}));

const BASE_URL = import.meta.env.VITE_SUPABASE_URL;

/** Reads the hook directly, for values the register does not surface. */
function RegisterProbe() {
  const { settings } = useAppSettings();
  return (
    <p data-testid="probe">
      bulk:{String(settings.enable_bulk_approval)} universal:{String(settings.universal_task_submission)}
    </p>
  );
}

async function clickBulkSwitch(user) {
  const label = await screen.findByText("Enable Manager Bulk Approval");
  const row = label.closest("div.group");
  await waitFor(() => expect(row.querySelector("div.cursor-pointer")).not.toBeNull());
  await user.click(row.querySelector("div.cursor-pointer"));
}

function renderBoth() {
  return renderWithProviders(
    <MemoryRouter initialEntries={["/settings?tab=approvals"]}>
      <RegisterProbe />
      <SettingsPage />
    </MemoryRouter>,
  );
}

describe("useAppSettings", () => {
  beforeEach(() => {
    mockUser.current = makeSuperAdmin({ name: "Boss" });
  });

  it("gives every reader the same defaults when there is no settings row", async () => {
    renderBoth();

    await waitFor(() =>
      expect(screen.getByTestId("probe")).toHaveTextContent("bulk:false universal:true"),
    );
  });

  it("lets a Settings-page toggle reach a mounted register without a reload, and audits it", async () => {
    db.seed("app_settings", { id: true });
    const category = makeCategory({ category_id: "IT-01", description: "IT Support" });
    makeTask({
      logged_by: makeEmployee({ name: "Ana Cruz" }).id,
      category_id: category.category_id,
      reported_to: mockUser.current.id,
      status: TASK_STATUS.INCOMPLETE,
      task_description: "Replace the office switch",
    });
    const user = setupUser();
    renderWithProviders(
      <MemoryRouter initialEntries={["/settings?tab=approvals"]}>
        <TaskApprovals />
        <SettingsPage />
      </MemoryRouter>,
    );
    await waitFor(() =>
      expect(screen.getAllByText("Replace the office switch").length).toBeGreaterThan(0),
    );
    expect(screen.queryByRole("button", { name: "Select for bulk action", hidden: true })).not.toBeInTheDocument();

    await clickBulkSwitch(user);

    expect(await screen.findByRole("button", { name: "Select for bulk action", hidden: true })).toBeInTheDocument();
    await waitForNetworkIdle();
    expect(db.rows("system_audit_logs")[0].content).toBe("App settings updated: enable_bulk_approval.");
  });

  it("reverts the switch and shows an error when the save fails", async () => {
    db.seed("app_settings", { id: true });
    server.use(
      http.patch(`${BASE_URL}/rest/v1/app_settings`, () =>
        HttpResponse.json({ message: "boom" }, { status: 500 }),
      ),
    );
    const errorToast = vi.spyOn(toast, "error");
    const user = setupUser();
    renderBoth();
    await clickBulkSwitch(user);


    await waitFor(() => expect(errorToast).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByTestId("probe")).toHaveTextContent("bulk:false"));
  });

  it("shows the stored value, not the defaults, when a save fails with nothing cached", async () => {
    // Stored differs from the default on a field the click does not touch, so
    // "reverted to stored" and "stuck on defaults" read differently.
    db.seed("app_settings", { id: true, universal_task_submission: false });
    let failFirstRead = true;
    server.use(
      http.get(`${BASE_URL}/rest/v1/app_settings`, () => {
        if (!failFirstRead) return undefined;
        failFirstRead = false;
        return HttpResponse.json({ message: "offline" }, { status: 500 });
      }),
      http.patch(`${BASE_URL}/rest/v1/app_settings`, () =>
        HttpResponse.json({ message: "boom" }, { status: 500 }),
      ),
    );
    vi.spyOn(console, "error").mockImplementation(() => {});
    const errorToast = vi.spyOn(toast, "error");
    const user = setupUser();
    renderBoth();
    await waitFor(() =>
      expect(screen.getByTestId("probe")).toHaveTextContent("bulk:false universal:true"),
    );
    await clickBulkSwitch(user);

    await waitFor(() => expect(errorToast).toHaveBeenCalled());
    await waitFor(() =>
      expect(screen.getByTestId("probe")).toHaveTextContent("bulk:false universal:false"),
    );
  });
});
