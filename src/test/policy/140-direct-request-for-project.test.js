/**
 * A Direct request can name the project it is for (#689, spec #675,
 * 20261104140000_direct_request_for_project.sql): it stays Direct, never
 * becomes a Project request, and the SOR lists it (title, PR number, P0,
 * status) to anyone who can read the SOR and to nobody else.
 *
 * `dealOwner` owns the SOR; `ordinary` cannot read it.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { ids, clientFor, ensureCastLoaded } from "./support/cast.js"
import { serviceClient } from "./support/stack.js"
import { makeSor, MARKER } from "./support/rows.js"

const svc = () => serviceClient()
const rpc = async (who, name, args) => (await clientFor(who)).rpc(name, args)

let sorId, otherSorId, directId, plainId

const item = { name: `${MARKER} Cable`, quantity: 2, unit: "pcs", description: "" }

beforeAll(async () => {
    await ensureCastLoaded()
    sorId = await makeSor({ registeredBy: ids.dealOwner, dealOwnerId: ids.dealOwner })
    otherSorId = await makeSor({ registeredBy: ids.dealOwner, dealOwnerId: ids.dealOwner })
    const { data, error } = await rpc("stageParticipant", "purchase_request_open", {
        p_title: `${MARKER} For the project`,
        p_items: [item],
        p_for_opportunity_id: sorId,
    })
    if (error) throw new Error(`purchase_request_open: ${error.message}`)
    directId = data
    const plain = await rpc("stageParticipant", "purchase_request_open", { p_title: `${MARKER} No project`, p_items: [item] })
    if (plain.error) throw new Error(`purchase_request_open: ${plain.error.message}`)
    plainId = plain.data
})

afterAll(async () => {
    await svc().from("purchase_requests").delete().in("id", [directId, plainId].filter(Boolean))
    await svc().from("sales_opportunities").delete().in("id", [sorId, otherSorId].filter(Boolean))
})

describe("a Direct request that names a project", () => {
    it("stays Direct: it has no opportunity_id of its own", async () => {
        const { data } = await svc().from("purchase_requests").select("opportunity_id, for_opportunity_id").eq("id", directId).single()
        expect(data.opportunity_id).toBeNull()
        expect(data.for_opportunity_id).toBe(sorId)
    })

    it("cannot be both: a Project request refuses the link", async () => {
        const { error } = await svc()
            .from("purchase_requests")
            .insert({ opportunity_id: otherSorId, for_opportunity_id: sorId, created_by: ids.dealOwner })
        expect(error).not.toBeNull()
    })

    it("does not take the project's one Project request slot", async () => {
        const { error } = await svc().from("purchase_requests").insert({ opportunity_id: sorId, created_by: ids.dealOwner })
        expect(error).toBeNull()
        await svc().from("purchase_requests").delete().eq("opportunity_id", sorId)
    })

    it("refuses an SOR that does not exist", async () => {
        const { error } = await rpc("stageParticipant", "purchase_request_open", {
            p_title: `${MARKER} Ghost`,
            p_items: [item],
            p_for_opportunity_id: "00000000-0000-0000-0000-000000000000",
        })
        expect(error).not.toBeNull()
    })
})

describe("the SOR's Direct requests", () => {
    it("lists title, PR number, P0 and status to a reader of the SOR, with no money", async () => {
        await svc().from("purchase_request_items").update({ po_number: "P07777" }).eq("request_id", directId)
        const { data, error } = await rpc("dealOwner", "direct_requests_for_sor", { p_opportunity_id: sorId })
        expect(error).toBeNull()
        expect(data).toHaveLength(1)
        expect(data[0]).toMatchObject({ id: directId, title: `${MARKER} For the project`, p0: "P07777", status: "not_checked" })
        expect(data[0].pr_number).toMatch(/^PR_\d{4,}$/)
        expect(Object.keys(data[0]).sort()).toEqual(["id", "p0", "pr_number", "status", "title"])
    })

    it("leaves out a request made for another project or for none", async () => {
        const { data } = await rpc("dealOwner", "direct_requests_for_sor", { p_opportunity_id: otherSorId })
        expect(data).toEqual([])
    })

    it("gives nothing to someone who cannot read the SOR", async () => {
        const { data, error } = await rpc("ordinary", "direct_requests_for_sor", { p_opportunity_id: sorId })
        expect(error).toBeNull()
        expect(data).toEqual([])
    })
})
