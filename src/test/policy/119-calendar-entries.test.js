/**
 * The Calendar's server projection (#615, spec #609, ADR 0037): calendar_entries() hands every
 * signed-in employee the approved entries of everyone, decides in the function who may see a reason,
 * and sends pending rows only to viewers who can open HR's Time Off & Overtime page, and only on request.
 *
 *   ordinary      colleague   -> approved rows, no reason on anyone else's
 *   owner (outsider)          -> their own approved row carries the reason
 *   hr / leaveManager / superAdmin -> reasons on everyone, pending rows when asked
 *   anonymous                 -> nothing
 *
 * Rows: one approved and one pending entry per kind (SIL, Offset, Overtime, Undertime), all filed by
 * `outsider`. No signature, balance, hash or HR-officer field may appear for anybody.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { ids, clientFor, anonymousClient, ensureCastLoaded } from "./support/cast.js"
import { serviceClient } from "./support/stack.js"
import { MARKER } from "./support/rows.js"

const svc = () => serviceClient()
const REASON = `${MARKER} private reason`
const DAY = "2031-03-10"
const FROM = "2031-03-01"
const TO = "2031-03-31"
const FORBIDDEN = /signature|balance|hash|hr_processed|attachments|verification_token/i

const created = { sil_leaves: [], offset_leaves: [], overtime_requests: [], undertime_requests: [] }

const insert = async (table, row) => {
    const { data, error } = await svc().from(table).insert(row).select("id").single()
    if (error) throw new Error(`${table}: ${error.message}`)
    created[table].push(data.id)
    return data.id
}
const read = async (who, includePending) => {
    const { data, error } = await (await clientFor(who)).rpc("calendar_entries", { p_from: FROM, p_to: TO, p_include_pending: includePending })
    if (error) throw new Error(`calendar_entries as ${who}: ${error.message}`)
    return data
}
const mine = (rows) => rows.filter((r) => r.employee?.id === ids.outsider)

beforeAll(async () => {
    await ensureCastLoaded()
    const base = { employee_id: ids.outsider, date: DAY, hours: 8, reason: REASON }
    for (const status of ["APPROVED", "PENDING"]) {
        await insert("sil_leaves", { ...base, status })
        await insert("offset_leaves", { ...base, status })
        await insert("overtime_requests", { ...base, status: status === "APPROVED" ? "APPROVED_PAID" : status })
        await insert("undertime_requests", { ...base, status })
    }
})

afterAll(async () => {
    for (const [table, list] of Object.entries(created)) {
        if (list.length) await svc().from(table).delete().in("id", list)
    }
})

describe("calendar_entries()", () => {
    it("gives an ordinary colleague the approved entries of every kind, without the reason", async () => {
        const rows = mine(await read("ordinary", false))
        expect(rows.map((r) => r.kind).sort()).toEqual(["OFFSET", "OVERTIME", "SIL", "UNDERTIME"])
        expect(rows.every((r) => r.status === "APPROVED")).toBe(true)
        expect(rows.some((r) => r.details?.reason)).toBe(false)
        expect(JSON.stringify(rows)).not.toContain(REASON)
    })

    it("gives an employee their own reason", async () => {
        const rows = mine(await read("outsider", false))
        expect(rows).toHaveLength(4)
        expect(rows.every((r) => r.details?.reason === REASON)).toBe(true)
    })

    it.each(["hr", "leaveManager", "superAdmin"])("gives %s the reason on everyone's entries", async (who) => {
        const rows = mine(await read(who, false))
        expect(rows.length).toBeGreaterThan(0)
        expect(rows.every((r) => r.details?.reason === REASON)).toBe(true)
    })

    it.each(["hr", "leaveManager", "superAdmin"])("gives %s pending rows only when asked", async (who) => {
        expect(mine(await read(who, false)).some((r) => r.status === "PENDING")).toBe(false)
        const asked = mine(await read(who, true))
        expect(asked.filter((r) => r.status === "PENDING")).toHaveLength(4)
        expect(asked.filter((r) => r.status === "APPROVED")).toHaveLength(4)
    })

    it.each(["ordinary", "outsider", "head"])("never gives %s pending rows, even when asked", async (who) => {
        expect(mine(await read(who, true)).some((r) => r.status === "PENDING")).toBe(false)
    })

    it("never carries a signature, balance, hash or HR-officer field for any viewer", async () => {
        for (const who of ["ordinary", "outsider", "hr", "superAdmin"]) {
            const rows = await read(who, true)
            for (const row of rows) {
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
