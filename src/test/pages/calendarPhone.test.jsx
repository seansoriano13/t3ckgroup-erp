/**
 * #1069 (spec #1062): on a phone the Calendar is a small month with dots, and the
 * chosen day's list below it. Tapping a day lists its entries; tapping an entry
 * opens its details. The Gantt and the day-panel button are not offered.
 */
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import CalendarPage from "@/pages/calendar/index";
import { renderWithProviders } from "@/test/support";
import { makeEmployee } from "@/test/factories";
import { manilaToday } from "@/lib/manilaDate.js";

const mocks = vi.hoisted(() => ({ user: null, entries: [] }));

vi.mock("@/context/AuthContext", () => ({
  useAuth: () => ({ user: mocks.user, isAuthLoading: false }),
}));
vi.mock("@/services/calendarService", () => ({
  calendarService: { fetchEntries: vi.fn(async () => mocks.entries) },
}));
vi.mock("@/services/meetingRequestService", async (orig) => ({
  ...(await orig()),
  meetingRequestService: { listVenues: vi.fn(async () => []) },
}));

const month = manilaToday().slice(0, 8);
const dayA = `${month}10`;
const dayB = `${month}12`;
const lead = { id: "lead", name: "Lia Lead", department: "SALES" };

const activity = (id, type, ymd) => ({
  kind: "MEETING",
  id,
  group_id: id,
  starts_at: `${ymd}T01:00:00Z`,
  ends_at: `${ymd}T02:00:00Z`,
  all_day: false,
  manila_date: ymd,
  employee: { ...lead, avatar: null },
  status: "APPROVED",
  hours: null,
  venue: null,
  title: `${type} ${id}`,
  details: { activity_type: type, facilitator: { id: lead.id, name: lead.name }, participants: [] },
});

const stubPhone = () => {
  window.matchMedia = (query) => {
    const max = /max-width: (\d+(?:\.\d+)?)px/.exec(query);
    const min = /min-width: (\d+)px/.exec(query);
    const matches = (!min || 375 >= Number(min[1])) && (!max || 375 <= Number(max[1])) && !query.includes("height");
    return { matches, media: query, addEventListener: () => {}, removeEventListener: () => {} };
  };
};

const renderAt = (search) =>
  renderWithProviders(
    <MemoryRouter initialEntries={[`/calendar?${search}`]}>
      <CalendarPage />
    </MemoryRouter>,
  );

beforeEach(() => {
  window.localStorage.clear();
  stubPhone();
  mocks.user = makeEmployee({ name: "Dana Reyes" });
  mocks.entries = [activity("a1", "ADMIN_TASK", dayA), activity("e1", "EVENT", dayB)];
});

describe("Calendar on a phone", () => {
  it("shows a small month, lists the chosen day, and opens an entry", async () => {
    const user = userEvent.setup();
    renderAt(`date=${dayA}`);
    const agenda = await screen.findByTestId("calendar-agenda");
    expect(within(agenda).getByTestId(`day-${dayA}`)).toBeInTheDocument();
    expect(await within(agenda).findByText("ADMIN_TASK a1")).toBeInTheDocument();
    expect(within(agenda).queryByText("EVENT e1")).not.toBeInTheDocument();

    await user.click(within(agenda).getByTestId(`day-${dayB}`));
    expect(await within(agenda).findByText("EVENT e1")).toBeInTheDocument();
    expect(within(agenda).queryByText("ADMIN_TASK a1")).not.toBeInTheDocument();

    await user.click(within(agenda).getByText("EVENT e1"));
    expect(await screen.findByText("Lia Lead", { selector: "dd" })).toBeInTheDocument();
  });

  it("says so when the chosen day is empty", async () => {
    const user = userEvent.setup();
    renderAt(`date=${dayA}`);
    const agenda = await screen.findByTestId("calendar-agenda");
    await user.click(within(agenda).getByTestId(`day-${month}20`));
    expect(await within(agenda).findByText("Nothing on the Calendar this day.")).toBeInTheDocument();
  });

  it("keeps Filters, New and My Activities, and hides the Gantt switch and the day-panel button", async () => {
    renderAt(`date=${dayA}&layout=gantt`);
    await screen.findByTestId("calendar-agenda");
    expect(screen.getByRole("button", { name: /Filters/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "My Activities" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^New / })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Gantt" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^[A-Z][a-z]{2} · [A-Z][a-z]{2} \d+/ })).not.toBeInTheDocument();
    expect(screen.getByText("Gantt needs a wider screen.")).toBeInTheDocument();
  });
});
