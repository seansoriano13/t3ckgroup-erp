/**
 * LWOP on the Calendar (#622, spec #609, ADR 0037): the LWOP branch of calendar_entries() follows the
 * same privacy rules as SIL, asserted in both directions.
 *
 *   ordinary / head -> approved LWOP, no reason; never pending
 *   outsider (owner) -> own approved row carries the reason; never pending
 *   hr / leaveManager / superAdmin -> reasons, pending only when asked
 *   no signature, balance, hash or HR-officer field for anybody
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { ids, clientFor, anonymousClient, ensureCastLoaded } from "./support/cast.js"
import { serviceClient } from "./support/stack.js"
import { MARKER } from "./support/rows.js"

const svc = () => serviceClient()
const REASON = `${MARKER} private lwop reason`
const DAY = "2031-04-10"
const FROM = "2031-04-01"
const TO = "2031-04-30"
const FORBIDDEN = /signature|balance|hash|hr_processed|attachments|verification_token|recorded_by/i
const created = []

const read = async (who, includePending) => {
    const { data, error } = await (await clientFor(who)).rpc("calendar_entries", { p_from: FROM, p_to: TO, p_include_pending: includePending })
    if (error) throw new Error(`calendar_entries as ${who}: ${error.message}`)
    return data
}
const mine = (rows) => rows.filter((r) => r.employee?.id === ids.outsider && r.kind === "LWOP")

beforeAll(async () => {
    await ensureCastLoaded()
    for (const status of ["APPROVED", "PENDING"]) {
        const { data, error } = await svc()
            .from("lwop_leaves")
            .insert({ employee_id: ids.outsider, date: DAY, hours: 8, reason: REASON, status })
            .select("id")
            .single()
        if (error) throw new Error(`lwop_leaves: ${error.message}`)
        created.push(data.id)
    }
})

afterAll(async () => {
    if (created.length) await svc().from("lwop_leaves").delete().in("id", created)
})

describe("calendar_entries() LWOP branch", () => {
    it("gives an ordinary colleague the approved LWOP without the reason", async () => {
        const rows = mine(await read("ordinary", false))
        expect(rows).toHaveLength(1)
        expect(rows[0].status).toBe("APPROVED")
        expect(rows[0].title).toBe("LWOP")
        expect(JSON.stringify(rows)).not.toContain(REASON)
    })

    it("gives the employee their own reason", async () => {
        const rows = mine(await read("outsider", false))
        expect(rows).toHaveLength(1)
        expect(rows[0].details?.reason).toBe(REASON)
    })

    it.each(["hr", "leaveManager", "superAdmin"])("gives %s the reason, and pending only when asked", async (who) => {
        const plain = mine(await read(who, false))
        expect(plain).toHaveLength(1)
        expect(plain[0].details?.reason).toBe(REASON)
        const asked = mine(await read(who, true))
        expect(asked.map((r) => r.status).sort()).toEqual(["APPROVED", "PENDING"])
    })

    it.each(["ordinary", "outsider", "head"])("never gives %s pending LWOP, even when asked", async (who) => {
        expect(mine(await read(who, true)).some((r) => r.status === "PENDING")).toBe(false)
    })

    it("never carries a signature, balance, hash or HR-officer field", async () => {
        for (const who of ["ordinary", "outsider", "hr", "superAdmin"]) {
            for (const row of mine(await read(who, true))) {
                expect(Object.keys(row).join(" ")).not.toMatch(FORBIDDEN)
                expect(Object.keys(row.details ?? {}).join(" ")).not.toMatch(FORBIDDEN)
                expect(Object.keys(row.employee ?? {}).join(" ")).not.toMatch(FORBIDDEN)
            }
        }
    })

    it("gives an anonymous caller nothing", async () => {
        const { data, error } = await anonymousClient().rpc("calendar_entries", { p_from: FROM, p_to: TO, p_include_pending: false })
        expect(error || (data ?? []).length === 0).toBeTruthy()
    })
})
