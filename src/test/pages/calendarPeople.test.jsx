/**
 * #618 (spec #609): the Calendar's People view. HR-style viewers get pending bars
 * (styled apart from approved ones); everyone else gets approved entries only.
 * The mock behaves like the server: pending rows only come back when asked for.
 */
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import CalendarPage from "@/pages/calendar/index";
import { renderWithProviders } from "@/test/support";
import { makeEmployee, makeHrEmployee } from "@/test/factories";
import { manilaToday } from "@/lib/manilaDate.js";

const mocks = vi.hoisted(() => ({ user: null, fetch: null }));

vi.mock("@/context/AuthContext", () => ({
  useAuth: () => ({ user: mocks.user, isAuthLoading: false }),
}));
vi.mock("@/services/calendarService", () => ({
  calendarService: { fetchEntries: (args) => mocks.fetch(args) },
}));

const month = manilaToday().slice(0, 8);
const row = (kind, id, person, date, status = "APPROVED") => ({
  kind,
  id: `${id}-${date}`,
  group_id: id,
  starts_at: `${date}T01:00:00Z`,
  ends_at: `${date}T09:00:00Z`,
  all_day: false,
  manila_date: date,
  employee: { id: person.id, name: person.name, department: person.department, avatar: null },
  status,
  hours: 8,
  venue: null,
  title: kind,
  details: {},
});
const ana = { id: "p1", name: "Ana Cruz", department: "SALES" };
const ben = { id: "p2", name: "Ben Lim", department: "IT" };
const all = [
  row("SIL", "a", ana, `${month}10`),
  row("SIL", "a", ana, `${month}11`),
  row("OFFSET", "b", ben, `${month}12`, "PENDING"),
];

const renderPeople = async () => {
  const user = userEvent.setup();
  renderWithProviders(
    <MemoryRouter initialEntries={["/calendar"]}>
      <CalendarPage />
    </MemoryRouter>,
  );
  await user.click(await screen.findByRole("button", { name: "People" }));
  await screen.findByTestId("calendar-people");
  return user;
};

beforeEach(() => {
  window.localStorage.clear();
  mocks.fetch = vi.fn(async ({ includePending }) =>
    includePending ? all : all.filter((e) => e.status === "APPROVED"),
  );
});

describe("Calendar People view", () => {
  it("shows an HR viewer pending bars, styled apart from approved ones", async () => {
    mocks.user = makeHrEmployee();
    await renderPeople();

    const bars = await screen.findAllByTestId("people-bar");
    expect(bars).toHaveLength(2);
    const pending = bars.find((b) => b.dataset.pending === "true");
    const approved = bars.find((b) => b.dataset.pending === "false");
    expect(pending).toHaveTextContent("Offset (pending)");
    expect(pending.className).toContain("border-dashed");
    expect(approved.className).not.toContain("border-dashed");
  });

  it("shows an ordinary employee approved entries only, one bar per multi-day group", async () => {
    mocks.user = makeEmployee({ name: "Dana Reyes" });
    await renderPeople();

    const bars = await screen.findAllByTestId("people-bar");
    expect(bars).toHaveLength(1);
    expect(bars[0]).toHaveTextContent("SIL");
    expect(screen.queryByText("Ben Lim")).toBeNull();
    expect(mocks.fetch).toHaveBeenCalledWith(expect.objectContaining({ includePending: false }));
  });

  it("narrows the rows by name or department", async () => {
    mocks.user = makeHrEmployee();
    const user = await renderPeople();
    await screen.findByTestId("person-p2");

    await user.type(screen.getByLabelText("Filter people"), "it");
    expect(screen.queryByTestId("person-p1")).toBeNull();
    expect(within(screen.getByTestId("person-p2")).getByText("Ben Lim")).toBeInTheDocument();
  });
});
