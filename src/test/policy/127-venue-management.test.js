/**
 * Venue management (#626, spec #609): HR and Super Admins add, rename, reorder and switch Venues off.
 * Employees and department heads are refused. A Venue with requests cannot be deleted (the database
 * restricts it); one with none can.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { ids, clientFor, ensureCastLoaded } from "./support/cast.js"
import { serviceClient } from "./support/stack.js"
import { tryInsert, tryUpdate, tryDelete, RLS_VIOLATION } from "./support/access.js"
import { MARKER } from "./support/rows.js"

const svc = () => serviceClient()
const made = []
const requests = []

const newVenue = async (suffix) => {
    const { data } = await svc().from("calendar_venues").insert({ name: `${MARKER} ${suffix}`, sort_order: 90 }).select("id").single()
    made.push(data.id)
    return data.id
}

beforeAll(async () => {
    await ensureCastLoaded()
})

afterAll(async () => {
    if (requests.length) await svc().from("meeting_requests").delete().in("id", requests)
    if (made.length) await svc().from("calendar_venues").delete().in("id", made)
})

describe.each(["hr", "superAdmin"])("%s", (who) => {
    it("adds, renames, reorders and switches a Venue off and on", async () => {
        const client = await clientFor(who)
        const added = await tryInsert(client, "calendar_venues", { name: `${MARKER} ${who} room`, sort_order: 91 })
        expect(added.ok).toBe(true)
        made.push(added.id)
        expect((await tryUpdate(client, "calendar_venues", added.id, { name: `${MARKER} ${who} hall` })).affected).toBe(1)
        expect((await tryUpdate(client, "calendar_venues", added.id, { sort_order: 5 })).affected).toBe(1)
        expect((await tryUpdate(client, "calendar_venues", added.id, { active: false })).affected).toBe(1)
        expect((await tryUpdate(client, "calendar_venues", added.id, { active: true })).affected).toBe(1)
    })

    it("deletes a Venue with no requests", async () => {
        const id = await newVenue(`${who} spare`)
        expect((await tryDelete(await clientFor(who), "calendar_venues", id)).affected).toBe(1)
    })

    it("cannot delete a Venue that has a request", async () => {
        const id = await newVenue(`${who} used`)
        const { data } = await svc()
            .from("meeting_requests")
            .insert({
                applicant_id: ids.ordinary,
                venue_id: id,
                starts_at: new Date("2032-05-03T09:00:00+08:00").toISOString(),
                ends_at: new Date("2032-05-03T10:00:00+08:00").toISOString(),
                facilitator_id: ids.head,
                purpose: `${MARKER} venue used`,
                status: "APPROVED",
                head_id: ids.head,
            })
            .select("id")
            .single()
        requests.push(data.id)
        const result = await tryDelete(await clientFor(who), "calendar_venues", id)
        expect(result.ok).toBe(false)
        expect(result.code).toBe("23503")
    })
})

describe.each(["ordinary", "head"])("%s", (who) => {
    it("is refused every Venue write", async () => {
        const client = await clientFor(who)
        const id = await newVenue(`${who} target`)
        const inserted = await tryInsert(client, "calendar_venues", { name: `${MARKER} ${who} sneaky`, sort_order: 92 })
        expect(inserted.ok).toBe(false)
        expect(inserted.code).toBe(RLS_VIOLATION)
        expect((await tryUpdate(client, "calendar_venues", id, { name: `${MARKER} renamed` })).affected).toBe(0)
        expect((await tryUpdate(client, "calendar_venues", id, { active: false })).affected).toBe(0)
        expect((await tryDelete(client, "calendar_venues", id)).affected).toBe(0)
    })
})
