/**
 * Issue #1193 (spec #1187) — Archived SORs.
 *
 * Only a Super Admin archives or un-archives; the database refuses anyone else, including a direct
 * write of the archive columns. Archiving never touches `is_deleted`, locks nothing, and leaves
 * every total as it was. The service role seeds the SORs; the cast member named is the caller.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { ids, clientFor, ensureCastLoaded } from "./support/cast.js"
import { serviceClient } from "./support/stack.js"
import { makeSor } from "./support/rows.js"

const svc = () => serviceClient()
const sorIds = []

async function sor() {
    const id = await makeSor({ registeredBy: ids.dealOwner, dealOwnerId: ids.dealOwner })
    sorIds.push(id)
    return id
}

const row = async (id) => {
    const { data, error } = await svc().from("sales_opportunities").select("*").eq("id", id).single()
    if (error) throw new Error(error.message)
    return data
}

beforeAll(async () => {
    await ensureCastLoaded()
})

afterAll(async () => {
    const s = svc()
    await s.from("system_audit_logs").delete().in("entity_id", sorIds)
    await s.from("sales_opportunity_logs").delete().in("opportunity_id", sorIds)
    await s.from("sales_opportunities").delete().in("id", sorIds)
})

describe("who may archive", () => {
    it("lets a Super Admin archive and un-archive, stamping when and by whom", async () => {
        const id = await sor()
        const admin = await clientFor("superAdmin")
        const a = await admin.rpc("sor_set_archived", { p_opportunity_id: id, p_archived: true })
        expect(a.error).toBeNull()
        const archived = await row(id)
        expect(archived.archived_at).not.toBeNull()
        expect(archived.archived_by).toBe(ids.superAdmin)
        expect(archived.is_deleted).toBeFalsy()

        const b = await admin.rpc("sor_set_archived", { p_opportunity_id: id, p_archived: false })
        expect(b.error).toBeNull()
        const back = await row(id)
        expect(back.archived_at).toBeNull()
        expect(back.archived_by).toBeNull()
    })

    it("refuses the Deal Owner, through the function", async () => {
        const id = await sor()
        const owner = await clientFor("dealOwner")
        const { error } = await owner.rpc("sor_set_archived", { p_opportunity_id: id, p_archived: true })
        expect(error).not.toBeNull()
        expect((await row(id)).archived_at).toBeNull()
    })

    it("refuses the Deal Owner writing the columns directly", async () => {
        const id = await sor()
        const owner = await clientFor("dealOwner")
        await owner
            .from("sales_opportunities")
            .update({ archived_at: new Date().toISOString(), archived_by: ids.dealOwner })
            .eq("id", id)
        expect((await row(id)).archived_at).toBeNull()
    })

    it("refuses a Deal Owner un-archiving", async () => {
        const id = await sor()
        await svc().from("sales_opportunities").update({ archived_at: new Date().toISOString() }).eq("id", id)
        const owner = await clientFor("dealOwner")
        const { error } = await owner.rpc("sor_set_archived", { p_opportunity_id: id, p_archived: false })
        expect(error).not.toBeNull()
        expect((await row(id)).archived_at).not.toBeNull()
    })
})

describe("an archived SOR is still whole", () => {
    it("stays readable and editable by its Deal Owner, and still counts", async () => {
        const id = await sor()
        const admin = await clientFor("superAdmin")
        await admin.rpc("sor_set_archived", { p_opportunity_id: id, p_archived: true })

        const owner = await clientFor("dealOwner")
        const read = await owner.from("sales_opportunities").select("id").eq("id", id).maybeSingle()
        expect(read.data?.id).toBe(id)

        const edit = await owner.from("sales_opportunities").update({ project_title: "Still editable" }).eq("id", id)
        expect(edit.error).toBeNull()
        expect((await row(id)).project_title).toBe("Still editable")

        // Totals read every non-deleted SOR; archiving must not remove it from that set.
        const { count } = await svc()
            .from("sales_opportunities")
            .select("id", { count: "exact", head: true })
            .eq("id", id)
            .neq("is_deleted", true)
        expect(count).toBe(1)
    })
})
