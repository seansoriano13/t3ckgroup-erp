/**
 * OPEX Report tables (#1244, spec #1241): only Finance access and Super Admins read
 * or write opex_reports and opex_report_snapshots; one report per S0.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { ids, clientFor, ensureCastLoaded } from "./support/cast.js"
import { serviceClient } from "./support/stack.js"

const svc = () => serviceClient()
const S0 = "S9124401"
const S0_OTHER = "S9124402"

beforeAll(async () => {
    await ensureCastLoaded()
    await svc().from("opex_reports").delete().in("s0_number", [S0, S0_OTHER])
})

afterAll(async () => {
    await svc().from("opex_reports").delete().in("s0_number", [S0, S0_OTHER])
})

describe("OPEX Report tables (#1244)", () => {
    it("lets Finance access start a report and save its snapshot", async () => {
        const finance = await clientFor("finance")
        const made = await finance.from("opex_reports").insert({ s0_number: S0 }).select().single()
        expect(made.error).toBeNull()
        const snap = await finance.from("opex_report_snapshots").insert({ report_id: made.data.id, project_name: "Made-up project", contract_price: 1000 })
        expect(snap.error).toBeNull()
        const read = await finance.from("opex_report_snapshots").select("project_name").eq("report_id", made.data.id)
        expect(read.data).toHaveLength(1)
    })

    it("lets a Super Admin read and write them", async () => {
        const admin = await clientFor("superAdmin")
        const read = await admin.from("opex_reports").select("id").eq("s0_number", S0)
        expect(read.data).toHaveLength(1)
        const made = await admin.from("opex_reports").insert({ s0_number: S0_OTHER }).select().single()
        expect(made.error).toBeNull()
    })

    it("refuses a second report for the same S0", async () => {
        const finance = await clientFor("finance")
        const again = await finance.from("opex_reports").insert({ s0_number: S0 })
        expect(again.error?.code).toBe("23505")
    })

    it("shows nothing to everyone else and refuses their writes", async () => {
        for (const who of ["ordinary", "outsider", "dealOwner"]) {
            const client = await clientFor(who)
            const read = await client.from("opex_reports").select("id")
            expect(read.data ?? []).toHaveLength(0)
            const snaps = await client.from("opex_report_snapshots").select("report_id")
            expect(snaps.data ?? []).toHaveLength(0)
            const write = await client.from("opex_reports").insert({ s0_number: "S9124403" })
            expect(write.error).not.toBeNull()
            const update = await client.from("opex_reports").update({ contract_price: 1 }).eq("s0_number", S0).select()
            expect(update.data ?? []).toHaveLength(0)
        }
        expect(ids.finance).toBeTruthy()
    })

    it("refuses a signed-out caller", async () => {
        const { anonymousClient } = await import("./support/cast.js")
        const read = await anonymousClient().from("opex_reports").select("id")
        expect(read.data ?? []).toHaveLength(0)
    })
})
