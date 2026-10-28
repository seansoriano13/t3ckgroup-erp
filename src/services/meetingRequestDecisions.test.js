import { beforeEach, describe, expect, it } from "vitest"
import { meetingRequestService } from "./meetingRequestService"
import { db, insertRow } from "@/test/db/store"
import { pgrstError } from "@/test/db/schema"
import { stubRpc } from "@/test/msw/server"
import { waitForNetworkIdle } from "@/test/network"
import { makeEmployee, makeHead, makeHrEmployee } from "@/test/factories"

/**
 * #624: each transition writes an event row (the database function, stubbed here), a MEETING_REQUEST
 * audit line and the notifications. Who may act is the policy tier's job (125-meeting-request-decisions).
 */
describe("meetingRequestService decisions", () => {
  let head, hr, applicant, facilitator, participant, request

  const stubDecision = (toStatus, action, fromStatus = request.status) =>
    stubRpc("decide_meeting_request", () => {
      const row = db.rows("meeting_requests").find((r) => r.id === request.id)
      row.status = toStatus
      insertRow("meeting_request_events", { request_id: request.id, actor_id: hr.id, action, from_status: fromStatus, to_status: toStatus })
      return { id: request.id, action, from_status: fromStatus, to_status: toStatus, applicant_id: applicant.id, facilitator_id: facilitator.id, participant_ids: [participant.id] }
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

  it("head approval notifies HR and the applicant, and writes an event and audit line", async () => {
    stubDecision("PENDING_HR", "HEAD_APPROVED")
    await meetingRequestService.decide({ requestId: request.id, decision: "APPROVE", actor: head })
    await waitForNetworkIdle()

    expect(db.rows("meeting_request_events")).toHaveLength(1)
    expect(to("MEETING_REQUEST")).toContain(hr.id)
    expect(to("MEETING_REQUEST_DECISION")).toEqual([applicant.id])
    expect(to("MEETING_APPROVED")).toEqual([])
    expect(audit()).toHaveLength(1)
    expect(audit()[0]).toMatchObject({ entity_id: request.id, author_id: head.id })
  })

  it("final approval tells the applicant, the Facilitator and the Participants", async () => {
    request.status = "PENDING_HR"
    stubDecision("APPROVED", "HR_APPROVED", "PENDING_HR")
    await meetingRequestService.decide({ requestId: request.id, decision: "APPROVE", actor: hr })
    await waitForNetworkIdle()

    expect(to("MEETING_REQUEST_DECISION")).toEqual([applicant.id])
    expect(to("MEETING_APPROVED").sort()).toEqual([facilitator.id, participant.id].sort())
    expect(audit()).toHaveLength(1)
  })

  it("a return tells the applicant with the note", async () => {
    stubDecision("RETURNED", "HR_RETURNED")
    await meetingRequestService.decide({ requestId: request.id, decision: "RETURN", note: "Add an agenda", actor: hr })
    await waitForNetworkIdle()

    const note = db.rows("notifications").find((n) => n.type === "MEETING_REQUEST_DECISION")
    expect(note.recipient_id).toBe(applicant.id)
    expect(note.message).toContain("Add an agenda")
    expect(to("MEETING_REQUEST")).toEqual([])
  })

  it("surfaces the database's refusal and sends nothing", async () => {
    stubRpc("decide_meeting_request", () => {
      throw pgrstError("42501", "You cannot decide your own Meeting Request.", { status: 403 })
    })
    await expect(meetingRequestService.decide({ requestId: request.id, decision: "APPROVE", actor: applicant })).rejects.toThrow(/own Meeting Request/)
    await waitForNetworkIdle()
    expect(db.rows("notifications")).toHaveLength(0)
    expect(audit()).toHaveLength(0)
  })

  it("only HR and Super Admins have a queue, and it holds the pending-HR requests", async () => {
    insertRow("meeting_requests", { ...request, id: undefined, status: "PENDING_HR", head_id: null, starts_at: "2031-03-12T01:00:00.000Z", ends_at: "2031-03-12T02:00:00.000Z" })

    expect(await meetingRequestService.listPendingForApprover({ employeeId: head.id })).toEqual([])
    const queue = await meetingRequestService.listPendingForApprover({ employeeId: hr.id, isHr: true })
    expect(queue.map((r) => r.status)).toEqual(["PENDING_HR"])
    expect(await meetingRequestService.countPendingForApprover({ employeeId: hr.id, isHr: true })).toBe(1)
  })
})
