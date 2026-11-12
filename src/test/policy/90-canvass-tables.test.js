/**
 * Canvass tables, one per Purchase Request (#967, spec #956): one Canvass per request, the CNV_
 * number when the first supplier is saved, a supplier once, one quote per supplier per line, a
 * winner per line, the "No other supplier" note, who writes, who reads and who reads money.
 *
 * The cast, on one Purchase Request (outsider opens it and has Purchasing access):
 *   outsider     Purchasing access, on the request       -> reads, writes, sees money
 *   superAdmin                                           -> reads, writes, sees money
 *   finance      Finance access, a member of the request -> reads, sees money, no write
 *   dealOwner    a member of the request (sales side)    -> reads names, no money, no write
 *   ordinary     nobody                                  -> reads nothing, no write
 *
 * The request and its lines are made with the purchaser's own function and the service role;
 * every assertion about access runs as a real cast member.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { ids, clientFor, ensureCastLoaded } from "./support/cast.js"
import { serviceClient, rlsStatus, sql } from "./support/stack.js"

const svc = () => serviceClient()
const CHECK_VIOLATION = "23514"
const UNIQUE_VIOLATION = "23505"
const FOREIGN_KEY_VIOLATION = "23503"
const INSUFFICIENT_PRIVILEGE = "42501"

const TABLES = [
    "request_canvasses",
    "request_canvass_suppliers",
    "request_canvass_supplier_prices",
    "request_canvass_quotes",
    "request_canvass_quote_prices",
    "request_canvass_winners",
    "request_canvass_no_other_supplier",
]

let requestId, otherRequestId
let lineA, lineB, otherLine
const requestIds = []

const asSvc = async (query, what) => {
    const { data, error } = await query
    if (error) throw new Error(`${what}: ${error.message}`)
    return data
}

async function openRequest(title) {
    const purchaser = await clientFor("outsider")
    const made = await purchaser.rpc("purchase_request_open", {
        p_title: `[policy-tier] ${title}`,
        p_items: [
            { name: `[policy-tier] ${title} line A`, quantity: 2, unit: "pc" },
            { name: `[policy-tier] ${title} line B`, quantity: 1, unit: "pc" },
        ],
    })
    if (made.error) throw new Error(`purchase_request_open: ${made.error.message}`)
    requestIds.push(made.data)
    const items = await asSvc(svc().from("purchase_request_items").select("id, name").eq("request_id", made.data).order("name"), "items")
    return { id: made.data, items: items.map((i) => i.id) }
}

/** A supplier added the way the app adds one: by canvass_add_supplier, as the purchaser. */
async function addSupplier(forRequest, supplier = {}, price = {}, who = "outsider") {
    const client = await clientFor(who)
    return client.rpc("canvass_add_supplier", {
        p_request_id: forRequest,
        p_supplier: { supplier_name: `[policy-tier] Redleaf ${Math.random().toString(36).slice(2, 8)}`, ...supplier },
        p_price: price,
    })
}

const canvassOf = async (forRequest) =>
    (await asSvc(svc().from("request_canvasses").select("*").eq("request_id", forRequest).maybeSingle(), "Canvass"))

async function wipe(forRequest) {
    await svc().from("request_canvasses").delete().eq("request_id", forRequest)
}

beforeAll(async () => {
    await ensureCastLoaded()
    await asSvc(svc().from("employees").update({ has_purchasing_flow: true }).eq("id", ids.outsider), "purchasing flag")

    const first = await openRequest("Canvass tables")
    requestId = first.id
    ;[lineA, lineB] = first.items
    const other = await openRequest("Canvass tables, other request")
    otherRequestId = other.id
    otherLine = other.items[0]

    for (const [employee, side] of [[ids.dealOwner, "sales"], [ids.finance, "sales"]]) {
        await asSvc(svc().from("purchase_request_members").upsert({ request_id: requestId, employee_id: employee, side }, { onConflict: "request_id,employee_id" }), "member")
    }
})

afterAll(async () => {
    for (const id of requestIds) {
        await svc().from("request_canvasses").delete().eq("request_id", id)
        await svc().from("purchase_request_items").delete().eq("request_id", id)
        await svc().from("purchase_request_messages").delete().eq("request_id", id)
        await svc().from("purchase_request_members").delete().eq("request_id", id)
        await svc().from("purchase_requests").delete().eq("id", id)
    }
    await svc().from("employees").update({ has_purchasing_flow: false }).eq("id", ids.outsider)
})

describe("the tables", () => {
    it("keep row level security on", async () => {
        for (const table of TABLES) expect(await rlsStatus(table), table).toMatchObject({ enabled: true })
    })

    it("replace the per-line Canvass: the old tables are gone", async () => {
        const { rows } = await sql().query(
            `select table_name from information_schema.tables
              where table_schema = 'public' and table_name in ('sor_canvasses', 'sor_canvass_offers', 'sor_canvass_offer_prices', 'sor_canvass_signoff_events', 'sor_canvass_no_other_supplier')`,
        )
        expect(rows).toEqual([])
    })
})

describe("one Canvass per request", () => {
    it("is made by the first supplier, which gives it its CNV_ number; reading never makes it", async () => {
        expect(await canvassOf(requestId)).toBeNull()
        const reader = await clientFor("outsider")
        await reader.from("request_canvasses").select("*").eq("request_id", requestId)
        expect(await canvassOf(requestId)).toBeNull()

        const { data, error } = await addSupplier(requestId)
        expect(error).toBeNull()
        expect(data.number).toMatch(/^CNV_\d{4}$/)
        const canvass = await canvassOf(requestId)
        expect(canvass.id).toBe(data.canvass_id)
        expect(canvass.number).toBe(data.number)
        expect(canvass.created_by).toBe(ids.outsider)
        expect(canvass.canvasser_id).toBe(ids.outsider)
        await wipe(requestId)
    })

    it("takes a second supplier onto the same Canvass, in order", async () => {
        const one = await addSupplier(requestId)
        const two = await addSupplier(requestId)
        expect(two.data.canvass_id).toBe(one.data.canvass_id)
        expect(two.data.number).toBe(one.data.number)
        expect([one.data.supplier.sort_order, two.data.supplier.sort_order]).toEqual([0, 1])
        await wipe(requestId)
    })

    it("refuses a second Canvass on one request", async () => {
        const first = await addSupplier(requestId)
        const again = await svc().from("request_canvasses").insert({ request_id: requestId, number: "x" })
        expect(again.error.code).toBe(UNIQUE_VIOLATION)
        expect(first.error).toBeNull()
        await wipe(requestId)
    })

    it("has no insert path for a signed-in user but the function", async () => {
        const client = await clientFor("outsider")
        const direct = await client.from("request_canvasses").insert({ request_id: requestId, number: "x" })
        expect(direct.error.code).toBe(INSUFFICIENT_PRIVILEGE)
    })

    it("goes with its request", async () => {
        const made = await openRequest("Canvass cascade")
        await addSupplier(made.id)
        await asSvc(svc().from("purchase_request_items").delete().eq("request_id", made.id), "items")
        await asSvc(svc().from("purchase_request_messages").delete().eq("request_id", made.id), "messages")
        await asSvc(svc().from("purchase_request_members").delete().eq("request_id", made.id), "members")
        await asSvc(svc().from("purchase_requests").delete().eq("id", made.id), "request")
        expect(await canvassOf(made.id)).toBeNull()
    })
})

describe("the number", () => {
    it("is CNV_ and four digits, assigned by the database whatever the caller sends", async () => {
        const { data } = await addSupplier(requestId)
        const forced = await svc().from("request_canvasses").insert({ request_id: otherRequestId, number: "CNV_9999" }).select("number").single()
        expect(forced.data.number).toMatch(/^CNV_\d{4}$/)
        expect(forced.data.number).not.toBe("CNV_9999")
        expect(data.number).toMatch(/^CNV_\d{4}$/)
        await wipe(requestId)
        await wipe(otherRequestId)
    })

    it("is never changed, and never reused", async () => {
        const first = await addSupplier(requestId)
        const client = await clientFor("outsider")
        const edit = await client.from("request_canvasses").update({ number: "CNV_0001" }).eq("id", first.data.canvass_id)
        expect(edit.error.code).toBe(INSUFFICIENT_PRIVILEGE)
        const move = await client.from("request_canvasses").update({ request_id: otherRequestId }).eq("id", first.data.canvass_id)
        expect(move.error.code).toBe(INSUFFICIENT_PRIVILEGE)

        await wipe(requestId)
        const second = await addSupplier(requestId)
        expect(Number(second.data.number.slice(4))).toBeGreaterThan(Number(first.data.number.slice(4)))
        await wipe(requestId)
    })
})

describe("a supplier", () => {
    let canvass

    beforeAll(async () => {
        canvass = (await addSupplier(requestId, { supplier_name: "[policy-tier] Base" })).data.canvass_id
    })
    afterAll(() => wipe(requestId))

    it("defaults to PHP, and refuses a currency that is not three capital letters", async () => {
        const made = await addSupplier(requestId)
        expect(made.data.supplier.currency).toBe("PHP")
        const bad = await svc().from("request_canvass_suppliers").update({ currency: "usd" }).eq("id", made.data.supplier.id)
        expect(bad.error.code).toBe(CHECK_VIOLATION)
    })

    it("needs a name, and is added to a Canvass once", async () => {
        const blank = await addSupplier(requestId, { supplier_name: "  " })
        expect(blank.error).not.toBeNull()
        await addSupplier(requestId, { supplier_name: "[policy-tier] Twice" })
        const twice = await addSupplier(requestId, { supplier_name: "  [policy-tier] TWICE " })
        expect(twice.error.code).toBe(UNIQUE_VIOLATION)
    })

    it("keeps how long the quote holds, the lead time and the quality note", async () => {
        const made = await addSupplier(requestId, { valid_until: "2027-01-31", lead_time: "2 weeks", quality_note: "ISO 9001" })
        expect(made.data.supplier).toMatchObject({ valid_until: "2027-01-31", lead_time: "2 weeks", quality_note: "ISO 9001", canvass_id: canvass })
    })

    it("takes a comparison rate only when foreign", async () => {
        const php = await addSupplier(requestId, { currency: "PHP" }, { comparison_rate: 60 })
        expect(php.error.code).toBe(CHECK_VIOLATION)

        const usd = await addSupplier(requestId, { currency: "USD" }, { comparison_rate: 63.5 })
        expect(usd.error).toBeNull()
        const rate = await asSvc(svc().from("request_canvass_supplier_prices").select("*").eq("supplier_id", usd.data.supplier.id).single(), "rate")
        expect(Number(rate.comparison_rate)).toBe(63.5)

        const toPhp = await svc().from("request_canvass_suppliers").update({ currency: "PHP" }).eq("id", usd.data.supplier.id)
        expect(toPhp.error.code).toBe(CHECK_VIOLATION)
        const zero = await svc().from("request_canvass_supplier_prices").update({ comparison_rate: 0 }).eq("supplier_id", usd.data.supplier.id)
        expect(zero.error.code).toBe(CHECK_VIOLATION)
    })
})

describe("a quote", () => {
    let canvass, supplier, second

    beforeAll(async () => {
        const made = await addSupplier(requestId, { supplier_name: "[policy-tier] Quoter" })
        canvass = made.data.canvass_id
        supplier = made.data.supplier.id
        second = (await addSupplier(requestId, { supplier_name: "[policy-tier] Quoter two" })).data.supplier.id
    })
    afterAll(() => wipe(requestId))

    it("is one supplier's answer on one line, with its price row, saved together", async () => {
        const client = await clientFor("outsider")
        const saved = await client.rpc("canvass_save_quote", {
            p_supplier_id: supplier,
            p_item_id: lineA,
            p_quote: { brand: "Acme", description: "Rope 10mm", source_link: "https://example.com/rope", remarks: "stock" },
            p_price: { unit_price: 125.5 },
        })
        expect(saved.error).toBeNull()
        expect(saved.data).toMatchObject({ brand: "Acme", description: "Rope 10mm", canvass_id: canvass, item_id: lineA })
        const price = await asSvc(svc().from("request_canvass_quote_prices").select("unit_price").eq("quote_id", saved.data.id).single(), "price")
        expect(Number(price.unit_price)).toBe(125.5)
    })

    it("is saved again as an edit, touching only the keys sent", async () => {
        const client = await clientFor("outsider")
        const saved = await client.rpc("canvass_save_quote", { p_supplier_id: supplier, p_item_id: lineA, p_quote: { remarks: "out of stock" }, p_price: {} })
        expect(saved.data).toMatchObject({ brand: "Acme", remarks: "out of stock" })
        const rows = await asSvc(svc().from("request_canvass_quotes").select("id").eq("supplier_id", supplier).eq("item_id", lineA), "quotes")
        expect(rows).toHaveLength(1)
        const price = await asSvc(svc().from("request_canvass_quote_prices").select("unit_price").eq("quote_id", saved.data.id).single(), "price")
        expect(Number(price.unit_price)).toBe(125.5)
    })

    it("lets a supplier skip a line", async () => {
        const rows = await asSvc(svc().from("request_canvass_quotes").select("item_id").eq("supplier_id", supplier), "quotes")
        expect(rows.map((r) => r.item_id)).toEqual([lineA])
    })

    it("is one per supplier per line", async () => {
        const dup = await svc().from("request_canvass_quotes").insert({ canvass_id: canvass, supplier_id: supplier, item_id: lineA })
        expect(dup.error.code).toBe(UNIQUE_VIOLATION)
    })

    it("has to be on a line of the Canvass's own request", async () => {
        const client = await clientFor("outsider")
        const foreign = await client.rpc("canvass_save_quote", { p_supplier_id: supplier, p_item_id: otherLine, p_quote: {}, p_price: {} })
        expect(foreign.error.code).toBe(CHECK_VIOLATION)
    })

    it("refuses a negative price", async () => {
        const client = await clientFor("outsider")
        const saved = await client.rpc("canvass_save_quote", { p_supplier_id: second, p_item_id: lineB, p_quote: {}, p_price: { unit_price: -1 } })
        expect(saved.error.code).toBe(CHECK_VIOLATION)
    })

    it("goes with its line, and with its supplier", async () => {
        const client = await clientFor("outsider")
        await client.rpc("canvass_save_quote", { p_supplier_id: second, p_item_id: lineB, p_quote: { brand: "Gone" }, p_price: { unit_price: 1 } })
        await asSvc(svc().from("request_canvass_suppliers").delete().eq("id", second), "supplier")
        const left = await asSvc(svc().from("request_canvass_quotes").select("id").eq("supplier_id", second), "quotes")
        expect(left).toEqual([])
    })
})

describe("a winner", () => {
    let supplier, other

    beforeAll(async () => {
        const client = await clientFor("outsider")
        supplier = (await addSupplier(requestId, { supplier_name: "[policy-tier] Winner" })).data.supplier.id
        other = (await addSupplier(requestId, { supplier_name: "[policy-tier] Runner up" })).data.supplier.id
        await client.rpc("canvass_save_quote", { p_supplier_id: supplier, p_item_id: lineA, p_quote: { brand: "A" }, p_price: { unit_price: 10 } })
        await client.rpc("canvass_save_quote", { p_supplier_id: other, p_item_id: lineA, p_quote: { brand: "B" }, p_price: { unit_price: 12 } })
    })
    afterAll(() => wipe(requestId))

    it("is one per line, with its reason, and replaces the line's winner", async () => {
        const client = await clientFor("outsider")
        const first = await client.from("request_canvass_winners").upsert({ item_id: lineA, supplier_id: supplier, reason: "Cheapest" }, { onConflict: "item_id" }).select()
        expect(first.error).toBeNull()
        const second = await client.from("request_canvass_winners").upsert({ item_id: lineA, supplier_id: other, reason: "Faster" }, { onConflict: "item_id" }).select()
        expect(second.error).toBeNull()
        const rows = await asSvc(svc().from("request_canvass_winners").select("supplier_id, reason").eq("item_id", lineA), "winners")
        expect(rows).toEqual([{ supplier_id: other, reason: "Faster" }])
        const twice = await svc().from("request_canvass_winners").insert({ item_id: lineA, supplier_id: supplier })
        expect(twice.error.code).toBe(UNIQUE_VIOLATION)
    })

    it("has to be a supplier that quoted the line", async () => {
        const refused = await svc().from("request_canvass_winners").insert({ item_id: lineB, supplier_id: supplier })
        expect(refused.error.code).toBe(FOREIGN_KEY_VIOLATION)
    })

    it("goes when its quote does", async () => {
        await asSvc(svc().from("request_canvass_quotes").delete().eq("supplier_id", other).eq("item_id", lineA), "quote")
        const rows = await asSvc(svc().from("request_canvass_winners").select("item_id").eq("item_id", lineA), "winners")
        expect(rows).toEqual([])
    })
})

describe("the No other supplier note", () => {
    let canvass

    beforeAll(async () => {
        canvass = (await addSupplier(requestId)).data.canvass_id
    })
    afterAll(() => wipe(requestId))

    it("is one per Canvass, written by Purchasing, and needs a reason", async () => {
        const client = await clientFor("outsider")
        const blank = await client.from("request_canvass_no_other_supplier").insert({ canvass_id: canvass, reason: "  " })
        expect(blank.error.code).toBe(CHECK_VIOLATION)
        const note = await client.from("request_canvass_no_other_supplier").insert({ canvass_id: canvass, reason: "Sole distributor", actor_id: ids.outsider })
        expect(note.error).toBeNull()
        const twice = await svc().from("request_canvass_no_other_supplier").insert({ canvass_id: canvass, reason: "Again" })
        expect(twice.error.code).toBe(UNIQUE_VIOLATION)
    })
})

describe("who reads, who writes, who sees money", () => {
    let canvass, usd, quote

    beforeAll(async () => {
        const client = await clientFor("outsider")
        const made = await addSupplier(requestId, { supplier_name: "[policy-tier] Visible", currency: "USD" }, { comparison_rate: 63.5 })
        canvass = made.data.canvass_id
        usd = made.data.supplier.id
        const saved = await client.rpc("canvass_save_quote", { p_supplier_id: usd, p_item_id: lineA, p_quote: { brand: "Visible" }, p_price: { unit_price: 99 } })
        quote = saved.data.id
        await asSvc(svc().from("request_canvass_winners").insert({ item_id: lineA, supplier_id: usd, reason: "Only one" }), "winner")
        await asSvc(svc().from("request_canvass_no_other_supplier").insert({ canvass_id: canvass, reason: "Sole" }), "note")
    })
    afterAll(() => wipe(requestId))

    it.each(["outsider", "superAdmin", "finance", "dealOwner"])("%s reads the Canvass, its suppliers, quotes, winners and note", async (who) => {
        const client = await clientFor(who)
        expect((await client.from("request_canvasses").select("id").eq("id", canvass)).data, who).toHaveLength(1)
        expect((await client.from("request_canvass_suppliers").select("id").eq("id", usd)).data, who).toHaveLength(1)
        expect((await client.from("request_canvass_quotes").select("id").eq("id", quote)).data, who).toHaveLength(1)
        expect((await client.from("request_canvass_winners").select("item_id").eq("item_id", lineA)).data, who).toHaveLength(1)
        expect((await client.from("request_canvass_no_other_supplier").select("canvass_id").eq("canvass_id", canvass)).data, who).toHaveLength(1)
    })

    it.each(["outsider", "superAdmin", "finance"])("%s sees the unit price and the comparison rate", async (who) => {
        const client = await clientFor(who)
        const price = await client.from("request_canvass_quote_prices").select("unit_price").eq("quote_id", quote)
        expect(price.data, who).toHaveLength(1)
        expect(Number(price.data[0].unit_price)).toBe(99)
        const rate = await client.from("request_canvass_supplier_prices").select("comparison_rate").eq("supplier_id", usd)
        expect(rate.data, who).toHaveLength(1)
        expect((await client.rpc("canvass_can_read_money", { p_canvass_id: canvass })).data, who).toBe(true)
    })

    it("shows a member without the money tier the names, and no price and no rate", async () => {
        const client = await clientFor("dealOwner")
        const price = await client.from("request_canvass_quote_prices").select("*").eq("quote_id", quote)
        expect(price.error).toBeNull()
        expect(price.data).toEqual([])
        const rate = await client.from("request_canvass_supplier_prices").select("*").eq("supplier_id", usd)
        expect(rate.data).toEqual([])
        expect((await client.rpc("canvass_can_read_money", { p_canvass_id: canvass })).data).toBe(false)
    })

    it("shows someone who is not on the request nothing at all", async () => {
        const client = await clientFor("ordinary")
        for (const [table, column, value] of [
            ["request_canvasses", "id", canvass],
            ["request_canvass_suppliers", "id", usd],
            ["request_canvass_quotes", "id", quote],
            ["request_canvass_winners", "item_id", lineA],
            ["request_canvass_no_other_supplier", "canvass_id", canvass],
            ["request_canvass_quote_prices", "quote_id", quote],
            ["request_canvass_supplier_prices", "supplier_id", usd],
        ]) {
            const { data } = await client.from(table).select("*").eq(column, value)
            expect(data, table).toEqual([])
        }
    })

    it("lets Purchasing and a Super Admin write, and no one else", async () => {
        for (const who of ["outsider", "superAdmin"]) {
            const client = await clientFor(who)
            const edit = await client.from("request_canvass_suppliers").update({ lead_time: `${who} 3 days` }).eq("id", usd).select("lead_time")
            expect(edit.data, who).toEqual([{ lead_time: `${who} 3 days` }])
        }
        for (const who of ["dealOwner", "finance", "ordinary", "head"]) {
            const client = await clientFor(who)
            const edit = await client.from("request_canvass_suppliers").update({ lead_time: "hacked" }).eq("id", usd).select("lead_time")
            expect(edit.data ?? [], who).toEqual([])
            const winner = await client.from("request_canvass_winners").update({ reason: "hacked" }).eq("item_id", lineA).select("reason")
            expect(winner.data ?? [], who).toEqual([])
            const price = await client.from("request_canvass_quote_prices").update({ unit_price: 1 }).eq("quote_id", quote).select("unit_price")
            expect(price.data ?? [], who).toEqual([])
            const removed = await client.from("request_canvass_quotes").delete().eq("id", quote).select("id")
            expect(removed.data ?? [], who).toEqual([])
        }
        const intact = await asSvc(svc().from("request_canvass_quote_prices").select("unit_price").eq("quote_id", quote).single(), "price")
        expect(Number(intact.unit_price)).toBe(99)
    })

    it("refuses a person without Purchasing access the add-supplier and save-quote functions", async () => {
        for (const who of ["dealOwner", "finance", "ordinary", "head"]) {
            const add = await addSupplier(requestId, {}, {}, who)
            expect(add.error?.code, who).toBe(INSUFFICIENT_PRIVILEGE)
            const client = await clientFor(who)
            const save = await client.rpc("canvass_save_quote", { p_supplier_id: usd, p_item_id: lineB, p_quote: { brand: "no" }, p_price: { unit_price: 1 } })
            expect(save.error, who).not.toBeNull()
        }
        const none = await asSvc(svc().from("request_canvass_quotes").select("id").eq("supplier_id", usd).eq("item_id", lineB), "quotes")
        expect(none).toEqual([])
    })

    it("lists the Canvass to a reader of the request, by name and count, for one row per request", async () => {
        const client = await clientFor("dealOwner")
        const { data, error } = await client.rpc("canvass_list")
        expect(error).toBeNull()
        const mine = data.filter((row) => row.id === canvass)
        expect(mine).toHaveLength(1)
        expect(mine[0]).toMatchObject({ request_id: requestId, supplier_count: 1, quoted_line_count: 1, winner_count: 1 })
        expect(Object.keys(mine[0]).some((key) => /price|rate/.test(key))).toBe(false)
        const nobody = await (await clientFor("ordinary")).rpc("canvass_list")
        expect(nobody.data.filter((row) => row.id === canvass)).toEqual([])
    })
})
