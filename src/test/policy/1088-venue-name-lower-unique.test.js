/**
 * A Venue name is the same name whatever its capitals (#1088, spec #1083, tracker C2).
 *
 *   "a" next to "A" is refused with a unique violation (23505), on add and on rename
 *   a different name is still accepted
 *   the check is made by the database, so it holds for HR going through the ordinary client
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { clientFor, ensureCastLoaded } from "./support/cast.js"
import { serviceClient } from "./support/stack.js"
import { tryInsert, tryUpdate } from "./support/access.js"
import { MARKER } from "./support/rows.js"

const svc = () => serviceClient()
const made = []

beforeAll(async () => {
    await ensureCastLoaded()
})

afterAll(async () => {
    if (made.length) await svc().from("calendar_venues").delete().in("id", made)
})

describe("Venue names are unique whatever their capitals", () => {
    it("refuses 'a' next to 'A' on add, in lower and upper case", async () => {
        const hr = await clientFor("hr")
        const first = await tryInsert(hr, "calendar_venues", { name: `${MARKER} Aa Room`, sort_order: 92 })
        expect(first.ok).toBe(true)
        made.push(first.id)

        const lower = await tryInsert(hr, "calendar_venues", { name: `${MARKER} aa room`, sort_order: 93 })
        expect(lower.ok).toBe(false)
        expect(lower.code).toBe("23505")

        const upper = await tryInsert(hr, "calendar_venues", { name: `${MARKER} AA ROOM`, sort_order: 94 })
        expect(upper.ok).toBe(false)
        expect(upper.code).toBe("23505")
    })

    it("refuses a rename that matches another Venue apart from its capitals", async () => {
        const hr = await clientFor("hr")
        const one = await tryInsert(hr, "calendar_venues", { name: `${MARKER} Bb Hall`, sort_order: 95 })
        const two = await tryInsert(hr, "calendar_venues", { name: `${MARKER} Cc Hall`, sort_order: 96 })
        made.push(one.id, two.id)

        const clash = await tryUpdate(hr, "calendar_venues", two.id, { name: `${MARKER} bb hall` })
        expect(clash.ok).toBe(false)
        expect(clash.code).toBe("23505")

        // Changing only its own capitals is fine: it is the same Venue.
        const own = await tryUpdate(hr, "calendar_venues", two.id, { name: `${MARKER} CC HALL` })
        expect(own.affected).toBe(1)
    })
})
