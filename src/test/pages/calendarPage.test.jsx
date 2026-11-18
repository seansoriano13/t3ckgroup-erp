/**
 * #615 (spec #609), redesigned: the Calendar page. Entries come from the server
 * projection (mocked here), are drawn from the kind registry, and honour the
 * layer toggles. Multi-day Time Off is one bar in the month; the day rail lists
 * who is out. The detail panel shows a reason only when the data carries one,
 * and a multi-day request's whole range.
 */
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation, useNavigationType } from "react-router";
import { stubRoomyScreen } from "@/test/roomyScreen";
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

// The day panel is a side panel at every width: open it from the toolbar's day button.
const openDayPanel = async (user) => {
  await user.click(await screen.findByRole("button", { name: /^[A-Z][a-z]{2} · [A-Z][a-z]{2} \d+/ }));
  return screen.findByTestId("day-rail");
};

const renderPage = () =>
  renderWithProviders(
    <MemoryRouter initialEntries={[`/calendar?date=${day}`]}>
      <CalendarPage />
    </MemoryRouter>,
  );

beforeEach(() => {
  stubRoomyScreen();
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
    const user = userEvent.setup();
    renderPage();
    const rail = await openDayPanel(user);
    const out = await within(rail).findByRole("region", { name: "Out of office" });
    expect(within(out).getByText("Ana Cruz")).toBeInTheDocument();
    expect(within(out).getByText("Ben Lim")).toBeInTheDocument();
    expect(within(out).queryByText("Dino Uy")).toBeNull();
    expect(within(within(rail).getByRole("region", { name: "Overtime" })).getByText("Cara Tan")).toBeInTheDocument();
  });

  it("moves the rail to the day that is clicked, without opening the panel by itself", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByTestId(`day-${nextDay}`));
    expect(screen.queryByTestId("day-rail")).toBeNull();
    const out = within(await openDayPanel(user)).getByRole("region", { name: "Out of office" });
    expect(within(out).getByText("Dino Uy")).toBeInTheDocument();
    expect(within(out).queryByText("Ana Cruz")).toBeNull();
  });

  it("hides a layer's entries when it is turned off, and remembers the choice", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("Cara T. overtime");

    await user.click(screen.getByRole("button", { name: /^Filters/ }));
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
    await user.click(screen.getByRole("button", { name: /^Filters/ }));
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

  it("closing an entry opened from the page steps Back; one opened by a link just clears the address", async () => {
    const Probe = () => {
      const { search } = useLocation();
      return <output data-testid="probe">{`${useNavigationType()}${search.includes("entry=") ? " open" : " closed"}`}</output>;
    };
    const user = userEvent.setup();
    const { unmount } = renderWithProviders(
      <MemoryRouter initialEntries={[`/calendar?date=${day}`]}>
        <CalendarPage />
        <Probe />
      </MemoryRouter>,
    );
    await user.click(await screen.findByText(/Ben L\. · Offset/));
    expect(await screen.findByText("Dental")).toBeInTheDocument();
    expect(screen.getByTestId("probe")).toHaveTextContent("PUSH open");
    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.getByTestId("probe")).toHaveTextContent("POP closed");
    unmount();

    renderWithProviders(
      <MemoryRouter initialEntries={[`/calendar?date=${day}&entry=offset:b`]}>
        <CalendarPage />
        <Probe />
      </MemoryRouter>,
    );
    expect(await screen.findByText("Dental")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.getByTestId("probe")).toHaveTextContent("REPLACE closed");
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

  describe("filters", () => {
    const withActivity = () => {
      mocks.entries = [
        entry("SIL", "a", "Ana Cruz"),
        entry("OVERTIME", "c", "Cara Tan"),
        {
          ...entry("MEETING", "m", "Dana Reyes", {
            activity_type: "MEETING",
            facilitator: { id: "emp-lead", name: "Lee Lead", department: "IT" },
            participants: [{ id: "emp-part", name: "Pat Part", department: "IT" }],
          }),
          employee: { id: mocks.user.id, name: "Dana Reyes", department: "SALES" },
          title: "Weekly sync",
        },
      ];
    };

    it("puts every filter behind one Filters button with a count", async () => {
      const user = userEvent.setup();
      renderPage();
      await screen.findByText(/Ana C\. · SIL/);
      expect(screen.getAllByRole("button", { name: /^Filters/ })).toHaveLength(1);
      expect(screen.queryByRole("button", { name: /^Overtime/ })).toBeNull();

      await user.click(screen.getByRole("button", { name: /^Filters/ }));
      for (const name of [/^Activities/, /^Time Off/, /^Overtime/, /^Event/]) {
        expect(screen.getByRole("button", { name })).toBeInTheDocument();
      }
      await user.click(screen.getByRole("button", { name: /^Overtime/ }));
      expect(screen.getByRole("button", { name: /^Filters.*1/ })).toBeInTheDocument();
    });

    it("shows a chip for a filter that is on, and removing the chip turns it off", async () => {
      const user = userEvent.setup();
      renderPage();
      await screen.findByText("Cara T. overtime");
      await user.click(screen.getByRole("button", { name: /^Filters/ }));
      await user.click(screen.getByRole("button", { name: /^Overtime/ }));
      expect(screen.queryByText("Cara T. overtime")).toBeNull();

      await user.click(screen.getByRole("button", { name: "Remove filter Overtime hidden" }));
      expect(await screen.findByText("Cara T. overtime")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /^Remove filter/ })).toBeNull();
    });

    it("Only me shows only the viewer's own entries", async () => {
      const user = userEvent.setup();
      mocks.entries = [entry("SIL", "a", "Ana Cruz"), { ...entry("OVERTIME", "c", "Dana Reyes"), employee: { id: mocks.user.id, name: "Dana Reyes", department: "SALES" } }];
      renderPage();
      await screen.findByText(/Ana C\. · SIL/);
      await user.click(screen.getByRole("button", { name: /^Filters/ }));
      await user.click(screen.getByRole("checkbox", { name: "Only me" }));

      expect(screen.queryByText(/Ana C\. · SIL/)).toBeNull();
      expect(screen.getByText("Dana R. overtime")).toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: "Remove filter Only me" }));
      expect(await screen.findByText(/Ana C\. · SIL/)).toBeInTheDocument();
    });

    it("picking a department shows only that department's people", async () => {
      const user = userEvent.setup();
      mocks.entries = [entry("SIL", "a", "Ana Cruz"), { ...entry("OFFSET", "b", "Ben Lim"), employee: { id: "emp-b", name: "Ben Lim", department: "IT" } }];
      renderPage();
      await screen.findByText(/Ana C\. · SIL/);
      await user.click(screen.getByRole("button", { name: /^Filters/ }));
      await user.click(screen.getByRole("checkbox", { name: "IT department" }));

      expect(screen.queryByText(/Ana C\. · SIL/)).toBeNull();
      expect(screen.getByText(/Ben L\. · Offset/)).toBeInTheDocument();
    });

    it("an Activity shows for a chosen Lead or Participant", async () => {
      const user = userEvent.setup();
      withActivity();
      renderPage();
      await screen.findByText(/Ana C\. · SIL/);
      await user.click(screen.getByRole("button", { name: /^Filters/ }));
      await user.click(screen.getByRole("checkbox", { name: "Pat Part" }));

      expect(screen.queryByText(/Ana C\. · SIL/)).toBeNull();
      expect(screen.getAllByText(/Weekly sync/).length).toBeGreaterThan(0);
      expect(screen.getByRole("button", { name: "Remove filter Pat Part" })).toBeInTheDocument();
    });
  });
});
