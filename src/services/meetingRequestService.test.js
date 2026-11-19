import { beforeEach, describe, expect, it } from "vitest"
import { meetingRequestService } from "./meetingRequestService"
import { db, insertRow } from "@/test/db/store"
import { pgrstError } from "@/test/db/schema"
import { stubRpc } from "@/test/msw/server"

// Mirrors the database's activity_needs_hr() for an ordinary filer: only a Meeting with a Venue waits for HR.
const needsHr = (activityType, venueId) => activityType === "MEETING" && Boolean(venueId)
import { waitForNetworkIdle } from "@/test/network"
import { makeEmployee, makeHead, makeHrEmployee } from "@/test/factories"

/**
 * #619: filing saves the request, its Participants and an event row, writes an audit line and
 * tells the routed head (or HR when the applicant is a head). The double-booking rule itself is
 * the database's (policy tier, 121-meeting-requests); here a clash only has to read plainly.
 */
describe("meetingRequestService.fileRequest", () => {
  let venue
  let head
  let applicant
  let participant

  const stubFiling = ({ clash = false } = {}) =>
    stubRpc("file_meeting_request", (body) => {
      if (clash) throw pgrstError("23P01", "conflicting key value violates exclusion constraint", { status: 409 })
      const row = insertRow("meeting_requests", {
        applicant_id: applicant.id,
        venue_id: body.p_venue_id,
        starts_at: body.p_starts_at,
        ends_at: body.p_ends_at,
        facilitator_id: body.p_facilitator_id,
        purpose: body.p_purpose,
        guests: body.p_guests,
        activity_type: body.p_activity_type,
        meeting_type: body.p_meeting_type,
        status: needsHr(body.p_activity_type, body.p_venue_id) ? "PENDING_HR" : "APPROVED",
        head_id: null,
      })
      for (const employee_id of body.p_participant_ids) insertRow("meeting_request_participants", { request_id: row.id, employee_id })
      insertRow("meeting_request_events", { request_id: row.id, actor_id: applicant.id, action: "FILED", to_status: row.status })
      return row.id
    })

  const input = () => ({
    venueId: venue.id,
    startsAt: "2031-03-10T01:00:00.000Z",
    endsAt: "2031-03-10T02:00:00.000Z",
    facilitatorId: head.id,
    purpose: "Quarterly planning",
    guests: ["Mr. Visitor"],
    participantIds: [participant.id],
    headId: head.id,
    applicant,
  })

  beforeEach(() => {
    venue = insertRow("calendar_venues", { name: "Conference Room", active: true, sort_order: 1 })
    head = makeHead({ name: "Head Honcho" })
    applicant = makeEmployee({ name: "Ana Reyes" })
    participant = makeEmployee({ name: "Pat Cruz" })
    makeHrEmployee({ name: "HR Officer" })
  })

  it("saves the request, its Participants and an event row", async () => {
    stubFiling()
    const request = await meetingRequestService.fileRequest(input())

    expect(request).toMatchObject({ status: "PENDING_HR", activity_type: "MEETING", purpose: "Quarterly planning", guests: ["Mr. Visitor"], head_id: null })
    expect(db.rows("meeting_request_participants").map((p) => p.employee_id)).toEqual([participant.id])
    expect(db.rows("meeting_request_events")).toHaveLength(1)
    expect(request.events).toHaveLength(1)
  })

  it("writes a MEETING_REQUEST audit line and tells HR about a room Meeting", async () => {
    stubFiling()
    const request = await meetingRequestService.fileRequest(input())
    await waitForNetworkIdle()

    const audit = db.rows("system_audit_logs").find((e) => e.entity_type === "MEETING_REQUEST")
    expect(audit).toMatchObject({ entity_id: request.id, author_id: applicant.id })
    const hrIds = db.rows("employees").filter((e) => e.is_hr).map((e) => e.id)
    const told = db.rows("notifications").filter((n) => n.type === "MEETING_REQUEST").map((n) => n.recipient_id)
    expect(told).toEqual(expect.arrayContaining(hrIds))
    expect(db.rows("notifications").filter((n) => n.type === "MEETING_APPROVED")).toHaveLength(0)
  })

  it("approves a task at once and tells the Lead and Participants, not HR", async () => {
    stubFiling()
    const request = await meetingRequestService.fileRequest({ ...input(), activityType: "ADMIN_TASK", venueId: null })
    await waitForNetworkIdle()

    expect(request).toMatchObject({ status: "APPROVED", activity_type: "ADMIN_TASK", venue_id: null, meeting_type: null })
    const told = db.rows("notifications").filter((n) => n.type === "MEETING_APPROVED").map((n) => n.recipient_id)
    expect(told.sort()).toEqual([head.id, participant.id].sort())
    expect(db.rows("notifications").filter((n) => n.type === "MEETING_REQUEST")).toHaveLength(0)
  })

  it("does not tell the person filing when they are also the Lead", async () => {
    stubFiling()
    await meetingRequestService.fileRequest({ ...input(), activityType: "OPERATIONS_TASK", venueId: null, facilitatorId: applicant.id })
    await waitForNetworkIdle()

    const told = db.rows("notifications").filter((n) => n.type === "MEETING_APPROVED").map((n) => n.recipient_id)
    expect(told).toEqual([participant.id])
  })

  it("tells them \"You're on an Activity\" with the type, the date, the time and who scheduled it", async () => {
    stubFiling()
    await meetingRequestService.fileRequest({ ...input(), activityType: "ADMIN_TASK", venueId: null })
    await waitForNetworkIdle()

    const [note] = db.rows("notifications").filter((n) => n.type === "MEETING_APPROVED" && n.recipient_id === participant.id)
    expect(note.title).toBe("You're on an Activity")
    expect(note.message).toContain("Admin Task")
    expect(note.message).toContain("Mar 10, 2031")
    expect(note.message).toContain("9:00 AM")
    expect(note.message).toMatch(/9:00 AM to 10:00/)
    expect(note.message).toContain("Scheduled by Ana Reyes")
  })

  it("tells no one before a room Meeting is approved", async () => {
    stubFiling()
    await meetingRequestService.fileRequest(input())
    await waitForNetworkIdle()
    expect(db.rows("notifications").filter((n) => n.title === "You're on an Activity")).toHaveLength(0)
  })

  it("sends a Meeting-only field only for a Meeting", async () => {
    stubFiling()
    await meetingRequestService.fileRequest({ ...input(), activityType: "EVENT", meetingType: "HYBRID", meetingLink: "https://x.test/a" })
    const [row] = db.rows("meeting_requests")
    expect(row).toMatchObject({ activity_type: "EVENT", venue_id: null, meeting_type: null })
  })

  it("turns a clash into a plain message naming the request that holds the slot", async () => {
    stubFiling({ clash: true })
    stubRpc("meeting_request_holder", [
      {
        id: "held",
        purpose: "Sales huddle",
        starts_at: "2031-03-10T00:30:00.000Z",
        ends_at: "2031-03-10T01:30:00.000Z",
        applicant_name: "Dana Lim",
        venue_name: "Conference Room",
      },
    ])

    await expect(meetingRequestService.fileRequest(input())).rejects.toThrow(
      /Conference Room is already held 08:30 to 09:30 for "Sales huddle" \(requested by Dana Lim\)/,
    )
    expect(db.rows("meeting_requests")).toHaveLength(0)
  })

  it("asks who holds the slot by day, so a multi-day room Meeting is checked per day", async () => {
    stubFiling({ clash: true })
    let body
    stubRpc("meeting_request_holder", (b) => {
      body = b
      return []
    })
    const days = [
      { startsAt: "2031-03-10T01:00:00.000Z", endsAt: "2031-03-10T02:00:00.000Z" },
      { startsAt: "2031-03-12T01:00:00.000Z", endsAt: "2031-03-12T02:00:00.000Z" },
    ]
    await expect(meetingRequestService.fileRequest({ ...input(), days })).rejects.toThrow(/already booked/)
    expect(body.p_days).toEqual([
      { starts_at: days[0].startsAt, ends_at: days[0].endsAt },
      { starts_at: days[1].startsAt, ends_at: days[1].endsAt },
    ])
  })
})

describe("meetingRequestService.fileRequest over several days (#1056)", () => {
  it("sends every day to the filing function, with the first day as the start", async () => {
    const applicant = makeEmployee({ name: "Ana Reyes" })
    let body
    stubRpc("file_meeting_request", (b) => {
      body = b
      return insertRow("meeting_requests", {
        applicant_id: applicant.id,
        starts_at: b.p_starts_at,
        ends_at: b.p_ends_at,
        facilitator_id: b.p_facilitator_id,
        purpose: b.p_purpose,
        guests: [],
        activity_type: b.p_activity_type,
        status: "APPROVED",
      }).id
    })
    const days = [
      { startsAt: "2031-03-14T01:00:00.000Z", endsAt: "2031-03-14T02:00:00.000Z" },
      { startsAt: "2031-03-15T01:00:00.000Z", endsAt: "2031-03-15T04:00:00.000Z" },
    ]
    await meetingRequestService.fileRequest({
      activityType: "OPERATIONS_TASK",
      startsAt: days[0].startsAt,
      endsAt: days[0].endsAt,
      days,
      facilitatorId: applicant.id,
      purpose: "Stock count",
      applicant,
    })
    expect(body.p_days).toEqual([
      { starts_at: days[0].startsAt, ends_at: days[0].endsAt },
      { starts_at: days[1].startsAt, ends_at: days[1].endsAt },
    ])
    expect(body.p_starts_at).toBe(days[0].startsAt)
  })
})

/**
 * #1084: an edit that changes nothing is a no-op in the database (policy tier, 1084-edit-no-change). Here the service
 * has only to stay quiet on that answer, and to keep telling HR once when something did change.
 */
describe("meetingRequestService.editRequest (#1084)", () => {
  let venue
  let applicant
  let request

  const edit = () =>
    meetingRequestService.editRequest({
      requestId: request.id,
      venueId: venue.id,
      startsAt: request.starts_at,
      endsAt: request.ends_at,
      facilitatorId: applicant.id,
      purpose: "Quarterly planning",
      actor: applicant,
    })
  const base = () => ({ id: request.id, from_status: "APPROVED", applicant_id: applicant.id, facilitator_id: applicant.id, old_facilitator_id: applicant.id, participant_ids: [], old_participant_ids: [] })

  beforeEach(() => {
    venue = insertRow("calendar_venues", { name: "Conference Room", active: true, sort_order: 1 })
    applicant = makeEmployee({ name: "Ana Reyes" })
    makeHrEmployee({ name: "HR Officer" })
    request = insertRow("meeting_requests", {
      applicant_id: applicant.id,
      venue_id: venue.id,
      starts_at: "2031-03-10T01:00:00.000Z",
      ends_at: "2031-03-10T02:00:00.000Z",
      facilitator_id: applicant.id,
      purpose: "Quarterly planning",
      guests: [],
      activity_type: "MEETING",
      meeting_type: "ONSITE",
      status: "APPROVED",
    })
  })

  it("sends no notification and writes no audit line when nothing changed", async () => {
    stubRpc("edit_meeting_request", () => ({ ...base(), action: "NO_CHANGE", no_change: true, to_status: "APPROVED", changed_fields: {} }))
    const result = await edit()
    await waitForNetworkIdle()

    expect(result.action).toBe("NO_CHANGE")
    expect(db.rows("notifications")).toHaveLength(0)
    expect(db.rows("system_audit_logs").filter((e) => e.entity_type === "MEETING_REQUEST")).toHaveLength(0)
  })

  it("tells HR once, and writes the audit line, when a real change sends it back", async () => {
    stubRpc("edit_meeting_request", () => ({ ...base(), action: "EDITED", to_status: "PENDING_HR", changed_fields: { ends_at: { from: "a", to: "b" } } }))
    await edit()
    await waitForNetworkIdle()

    const hrIds = db.rows("employees").filter((e) => e.is_hr).map((e) => e.id)
    const told = db.rows("notifications").filter((n) => n.type === "MEETING_REQUEST").map((n) => n.recipient_id)
    expect(told.sort()).toEqual(hrIds.sort())
    expect(db.rows("system_audit_logs").filter((e) => e.entity_type === "MEETING_REQUEST")).toHaveLength(1)
  })
})

/** The HR queue's count and its events read (#1083 review): a head-only count, and the events in chunks of ids. */
describe("meetingRequestService pending queue", () => {
  it("counts the requests waiting on HR, and nobody else's queue", async () => {
    const applicant = makeEmployee({ name: "Ana Reyes" })
    const venue = insertRow("calendar_venues", { name: "Conference Room", active: true, sort_order: 1 })
    const filed = (status) =>
      insertRow("meeting_requests", { applicant_id: applicant.id, venue_id: venue.id, starts_at: "2031-03-10T01:00:00.000Z", ends_at: "2031-03-10T02:00:00.000Z", facilitator_id: applicant.id, purpose: "Sync", guests: [], status })
    filed("PENDING_HR")
    filed("PENDING_HR")
    filed("APPROVED")

    expect(await meetingRequestService.countPendingForApprover({ isHr: true })).toBe(2)
    expect(await meetingRequestService.countPendingForApprover({ isSuperAdmin: true })).toBe(2)
    expect(await meetingRequestService.countPendingForApprover({})).toBe(0)
  })

  it("gives every request in a long queue its own events", async () => {
    const applicant = makeEmployee({ name: "Ana Reyes" })
    const venue = insertRow("calendar_venues", { name: "Conference Room", active: true, sort_order: 1 })
    const requests = Array.from({ length: 230 }, (_, i) => {
      const r = insertRow("meeting_requests", { applicant_id: applicant.id, venue_id: venue.id, starts_at: "2031-03-10T01:00:00.000Z", ends_at: "2031-03-10T02:00:00.000Z", facilitator_id: applicant.id, purpose: `Sync ${i}`, guests: [], status: "PENDING_HR" })
      insertRow("meeting_request_events", { request_id: r.id, actor_id: applicant.id, action: "FILED", from_status: null, to_status: "PENDING_HR" })
      return r
    })

    const queue = await meetingRequestService.listPendingForApprover({ isHr: true })
    expect(queue).toHaveLength(requests.length)
    for (const row of queue) expect(row.events.map((e) => e.request_id)).toEqual([row.id])
  })
})
