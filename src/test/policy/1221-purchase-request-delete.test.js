/**
 * Deleting a Purchase Request (soft): the requester or Purchasing or a Super
 * Admin may delete, with a written reason; it is refused once a line is
 * purchased, received or on an IPAS; a deleted request is hidden from every
 * reader; only Purchasing and Super Admin can restore it.
 * 20261221100000_purchase_request_delete.sql
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { ids, clientFor, ensureCastLoaded } from "./support/cast.js"
import { serviceClient } from "./support/stack.js"
import { MARKER } from "./support/rows.js"

const svc = () => serviceClient()
const rpc = async (who, name, args) => (await clientFor(who)).rpc(name, args)
const item = { name: `${MARKER} Cable`, quantity: 1, unit: "pcs", description: "" }

const open = async (who = "ordinary") => {
    const { data, error } = await rpc(who, "purchase_request_open", { p_title: `${MARKER} Delete me`, p_items: [item] })
    if (error) throw new Error(`purchase_request_open: ${error.message}`)
    return data
}
const created = []

beforeAll(ensureCastLoaded)
afterAll(async () => {
    await svc().from("purchase_requests").delete().in("id", created)
})

describe("deleting a Purchase Request", () => {
    it("needs a reason", async () => {
        const id = await open()
        created.push(id)
        const { error } = await rpc("ordinary", "purchase_request_delete", { p_request_id: id, p_reason: "   " })
        expect(error).not.toBeNull()
    })

    it("lets the requester delete their own, then hides it from them", async () => {
        const id = await open()
        created.push(id)
        const { error } = await rpc("ordinary", "purchase_request_delete", { p_request_id: id, p_reason: "Made twice" })
        expect(error).toBeNull()
        const { data: row } = await svc().from("purchase_requests").select("deleted_at, delete_reason, deleted_by").eq("id", id).single()
        expect(row.deleted_at).not.toBeNull()
        expect(row.delete_reason).toBe("Made twice")
        const { data: mine } = await rpc("ordinary", "purchase_request_queue", { p_request_id: id })
        expect(mine).toHaveLength(0)
    })

    it("refuses someone who is neither the requester nor Purchasing", async () => {
        const id = await open()
        created.push(id)
        const { error } = await rpc("outsider", "purchase_request_delete", { p_request_id: id, p_reason: "Nope" })
        expect(error).not.toBeNull()
    })

    it("is refused once a line is purchased", async () => {
        const id = await open()
        created.push(id)
        await svc().from("purchase_request_items").update({ status: "purchased" }).eq("request_id", id)
        const { error } = await rpc("ordinary", "purchase_request_delete", { p_request_id: id, p_reason: "Too late" })
        expect(error).not.toBeNull()
    })

    it("cannot be deleted twice", async () => {
        const id = await open()
        created.push(id)
        await rpc("ordinary", "purchase_request_delete", { p_request_id: id, p_reason: "First" })
        const { error } = await rpc("superAdmin", "purchase_request_delete", { p_request_id: id, p_reason: "Second" })
        expect(error).not.toBeNull()
    })
})

describe("restoring a deleted Purchase Request", () => {
    it("is refused for the requester, allowed for a Super Admin, and brings it back", async () => {
        const id = await open()
        created.push(id)
        await rpc("ordinary", "purchase_request_delete", { p_request_id: id, p_reason: "Oops" })
        const denied = await rpc("ordinary", "purchase_request_restore", { p_request_id: id })
        expect(denied.error).not.toBeNull()
        const listed = await rpc("superAdmin", "purchase_request_deleted_list", {})
        expect(listed.data.some((r) => r.id === id)).toBe(true)
        const ok = await rpc("superAdmin", "purchase_request_restore", { p_request_id: id })
        expect(ok.error).toBeNull()
        const { data } = await rpc("ordinary", "purchase_request_queue", { p_request_id: id })
        expect(data).toHaveLength(1)
    })

    it("keeps the Deleted view away from an ordinary employee", async () => {
        const { data } = await rpc("ordinary", "purchase_request_deleted_list", {})
        expect(data).toHaveLength(0)
    })
})
