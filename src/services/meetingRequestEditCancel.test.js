import { beforeEach, describe, expect, it } from "vitest"
import { meetingRequestService } from "./meetingRequestService"
import { db, insertRow } from "@/test/db/store"
import { pgrstError } from "@/test/db/schema"
import { stubRpc } from "@/test/msw/server"
import { waitForNetworkIdle } from "@/test/network"
import { makeEmployee, makeHead, makeHrEmployee } from "@/test/factories"

/**
 * #628: edit, send again and cancel each write an event row (the database function, stubbed here),
 * a MEETING_REQUEST audit line and the notifications. Who may act is the policy tier's job (129).
 */
describe("meetingRequestService edit, resend and cancel", () => {
  let head, hr, applicant, facilitator, participant, request

  const result = (over) => ({
    id: request.id, applicant_id: applicant.id, facilitator_id: facilitator.id, participant_ids: [participant.id],
    old_participant_ids: [participant.id], old_facilitator_id: facilitator.id, head_id: head.id, changed_fields: {}, ...over,
  })
  const stub = (name, over) =>
    stubRpc(name, () => {
      insertRow("meeting_request_events", { request_id: request.id, actor_id: applicant.id, action: over.action, changed_fields: over.changed_fields ?? null })
      return result(over)
    })

  beforeEach(() => {
    const venue = insertRow("calendar_venues", { name: "Conference Room", active: true, sort_order: 1 })
    head = makeHead({ name: "Head Honcho" })
    hr = makeHrEmployee({ name: "HR Officer" })
    applicant = makeEmployee({ name: "Ana Reyes" })
    facilitator = makeHead({ name: "Fay Facilitator" })
    participant = makeEmployee({ name: "Pat Cruz" })
    request = insertRow("meeting_requests", {
      applicant_id: applicant.id, venue_id: venue.id, starts_at: "2031-03-10T01:00:00.000Z", ends_at: "2031-03-10T02:00:00.000Z",
      facilitator_id: facilitator.id, purpose: "Planning", guests: [], status: "PENDING_HEAD", head_id: head.id,
    })
    insertRow("meeting_request_participants", { request_id: request.id, employee_id: participant.id })
  })

  const to = (type) => db.rows("notifications").filter((n) => n.type === type).map((n) => n.recipient_id)
  const audit = () => db.rows("system_audit_logs").filter((e) => e.entity_type === "MEETING_REQUEST")
  const editArgs = () => ({
    requestId: request.id, venueId: request.venue_id, startsAt: request.starts_at, endsAt: request.ends_at,
    facilitatorId: facilitator.id, purpose: "New purpose", guests: [], participantIds: [participant.id], headId: head.id, actor: applicant,
  })

  it("an edit that puts an approved request back tells the head, the Facilitator and Participants, with the changed fields", async () => {
    stub("edit_meeting_request", {
      action: "EDITED", from_status: "APPROVED", to_status: "PENDING_HEAD",
      changed_fields: { purpose: { from: "Planning", to: "New purpose" } },
    })
    await meetingRequestService.editRequest(editArgs())
    await waitForNetworkIdle()

    expect(db.rows("meeting_request_events")[0].changed_fields).toHaveProperty("purpose")
    expect(to("MEETING_REQUEST")).toEqual([head.id])
    expect(to("MEETING_CHANGED").sort()).toEqual([facilitator.id, participant.id].sort())
    expect(audit()).toHaveLength(1)
    expect(audit()[0].content).toContain("purpose")
    expect(audit()[0]).toMatchObject({ entity_id: request.id, author_id: applicant.id })
  })

  it("an edit of a pending-head request tells nobody new", async () => {
    stub("edit_meeting_request", { action: "EDITED", from_status: "PENDING_HEAD", to_status: "PENDING_HEAD" })
    await meetingRequestService.editRequest(editArgs())
    await waitForNetworkIdle()

    expect(to("MEETING_REQUEST")).toEqual([])
    expect(to("MEETING_CHANGED")).toEqual([])
    expect(audit()).toHaveLength(1)
  })

  it("sending again tells the head and writes an event and audit line", async () => {
    stub("resend_meeting_request", { action: "RESENT", from_status: "RETURNED", to_status: "PENDING_HEAD" })
    await meetingRequestService.resend({ requestId: request.id, actor: applicant })
    await waitForNetworkIdle()

    expect(db.rows("meeting_request_events")).toHaveLength(1)
    expect(to("MEETING_REQUEST")).toEqual([head.id])
    expect(audit()).toHaveLength(1)
  })

  it("sending a head applicant's request again goes to HR", async () => {
    stub("resend_meeting_request", { action: "RESENT", from_status: "RETURNED", to_status: "PENDING_HR" })
    await meetingRequestService.resend({ requestId: request.id, actor: applicant })
    await waitForNetworkIdle()
    expect(to("MEETING_REQUEST")).toContain(hr.id)
  })

  it("cancelling an approved request by the applicant tells the Facilitator and Participants", async () => {
    stub("cancel_meeting_request", { action: "CANCELLED", from_status: "APPROVED", to_status: "CANCELLED" })
    await meetingRequestService.cancel({ requestId: request.id, actor: applicant })
    await waitForNetworkIdle()

    expect(to("MEETING_CANCELLED").sort()).toEqual([facilitator.id, participant.id].sort())
    expect(to("MEETING_REQUEST_DECISION")).toEqual([])
    expect(audit()).toHaveLength(1)
  })

  it("HR cancelling tells the applicant with the reason, and the invitees if it was approved", async () => {
    stub("cancel_meeting_request", { action: "HR_CANCELLED", from_status: "APPROVED", to_status: "CANCELLED" })
    await meetingRequestService.cancel({ requestId: request.id, reason: "Audit in the room", actor: hr })
    await waitForNetworkIdle()

    const note = db.rows("notifications").find((n) => n.type === "MEETING_REQUEST_DECISION")
    expect(note.recipient_id).toBe(applicant.id)
    expect(note.message).toContain("Audit in the room")
    expect(to("MEETING_CANCELLED")).toHaveLength(2)
    expect(audit()[0].content).toContain("Audit in the room")
  })

  it("cancelling a request that was never approved tells no invitee", async () => {
    stub("cancel_meeting_request", { action: "CANCELLED", from_status: "PENDING_HEAD", to_status: "CANCELLED" })
    await meetingRequestService.cancel({ requestId: request.id, actor: applicant })
    await waitForNetworkIdle()
    expect(to("MEETING_CANCELLED")).toEqual([])
  })

  it("surfaces the database's refusal and sends nothing", async () => {
    stubRpc("cancel_meeting_request", () => {
      throw pgrstError("22023", "This meeting has already started, so it can no longer be cancelled.", { status: 400 })
    })
    await expect(meetingRequestService.cancel({ requestId: request.id, actor: applicant })).rejects.toThrow(/already started/)
    await waitForNetworkIdle()
    expect(db.rows("notifications")).toHaveLength(0)
    expect(audit()).toHaveLength(0)
  })

  it("turns a clash on edit into the plain message", async () => {
    stubRpc("edit_meeting_request", () => {
      throw pgrstError("23P01", "conflicting key value violates exclusion constraint", { status: 409 })
    })
    stubRpc("meeting_request_holder", () => [
      { id: "x", purpose: "Board", starts_at: request.starts_at, ends_at: request.ends_at, applicant_name: "Dana", venue_name: "Conference Room" },
    ])
    await expect(meetingRequestService.editRequest(editArgs())).rejects.toThrow(/already held.*Board/)
  })
})
