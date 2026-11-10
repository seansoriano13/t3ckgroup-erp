import { beforeEach, describe, expect, it } from "vitest"
import { meetingRequestService } from "./meetingRequestService"
import { db, insertRow } from "@/test/db/store"
import { pgrstError } from "@/test/db/schema"
import { stubRpc } from "@/test/msw/server"
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
      const isHead = Boolean(applicant.is_head)
      const row = insertRow("meeting_requests", {
        applicant_id: applicant.id,
        venue_id: body.p_venue_id,
        starts_at: body.p_starts_at,
        ends_at: body.p_ends_at,
        facilitator_id: body.p_facilitator_id,
        purpose: body.p_purpose,
        guests: body.p_guests,
        status: isHead ? "PENDING_HR" : "PENDING_HEAD",
        head_id: isHead ? null : body.p_head_id,
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

    expect(request).toMatchObject({ status: "PENDING_HEAD", purpose: "Quarterly planning", guests: ["Mr. Visitor"], head_id: head.id })
    expect(db.rows("meeting_request_participants").map((p) => p.employee_id)).toEqual([participant.id])
    expect(db.rows("meeting_request_events")).toHaveLength(1)
    expect(request.events).toHaveLength(1)
  })

  it("writes a MEETING_REQUEST audit line and notifies the routed head", async () => {
    stubFiling()
    const request = await meetingRequestService.fileRequest(input())
    await waitForNetworkIdle()

    const audit = db.rows("system_audit_logs").find((e) => e.entity_type === "MEETING_REQUEST")
    expect(audit).toMatchObject({ entity_id: request.id, author_id: applicant.id })
    const told = db.rows("notifications").filter((n) => n.type === "MEETING_REQUEST")
    expect(told.map((n) => n.recipient_id)).toEqual([head.id])
  })

  it("sends a head applicant's request to HR, not to a head", async () => {
    applicant = makeHead({ name: "Other Head" })
    stubFiling()
    const request = await meetingRequestService.fileRequest({ ...input(), headId: null, applicant })
    await waitForNetworkIdle()

    expect(request.status).toBe("PENDING_HR")
    const hrIds = db.rows("employees").filter((e) => e.is_hr).map((e) => e.id)
    const told = db.rows("notifications").filter((n) => n.type === "MEETING_REQUEST").map((n) => n.recipient_id)
    expect(told).toEqual(expect.arrayContaining(hrIds))
    expect(told).not.toContain(head.id)
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
})
