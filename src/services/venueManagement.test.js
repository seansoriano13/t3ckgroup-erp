import { beforeEach, describe, expect, it } from "vitest"
import { meetingRequestService } from "./meetingRequestService"
import { systemAuditLogService } from "./systemAuditLogService"
import { insertRow } from "@/test/db/store"
import { makeHrEmployee } from "@/test/factories"

/** #626: every Venue change writes an audit line; the request form only lists open Venues. */
describe("meetingRequestService venue management", () => {
  let actor
  let conference

  beforeEach(() => {
    actor = makeHrEmployee({ name: "Hera HR" })
    conference = insertRow("calendar_venues", { name: "Conference Room", active: true, sort_order: 1 })
    insertRow("calendar_venues", { name: "Admin Office", active: true, sort_order: 2 })
  })

  const events = async () => (await systemAuditLogService.getRecentSystemActivity()).map((e) => e.metadata?.event)

  it("adds a Venue at the end and audits it", async () => {
    const venue = await meetingRequestService.addVenue("  Pantry  ", actor.id)
    expect(venue).toMatchObject({ name: "Pantry", sort_order: 3 })
    expect(await events()).toContain("VENUE_CREATED")
  })

  it("renames, switches off and on, reorders and deletes, each with an audit line", async () => {
    await meetingRequestService.renameVenue(conference, "Board Room", actor.id)
    await meetingRequestService.setVenueActive(conference, false, actor.id)
    await meetingRequestService.setVenueActive(conference, true, actor.id)
    const all = await meetingRequestService.listVenues({ includeInactive: true })
    await meetingRequestService.reorderVenues([all[1], all[0]], actor.id)
    await meetingRequestService.deleteVenue(all[0], actor.id)
    const logged = await events()
    for (const e of ["VENUE_RENAMED", "VENUE_SWITCHED_OFF", "VENUE_SWITCHED_ON", "VENUES_REORDERED", "VENUE_DELETED"]) {
      expect(logged).toContain(e)
    }
  })

  it("lists only open Venues unless asked for all", async () => {
    await meetingRequestService.setVenueActive(conference, false, actor.id)
    expect((await meetingRequestService.listVenues()).map((v) => v.name)).toEqual(["Admin Office"])
    expect(await meetingRequestService.listVenues({ includeInactive: true })).toHaveLength(2)
  })
})
