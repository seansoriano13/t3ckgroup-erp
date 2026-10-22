/**
 * #619 (spec #609): filing a Meeting Request from the Calendar page puts it in
 * "My Meeting Requests" and, faded (pending), on the Calendar. The database
 * functions are stubbed against the fake store; the clash rule is the policy tier's.
 */
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import CalendarPage from "@/pages/calendar/index";
import { renderWithProviders } from "@/test/support";
import { makeEmployee, makeHead } from "@/test/factories";
import { db, insertRow } from "@/test/db/store";
import { stubRpc } from "@/test/msw/server";
import { manilaDate, manilaToday } from "@/lib/manilaDate.js";

const mocks = vi.hoisted(() => ({ user: null }));

vi.mock("@/context/AuthContext", () => ({
  useAuth: () => ({ user: mocks.user, isAuthLoading: false }),
}));

// Tomorrow in Manila, so the form's "not in the past" rule always passes.
const tomorrow = manilaDate(new Date(Date.now() + 24 * 3600 * 1000));

beforeEach(() => {
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

describe("Meeting Request from the Calendar page", () => {
  it("shows the filed request under My Meeting Requests and, faded, on the Calendar", async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <MemoryRouter initialEntries={["/calendar"]}>
        <CalendarPage />
      </MemoryRouter>,
    );

    await user.click(await screen.findByRole("button", { name: "New Meeting Request" }));
    const dialog = await screen.findByRole("dialog");

    await user.click(within(dialog).getAllByRole("combobox")[0]);
    await user.click(await screen.findByRole("option", { name: "Conference Room" }));
    const date = within(dialog).getByDisplayValue(manilaToday());
    fireEvent.change(date, { target: { value: tomorrow } });
    await user.click(within(dialog).getAllByRole("combobox")[3]);
    await user.click(await screen.findByRole("option", { name: "Head Honcho" }));
    await user.type(within(dialog).getByPlaceholderText("What is the meeting for?"), "Quarterly planning");

    const send = within(dialog).getByRole("button", { name: "Send request" });
    await waitFor(() => expect(send).toBeEnabled());
    await user.click(send);

    await waitFor(() => expect(db.rows("meeting_requests")).toHaveLength(1));
    expect(db.rows("meeting_request_events")).toHaveLength(1);

    await user.click(await screen.findByRole("tab", { name: "My Meeting Requests" }));
    const list = await screen.findByTestId("my-meeting-requests");
    expect(within(list).getByText("Quarterly planning")).toBeInTheDocument();
    expect(within(list).getByText("Waiting for head")).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "Calendar" }));
    // Tomorrow is in this month's grid unless today ends a month on a Sunday.
    await screen.findByTestId("calendar-month");
    if (!screen.queryByTestId(`day-${tomorrow}`)) await user.click(screen.getByRole("button", { name: "Next month" }));
    await user.click(await screen.findByTestId(`day-${tomorrow}`));
    const rooms = within(screen.getByTestId("day-rail")).getByRole("region", { name: "Rooms" });
    expect(await within(rooms).findByText("Quarterly planning")).toHaveClass("italic");
    expect(within(rooms).getByText("Waiting for head")).toBeInTheDocument();
  }, 30000);
});
