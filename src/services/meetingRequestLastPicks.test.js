import { beforeEach, describe, expect, it } from "vitest"
import { meetingRequestService } from "./meetingRequestService"
import { insertRow } from "@/test/db/store"
import { makeEmployee, makeHead } from "@/test/factories"

describe("meetingRequestService.lastPicks", () => {
  let applicant
  let venueA
  let venueB
  let headA
  let headB

  beforeEach(() => {
    applicant = makeEmployee({ name: "Ana Reyes" })
    venueA = insertRow("calendar_venues", { name: "Conference Room", active: true, sort_order: 1 })
    venueB = insertRow("calendar_venues", { name: "Admin Office", active: true, sort_order: 2 })
    headA = makeHead({ name: "Head A" })
    headB = makeHead({ name: "Head B" })
  })

  const file = (venue, facilitator, created_at, applicant_id = applicant.id) =>
    insertRow("meeting_requests", {
      applicant_id,
      venue_id: venue.id,
      facilitator_id: facilitator.id,
      starts_at: "2031-03-10T01:00:00.000Z",
      ends_at: "2031-03-10T02:00:00.000Z",
      purpose: "x",
      status: "PENDING_HEAD",
      created_at,
    })

  it("returns the most recent request's Facilitator and Venue", async () => {
    file(venueA, headA, "2031-01-01T00:00:00.000Z")
    file(venueB, headB, "2031-02-01T00:00:00.000Z")
    file(venueA, headA, "2031-03-01T00:00:00.000Z", makeEmployee({ name: "Someone Else" }).id)

    expect(await meetingRequestService.lastPicks(applicant.id)).toEqual({ facilitatorId: headB.id, venueId: venueB.id })
  })

  it("returns nothing when the applicant has no request", async () => {
    expect(await meetingRequestService.lastPicks(applicant.id)).toBeNull()
  })
})
