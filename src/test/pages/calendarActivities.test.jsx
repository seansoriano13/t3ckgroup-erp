/**
 * #1065 (spec #1062): Activities with no Venue (Admin Task, Operations Task, Event, Online
 * Meeting) show in the day panel and on the Gantt's people rows; a room Meeting also stays on
 * its Venue's row. "+N more" opens the day panel at a wide and at a laptop width.
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
  meetingRequestService: { listVenues: vi.fn(async () => [{ id: "v1", name: "Conference Room" }]) },
}));

const month = manilaToday().slice(0, 8);
const day = `${month}10`;
const lead = { id: "lead", name: "Lia Lead", department: "SALES" };
const pat = { id: "pat", name: "Pat Part", department: "IT" };

const activity = (id, type, over = {}) => ({
  kind: "MEETING",
  id,
  group_id: id,
  starts_at: `${day}T01:00:00Z`,
  ends_at: `${day}T02:00:00Z`,
  all_day: false,
  manila_date: day,
  employee: { ...lead, avatar: null },
  status: "APPROVED",
  hours: null,
  venue: null,
  title: `${type} ${id}`,
  details: { activity_type: type, facilitator: { id: lead.id, name: lead.name }, participants: [{ id: pat.id, name: pat.name }] },
  ...over,
});

const four = () => [
  activity("a1", "ADMIN_TASK"),
  activity("o1", "OPERATIONS_TASK"),
  activity("e1", "EVENT"),
  activity("m1", "MEETING"),
];

// A screen `width` px wide and tall: only the width queries can match.
const stubScreen = (width) => {
  window.matchMedia = (query) => {
    const min = /min-width: (\d+)px/.exec(query);
    const max = /max-width: (\d+(?:\.\d+)?)px/.exec(query);
    const matches = (!min || width >= Number(min[1])) && (!max || width <= Number(max[1])) && !query.includes("height");
    return { matches, media: query, addEventListener: () => {}, removeEventListener: () => {} };
  };
};

const renderAt = (search) =>
  renderWithProviders(
    <MemoryRouter initialEntries={[`/calendar?${search}`]}>
      <CalendarPage />
    </MemoryRouter>,
  );

const dayButton = () => screen.findByRole("button", { name: /^[A-Z][a-z]{2} · [A-Z][a-z]{2} \d+/ });

beforeEach(() => {
  window.localStorage.clear();
  mocks.user = makeEmployee({ name: "Dana Reyes" });
  mocks.entries = four();
});

describe("Calendar day panel", () => {
  it("lists each Activity without a Venue, and clicking one opens its details", async () => {
    stubScreen(1920);
    const user = userEvent.setup();
    renderAt(`date=${day}`);
    await user.click(await dayButton());
    const none = within(await screen.findByTestId("day-rail")).getByRole("region", { name: "No venue" });
    for (const title of ["ADMIN_TASK a1", "OPERATIONS_TASK o1", "EVENT e1", "MEETING m1"]) {
      expect(within(none).getByText(title)).toBeInTheDocument();
    }
    await user.click(within(none).getByText("EVENT e1"));
    expect(await screen.findByText("Lia Lead", { selector: "dd" })).toBeInTheDocument();
  });

  it.each([
    ["a 1920px screen", 1920],
    ["a 1366px laptop", 1366],
  ])("opens the day panel from +N more on %s", async (_name, width) => {
    stubScreen(width);
    mocks.entries = [...four(), activity("a2", "ADMIN_TASK"), activity("a3", "ADMIN_TASK")];
    const user = userEvent.setup();
    renderAt(`date=${day}`);
    await user.click(await screen.findByRole("button", { name: /\+\d+ more/ }));
    expect(await screen.findByTestId("day-rail")).toBeInTheDocument();
  });
});

describe("Calendar Gantt people rows", () => {
  it("draws an Admin Task on its Lead's and Participants' rows, and opens it", async () => {
    stubScreen(1920);
    mocks.entries = [activity("a1", "ADMIN_TASK")];
    const user = userEvent.setup();
    renderAt(`layout=gantt&weeks=2&date=${day}`);
    const leadRow = await screen.findByTestId("person-lead");
    const partRow = await screen.findByTestId("person-pat");
    expect(within(leadRow).getByText("ADMIN_TASK a1")).toBeInTheDocument();
    expect(within(partRow).getByText("ADMIN_TASK a1")).toBeInTheDocument();
    await user.click(within(partRow).getByTestId("people-bar"));
    expect(await screen.findByText("Pat Part", { selector: "dd" })).toBeInTheDocument();
  });

  it("keeps a room Meeting on its Venue's row", async () => {
    stubScreen(1920);
    mocks.entries = [activity("m2", "MEETING", { venue: "Conference Room" })];
    renderAt(`layout=gantt&weeks=2&date=${day}`);
    const room = await screen.findByTestId("venue-row-Conference Room");
    expect(within(room).getByRole("button", { name: /MEETING m2/ })).toBeInTheDocument();
    expect(screen.getByTestId("person-lead")).toBeInTheDocument();
  });
});

describe("A multi-day Activity", () => {
  const dayN = (n) => `${month}${String(n).padStart(2, "0")}`;
  const days = (id, type, dates) =>
    dates.map((n, i) =>
      activity(`${id}-${n}`, type, {
        group_id: id,
        manila_date: dayN(n),
        starts_at: `${dayN(n)}T0${i + 1}:00:00Z`,
        ends_at: `${dayN(n)}T0${i + 1}:30:00Z`,
        title: "Site visit",
        details: { activity_type: type, days_total: dates.length, day_index: i + 1, facilitator: { id: lead.id, name: lead.name }, participants: [] },
      }),
    );

  it("is one bar in the Month, and its details list every day and mark the one opened", async () => {
    stubScreen(1920);
    mocks.entries = days("ops", "OPERATIONS_TASK", [10, 11, 12]);
    const user = userEvent.setup();
    renderAt(`date=${day}`);
    const bars = await screen.findAllByTestId("month-bar");
    expect(bars).toHaveLength(1);
    await user.click(bars[0]);
    const list = await screen.findByTestId("activity-days");
    expect(within(list).getAllByRole("listitem")).toHaveLength(3);
    expect(screen.getByText("From")).toBeInTheDocument();
    expect(screen.getByText("To")).toBeInTheDocument();
    expect(list.querySelectorAll('[data-clicked="true"]')).toHaveLength(1);
  });

  it("shows a removed day as a gap in the Gantt", async () => {
    stubScreen(1920);
    mocks.entries = days("evt", "EVENT", [10, 11, 13, 14, 15]);
    renderAt(`layout=gantt&weeks=2&date=${day}`);
    const row = await screen.findByTestId("person-lead");
    expect(within(row).getAllByTestId("people-bar")).toHaveLength(2);
  });

  it("opens the right Activity from its address", async () => {
    stubScreen(1920);
    mocks.entries = days("evt", "EVENT", [10, 11, 12]);
    renderAt(`date=${day}&entry=meeting:evt-11`);
    const list = await screen.findByTestId("activity-days");
    expect(list.querySelector('[data-clicked="true"]')).toHaveTextContent(/11/);
  });
});
