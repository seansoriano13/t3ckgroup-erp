/**
 * #615 (spec #609), redesigned: the Calendar page. Entries come from the server
 * projection (mocked here), are drawn from the kind registry, and honour the
 * layer toggles. Multi-day Time Off is one bar in the month; the day rail lists
 * who is out. The detail panel shows a reason only when the data carries one,
 * and a multi-day request's whole range.
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
    <MemoryRouter initialEntries={[`/calendar?date=${day}`]}>
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
    const week = cell.parentElement;
    expect(await within(week).findByText(/Ana C\. · SIL/)).toBeInTheDocument();
    expect(within(week).getByText(/Ben L\. · Offset/)).toBeInTheDocument();
    expect(within(week).getByText("Cara T. overtime")).toBeInTheDocument();
    expect(within(week).getByText("Dino U. undertime")).toBeInTheDocument();
  });

  it("lists the selected day in the rail: who is out, and overtime", async () => {
    renderPage();
    const rail = await screen.findByTestId("day-rail");
    const out = await within(rail).findByRole("region", { name: "Out of office" });
    expect(within(out).getByText("Ana Cruz")).toBeInTheDocument();
    expect(within(out).getByText("Ben Lim")).toBeInTheDocument();
    expect(within(out).queryByText("Dino Uy")).toBeNull();
    expect(within(within(rail).getByRole("region", { name: "Overtime" })).getByText("Cara Tan")).toBeInTheDocument();
  });

  it("moves the rail to the day that is clicked", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByTestId(`day-${nextDay}`));
    const out = within(screen.getByTestId("day-rail")).getByRole("region", { name: "Out of office" });
    expect(within(out).getByText("Dino Uy")).toBeInTheDocument();
    expect(within(out).queryByText("Ana Cruz")).toBeNull();
  });

  it("hides a layer's entries when it is turned off, and remembers the choice", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("Cara T. overtime");

    await user.click(screen.getByRole("button", { name: /^Overtime/ }));

    expect(screen.queryByText("Cara T. overtime")).toBeNull();
    expect(screen.queryByRole("region", { name: "Overtime" })).toBeNull();
    expect(screen.getByText(/Ana C\. · SIL/)).toBeInTheDocument();
    expect(JSON.parse(window.localStorage.getItem("calendar.layers")).overtime).toBe(false);
  });

  it("shows an approved LWOP in the month view and hides it when Time Off is off", async () => {
    const user = userEvent.setup();
    mocks.entries = [entry("LWOP", "l", "Lia Gomez")];
    renderPage();
    const cell = await screen.findByTestId(`day-${day}`);
    expect(await within(cell.parentElement).findByText(/Lia G\. · LWOP/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /^Time Off/ }));
    expect(screen.queryByText(/Lia G\. · LWOP/)).toBeNull();
  });

  it("still works when browser storage throws", async () => {
    const spy = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    renderPage();
    expect(await screen.findByText(/Ana C\. · SIL/)).toBeInTheDocument();
    spy.mockRestore();
  });

  it("shows the reason in the detail panel only when the data has one", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByText(/Ben L\. · Offset/));
    expect(await screen.findByText("Dental")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Close" }));

    await user.click(screen.getByText(/Ana C\. · SIL/));
    expect(await screen.findAllByText("Ana Cruz")).not.toHaveLength(0);
    expect(screen.queryByText("Reason")).toBeNull();
  });

  it("draws a multi-day request as one bar and opens its whole range", async () => {
    const user = userEvent.setup();
    const days = ["07", "08", "09"].map((d) => manilaToday().slice(0, 8) + d);
    mocks.entries = days.map((d) => ({ ...entry("SIL", `g-${d}`, "Ana Cruz", {}, d), group_id: "g" }));
    renderPage();

    const bars = await screen.findAllByText(/Ana Cruz · SIL|Ana C\. · SIL/);
    // One bar per week the request touches (the 7th to the 9th may cross a Monday).
    expect(bars.length).toBeLessThanOrEqual(2);
    await user.click(bars[0]);
    expect(await screen.findByText("Dates")).toBeInTheDocument();
    expect(screen.getByText("Total hours").parentElement).toHaveTextContent("24");
    expect(screen.getByText("Days").parentElement).toHaveTextContent("3");
  });

  it("offers the pending switch to HR viewers only", async () => {
    renderPage();
    await screen.findByText(/Ana C\. · SIL/);
    expect(screen.queryByLabelText("Show pending")).toBeNull();
  });
});
