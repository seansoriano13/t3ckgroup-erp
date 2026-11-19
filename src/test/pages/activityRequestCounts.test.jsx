/**
 * #1090 (spec #1083, tracker E1): the Activity pages ask for each list once.
 *
 * The fake Supabase answers over HTTP, so a request counter on the MSW server sees exactly what
 * `playwright-cli requests` saw on staging. Each test counts the calls one flow makes.
 */
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import CalendarPage from "@/pages/calendar/index";
import Calendar from "@/components/calendar/Calendar";
import MyMeetingRequests from "@/components/calendar/MyMeetingRequests";
import { supabase } from "@/lib/supabase";
import { stubRoomyScreen } from "@/test/roomyScreen";
import { renderWithProviders } from "@/test/support";
import { makeEmployee, makeHead } from "@/test/factories";
import { db, insertRow } from "@/test/db/store";
import { server, stubRpc } from "@/test/msw/server";
import { waitForNetworkIdle } from "@/test/network";
import { manilaDate, manilaToday } from "@/lib/manilaDate.js";

const mocks = vi.hoisted(() => ({ user: null }));

vi.mock("@/context/AuthContext", () => ({
  useAuth: () => ({ user: mocks.user, isAuthLoading: false }),
}));

const tomorrow = manilaDate(new Date(Date.now() + 24 * 3600 * 1000));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Every request the page makes, newest last; `body` is the parsed JSON of an rpc call. */
let calls = [];
/** The realtime callbacks the screens registered, one per table topic. */
let handlers = [];
const onStart = ({ request }) => {
  const url = new URL(request.url);
  const entry = { method: request.method, path: url.pathname.replace("/rest/v1/", ""), body: null };
  calls.push(entry);
  if (request.method === "POST") {
    request
      .clone()
      .json()
      .then((body) => {
        entry.body = body;
      })
      .catch(() => {});
  }
};
const count = (path, method = "GET") => calls.filter((c) => c.path === path && c.method === method).length;
/** calendar_entries rpc calls, grouped by the range they asked for. */
const calendarCallsByRange = async () => {
  await waitForNetworkIdle();
  const byRange = {};
  calls
    .filter((c) => c.path === "rpc/calendar_entries")
    .forEach((c) => {
      const key = `${c.body?.p_from}..${c.body?.p_to}`;
      byRange[key] = (byRange[key] ?? 0) + 1;
    });
  return byRange;
};

beforeEach(() => {
  calls = [];
  handlers = [];
  const open = supabase.channel.bind(supabase);
  vi.spyOn(supabase, "channel").mockImplementation((topic, options) => {
    const channel = open(topic, options);
    const on = channel.on.bind(channel);
    channel.on = (type, filter, callback) => {
      handlers.push({ topic, callback });
      return on(type, filter, callback);
    };
    return channel;
  });
  server.events.on("request:start", onStart);
  stubRoomyScreen();
  window.localStorage.clear();
  const head = makeHead({ name: "Head Honcho", department: "SALES" });
  mocks.user = makeEmployee({ name: "Ana Reyes", department: "SALES" });
  insertRow("calendar_venues", { name: "Conference Room", active: true, sort_order: 1 });

  stubRpc("file_meeting_request", (body) => {
    const row = insertRow("meeting_requests", {
      applicant_id: mocks.user.id,
      venue_id: body.p_venue_id,
      starts_at: body.p_starts_at,
      ends_at: body.p_ends_at,
      facilitator_id: body.p_facilitator_id,
      purpose: body.p_purpose,
      guests: body.p_guests,
      status: "PENDING_HEAD",
      head_id: body.p_head_id ?? head.id,
    });
    insertRow("meeting_request_events", { request_id: row.id, actor_id: mocks.user.id, action: "FILED", to_status: row.status });
    return row.id;
  });
  stubRpc("calendar_entries", () =>
    db.rows("meeting_requests").map((m) => ({
      kind: "MEETING",
      id: m.id,
      group_id: m.id,
      starts_at: m.starts_at,
      ends_at: m.ends_at,
      all_day: false,
      manila_date: manilaDate(m.starts_at),
      employee: { id: mocks.user.id, name: mocks.user.name, department: "SALES", avatar: null },
      status: "PENDING",
      hours: 1,
      venue: "Conference Room",
      title: m.purpose,
      details: { stage: m.status, purpose: m.purpose, venue: "Conference Room", facilitator: { id: head.id, name: head.name }, participants: [], guests: [] },
    })),
  );
});

afterEach(() => {
  vi.restoreAllMocks();
  server.events.removeListener("request:start", onStart);
});

const renderPage = () =>
  renderWithProviders(
    <MemoryRouter initialEntries={["/calendar"]}>
      <CalendarPage />
    </MemoryRouter>,
  );

describe("Activity pages ask for each list once", () => {
  it("one Send request refetches the Calendar once per visible range", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole("button", { name: "New Meeting" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getAllByRole("combobox")[2]);
    await user.click(await screen.findByRole("option", { name: "Conference Room" }));
    fireEvent.change(within(dialog).getByDisplayValue(manilaToday()), { target: { value: tomorrow } });
    await user.click(within(dialog).getAllByRole("combobox")[5]);
    await user.click(await screen.findByRole("option", { name: "Head Honcho" }));
    await user.type(within(dialog).getByPlaceholderText("What is the Activity for?"), "Quarterly planning");
    const send = within(dialog).getByRole("button", { name: "Send request" });
    await waitFor(() => expect(send).toBeEnabled());
    await waitForNetworkIdle();

    calls = [];
    await user.click(send);
    await waitFor(() => expect(db.rows("meeting_requests")).toHaveLength(1));
    // The filing writes three tables; the broadcast reaches every open screen as it does on staging.
    handlers.forEach((h) => h.callback({}));
    // Longer than the refresh window, so a second wave would show up too.
    await sleep(700);

    const byRange = await calendarCallsByRange();
    expect(Object.keys(byRange).length).toBeGreaterThan(0);
    Object.entries(byRange).forEach(([range, n]) => expect(n, `calendar_entries ${range}`).toBeLessThanOrEqual(1));
  }, 30000);

  it("opening the New Activity form twice within a minute loads employees once", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole("button", { name: "New Meeting" }));
    await screen.findByRole("dialog");
    await waitForNetworkIdle();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: "New Meeting" }));
    await screen.findByRole("dialog");
    await waitForNetworkIdle();

    expect(count("employees")).toBe(1);
  }, 30000);

  describe("realtime", () => {
    it("a burst of signals from all three tables, heard by two screens, is one refetch of each list", async () => {
      insertRow("meeting_requests", {
        applicant_id: mocks.user.id,
        starts_at: new Date(`${manilaToday()}T09:00:00+08:00`).toISOString(),
        ends_at: new Date(`${manilaToday()}T10:00:00+08:00`).toISOString(),
        purpose: "Existing one",
        status: "PENDING_HEAD",
        facilitator_id: mocks.user.id,
      });
      renderWithProviders(
        <MemoryRouter initialEntries={["/calendar"]}>
          <Calendar />
          <MyMeetingRequests />
        </MemoryRouter>,
      );
      await screen.findByText("Existing one");
      await waitForNetworkIdle();
      expect(handlers.map((h) => h.topic).sort()).toEqual(["meeting_request_days-changes", "meeting_request_participants-changes", "meeting_requests-changes"]);

      const loaded = { calendar: count("rpc/calendar_entries", "POST"), requests: count("meeting_requests"), people: count("meeting_request_participants") };
      expect(loaded.calendar).toBe(1);

      // One filing by someone else: three tables, two signals each, in under 100 ms.
      handlers.forEach((h) => h.callback({}));
      handlers.forEach((h) => h.callback({}));
      await sleep(700);
      await waitForNetworkIdle();

      expect(count("rpc/calendar_entries", "POST")).toBe(loaded.calendar + 1);
      expect(count("meeting_requests")).toBe(loaded.requests * 2);
      expect(count("meeting_request_participants")).toBe(loaded.people * 2);
    }, 30000);
  });
});
