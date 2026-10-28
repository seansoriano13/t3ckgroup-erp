import { fireEvent, screen, waitFor, within } from "@testing-library/react"
import { MemoryRouter } from "react-router"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { manilaDate, manilaToday } from "@/lib/manilaDate.js"
import { supabase } from "@/lib/supabase"
import { db, insertRow } from "@/test/db/store"
import { makeEmployee, makeHead, makeHrEmployee } from "@/test/factories"
import { stubRpc } from "@/test/msw/server"
import { renderWithProviders, setupUser } from "@/test/support"

/**
 * End-to-end journey for a Meeting Request (#624, spec #609): an employee files from the Calendar's
 * quick action, the department head approves in the Approval Center, HR approves, and the meeting
 * shows as approved on the Calendar.
 *
 * The page, the services and the fake database are real. Only the three database functions
 * (file, decide, calendar read) are stubbed with the same state machine the migrations implement;
 * who may act at each step, and the notes, are the policy tier's (src/test/policy).
 */

const mockUser = vi.hoisted(() => ({ current: null }))
const auth = () => ({ user: mockUser.current, isAuthLoading: false })

vi.mock("@/context/AuthContext", () => ({ useAuth: auth }))
vi.mock("@/pages/../context/AuthContext", () => ({ useAuth: auth }))

const tomorrow = manilaDate(new Date(Date.now() + 24 * 3600 * 1000))

let applicant
let head
let hr

const STEP = {
    PENDING_HR: { action: "HR_APPROVED", to: "APPROVED" },
}

beforeEach(() => {
    window.localStorage.clear()
    head = makeHead({ name: "Head Honcho", department: "SALES" })
    hr = makeHrEmployee({ name: "Hana Resources" })
    applicant = makeEmployee({ name: "Ana Reyes", department: "SALES" })
    mockUser.current = applicant
    insertRow("calendar_venues", { name: "Conference Room", active: true, sort_order: 1 })

    stubRpc("file_meeting_request", (body) => {
        const row = insertRow("meeting_requests", {
            applicant_id: applicant.id,
            venue_id: body.p_venue_id,
            starts_at: body.p_starts_at,
            ends_at: body.p_ends_at,
            facilitator_id: body.p_facilitator_id,
            purpose: body.p_purpose,
            guests: body.p_guests,
            status: "PENDING_HR",
            head_id: null,
        })
        insertRow("meeting_request_events", { request_id: row.id, actor_id: applicant.id, action: "FILED", to_status: row.status })
        return row.id
    })

    stubRpc("decide_meeting_request", async (body) => {
        const row = db.rows("meeting_requests").find((r) => r.id === body.p_request_id)
        const step = STEP[row.status]
        if (!step) throw new Error("Nothing to decide")
        const from = row.status
        await supabase.from("meeting_requests").update({ status: step.to }).eq("id", row.id)
        insertRow("meeting_request_events", { request_id: row.id, actor_id: mockUser.current.id, action: step.action, from_status: from, to_status: step.to })
        return { id: row.id, action: step.action, from_status: from, to_status: step.to }
    })

    stubRpc("calendar_entries", () =>
        db.rows("meeting_requests").map((m) => ({
            kind: "MEETING",
            id: m.id,
            group_id: m.id,
            starts_at: m.starts_at,
            ends_at: m.ends_at,
            all_day: false,
            manila_date: manilaDate(m.starts_at),
            employee: { id: applicant.id, name: applicant.name, department: "SALES", avatar: null },
            status: m.status === "APPROVED" ? "APPROVED" : "PENDING",
            hours: 1,
            venue: "Conference Room",
            title: m.purpose,
            details: { stage: m.status, purpose: m.purpose, venue: "Conference Room", facilitator: { id: head.id, name: head.name }, participants: [], guests: [] },
        })),
    )
})

const statusOf = () => db.rows("meeting_requests")[0].status

async function approveInQueue(user, as, applicantName) {
    mockUser.current = as
    const Page = (await import("@/pages/approvals/meetings/index.jsx")).default
    const view = renderWithProviders(
        <MemoryRouter initialEntries={["/approvals/meetings"]}>
            <Page />
        </MemoryRouter>,
    )
    await user.click(await screen.findByRole("button", { name: `Approve ${applicantName}'s meeting request` }, { timeout: 5000 }))
    return view
}

describe("Meeting Request journey", () => {
    it("is filed, sent straight to HR, approved by HR, and shows as approved on the Calendar", { timeout: 60000 }, async () => {
        const user = setupUser()

        // 1. The employee files from the Calendar's quick action.
        const CalendarPage = (await import("@/pages/calendar/index")).default
        const filing = renderWithProviders(
            <MemoryRouter initialEntries={["/calendar"]}>
                <CalendarPage />
            </MemoryRouter>,
        )
        await user.click(await screen.findByRole("button", { name: "New Meeting Request" }))
        const dialog = await screen.findByRole("dialog")
        await user.click(within(dialog).getAllByRole("combobox")[1])
        await user.click(await screen.findByRole("option", { name: "Conference Room" }))
        fireEvent.change(within(dialog).getByDisplayValue(manilaToday()), { target: { value: tomorrow } })
        await user.click(within(dialog).getAllByRole("combobox")[4])
        await user.click(await screen.findByRole("option", { name: "Head Honcho" }))
        await user.type(within(dialog).getByPlaceholderText("What is the meeting for?"), "Quarterly planning")
        const send = within(dialog).getByRole("button", { name: "Send request" })
        await waitFor(() => expect(send).toBeEnabled())
        await user.click(send)
        await waitFor(() => expect(statusOf()).toBe("PENDING_HR"))
        filing.unmount()

        // 2. HR approves the request that reached its step.
        const hrView = await approveInQueue(user, hr, "Ana Reyes")
        await waitFor(() => expect(statusOf()).toBe("APPROVED"))
        hrView.unmount()

        expect(db.rows("meeting_request_events").map((e) => e.action)).toEqual(["FILED", "HR_APPROVED"])

        // 3. The meeting is on the Calendar, no longer faded as pending.
        mockUser.current = applicant
        renderWithProviders(
            <MemoryRouter initialEntries={[`/calendar?date=${tomorrow}`]}>
                <CalendarPage />
            </MemoryRouter>,
        )
        const rooms = within(await screen.findByTestId("day-rail")).getByRole("region", { name: "Rooms" })
        expect(await within(rooms).findByText("Quarterly planning")).not.toHaveClass("italic")
        expect(within(rooms).queryByText(/Waiting for/)).not.toBeInTheDocument()
    })
})
