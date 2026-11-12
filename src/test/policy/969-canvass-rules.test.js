/**
 * The rules of a Canvass, one per Purchase Request (#969, spec #956): a winner per line with a
 * reason, the shortcuts, three suppliers or a "No other supplier" note, Still canvassing, the lock
 * on a Purchased line and its unlock, what a winner fills, the canvasser, lines added later, and
 * the Offer projection. Every rule is tested with its refusal.
 *
 * The cast:
 *   outsider     Purchasing access, on the request  -> picks, saves, sees money
 *   superAdmin                                       -> unlocks
 *   dealOwner    Deal Team, a member of the request  -> reads, accepts a brand, writes nothing here
 *   ordinary     nobody
 *
 * Requests and lines are made with the purchaser's own function or the service role; every
 * assertion about a rule runs as a real cast member.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { ids, clientFor, ensureCastLoaded } from "./support/cast.js"
import { serviceClient } from "./support/stack.js"
import { MARKER, makeSor } from "./support/rows.js"
import { purgeCostingForSors } from "./support/costing.js"

const svc = () => serviceClient()
const RULE = "22023"
const LOCKED = "55000"
const DENIED = "42501"
const NOT_A_QUOTER = "23503"

const requestIds = []
const sorIds = []

const asSvc = async (query, what) => {
    const { data, error } = await query
    if (error) throw new Error(`${what}: ${error.message}`)
    return data
}

/** A request with `lines` lines, opened by the purchaser; the Deal Team joins it. */
async function openRequest(title, lines = 3) {
    const purchaser = await clientFor("outsider")
    const made = await purchaser.rpc("purchase_request_open", {
        p_title: `${MARKER} ${title}`,
        p_items: Array.from({ length: lines }, (_, i) => ({ name: `${MARKER} ${title} line ${i + 1}`, quantity: 1, unit: "pc" })),
    })
    if (made.error) throw new Error(`purchase_request_open: ${made.error.message}`)
    requestIds.push(made.data)
    await asSvc(
        svc().from("purchase_request_members").upsert({ request_id: made.data, employee_id: ids.dealOwner, side: "sales" }, { onConflict: "request_id,employee_id" }),
        "member",
    )
    const items = await asSvc(svc().from("purchase_request_items").select("id, name").eq("request_id", made.data).order("name"), "items")
    return { id: made.data, items: items.map((i) => i.id) }
}

/** A supplier added the way the app adds one. */
async function addSupplier(request, supplier = {}, price = {}, who = "outsider") {
    const client = await clientFor(who)
    return client.rpc("canvass_add_supplier", {
        p_request_id: request,
        p_supplier: { supplier_name: `${MARKER} Supplier ${Math.random().toString(36).slice(2, 8)}`, ...supplier },
        p_price: price,
    })
}

const saveQuote = async (supplier, item, quote = {}, price = { unit_price: 100 }, who = "outsider") =>
    (await clientFor(who)).rpc("canvass_save_quote", { p_supplier_id: supplier, p_item_id: item, p_quote: quote, p_price: price })

/** A Canvass with `n` suppliers, each quoting every line in `lines`. */
async function seedCanvass(request, n, lines = request.items) {
    const suppliers = []
    let canvass = null
    for (let i = 0; i < n; i++) {
        const added = await addSupplier(request.id, { supplier_name: `${MARKER} Supplier ${i + 1}` })
        if (added.error) throw new Error(`canvass_add_supplier: ${added.error.message}`)
        canvass = added.data.canvass_id
        suppliers.push(added.data.supplier.id)
        for (const item of lines) {
            const saved = await saveQuote(added.data.supplier.id, item, { brand: `Brand ${i + 1}` }, { unit_price: 100 + i * 10 })
            if (saved.error) throw new Error(`canvass_save_quote: ${saved.error.message}`)
        }
    }
    return { canvass, suppliers }
}

const pick = async (item, supplier, reason = "Best price", who = "outsider") =>
    (await clientFor(who))
        .from("request_canvass_winners")
        .upsert({ item_id: item, supplier_id: supplier, reason }, { onConflict: "item_id" })
        .select()

const winnerOf = async (item) => (await svc().from("request_canvass_winners").select("*").eq("item_id", item).maybeSingle()).data
const statusOf = async (item) => (await asSvc(svc().from("purchase_request_items").select("status").eq("id", item).single(), "status")).status
const setStatus = (item, status) =>
    asSvc(svc().from("purchase_request_items").update({ status, status_changed_at: new Date().toISOString() }).eq("id", item), "set status")

beforeAll(async () => {
    await ensureCastLoaded()
    await asSvc(svc().from("employees").update({ has_purchasing_flow: true }).eq("id", ids.outsider), "purchasing flag")
})

afterAll(async () => {
    for (const id of requestIds) {
        await svc().from("request_canvasses").delete().eq("request_id", id)
        await svc().from("purchase_request_item_prices").delete().in("item_id", (await svc().from("purchase_request_items").select("id").eq("request_id", id)).data?.map((i) => i.id) ?? [])
        await svc().from("purchase_request_items").delete().eq("request_id", id)
        await svc().from("purchase_request_messages").delete().eq("request_id", id)
        await svc().from("purchase_request_members").delete().eq("request_id", id)
        await svc().from("purchase_requests").delete().eq("id", id)
    }
    await purgeCostingForSors(sorIds)
    if (sorIds.length) await svc().from("sales_opportunities").delete().in("id", sorIds)
    await svc().from("employees").update({ has_purchasing_flow: false }).eq("id", ids.outsider)
})

describe("a winner per line", () => {
    let request, suppliers

    beforeAll(async () => {
        request = await openRequest("Winner per line", 3)
        ;({ suppliers } = await seedCanvass(request, 3, request.items.slice(0, 2)))
    })

    it("is one per line, and picking another clears the old one", async () => {
        const [a, b] = suppliers
        expect((await pick(request.items[0], a, "Cheapest")).error).toBeNull()
        expect((await winnerOf(request.items[0])).supplier_id).toBe(a)
        expect((await pick(request.items[0], b, "Faster")).error).toBeNull()
        const rows = await asSvc(svc().from("request_canvass_winners").select("supplier_id, reason").eq("item_id", request.items[0]), "winners")
        expect(rows).toEqual([{ supplier_id: b, reason: "Faster" }])
        // The other line is untouched.
        expect(await winnerOf(request.items[1])).toBeNull()
    })

    it("can be un-picked, leaving the line with none", async () => {
        const removed = await (await clientFor("outsider")).from("request_canvass_winners").delete().eq("item_id", request.items[0]).select("item_id")
        expect(removed.error).toBeNull()
        expect(removed.data).toHaveLength(1)
        expect(await winnerOf(request.items[0])).toBeNull()
    })

    it("has to be a supplier that quoted the line (refused otherwise)", async () => {
        // Nobody quoted the third line.
        const refused = await pick(request.items[2], suppliers[0])
        expect(refused.error.code).toBe(NOT_A_QUOTER)
        expect(await winnerOf(request.items[2])).toBeNull()
    })

    it("needs a reason (refused blank or missing)", async () => {
        for (const reason of ["", "   ", null]) {
            const refused = await pick(request.items[0], suppliers[0], reason)
            expect(refused.error?.code, String(reason)).toBeTruthy()
        }
        expect(await winnerOf(request.items[0])).toBeNull()
        const blankEdit = (await pick(request.items[0], suppliers[0], "Cheapest")).error
        expect(blankEdit).toBeNull()
        const cleared = await (await clientFor("outsider")).from("request_canvass_winners").update({ reason: "  " }).eq("item_id", request.items[0])
        expect(cleared.error.code).toBe(RULE)
        expect((await winnerOf(request.items[0])).reason).toBe("Cheapest")
    })

    it("is never on a cancelled line, and the cancelled line stays readable", async () => {
        const second = request.items[1]
        await setStatus(second, "cancelled")
        const refused = await pick(second, suppliers[0])
        expect(refused.error.code).toBe(RULE)
        expect(await winnerOf(second)).toBeNull()
        const readable = await (await clientFor("dealOwner")).from("request_canvass_quotes").select("id").eq("item_id", second)
        expect(readable.data.length).toBe(3)
    })

    it("is picked by Purchasing only", async () => {
        const refused = await pick(request.items[0], suppliers[1], "Sneaky", "dealOwner")
        expect(refused.error ?? refused.data.length === 0).toBeTruthy()
        expect((await winnerOf(request.items[0])).supplier_id).toBe(suppliers[0])
    })
})

describe("the shortcuts", () => {
    let request, canvass, suppliers

    beforeAll(async () => {
        request = await openRequest("Shortcuts", 3)
        ;({ canvass, suppliers } = await seedCanvass(request, 3, request.items.slice(0, 2)))
        // The third supplier also quotes the third line; the first two do not.
        await saveQuote(suppliers[2], request.items[2])
    })

    it("'this supplier wins every line' picks the lines it quoted and skips the others", async () => {
        const client = await clientFor("outsider")
        const { data, error } = await client.rpc("canvass_pick_supplier_for_all", {
            p_canvass_id: canvass,
            p_supplier_id: suppliers[0],
            p_reason: "Lowest total",
        })
        expect(error).toBeNull()
        expect(data).toMatchObject({ picked: 2, skipped: 0 })
        for (const item of request.items.slice(0, 2)) expect(await winnerOf(item)).toMatchObject({ supplier_id: suppliers[0], reason: "Lowest total" })
        // Lines the supplier did not quote are skipped.
        expect(await winnerOf(request.items[2])).toBeNull()
    })

    it("replaces winners already picked on the lines it quoted", async () => {
        const client = await clientFor("outsider")
        const { error } = await client.rpc("canvass_pick_supplier_for_all", { p_canvass_id: canvass, p_supplier_id: suppliers[2], p_reason: "Faster" })
        expect(error).toBeNull()
        for (const item of request.items) expect((await winnerOf(item)).supplier_id).toBe(suppliers[2])
    })

    it("'use the same reason for all' copies one reason to every picked line", async () => {
        const client = await clientFor("outsider")
        await pick(request.items[0], suppliers[0], "One reason")
        await pick(request.items[1], suppliers[1], "Another reason")
        const { data, error } = await client.rpc("canvass_use_same_reason", { p_canvass_id: canvass, p_reason: "Sole reason for all" })
        expect(error).toBeNull()
        expect(data.changed).toBe(3)
        for (const item of request.items) expect((await winnerOf(item)).reason).toBe("Sole reason for all")
    })

    it("refuse a blank reason, a stranger to the Canvass, and a supplier not on it", async () => {
        const client = await clientFor("outsider")
        const blank = await client.rpc("canvass_pick_supplier_for_all", { p_canvass_id: canvass, p_supplier_id: suppliers[0], p_reason: " " })
        expect(blank.error.code).toBe(RULE)
        const blankSame = await client.rpc("canvass_use_same_reason", { p_canvass_id: canvass, p_reason: "" })
        expect(blankSame.error.code).toBe(RULE)

        for (const who of ["dealOwner", "ordinary"]) {
            const other = await clientFor(who)
            const pickAll = await other.rpc("canvass_pick_supplier_for_all", { p_canvass_id: canvass, p_supplier_id: suppliers[0], p_reason: "no" })
            expect(pickAll.error?.code, who).toBe(DENIED)
            const same = await other.rpc("canvass_use_same_reason", { p_canvass_id: canvass, p_reason: "no" })
            expect(same.error?.code, who).toBe(DENIED)
        }

        const elsewhere = await openRequest("Shortcuts, elsewhere", 1)
        const foreign = await seedCanvass(elsewhere, 1)
        const wrong = await client.rpc("canvass_pick_supplier_for_all", { p_canvass_id: canvass, p_supplier_id: foreign.suppliers[0], p_reason: "no" })
        expect(wrong.error.code).toBe("P0002")
    })
})

describe("three suppliers, or a No other supplier note", () => {
    it("refuses a winner on any line while the Canvass has fewer than three suppliers", async () => {
        const request = await openRequest("Three suppliers", 2)
        const { suppliers } = await seedCanvass(request, 2)
        for (const item of request.items) {
            const refused = await pick(item, suppliers[0])
            expect(refused.error.code).toBe(RULE)
            expect(await winnerOf(item)).toBeNull()
        }
        const third = await addSupplier(request.id)
        await saveQuote(third.data.supplier.id, request.items[0])
        expect((await pick(request.items[0], suppliers[0])).error).toBeNull()
        // The rule is per Canvass, not per line: the second line was quoted by only two, and is open too.
        expect((await pick(request.items[1], suppliers[0])).error).toBeNull()
    })

    it("lets a No other supplier note cover the missing second and third", async () => {
        const request = await openRequest("Note covers", 1)
        const { canvass, suppliers } = await seedCanvass(request, 1)
        expect((await pick(request.items[0], suppliers[0])).error.code).toBe(RULE)
        const note = await (await clientFor("outsider")).from("request_canvass_no_other_supplier").insert({ canvass_id: canvass, reason: "Sole distributor", actor_id: ids.outsider })
        expect(note.error).toBeNull()
        expect((await pick(request.items[0], suppliers[0])).error).toBeNull()
    })

    it("covers a second supplier with the note too", async () => {
        const request = await openRequest("Note covers two", 1)
        const { canvass, suppliers } = await seedCanvass(request, 2)
        expect((await pick(request.items[0], suppliers[0])).error.code).toBe(RULE)
        await asSvc(svc().from("request_canvass_no_other_supplier").insert({ canvass_id: canvass, reason: "Only two stock it" }), "note")
        expect((await pick(request.items[0], suppliers[1])).error).toBeNull()
    })

    it("can't explain away the first supplier (a note on a Canvass with no supplier is refused)", async () => {
        const request = await openRequest("First supplier", 1)
        const { canvass, suppliers } = await seedCanvass(request, 1)
        await asSvc(svc().from("request_canvass_suppliers").delete().eq("id", suppliers[0]), "remove supplier")
        const refused = await (await clientFor("outsider")).from("request_canvass_no_other_supplier").insert({ canvass_id: canvass, reason: "Nobody sells it" })
        expect(refused.error.code).toBe(RULE)
        expect(refused.error.message).toMatch(/first supplier/i)
    })

    it("refuses a note on a Canvass that already has three suppliers", async () => {
        const request = await openRequest("Already three", 1)
        const { canvass } = await seedCanvass(request, 3)
        const refused = await (await clientFor("outsider")).from("request_canvass_no_other_supplier").insert({ canvass_id: canvass, reason: "Not needed" })
        expect(refused.error.code).toBe(RULE)
    })

    it("needs a reason on the note", async () => {
        const request = await openRequest("Note reason", 1)
        const { canvass } = await seedCanvass(request, 1)
        const refused = await (await clientFor("outsider")).from("request_canvass_no_other_supplier").insert({ canvass_id: canvass, reason: "  " })
        expect(refused.error.code).toBe("23514")
    })

    it("can't be taken off while a winner depends on it, but can once the winners go", async () => {
        const request = await openRequest("Note withdrawn", 1)
        const { canvass, suppliers } = await seedCanvass(request, 1)
        const client = await clientFor("outsider")
        await client.from("request_canvass_no_other_supplier").insert({ canvass_id: canvass, reason: "Sole distributor" })
        expect((await pick(request.items[0], suppliers[0])).error).toBeNull()

        const refused = await client.from("request_canvass_no_other_supplier").delete().eq("canvass_id", canvass).select("canvass_id")
        expect(refused.error.code).toBe(RULE)
        await client.from("request_canvass_winners").delete().eq("item_id", request.items[0])
        const removed = await client.from("request_canvass_no_other_supplier").delete().eq("canvass_id", canvass).select("canvass_id")
        expect(removed.error).toBeNull()
        expect(removed.data).toHaveLength(1)
        expect((await pick(request.items[0], suppliers[0])).error.code).toBe(RULE)
    })
})

describe("Still canvassing", () => {
    it("moves a line when the first supplier price is saved on it, and only that line", async () => {
        const request = await openRequest("Still canvassing", 2)
        const added = await addSupplier(request.id)
        const supplier = added.data.supplier.id
        await setStatus(request.items[0], "to_purchase")
        await setStatus(request.items[1], "to_purchase")

        const saved = await saveQuote(supplier, request.items[0], { brand: "X" }, { unit_price: 55 })
        expect(saved.error).toBeNull()
        expect(await statusOf(request.items[0])).toBe("still_canvassing")
        expect(await statusOf(request.items[1])).toBe("to_purchase")

        const events = await asSvc(svc().from("purchase_request_messages").select("metadata").eq("request_id", request.id), "events")
        expect(events.some((m) => m.metadata?.event === "item_status_changed" && m.metadata.item_id === request.items[0] && m.metadata.to === "still_canvassing")).toBe(true)
    })

    it("does not move a line for a quote with no price yet", async () => {
        const request = await openRequest("No price yet", 1)
        const added = await addSupplier(request.id)
        await setStatus(request.items[0], "to_purchase")
        const saved = await saveQuote(added.data.supplier.id, request.items[0], { brand: "X" }, {})
        expect(saved.error).toBeNull()
        expect(await statusOf(request.items[0])).toBe("to_purchase")
        await saveQuote(added.data.supplier.id, request.items[0], {}, { unit_price: 9 })
        expect(await statusOf(request.items[0])).toBe("still_canvassing")
    })

    it("leaves a line that is Purchased, or cancelled, where it is", async () => {
        const request = await openRequest("Closed lines", 2)
        const added = await addSupplier(request.id)
        await setStatus(request.items[0], "purchased")
        await setStatus(request.items[1], "cancelled")
        await saveQuote(added.data.supplier.id, request.items[1], {}, { unit_price: 9 })
        expect(await statusOf(request.items[0])).toBe("purchased")
        expect(await statusOf(request.items[1])).toBe("cancelled")
    })
})

describe("the lock on a Purchased line", () => {
    let request, canvass, suppliers

    beforeAll(async () => {
        request = await openRequest("Lock", 2)
        ;({ canvass, suppliers } = await seedCanvass(request, 3))
        expect((await pick(request.items[0], suppliers[0], "Cheapest")).error).toBeNull()
        expect((await pick(request.items[1], suppliers[0], "Cheapest")).error).toBeNull()
        await setStatus(request.items[0], "purchased")
    })

    const priceOf = async (supplier, item) => {
        const quote = await asSvc(svc().from("request_canvass_quotes").select("id").eq("supplier_id", supplier).eq("item_id", item).single(), "quote")
        return Number((await asSvc(svc().from("request_canvass_quote_prices").select("unit_price").eq("quote_id", quote.id).single(), "price")).unit_price)
    }

    it("refuses a changed quoted price", async () => {
        const refused = await saveQuote(suppliers[1], request.items[0], {}, { unit_price: 1 })
        expect(refused.error.code).toBe(LOCKED)
        expect(await priceOf(suppliers[1], request.items[0])).toBe(110)
        const direct = await (await clientFor("outsider")).from("request_canvass_quote_prices").update({ unit_price: 2 }).eq("quote_id", (await asSvc(svc().from("request_canvass_quotes").select("id").eq("supplier_id", suppliers[1]).eq("item_id", request.items[0]).single(), "quote")).id)
        expect(direct.error.code).toBe(LOCKED)
    })

    it("refuses a changed winner and a changed reason", async () => {
        const swap = await pick(request.items[0], suppliers[1], "Changed my mind")
        expect(swap.error.code).toBe(LOCKED)
        const reason = await (await clientFor("outsider")).from("request_canvass_winners").update({ reason: "Rewritten" }).eq("item_id", request.items[0])
        expect(reason.error.code).toBe(LOCKED)
        const unpick = await (await clientFor("outsider")).from("request_canvass_winners").delete().eq("item_id", request.items[0])
        expect(unpick.error.code).toBe(LOCKED)
        expect(await winnerOf(request.items[0])).toMatchObject({ supplier_id: suppliers[0], reason: "Cheapest" })
    })

    it("refuses a quote taken off, a quote changed, and a new quote, on that line", async () => {
        const client = await clientFor("outsider")
        const removed = await client.from("request_canvass_quotes").delete().eq("supplier_id", suppliers[1]).eq("item_id", request.items[0])
        expect(removed.error.code).toBe(LOCKED)
        const brand = await saveQuote(suppliers[1], request.items[0], { brand: "Different" }, {})
        expect(brand.error.code).toBe(LOCKED)
        const extra = await addSupplier(request.id)
        // A fourth supplier is allowed on the Canvass but can't quote a locked line.
        const fresh = await saveQuote(extra.data.supplier.id, request.items[0], {}, { unit_price: 5 })
        expect(fresh.error.code).toBe(LOCKED)
    })

    it("keeps the other lines of the same Canvass open", async () => {
        const saved = await saveQuote(suppliers[1], request.items[1], {}, { unit_price: 77 })
        expect(saved.error).toBeNull()
        expect(await priceOf(suppliers[1], request.items[1])).toBe(77)
        expect((await pick(request.items[1], suppliers[1], "Now cheapest")).error).toBeNull()
        const gone = await (await clientFor("outsider")).from("request_canvass_winners").delete().eq("item_id", request.items[1]).select("item_id")
        expect(gone.error).toBeNull()
    })

    it("keeps attachments open: a brochure on a locked line, and the Canvass's working sheets", async () => {
        const brochure = [{ url: "https://files.test/b.pdf", name: "b.pdf", type: "application/pdf", bytes: 10 }]
        const saved = await saveQuote(suppliers[1], request.items[0], { brochure }, {})
        expect(saved.error).toBeNull()
        expect(saved.data.brochure).toEqual(brochure)
        const sheet = await (await clientFor("outsider")).from("request_canvasses").update({ attachments: brochure }).eq("id", canvass).select("attachments")
        expect(sheet.error).toBeNull()
        expect(sheet.data[0].attachments).toEqual(brochure)
    })

    it("is lifted only by a Super Admin, with a reason, and the reason is kept", async () => {
        for (const who of ["outsider", "dealOwner", "ordinary"]) {
            const denied = await (await clientFor(who)).rpc("canvass_unlock_line", { p_item_id: request.items[0], p_reason: "Please" })
            expect(denied.error?.code, who).toBe(DENIED)
        }
        const admin = await clientFor("superAdmin")
        const blank = await admin.rpc("canvass_unlock_line", { p_item_id: request.items[0], p_reason: "  " })
        expect(blank.error.code).toBe(RULE)
        // Still locked after the refusals.
        expect((await saveQuote(suppliers[1], request.items[0], {}, { unit_price: 1 })).error.code).toBe(LOCKED)

        const lifted = await admin.rpc("canvass_unlock_line", { p_item_id: request.items[0], p_reason: "Supplier corrected the quote" })
        expect(lifted.error).toBeNull()
        expect(lifted.data).toMatchObject({ unlocked: true })

        const history = await asSvc(svc().from("request_canvass_line_unlocks").select("reason, actor_id").eq("item_id", request.items[0]), "history")
        expect(history).toEqual([{ reason: "Supplier corrected the quote", actor_id: ids.superAdmin }])
        const readable = await (await clientFor("dealOwner")).from("request_canvass_line_unlocks").select("reason").eq("item_id", request.items[0])
        expect(readable.data).toHaveLength(1)
        const events = await asSvc(svc().from("purchase_request_messages").select("metadata").eq("request_id", request.id), "events")
        expect(events.some((m) => m.metadata?.event === "canvass_line_unlocked" && m.metadata.reason === "Supplier corrected the quote")).toBe(true)

        // Open again.
        expect((await saveQuote(suppliers[1], request.items[0], {}, { unit_price: 111 })).error).toBeNull()
        expect((await pick(request.items[0], suppliers[2], "Corrected")).error).toBeNull()
        // Nothing to lift on a line that is already open.
        const again = await admin.rpc("canvass_unlock_line", { p_item_id: request.items[0], p_reason: "Again" })
        expect(again.data).toMatchObject({ unlocked: false })
    })

    it("locks the line again when it moves on to a new status", async () => {
        await setStatus(request.items[0], "received")
        expect((await saveQuote(suppliers[1], request.items[0], {}, { unit_price: 1 })).error.code).toBe(LOCKED)
    })

    it("does not stop the service role (clean-ups, the demo reset)", async () => {
        const removed = await svc().from("request_canvass_winners").delete().eq("item_id", request.items[0])
        expect(removed.error).toBeNull()
    })

    it("refuses nobody a read of the history who can't read the request", async () => {
        const rows = await (await clientFor("ordinary")).from("request_canvass_line_unlocks").select("id")
        expect(rows.data ?? []).toEqual([])
    })
})

describe("the canvasser", () => {
    it("defaults to the request's Purchasing Incharge, and can be changed", async () => {
        const request = await openRequest("Canvasser", 1)
        await asSvc(svc().from("purchase_requests").update({ buyer_id: ids.superAdmin }).eq("id", request.id), "Purchasing Incharge")
        const added = await addSupplier(request.id)
        const canvass = await asSvc(svc().from("request_canvasses").select("canvasser_id, created_by").eq("id", added.data.canvass_id).single(), "Canvass")
        expect(canvass.canvasser_id).toBe(ids.superAdmin)
        expect(canvass.created_by).toBe(ids.outsider)

        const changed = await (await clientFor("outsider")).from("request_canvasses").update({ canvasser_id: ids.outsider }).eq("id", added.data.canvass_id).select("canvasser_id")
        expect(changed.data).toEqual([{ canvasser_id: ids.outsider }])
        const refused = await (await clientFor("dealOwner")).from("request_canvasses").update({ canvasser_id: ids.dealOwner }).eq("id", added.data.canvass_id).select("canvasser_id")
        expect(refused.data ?? []).toEqual([])
    })

    it("falls back to whoever opened the Canvass when the request has no Purchasing Incharge", async () => {
        const request = await openRequest("Canvasser fallback", 1)
        await asSvc(svc().from("purchase_requests").update({ buyer_id: null }).eq("id", request.id), "no incharge")
        const added = await addSupplier(request.id)
        const canvass = await asSvc(svc().from("request_canvasses").select("canvasser_id").eq("id", added.data.canvass_id).single(), "Canvass")
        expect(canvass.canvasser_id).toBe(ids.outsider)
    })
})

describe("lines added later", () => {
    it("show as a new row with no quotes, and can be quoted and won like any line", async () => {
        const request = await openRequest("Added later", 1)
        const { canvass, suppliers } = await seedCanvass(request, 3)
        const late = await asSvc(
            svc().from("purchase_request_items").insert({ request_id: request.id, name: `${MARKER} Late line`, quantity: 1, source: "new", requested_by: ids.outsider }).select("id").single(),
            "late line",
        )
        const quotes = await asSvc(svc().from("request_canvass_quotes").select("id").eq("item_id", late.id), "quotes")
        expect(quotes).toEqual([])
        expect(await winnerOf(late.id)).toBeNull()
        // No quote, no winner.
        expect((await pick(late.id, suppliers[0])).error.code).toBe(NOT_A_QUOTER)
        expect((await saveQuote(suppliers[0], late.id)).error).toBeNull()
        expect((await pick(late.id, suppliers[0])).error).toBeNull()
        const row = (await (await clientFor("outsider")).rpc("canvass_list")).data.find((r) => r.id === canvass)
        expect(row).toMatchObject({ line_count: 2, quoted_line_count: 2, winner_count: 1 })
    })
})

describe("what a winner fills", () => {
    let sorId, request, lineId, comp, otherComp
    let itemOne, itemTwo

    const costsOf = async (id) => (await svc().from("costing_component_costs").select("*").eq("component_id", id).maybeSingle()).data
    const componentOf = async (id) => asSvc(svc().from("costing_components").select("*").eq("id", id).single(), "Component")
    const brochure = (name) => [{ url: `https://files.test/${name}.pdf`, name: `${name}.pdf`, type: "application/pdf", bytes: 1200 }]

    beforeAll(async () => {
        sorId = await makeSor({ registeredBy: ids.dealOwner, dealOwnerId: ids.dealOwner })
        sorIds.push(sorId)
        const matrixId = (await svc().rpc("costing_open_matrix", { p_opportunity_id: sorId })).data
        lineId = (await asSvc(svc().from("costing_tender_lines").insert({ matrix_id: matrixId, position: 1, tender_specification: "Stretcher", quantity: 1 }).select("id").single(), "Tender Line")).id
        comp = (await asSvc(svc().from("costing_components").insert({ tender_line_id: lineId, position: 1, name: "Component 1", quantity: 1, brand: "Generic" }).select("id").single(), "Component")).id
        otherComp = (await asSvc(svc().from("costing_components").insert({ tender_line_id: lineId, position: 2, name: "Component 2", quantity: 1 }).select("id").single(), "Component")).id
        request = (await asSvc(svc().from("purchase_requests").insert({ opportunity_id: sorId, created_by: ids.dealOwner }).select("id").single(), "request")).id
        requestIds.push(request)
        for (const [employee, side] of [[ids.outsider, "purchasing"], [ids.dealOwner, "sales"]]) {
            await asSvc(svc().from("purchase_request_members").upsert({ request_id: request, employee_id: employee, side }, { onConflict: "request_id,employee_id" }), "member")
        }
        const item = async (component, name) =>
            (await asSvc(svc().from("purchase_request_items").insert({ request_id: request, source: "component", component_id: component, name, quantity: 1, requested_by: ids.dealOwner }).select("id").single(), "item")).id
        itemOne = await item(comp, "Stretcher")
        itemTwo = await item(otherComp, "Tripod")
    })

    it("fills the Component's Acquire, Offer Specification and documents, with the line's price", async () => {
        const a = await addSupplier(request, { supplier_name: `${MARKER} Fill A` })
        const b = await addSupplier(request, { supplier_name: `${MARKER} Fill B` })
        const usd = await addSupplier(request, { supplier_name: `${MARKER} Fill C`, currency: "USD" }, { comparison_rate: 60 })
        await saveQuote(a.data.supplier.id, itemOne, { brand: "Toyota", description: "Folding stretcher, aluminium", brochure: brochure("a") }, { unit_price: 1000 })
        await saveQuote(b.data.supplier.id, itemOne, { brand: "Honda", description: "Rigid stretcher" }, { unit_price: 1200 })
        await saveQuote(usd.data.supplier.id, itemOne, { brand: "Acme", description: "Imported stretcher", brochure: brochure("c") }, { unit_price: 20 })
        const quoteA = (await asSvc(svc().from("request_canvass_quotes").select("id").eq("supplier_id", a.data.supplier.id).eq("item_id", itemOne).single(), "quote")).id
        const quoteC = (await asSvc(svc().from("request_canvass_quotes").select("id").eq("supplier_id", usd.data.supplier.id).eq("item_id", itemOne).single(), "quote")).id

        expect((await pick(itemOne, a.data.supplier.id, "Cheapest")).error).toBeNull()
        const costs = await costsOf(comp)
        expect(Number(costs.acquire_unit)).toBe(1000)
        expect(costs.acquire_from_offer_id).toBe(quoteA)
        const component = await componentOf(comp)
        expect(component.offer_specification).toBe("Folding stretcher, aluminium")
        expect(component.offer_specification_from_offer_id).toBe(quoteA)
        expect(component.documents).toEqual([{ ...brochure("a")[0], offer_id: quoteA }])
        // A Canvass only ever proposes a brand.
        expect(component.brand).toBe("Generic")
        const price = await asSvc(svc().from("purchase_request_item_prices").select("*").eq("item_id", itemOne).single(), "line price")
        expect(Number(price.unit_price)).toBe(1000)
        expect(price.currency).toBe("PHP")

        // A new winner replaces what the old one filled; a foreign price is turned into pesos at the supplier's rate.
        expect((await pick(itemOne, usd.data.supplier.id, "Better warranty")).error).toBeNull()
        expect(Number((await costsOf(comp)).acquire_unit)).toBe(1200)
        expect((await costsOf(comp)).acquire_from_offer_id).toBe(quoteC)
        const after = await componentOf(comp)
        expect(after.offer_specification).toBe("Imported stretcher")
        expect(after.documents).toEqual([{ ...brochure("c")[0], offer_id: quoteC }])
        const foreign = await asSvc(svc().from("purchase_request_item_prices").select("*").eq("item_id", itemOne).single(), "line price")
        expect(Number(foreign.unit_price)).toBe(20)
        expect(foreign.currency).toBe("USD")
        expect(Number(foreign.comparison_rate)).toBe(60)

        // Un-picking leaves what the winner filled in place.
        const removed = await (await clientFor("outsider")).from("request_canvass_winners").delete().eq("item_id", itemOne)
        expect(removed.error).toBeNull()
        expect(Number((await costsOf(comp)).acquire_unit)).toBe(1200)
        expect((await componentOf(comp)).offer_specification).toBe("Imported stretcher")
    })

    it("never overwrites a figure or a specification a person typed", async () => {
        await asSvc(svc().from("costing_component_costs").upsert({ component_id: otherComp, acquire_unit: 555 }, { onConflict: "component_id" }), "typed Acquire")
        await asSvc(svc().from("costing_components").update({ offer_specification: "Typed by hand" }).eq("id", otherComp), "typed spec")
        const added = await addSupplier(request, { supplier_name: `${MARKER} Fill D` })
        await saveQuote(added.data.supplier.id, itemTwo, { description: "From the quote" }, { unit_price: 10 })
        expect((await pick(itemTwo, added.data.supplier.id, "Only quote")).error).toBeNull()
        expect(Number((await costsOf(otherComp)).acquire_unit)).toBe(555)
        expect((await costsOf(otherComp)).acquire_from_offer_id).toBeNull()
        expect((await componentOf(otherComp)).offer_specification).toBe("Typed by hand")
    })

    it("clears the 'from Canvass' pointer when the quote it points at goes", async () => {
        const costs = await costsOf(comp)
        expect(costs.acquire_from_offer_id).not.toBeNull()
        await asSvc(svc().from("request_canvass_quotes").delete().eq("id", costs.acquire_from_offer_id), "remove quote")
        expect((await costsOf(comp)).acquire_from_offer_id).toBeNull()
        expect(Number((await costsOf(comp)).acquire_unit)).toBe(1200)
    })

    it("proposes the winner's brand for Sales or Purchasing to accept, and refuses others", async () => {
        const canvassRow = await asSvc(svc().from("request_canvasses").select("id").eq("request_id", request).single(), "Canvass")
        expect(canvassRow.id).toBeTruthy()
        const winnerQuote = await asSvc(
            svc().from("request_canvass_suppliers").select("id").eq("canvass_id", canvassRow.id).eq("supplier_name", `${MARKER} Fill B`).single(),
            "supplier",
        )
        await pick(itemOne, winnerQuote.id, "Honda is the brand we know")
        const accept = async (who) => (await clientFor(who)).rpc("costing_accept_brand", { p_component_id: comp })

        for (const who of ["ordinary"]) expect((await accept(who)).error?.code, who).toBe(DENIED)
        const accepted = await accept("dealOwner")
        expect(accepted.error).toBeNull()
        expect(accepted.data).toEqual({ brand: "Honda" })
        expect((await componentOf(comp)).brand).toBe("Honda")

        // With no winner there is nothing to accept.
        await svc().from("request_canvass_winners").delete().eq("item_id", itemOne)
        const none = await accept("dealOwner")
        expect(none.error.code).toBe(RULE)
    })

    it("serves each quote's Acquire and Markup Price to the Closed Book tier, and nothing to anyone else", async () => {
        const canvassRow = await asSvc(svc().from("request_canvasses").select("id").eq("request_id", request).single(), "Canvass")
        const projected = await (await clientFor("outsider")).rpc("canvass_offer_projection", { p_canvass_id: canvassRow.id })
        expect(projected.error).toBeNull()
        expect(projected.data.length).toBeGreaterThanOrEqual(2)
        const withPrice = projected.data.find((row) => Number(row.acquire_unit) === 1200)
        expect(withPrice).toBeTruthy()
        expect(withPrice.markup_price_unit).not.toBeUndefined()
        expect(Object.keys(withPrice).sort()).toEqual(["acquire_unit", "item_id", "markup_price_unit", "offer_id", "quote_id", "supplier_id"])

        const nobody = await (await clientFor("ordinary")).rpc("canvass_offer_projection", { p_canvass_id: canvassRow.id })
        expect(nobody.data).toBeNull()
        expect(nobody.error).toBeNull()
    })
})
