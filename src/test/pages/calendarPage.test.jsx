/**
 * #615 (spec #609): the Calendar page. Entries come from the server projection
 * (mocked here), are drawn from the kind registry, and honour the layer toggles.
 * The detail panel shows a reason only when the data carries one.
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

const day = manilaToday().slice(0, 8) + "10";
const nextDay = manilaToday().slice(0, 8) + "11";
const entry = (kind, id, name, details = {}, manila_date = day) => ({
  kind,
  id,
  group_id: id,
  starts_at: `${day}T01:00:00Z`,
  ends_at: `${day}T09:00:00Z`,
  all_day: false,
  manila_date,
  employee: { id: `emp-${id}`, name, department: "SALES", avatar: null },
  status: "APPROVED",
  hours: 8,
  venue: null,
  title: kind,
  details,
});

const renderPage = () =>
  renderWithProviders(
    <MemoryRouter initialEntries={["/calendar"]}>
      <CalendarPage />
    </MemoryRouter>,
  );

beforeEach(() => {
  window.localStorage.clear();
  mocks.user = makeEmployee({ name: "Dana Reyes" });
  mocks.entries = [
    entry("SIL", "a", "Ana Cruz"),
    entry("OFFSET", "b", "Ben Lim", { reason: "Dental" }),
    entry("OVERTIME", "c", "Cara Tan"),
    entry("UNDERTIME", "d", "Dino Uy", {}, nextDay),
  ];
});

describe("Calendar page", () => {
  it("shows approved SIL, Offset, Overtime and Undertime entries", async () => {
    renderPage();
    const cell = await screen.findByTestId(`day-${day}`);
    expect(await within(cell).findByText(/Ana Cruz · SIL/)).toBeInTheDocument();
    expect(within(cell).getByText(/Ben Lim · Offset/)).toBeInTheDocument();
    expect(within(cell).getByText(/Cara Tan · Overtime/)).toBeInTheDocument();
    const next = screen.getByTestId(`day-${nextDay}`);
    expect(within(next).getByText(/Dino Uy · Undertime/)).toBeInTheDocument();
  });

  it("hides a layer's entries when it is turned off, and remembers the choice", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText(/Cara Tan · Overtime/);

    await user.click(screen.getByRole("button", { name: "Overtime" }));

    expect(screen.queryByText(/Cara Tan · Overtime/)).toBeNull();
    expect(screen.getByText(/Ana Cruz · SIL/)).toBeInTheDocument();
    expect(JSON.parse(window.localStorage.getItem("calendar.layers")).overtime).toBe(false);
  });

  it("still works when browser storage throws", async () => {
    const spy = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    renderPage();
    expect(await screen.findByText(/Ana Cruz · SIL/)).toBeInTheDocument();
    spy.mockRestore();
  });

  it("shows the reason in the detail panel only when the data has one", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByText(/Ben Lim · Offset/));
    expect(await screen.findByText("Dental")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Close" }));

    await user.click(screen.getByText(/Ana Cruz · SIL/));
    expect(await screen.findAllByText("Ana Cruz")).not.toHaveLength(0);
    expect(screen.queryByText("Reason")).toBeNull();
  });

  it("offers the pending switch to HR viewers only", async () => {
    renderPage();
    await screen.findByText(/Ana Cruz · SIL/);
    expect(screen.queryByLabelText("Show pending")).toBeNull();
  });
});
