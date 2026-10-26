/**
 * Carrying the old procurement requests into Purchase Requests (#313, part of
 * #209).
 *
 * The migration runs at `db reset`, before any fixture exists, so this file
 * seeds legacy rows and re-runs the real migration file against them (twice:
 * it must be re-runnable). Prior art: 16-legacy-pipeline-backfill.
 *
 * `stageParticipant` and `outsider` are given Purchasing access (the old
 * assignees); `dealOwner` and `support` asked for the items; `hr` holds
 * nothing and stays out.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { readFileSync } from "node:fs"
import { ids, clientFor, ensureCastLoaded } from "./support/cast.js"
import { serviceClient, sql } from "./support/stack.js"
import { MARKER, makeSor, makeTask } from "./support/rows.js"
import { tryInsert, tryUpdate, tryDelete, canRead, RLS_VIOLATION } from "./support/access.js"

// The file is the one that ran at `db reset`, when items still had the old status words. The
// status CHECK now holds only the new ones (#676), so the test re-runs it with the same word
// swap the #676 migration made inside function bodies.
const OLD_WORDS = { requested: "not_checked", from_stock: "available", to_order: "to_purchase", canvassing: "still_canvassing", ordered: "purchased", substituted: "cancelled" }
const MIGRATION = readFileSync(
    "supabase/migrations/20261005131000_migrate_legacy_procurement_requests.sql",
    "utf8",
).replace(/'(requested|from_stock|to_order|canvassing|ordered|substituted)'/g, (_, word) => `'${OLD_WORDS[word]}'`)
const PURCHASERS = ["stageParticipant", "outsider"]
const svc = () => serviceClient()
const runMigration = () => sql().query(MIGRATION)

const sors = {}
const tasks = {}
const legacy = {}
let preexistingRequestId, preexistingItemId

async function insert(table, row) {
    const { data, error } = await svc().from(table).insert(row).select("id").single()
    if (error) throw new Error(`Seeding ${table}: ${error.message}`)
    return data.id
}

const legacyRow = (key, opportunityId, fields) =>
    insert("sor_procurement_requests", {
        opportunity_id: opportunityId,
        requested_name: `${MARKER} ${key}`,
        requested_unit: "pc",
        requested_quantity: 2,
        requested_by: ids.dealOwner,
        ...fields,
    }).then((id) => (legacy[key] = id))

async function requestFor(opportunityId) {
    const { data, error } = await svc().from("purchase_requests").select("*").eq("opportunity_id", opportunityId)
    if (error) throw error
    return data
}

async function itemFor(legacyId) {
    const { data, error } = await svc()
        .from("purchase_request_items")
        .select("*")
        .eq("legacy_procurement_request_id", legacyId)
    if (error) throw error
    expect(data).toHaveLength(1)
    return data[0]
}

async function messages(requestId) {
    const { data, error } = await svc()
        .from("purchase_request_messages")
        .select("author_id, content, metadata")
        .eq("request_id", requestId)
    if (error) throw error
    return data
}

async function task(id) {
    const { data, error } = await svc().from("tasks").select("status, hr_verified").eq("id", id).single()
    if (error) throw error
    return data
}

async function taskActivity(id) {
    const { data, error } = await svc().from("task_activity").select("author_id, type, content, metadata").eq("task_id", id)
    if (error) throw error
    return data
}

beforeAll(async () => {
    await ensureCastLoaded()
    const { error } = await svc()
        .from("employees")
        .update({ has_purchasing_flow: true })
        .in("id", PURCHASERS.map((k) => ids[k]))
    if (error) throw new Error(`Granting Purchasing access: ${error.message}`)

    sors.main = await makeSor({
        registeredBy: ids.dealOwner,
        dealOwnerId: ids.dealOwner,
        supportSales1Id: ids.support,
        companyName: `${MARKER} Legacy Procurement`,
    })
    sors.existing = await makeSor({ registeredBy: ids.dealOwner, dealOwnerId: ids.dealOwner })
    sors.deleted = await makeSor({ registeredBy: ids.dealOwner, dealOwnerId: ids.dealOwner })
    await svc().from("sales_opportunities").update({ is_deleted: true }).eq("id", sors.deleted)

    tasks.open = await makeTask({ loggedBy: ids.stageParticipant, reportedTo: ids.dealOwner })
    tasks.awaiting = await makeTask({ loggedBy: ids.stageParticipant, reportedTo: ids.dealOwner })
    tasks.deleted = await makeTask({ loggedBy: ids.stageParticipant, reportedTo: ids.dealOwner })
    await svc().from("tasks").update({ status: "AWAITING APPROVAL" }).eq("id", tasks.awaiting)
    await svc().from("tasks").update({ status: "DELETED" }).eq("id", tasks.deleted)

    const sp = ids.stageParticipant
    await legacyRow("unanswered", sors.main, { assigned_to: sp, task_id: tasks.open, requested_quantity: 3 })
    await legacyRow("inProgress", sors.main, {
        assigned_to: sp,
        task_id: tasks.open,
        outcome: "IN_PROGRESS",
        eta: "2026-10-02",
        odoo_vendor: "ACME Trading",
        outcome_note: "waiting on supplier quote",
    })
    await legacyRow("purchased", sors.main, {
        assigned_to: ids.outsider,
        outcome: "PURCHASED",
        po_number: "P0123",
        verification: "VERIFIED",
        resolved_by: ids.outsider,
        resolved_at: "2026-09-20T03:00:00Z",
    })
    await legacyRow("onOrder", sors.main, {
        assigned_to: ids.outsider,
        outcome: "ON_ORDER",
        po_number: "P0124",
        verification: "PENDING_VERIFICATION",
    })
    await legacyRow("delivered", sors.main, {
        assigned_to: sp,
        task_id: tasks.awaiting,
        outcome: "DELIVERED",
        po_number: "P0125",
        verification: "VERIFIED",
        resolved_by: sp,
        resolved_at: "2026-09-25T03:00:00Z",
    })
    await legacyRow("alreadyExists", sors.main, { assigned_to: sp, task_id: tasks.deleted, outcome: "ALREADY_EXISTS" })
    await legacyRow("substituted", sors.main, { requested_by: ids.support, outcome: "SUBSTITUTED" })
    await legacyRow("unavailable", sors.main, { outcome: "UNAVAILABLE", requested_quantity: 0 })

    preexistingRequestId = await insert("purchase_requests", { opportunity_id: sors.existing, created_by: ids.dealOwner })
    preexistingItemId = await insert("purchase_request_items", {
        request_id: preexistingRequestId,
        source: "new",
        name: `${MARKER} Already asked`,
        quantity: 1,
        requested_by: ids.dealOwner,
    })
    await legacyRow("intoExisting", sors.existing, { assigned_to: ids.outsider })
    await legacyRow("onDeletedSor", sors.deleted, { assigned_to: sp })

    await runMigration()
    await runMigration()
})

afterAll(async () => {
    const allSors = Object.values(sors)
    await svc().from("task_activity").delete().in("task_id", Object.values(tasks))
    await svc().from("purchase_requests").delete().in("opportunity_id", allSors)
    await svc().from("sor_procurement_requests").delete().in("opportunity_id", allSors)
    await svc().from("tasks").delete().in("id", Object.values(tasks))
    await svc().from("sales_opportunities").delete().in("id", allSors)
    await svc()
        .from("employees")
        .update({ has_purchasing_flow: false })
        .in("id", PURCHASERS.map((k) => ids[k]))
})

describe("one Purchase Request per SOR", () => {
    it("opens exactly one request on an SOR with legacy rows, re-runs included", async () => {
        const requests = await requestFor(sors.main)
        expect(requests).toHaveLength(1)
        expect(requests[0].created_by).toBe(ids.dealOwner)
        expect(requests[0].opened_by_action_id).toBeNull()
        expect(requests[0].opened_visit_id).toBeNull()
    })

    it("makes the most frequent assignee the Buyer", async () => {
        const [request] = await requestFor(sors.main)
        expect(request.buyer_id).toBe(ids.stageParticipant)
    })

    it("reuses a request the SOR already has, and gives it a Buyer if it had none", async () => {
        const requests = await requestFor(sors.existing)
        expect(requests).toHaveLength(1)
        expect(requests[0].id).toBe(preexistingRequestId)
        expect(requests[0].buyer_id).toBe(ids.outsider)
        const { data } = await svc().from("purchase_request_items").select("id").eq("request_id", preexistingRequestId)
        expect(data.map((r) => r.id)).toEqual(expect.arrayContaining([preexistingItemId]))
        expect(data).toHaveLength(2)
    })

    it("leaves a soft-deleted SOR alone", async () => {
        expect(await requestFor(sors.deleted)).toHaveLength(0)
    })

    it("adds the requesters, the assignees and every Purchasing flag holder, each on their side", async () => {
        const [request] = await requestFor(sors.main)
        const { data, error } = await svc()
            .from("purchase_request_members")
            .select("employee_id, side")
            .eq("request_id", request.id)
        if (error) throw error
        const sideOf = Object.fromEntries(data.map((m) => [m.employee_id, m.side]))
        expect(sideOf[ids.dealOwner]).toBe("sales")
        expect(sideOf[ids.support]).toBe("sales")
        expect(sideOf[ids.stageParticipant]).toBe("purchasing")
        expect(sideOf[ids.outsider]).toBe("purchasing")
        expect(sideOf[ids.hr]).toBeUndefined()
        expect(sideOf[ids.ordinary]).toBeUndefined()
    })
})

describe("Requested Items", () => {
    const expected = {
        unanswered: { status: "not_checked", po_number: null, po_verification: "UNVERIFIED", quantity: 3 },
        inProgress: { status: "still_canvassing", po_number: null, po_verification: "UNVERIFIED", quantity: 2 },
        purchased: { status: "purchased", po_number: "P0123", po_verification: "VERIFIED", quantity: 2 },
        onOrder: { status: "purchased", po_number: "P0124", po_verification: "PENDING_VERIFICATION", quantity: 2 },
        delivered: { status: "received", po_number: "P0125", po_verification: "VERIFIED", quantity: 2 },
        alreadyExists: { status: "available", po_number: null, po_verification: "UNVERIFIED", quantity: 2 },
        substituted: { status: "cancelled", po_number: null, po_verification: "UNVERIFIED", quantity: 2 },
        unavailable: { status: "cannot_source", po_number: null, po_verification: "UNVERIFIED", quantity: 1 },
    }

    it.each(Object.entries(expected))("maps the %s row", async (key, want) => {
        const [request] = await requestFor(sors.main)
        const item = await itemFor(legacy[key])
        expect(item).toMatchObject({
            request_id: request.id,
            source: "new",
            name: `${MARKER} ${key}`,
            unit: "pc",
            status: want.status,
            po_number: want.po_number,
            po_verification: want.po_verification,
        })
        expect(Number(item.quantity)).toBe(want.quantity)
    })

    it("keeps who asked and who answered", async () => {
        expect((await itemFor(legacy.substituted)).requested_by).toBe(ids.support)
        const delivered = await itemFor(legacy.delivered)
        expect(delivered.requested_by).toBe(ids.dealOwner)
        expect(delivered.status_changed_by).toBe(ids.stageParticipant)
        expect(new Date(delivered.status_changed_at).toISOString()).toBe("2026-09-25T03:00:00.000Z")
        const unanswered = await itemFor(legacy.unanswered)
        expect(unanswered.status_changed_by).toBeNull()
        expect(unanswered.status_changed_at).toBeNull()
    })

    it("carries every legacy row of the SOR exactly once", async () => {
        const [request] = await requestFor(sors.main)
        const { data } = await svc().from("purchase_request_items").select("id").eq("request_id", request.id)
        expect(data).toHaveLength(Object.keys(expected).length)
    })
})

describe("the migration message", () => {
    it("posts one system message carrying ETA, vendor and note", async () => {
        const [request] = await requestFor(sors.main)
        const item = await itemFor(legacy.inProgress)
        const forItem = (await messages(request.id)).filter((m) => m.metadata.item_id === item.id)
        expect(forItem).toHaveLength(1)
        expect(forItem[0].author_id).toBeNull()
        expect(forItem[0].metadata.event).toBe("migrated")
        expect(forItem[0].content).toBe(
            `Migrated from the old request for ${MARKER} inProgress: ETA 2026-10-02 · vendor ACME Trading · note "waiting on supplier quote"`,
        )
    })

    it("posts nothing for a row with none of them", async () => {
        const [request] = await requestFor(sors.main)
        const item = await itemFor(legacy.unanswered)
        expect((await messages(request.id)).filter((m) => m.metadata.item_id === item.id)).toHaveLength(0)
    })

    it("says so when the old quantity was zero", async () => {
        const [request] = await requestFor(sors.main)
        const item = await itemFor(legacy.unavailable)
        const forItem = (await messages(request.id)).filter((m) => m.metadata.item_id === item.id)
        expect(forItem).toHaveLength(1)
        expect(forItem[0].content).toContain("quantity not given (set to 1)")
    })

    it("posts no other event (no `opened`) and notifies nobody", async () => {
        const [request] = await requestFor(sors.main)
        const events = (await messages(request.id)).map((m) => m.metadata.event)
        expect(events.every((e) => e === "migrated")).toBe(true)
        const { data, error } = await svc()
            .from("notifications")
            .select("id")
            .in("reference_id", [request.id, preexistingRequestId])
        if (error) throw error
        expect(data).toHaveLength(0)
    })
})

describe("old purchasing tasks", () => {
    it("completes the linked tasks and links the new request in their activity", async () => {
        const [request] = await requestFor(sors.main)
        for (const key of ["open", "awaiting"]) {
            const t = await task(tasks[key])
            expect(t.status).toBe("COMPLETED")
            expect(t.hr_verified).toBe(false)
            const activity = await taskActivity(tasks[key])
            expect(activity).toHaveLength(1)
            expect(activity[0]).toMatchObject({
                author_id: null,
                type: "SYSTEM",
                metadata: { event: "PURCHASE_REQUEST_MIGRATED", purchaseRequestId: request.id },
            })
        }
    })

    it("leaves a deleted task deleted", async () => {
        expect((await task(tasks.deleted)).status).toBe("DELETED")
    })
})

describe("the legacy table", () => {
    it("survives with every row", async () => {
        const { data } = await svc()
            .from("sor_procurement_requests")
            .select("id")
            .in("opportunity_id", Object.values(sors))
        expect(data).toHaveLength(Object.keys(legacy).length)
    })

    it("can still be read", async () => {
        expect(await canRead(await clientFor("dealOwner"), "sor_procurement_requests", legacy.unanswered)).toBe(true)
    })

    it("refuses inserts, updates and deletes, even from a Super Admin", async () => {
        const insertResult = await tryInsert(await clientFor("dealOwner"), "sor_procurement_requests", {
            opportunity_id: sors.main,
            requested_name: `${MARKER} late`,
            requested_by: ids.dealOwner,
        })
        expect(insertResult).toMatchObject({ ok: false, code: RLS_VIOLATION })

        for (const who of ["superAdmin", "stageParticipant", "dealOwner"]) {
            const client = await clientFor(who)
            expect((await tryUpdate(client, "sor_procurement_requests", legacy.unanswered, { outcome_note: "x" })).affected).toBe(0)
            expect((await tryDelete(client, "sor_procurement_requests", legacy.unanswered)).affected).toBe(0)
        }
    })
})
