/**
 * #1064: Settings > Activities is for HR and Super Admins only. A change is saved, written to the Activity
 * Log, and the rest of the app follows it: the type names, the New button, who may file what.
 */
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import SettingsPage from "@/pages/settings/index";
import { activitySettingsService } from "@/services/activitySettingsService";
import { renderWithProviders } from "@/test/support";
import { makeEmployee, makeHrEmployee, makeSuperAdmin } from "@/test/factories";
import { db } from "@/test/db/store";
import { ACTIVITY_TYPES } from "@/components/calendar/entryKinds.jsx";
import { ACTIVITY_TYPE_LABEL } from "@/services/meetingRequestService";
import { DEFAULT_ACTIVITY_SETTINGS, setActivitySettings } from "@/utils/activitySettings";

const mocks = vi.hoisted(() => ({ user: null }));
vi.mock("@/context/AuthContext", () => ({
  useAuth: () => ({ user: mocks.user, isAuthLoading: false, logout: vi.fn() }),
}));

const TYPE_ROWS = [
  { activity_type: "MEETING", name: "Meeting", color: "teal", active: true, who_files: "EVERYONE", needs_hr: true, multi_day: false },
  { activity_type: "ADMIN_TASK", name: "Admin Task", color: "indigo", active: true, who_files: "HEADS", needs_hr: false, multi_day: true },
  { activity_type: "OPERATIONS_TASK", name: "Operations Task", color: "orange", active: true, who_files: "HEADS", needs_hr: false, multi_day: true },
  { activity_type: "EVENT", name: "Event", color: "plum", active: true, who_files: "HEADS", needs_hr: false, multi_day: true },
];
const GENERAL_ROW = {
  id: true,
  meeting_onsite: true,
  meeting_online: true,
  meeting_hybrid: true,
  earliest_start: "06:00",
  latest_end: "21:45",
  time_step_minutes: 15,
  default_start: "09:00",
  default_end: "10:00",
  reminder_minutes: 15,
  max_days: 31,
  guests_allowed: true,
};

const renderSettings = () =>
  renderWithProviders(
    <MemoryRouter initialEntries={["/settings?tab=activities"]}>
      <SettingsPage />
    </MemoryRouter>,
  );

/** Each type is one row; its name, colour and rules open under it. */
const openType = async (user, typeKey) => {
  const row = await screen.findByTestId(`activity-type-${typeKey}`);
  const toggle = within(row).getByRole("button", { expanded: false });
  await user.click(toggle);
  expect(toggle).toHaveAttribute("aria-expanded", "true");
  return row;
};

describe("Activities in Settings (#1064)", () => {
  beforeEach(() => {
    db.seed("activity_type_settings", TYPE_ROWS);
    db.seed("activity_general_settings", GENERAL_ROW);
    setActivitySettings(DEFAULT_ACTIVITY_SETTINGS);
  });

  it.each([
    ["HR", makeHrEmployee],
    ["Super Admin", makeSuperAdmin],
  ])("shows the tab to %s, with the four types", async (_name, make) => {
    mocks.user = make({ name: "Boss" });
    renderSettings();
    expect(await screen.findByRole("tab", { name: "Activities" })).toBeInTheDocument();
    expect(await screen.findByDisplayValue("Operations Task")).toBeInTheDocument();
    expect(screen.getAllByTestId(/^activity-type-/)).toHaveLength(4);
  });

  it("hides the tab from an ordinary employee", async () => {
    mocks.user = makeEmployee({ name: "Ana" });
    renderSettings();
    expect(await screen.findByText("App preferences")).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Activities" })).not.toBeInTheDocument();
  });

  it("switches a type off, writes it to the Activity Log and keeps the others", async () => {
    mocks.user = makeHrEmployee({ name: "Boss" });
    renderSettings();
    const card = await screen.findByTestId("activity-type-EVENT");
    await userEvent.click(within(card).getByRole("switch", { name: "Event is on" }));
    await waitFor(() => expect(db.rows("activity_type_settings").find((r) => r.activity_type === "EVENT").active).toBe(false));
    expect(db.rows("activity_type_settings").filter((r) => r.active)).toHaveLength(3);
    await waitFor(() => expect(db.rows("system_audit_logs").map((r) => r.content)).toContain('Switched off Activity type "Event"'));
  });

  it("does not let the last type be switched off", async () => {
    mocks.user = makeHrEmployee({ name: "Boss" });
    for (const row of TYPE_ROWS.slice(1)) {
      const saved = db.rows("activity_type_settings").find((r) => r.activity_type === row.activity_type);
      await activitySettingsService.saveType(row.activity_type, { ...row, name: row.name, whoFiles: row.who_files, needsHr: row.needs_hr, multiDay: row.multi_day, active: true, color: row.color }, { active: false }, null);
      expect(saved).toBeTruthy();
    }
    renderSettings();
    const card = await screen.findByTestId("activity-type-MEETING");
    const toggle = () => within(card).getByRole("switch", { name: "Meeting is on" });
    await waitFor(() => expect(toggle()).toHaveAttribute("aria-disabled", "true"));
    // Why it is locked is a Hover detail (CONTEXT.md), not standing text.
    expect(within(card).queryByText("At least one type must stay on.")).not.toBeInTheDocument();
    await userEvent.hover(toggle().parentElement);
    expect(await screen.findByText("At least one type must stay on.")).toBeInTheDocument();
  });

  it("lists each type on one line with who files it, whether it waits for HR and how long it runs", async () => {
    mocks.user = makeHrEmployee({ name: "Boss" });
    renderSettings();
    const line = async (typeKey) => within(await screen.findByTestId(`activity-type-${typeKey}`)).getByRole("button", { expanded: false });
    const meeting = await line("MEETING");
    expect(within(meeting).getByText("Everyone")).toBeInTheDocument();
    expect(within(meeting).getByText("With a Venue")).toBeInTheDocument();
    expect(within(meeting).getByText("One day")).toBeInTheDocument();
    const event = await line("EVENT");
    expect(within(event).getByText("Department heads")).toBeInTheDocument();
    expect(within(event).getByText("Several days")).toBeInTheDocument();
    expect(screen.getByText("4 of 4 on")).toBeInTheDocument();
  });

  it("keeps the Meeting types inside Meeting", async () => {
    mocks.user = makeHrEmployee({ name: "Boss" });
    const user = userEvent.setup();
    renderSettings();
    const meeting = await openType(user, "MEETING");
    await user.click(within(meeting).getByRole("checkbox", { name: "Hybrid" }));
    await waitFor(() => expect(db.rows("activity_general_settings")[0].meeting_hybrid).toBe(false));
    const event = await openType(user, "EVENT");
    expect(within(event).queryByRole("group", { name: "Meeting types" })).not.toBeInTheDocument();
  });

  it("renames a type and the rest of the app follows", async () => {
    mocks.user = makeHrEmployee({ name: "Boss" });
    const user = userEvent.setup();
    renderSettings();
    await openType(user, "ADMIN_TASK");
    const input = screen.getByLabelText("Name of Admin Task");
    await user.clear(input);
    await user.type(input, "Office Duty");
    await user.tab();
    await waitFor(() => expect(db.rows("activity_type_settings").find((r) => r.activity_type === "ADMIN_TASK").name).toBe("Office Duty"));
    await waitFor(() => expect(ACTIVITY_TYPES.ADMIN_TASK.label).toBe("Office Duty"));
    expect(ACTIVITY_TYPE_LABEL.ADMIN_TASK).toBe("Office Duty");
    expect(db.rows("system_audit_logs").map((r) => r.content)).toContain('Renamed Activity type "Admin Task" to "Office Duty"');
  });

  it("changes a colour and the Calendar's colour for that type follows", async () => {
    mocks.user = makeHrEmployee({ name: "Boss" });
    const user = userEvent.setup();
    renderSettings();
    const card = await openType(user, "EVENT");
    await user.click(within(card).getByRole("button", { name: "Green" }));
    await waitFor(() => expect(db.rows("activity_type_settings").find((r) => r.activity_type === "EVENT").color).toBe("green"));
    await waitFor(() => expect(ACTIVITY_TYPES.EVENT.dot).toBe("bg-green-9"));
  });

  it("saves the Guests switch and logs it", async () => {
    mocks.user = makeSuperAdmin({ name: "Boss" });
    const user = userEvent.setup();
    renderSettings();
    await user.click(await screen.findByRole("switch", { name: "Guests are allowed" }));
    await waitFor(() => expect(db.rows("activity_general_settings")[0].guests_allowed).toBe(false));
    expect(db.rows("system_audit_logs").map((r) => r.content)).toContain("Guests are now not allowed on Activities");
  });

  it("shows Also allowed only on heads-only types, and saves and logs the list", async () => {
    mocks.user = makeHrEmployee({ name: "Boss" });
    renderSettings();
    await screen.findByTestId("activity-type-OPERATIONS_TASK");
    expect(screen.getByTestId("activity-also-allowed-OPERATIONS_TASK")).toBeInTheDocument();
    expect(screen.queryByTestId("activity-also-allowed-MEETING")).not.toBeInTheDocument();

    const from = { name: "Operations Task", color: "orange", active: true, whoFiles: "HEADS", needsHr: false, multiDay: true, alsoAllowed: [] };
    const ana = makeEmployee({ name: "Ana Cruz" });
    await activitySettingsService.saveType("OPERATIONS_TASK", from, { alsoAllowed: [ana.id] }, null);
    expect(db.rows("activity_type_settings").find((r) => r.activity_type === "OPERATIONS_TASK").also_allowed).toEqual([ana.id]);
    expect(db.rows("system_audit_logs").map((r) => r.content)).toContain('"Operations Task" Also allowed: added Ana Cruz');
    await activitySettingsService.saveType("OPERATIONS_TASK", { ...from, alsoAllowed: [ana.id] }, { alsoAllowed: [] }, null);
    expect(db.rows("system_audit_logs").map((r) => r.content)).toContain('"Operations Task" Also allowed: removed Ana Cruz');
  });
});
