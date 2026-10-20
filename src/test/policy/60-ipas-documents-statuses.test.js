/**
 * IPAS documents, Supplier Origin and the buyer track (#246, spec #241): the
 * database rules.
 *
 * `outsider` holds Purchasing access for the file and is the purchaser;
 * `finance` holds Finance access alone; `superAdmin` is a Super Admin with
 * neither flag; `ipasSigner` is a plain employee; `ordinary` and `dealOwner`
 * are nobody to the IPAS.
 *
 * Everything runs through the real functions. The two ticks have different
 * owners, which a table policy can't express, so `ipas_documents` carries a
 * read policy only and every write is a function: Finance may set only
 * finance_has, Purchasing everything else.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { CAST_KEYS, FIXTURE_DOMAIN, ids, clientFor, ensureCastLoaded } from "./support/cast.js"
import { serviceClient, sql, rlsStatus } from "./support/stack.js"
import { purgeFixtureIpas, raiseAsPurchaser } from "./support/ipas.js"
import { RLS_VIOLATION } from "./support/access.js"

const svc = () => serviceClient()

let poSeq = 0
/** A PO number nothing else in the tier uses. */
const nextPo = () => `P9${String(70000 + (poSeq += 1)).padStart(6, "0")}`

const copyFor = (po) => ({
    po: { id: 870000 + poSeq, name: po, state: "purchase", company: "T3ck Trading", company_id: 1, currency: "Php", origin: null, partner_ref: null },
    supplier: { id: 9_300_000 + poSeq, name: "Scorpe Technologies", contact: null },
    lines: [
        { line_id: 910001 + poSeq * 10, product_id: 5350, name: "Cutter", quantity: 6, unit: "Unit", price_unit: 1250, price_subtotal: 7500, taxes: [], analytic: [], brand: null },
    ],
    receipts: { status: "pending", done: 0, total: 1 },
    bills: { count: 0, draft: 0 },
})

const rpc = async (who, name, args) => (await clientFor(who)).rpc(name, args)

/** Raises an IPAS as the purchaser (Import or Local). */
async function raise(source = "import") {
    const po = nextPo()
    const { data, error } = await raiseAsPurchaser({
        p_po_number: po,
        p_priority: "high",
        p_source: source,
        p_purpose: "inventory",
        p_sor_ids: [],
        p_remarks: null,
        p_odoo_copy: copyFor(po),
    })
    if (error) throw new Error(`ipas_create ${po}: ${error.message}`)
    return data
}

const kinds = async () => {
    const { data, error } = await svc().from("ipas_options").select("*").eq("list", "document_kind")
    if (error) throw error
    return data
}

const kindByLabel = async (label) => (await kinds()).find((k) => k.label === label)

const optionByLabel = async (list, label) => {
    const { data, error } = await svc().from("ipas_options").select("*").eq("list", list).eq("label", label).single()
    if (error) throw error
    return data
}

const documentsOf = async (ipasId) => {
    const { data, error } = await svc().from("ipas_documents").select("*, kind:ipas_options(label)").eq("ipas_id", ipasId)
    if (error) throw error
    return data
}

const labelsOf = async (ipasId) =>
    (await documentsOf(ipasId)).map((d) => d.kind?.label ?? d.label).sort()

const docByLabel = async (ipasId, label) => (await documentsOf(ipasId)).find((d) => (d.kind?.label ?? d.label) === label)

const ipasRow = async (id) => {
    const { data, error } = await svc().from("ipas").select("*").eq("id", id).single()
    if (error) throw error
    return data
}

async function events(ipasId, ...eventKinds) {
    let query = svc().from("ipas_events").select("*").eq("ipas_id", ipasId).order("created_at")
    if (eventKinds.length) query = query.in("kind", eventKinds)
    const { data, error } = await query
    if (error) throw error
    return data
}

const tick = (who, documentId, side, value) =>
    rpc(who, "ipas_tick_document", { p_document_id: documentId, p_side: side, p_value: value })

const addDocument = (who, ipasId, over = {}) =>
    rpc(who, "ipas_add_document", { p_ipas_id: ipasId, p_kind_id: null, p_label: null, p_attachment_url: null, ...over })

const setOrigin = (who, ipasId, fields) => rpc(who, "ipas_set_supplier_origin", { p_ipas_id: ipasId, p_fields: fields })
const setTyped = (who, ipasId, status, date) =>
    rpc(who, "ipas_set_typed_status", { p_ipas_id: ipasId, p_status: status, p_date: date })

const setState = (id, state) =>
    sql().query(
        state === "filed"
            ? `update public.ipas set state = 'filed', filed_at = now() where id = $1`
            : `update public.ipas set state = 'cancelled', cancelled_at = now(), cancel_reason = 'test' where id = $1`,
        [id],
    )

const created = []

beforeAll(async () => {
    await ensureCastLoaded()
    const flag = await svc().from("employees").update({ has_purchasing_flow: true }).eq("id", ids.outsider)
    if (flag.error) throw flag.error
})

afterAll(async () => {
    // Kinds this file switched off or added.
    await svc().from("ipas_options").update({ active: true }).eq("list", "document_kind").eq("label", "Waybill")
    for (const id of created) await sql().query(`delete from public.ipas_options where id = $1`, [id])
    await svc().from("employees").update({ has_purchasing_flow: false }).eq("id", ids.outsider)
    await purgeFixtureIpas(`%@${FIXTURE_DOMAIN}`)
})

describe("the new table is protected", () => {
    it("has row level security on and a read policy only: every write goes through a function", async () => {
        const { enabled, policies } = await rlsStatus("ipas_documents")
        expect(enabled, "ipas_documents has RLS switched off").toBe(true)
        expect(policies, "ipas_documents has no policy").toBeGreaterThan(0)
        const { rows } = await sql().query(
            `select cmd from pg_policies where schemaname = 'public' and tablename = 'ipas_documents'`,
        )
        expect(rows.map((r) => r.cmd)).toEqual(["SELECT"])
    })

    it("refuses a direct insert, update or delete for everyone, Purchasing and Finance included", async () => {
        const ipas = await raise("import")
        const doc = (await documentsOf(ipas.id))[0]
        const spare = await raise("local")

        for (const who of CAST_KEYS) {
            const client = await clientFor(who)

            const inserted = await client.from("ipas_documents").insert({ ipas_id: spare.id, label: "Hand typed" }).select()
            expect(inserted.error?.code, `${who} inserted a row`).toBe(RLS_VIOLATION)

            const updated = await client.from("ipas_documents").update({ finance_has: true }).eq("id", doc.id).select()
            expect(updated.data ?? [], `${who} updated a row`).toEqual([])

            const deleted = await client.from("ipas_documents").delete().eq("id", doc.id).select()
            expect(deleted.data ?? [], `${who} deleted a row`).toEqual([])
        }

        expect((await documentsOf(ipas.id)).find((d) => d.id === doc.id)).toMatchObject({ finance_has: false })
        expect(await labelsOf(spare.id)).not.toContain("Hand typed")
    })

    it("reads documents for the IPAS's readers only", async () => {
        const ipas = await raise("import")
        for (const who of ["outsider", "finance", "superAdmin"]) {
            const { data, error } = await (await clientFor(who)).from("ipas_documents").select("id").eq("ipas_id", ipas.id)
            expect(error, `${who}: ${error?.message}`).toBeNull()
            expect(data.length, `${who} read no documents`).toBeGreaterThan(0)
        }
        for (const who of ["ordinary", "dealOwner"]) {
            const { data } = await (await clientFor(who)).from("ipas_documents").select("id").eq("ipas_id", ipas.id)
            expect(data, `${who} read documents`).toEqual([])
        }
    })
})

describe("the seeded lists", () => {
    it("marks every document kind: Import, Local or Both, and documentation, filing or both", async () => {
        const rows = await kinds()
        expect(rows.length).toBeGreaterThan(5)
        for (const row of rows) {
            expect(["import", "local", "both"], row.label).toContain(row.applies_to)
            expect(["documentation", "filing", "both"], row.label).toContain(row.used_for)
        }
    })

    it("seeds BIR 2307 as a filing kind and a Waybill and BL for Import, a Quotation for Local", async () => {
        expect(await kindByLabel("BIR 2307")).toMatchObject({ applies_to: "both", used_for: "filing" })
        expect(await kindByLabel("Waybill")).toMatchObject({ applies_to: "import" })
        expect(await kindByLabel("BL or Waybill")).toMatchObject({ applies_to: "import" })
        expect(await kindByLabel("Quotation (Local)")).toMatchObject({ applies_to: "local" })
    })

    it("seeds item locations", async () => {
        const { data } = await svc().from("ipas_options").select("label, applies_to, used_for").eq("list", "item_location")
        expect(data.length).toBeGreaterThan(0)
        for (const row of data) expect(row).toMatchObject({ applies_to: null, used_for: null })
    })

    it("refuses a document kind that isn't marked", async () => {
        const unmarked = await svc().from("ipas_options").insert({ list: "document_kind", label: "Unmarked kind" })
        expect(unmarked.error?.code).toBe("23514")
        const half = await svc().from("ipas_options").insert({ list: "document_kind", label: "Half marked", applies_to: "both" })
        expect(half.error?.code).toBe("23514")
    })
})

describe("documents follow the IPAS's Source", () => {
    it("gives an Import IPAS the Import and Both kinds, and no Local-only ones", async () => {
        const ipas = await raise("import")
        const all = await kinds()
        const expected = all.filter((k) => k.active && ["import", "both"].includes(k.applies_to)).map((k) => k.label).sort()

        expect(await labelsOf(ipas.id)).toEqual(expected)
        expect(expected).toContain("BL or Waybill")
        expect(expected).not.toContain("Quotation (Local)")
    })

    it("gives a Local IPAS the Local and Both kinds, and no Import-only ones", async () => {
        const ipas = await raise("local")
        const all = await kinds()
        const expected = all.filter((k) => k.active && ["local", "both"].includes(k.applies_to)).map((k) => k.label).sort()

        expect(await labelsOf(ipas.id)).toEqual(expected)
        expect(expected).toContain("Quotation (Local)")
        expect(expected).not.toContain("BL or Waybill")
    })

    it("starts every row unticked and without an attachment", async () => {
        const ipas = await raise("import")
        for (const doc of await documentsOf(ipas.id)) {
            expect(doc).toMatchObject({ purchasing_has: false, finance_has: false, attachment_url: null, label: null })
        }
    })

    it("doesn't suggest a deactivated kind, and suggests a kind added later only on request", async () => {
        const waybill = await kindByLabel("Waybill")
        await svc().from("ipas_options").update({ active: false }).eq("id", waybill.id)
        try {
            const ipas = await raise("import")
            expect(await labelsOf(ipas.id)).not.toContain("Waybill")

            await svc().from("ipas_options").update({ active: true }).eq("id", waybill.id)
            expect(await labelsOf(ipas.id), "a kind appeared by itself").not.toContain("Waybill")

            const { data, error } = await rpc("outsider", "ipas_suggest_documents", { p_ipas_id: ipas.id })
            expect(error).toBeNull()
            expect(data.added).toEqual(["Waybill"])
            expect(await labelsOf(ipas.id)).toContain("Waybill")
            expect((await events(ipas.id, "documents_suggested")).at(-1).detail.labels).toEqual(["Waybill"])

            // Again: nothing to add, nothing recorded.
            const again = await rpc("outsider", "ipas_suggest_documents", { p_ipas_id: ipas.id })
            expect(again.data.added).toEqual([])
            expect(await events(ipas.id, "documents_suggested")).toHaveLength(1)
        } finally {
            await svc().from("ipas_options").update({ active: true }).eq("id", waybill.id)
        }
    })

    it("leaves rows already ticked alone when suggesting", async () => {
        const ipas = await raise("import")
        const bl = await docByLabel(ipas.id, "BL or Waybill")
        await tick("outsider", bl.id, "purchasing", true)

        await rpc("outsider", "ipas_suggest_documents", { p_ipas_id: ipas.id })

        expect((await docByLabel(ipas.id, "BL or Waybill")).purchasing_has).toBe(true)
    })

    it("refuses ipas_suggest_documents to anyone but Purchasing", async () => {
        const ipas = await raise("import")
        for (const who of CAST_KEYS.filter((k) => k !== "outsider")) {
            const { error } = await rpc(who, "ipas_suggest_documents", { p_ipas_id: ipas.id })
            expect(error?.code, `${who} suggested documents`).toBe("42501")
        }
    })
})

describe("adding a document by hand", () => {
    it("adds a hand-typed row with its own label", async () => {
        const ipas = await raise("local")
        const { data, error } = await addDocument("outsider", ipas.id, { p_label: "  Warranty card  " })

        expect(error).toBeNull()
        expect(data).toMatchObject({ kind_id: null, label: "Warranty card", purchasing_has: false, finance_has: false })
        expect((await events(ipas.id, "document_added")).at(-1).detail).toMatchObject({ label: "Warranty card", by_hand: true })
    })

    it("adds an Import kind to a Local IPAS: the suggestion is only a start", async () => {
        const ipas = await raise("local")
        const bl = await kindByLabel("BL or Waybill")

        const { data, error } = await addDocument("outsider", ipas.id, { p_kind_id: bl.id })

        expect(error).toBeNull()
        expect(data.kind_id).toBe(bl.id)
        expect(data.label).toBeNull()
    })

    it("takes an attachment on the way in", async () => {
        const ipas = await raise("local")
        const { data, error } = await addDocument("outsider", ipas.id, {
            p_label: "Photo of goods",
            p_attachment_url: "https://res.cloudinary.com/demo/image/upload/goods.jpg",
        })
        expect(error).toBeNull()
        expect(data.attachment_url).toBe("https://res.cloudinary.com/demo/image/upload/goods.jpg")
    })

    it("refuses a kind and a name together, neither, a long name and a bad link", async () => {
        const ipas = await raise("local")
        const bl = await kindByLabel("BL or Waybill")

        expect((await addDocument("outsider", ipas.id, { p_kind_id: bl.id, p_label: "x" })).error?.code).toBe("22023")
        expect((await addDocument("outsider", ipas.id, {})).error?.code).toBe("22023")
        expect((await addDocument("outsider", ipas.id, { p_label: "   " })).error?.code).toBe("22023")
        expect((await addDocument("outsider", ipas.id, { p_label: "x".repeat(201) })).error?.code).toBe("22023")
        expect((await addDocument("outsider", ipas.id, { p_label: "Memo", p_attachment_url: "javascript:alert(1)" })).error?.code).toBe("22023")
    })

    it("refuses a kind or a name that is already on the IPAS", async () => {
        const ipas = await raise("import")
        const bl = await kindByLabel("BL or Waybill")
        expect((await addDocument("outsider", ipas.id, { p_kind_id: bl.id })).error?.code).toBe("23505")

        expect((await addDocument("outsider", ipas.id, { p_label: "Memo" })).error).toBeNull()
        expect((await addDocument("outsider", ipas.id, { p_label: "  memo " })).error?.code).toBe("23505")
    })

    it("refuses an option from another list and a deactivated kind", async () => {
        const ipas = await raise("local")
        const method = await optionByLabel("payment_method", "Cash")
        expect((await addDocument("outsider", ipas.id, { p_kind_id: method.id })).error?.code).toBe("22023")

        const { data: fresh } = await svc()
            .from("ipas_options")
            .insert({ list: "document_kind", label: "Retired kind", applies_to: "import", used_for: "documentation", active: false })
            .select()
            .single()
        created.push(fresh.id)
        const refused = await addDocument("outsider", ipas.id, { p_kind_id: fresh.id })
        expect(refused.error?.code).toBe("22023")
        expect(refused.error?.message).toMatch(/deactivated/)
    })

    it("refuses everyone but Purchasing, Finance included", async () => {
        const ipas = await raise("local")
        for (const who of CAST_KEYS.filter((k) => k !== "outsider")) {
            const { error } = await addDocument(who, ipas.id, { p_label: `By ${who}` })
            expect(error?.code, `${who} added a document`).toBe("42501")
        }
        expect(await labelsOf(ipas.id)).not.toContain("By finance")
    })
})

describe("who ticks", () => {
    it("lets Finance set finance_has, and records who in history", async () => {
        const ipas = await raise("import")
        const waybill = await docByLabel(ipas.id, "Waybill")

        const { data, error } = await tick("finance", waybill.id, "finance", true)

        expect(error).toBeNull()
        expect(data).toMatchObject({ finance_has: true, purchasing_has: false })
        expect((await events(ipas.id, "document_ticked")).at(-1)).toMatchObject({
            actor_id: ids.finance,
            detail: { document_id: waybill.id, label: "Waybill", side: "finance", value: true },
        })
    })

    it("lets Purchasing set purchasing_has, and untick it", async () => {
        const ipas = await raise("import")
        const waybill = await docByLabel(ipas.id, "Waybill")

        const on = await tick("outsider", waybill.id, "purchasing", true)
        expect(on.error).toBeNull()
        expect(on.data).toMatchObject({ purchasing_has: true, finance_has: false })

        const off = await tick("outsider", waybill.id, "purchasing", false)
        expect(off.data.purchasing_has).toBe(false)
        expect((await events(ipas.id, "document_ticked")).map((e) => [e.actor_id, e.detail.side, e.detail.value])).toEqual([
            [ids.outsider, "purchasing", true],
            [ids.outsider, "purchasing", false],
        ])
    })

    it("refuses Finance ticking Purchasing has it, and Purchasing ticking Finance has it for them", async () => {
        const ipas = await raise("import")
        const waybill = await docByLabel(ipas.id, "Waybill")

        const financeOnPurchasing = await tick("finance", waybill.id, "purchasing", true)
        expect(financeOnPurchasing.error?.code).toBe("42501")
        expect(financeOnPurchasing.error?.message).toMatch(/only Purchasing/)

        const purchasingOnFinance = await tick("outsider", waybill.id, "finance", true)
        expect(purchasingOnFinance.error?.code).toBe("42501")
        expect(purchasingOnFinance.error?.message).toMatch(/only Finance/)

        expect(await docByLabel(ipas.id, "Waybill")).toMatchObject({ purchasing_has: false, finance_has: false })
        expect(await events(ipas.id, "document_ticked")).toEqual([])
    })

    it("refuses everyone else, a Super Admin without either flag included", async () => {
        const ipas = await raise("import")
        const waybill = await docByLabel(ipas.id, "Waybill")

        for (const who of CAST_KEYS.filter((k) => !["outsider", "finance"].includes(k))) {
            for (const side of ["purchasing", "finance"]) {
                const { error } = await tick(who, waybill.id, side, true)
                expect(error?.code, `${who} ticked ${side}`).toBe("42501")
            }
        }
        expect(await docByLabel(ipas.id, "Waybill")).toMatchObject({ purchasing_has: false, finance_has: false })
    })

    it("refuses a side that isn't one, and a missing value", async () => {
        const ipas = await raise("import")
        const waybill = await docByLabel(ipas.id, "Waybill")

        expect((await tick("outsider", waybill.id, "warehouse", true)).error?.code).toBe("22023")
        expect((await tick("outsider", waybill.id, "purchasing", null)).error?.code).toBe("22023")
        expect((await tick("outsider", "00000000-0000-0000-0000-000000000000", "purchasing", true)).error?.code).toBe("P0002")
    })

    it("writes nothing when the tick doesn't change", async () => {
        const ipas = await raise("import")
        const waybill = await docByLabel(ipas.id, "Waybill")
        await tick("outsider", waybill.id, "purchasing", true)

        const again = await tick("outsider", waybill.id, "purchasing", true)

        expect(again.error).toBeNull()
        expect(await events(ipas.id, "document_ticked")).toHaveLength(1)
    })

    it("keeps the two ticks independent on one row", async () => {
        const ipas = await raise("import")
        const waybill = await docByLabel(ipas.id, "Waybill")
        await tick("outsider", waybill.id, "purchasing", true)
        await tick("finance", waybill.id, "finance", true)
        await tick("outsider", waybill.id, "purchasing", false)

        expect(await docByLabel(ipas.id, "Waybill")).toMatchObject({ purchasing_has: false, finance_has: true })
    })
})

describe("attachments and removal", () => {
    it("lets Purchasing attach and remove a file, with history, and refuses a bad link", async () => {
        const ipas = await raise("import")
        const doc = await docByLabel(ipas.id, "BIR 2307")
        const url = "https://res.cloudinary.com/demo/raw/upload/2307.pdf"

        const set = await rpc("outsider", "ipas_set_document_attachment", { p_document_id: doc.id, p_attachment_url: url })
        expect(set.error).toBeNull()
        expect(set.data.attachment_url).toBe(url)

        const bad = await rpc("outsider", "ipas_set_document_attachment", { p_document_id: doc.id, p_attachment_url: "ftp://x" })
        expect(bad.error?.code).toBe("22023")

        const cleared = await rpc("outsider", "ipas_set_document_attachment", { p_document_id: doc.id, p_attachment_url: null })
        expect(cleared.data.attachment_url).toBeNull()
        expect((await events(ipas.id, "document_attachment_set", "document_attachment_removed")).map((e) => e.kind)).toEqual([
            "document_attachment_set",
            "document_attachment_removed",
        ])
    })

    it("refuses Finance and everyone else an attachment", async () => {
        const ipas = await raise("import")
        const doc = await docByLabel(ipas.id, "BIR 2307")
        for (const who of CAST_KEYS.filter((k) => k !== "outsider")) {
            const { error } = await rpc(who, "ipas_set_document_attachment", {
                p_document_id: doc.id,
                p_attachment_url: "https://example.com/x.pdf",
            })
            expect(error?.code, `${who} attached a file`).toBe("42501")
        }
        expect((await docByLabel(ipas.id, "BIR 2307")).attachment_url).toBeNull()
    })

    it("lets Purchasing remove a hand-added row, unless Finance has ticked it", async () => {
        const ipas = await raise("import")
        const memo = (await addDocument("outsider", ipas.id, { p_label: "Memo" })).data
        const ticked = (await addDocument("outsider", ipas.id, { p_label: "Cover letter" })).data
        await tick("finance", ticked.id, "finance", true)

        const refused = await rpc("outsider", "ipas_remove_document", { p_document_id: ticked.id })
        expect(refused.error?.code).toBe("55000")
        expect(refused.error?.message).toMatch(/Finance has ticked/)
        expect(await docByLabel(ipas.id, "Cover letter")).toBeTruthy()

        const removed = await rpc("outsider", "ipas_remove_document", { p_document_id: memo.id })
        expect(removed.error).toBeNull()
        expect(await docByLabel(ipas.id, "Memo")).toBeUndefined()
        expect((await events(ipas.id, "document_removed")).at(-1).detail).toMatchObject({ label: "Memo" })

        const financeTries = await rpc("finance", "ipas_remove_document", { p_document_id: ticked.id })
        expect(financeTries.error?.code).toBe("42501")
    })

    it("refuses to remove a suggested row, ticked or not: only a hand-added row can go", async () => {
        const ipas = await raise("import")
        const waybill = await docByLabel(ipas.id, "Waybill")

        const refused = await rpc("outsider", "ipas_remove_document", { p_document_id: waybill.id })
        expect(refused.error?.code).toBe("55000")
        expect(refused.error?.message).toMatch(/only a document added by hand/)
        expect(await docByLabel(ipas.id, "Waybill")).toBeTruthy()
        expect(await events(ipas.id, "document_removed")).toHaveLength(0)

        // A row picked from the list (it has a kind) is the same.
        const kindId = (await svc().from("ipas_options").select("id").eq("list", "document_kind").eq("label", "Quotation (Local)").single()).data.id
        const picked = (await addDocument("outsider", ipas.id, { p_kind_id: kindId })).data
        expect((await rpc("outsider", "ipas_remove_document", { p_document_id: picked.id })).error?.code).toBe("55000")
    })
})

describe("a filed or cancelled IPAS", () => {
    it("refuses every document change on a filed one, Finance's tick included", async () => {
        const ipas = await raise("import")
        const waybill = await docByLabel(ipas.id, "Waybill")
        await setState(ipas.id, "filed")

        expect((await tick("finance", waybill.id, "finance", true)).error?.code).toBe("55000")
        expect((await tick("outsider", waybill.id, "purchasing", true)).error?.code).toBe("55000")
        expect((await addDocument("outsider", ipas.id, { p_label: "Late" })).error?.code).toBe("55000")
        expect((await rpc("outsider", "ipas_remove_document", { p_document_id: waybill.id })).error?.code).toBe("55000")
        expect((await rpc("outsider", "ipas_suggest_documents", { p_ipas_id: ipas.id })).error?.code).toBe("55000")
        expect(await docByLabel(ipas.id, "Waybill")).toMatchObject({ purchasing_has: false, finance_has: false })
    })

    it("refuses the status writes on a filed IPAS", async () => {
        const ipas = await raise("import")
        await setState(ipas.id, "filed")

        expect((await setOrigin("outsider", ipas.id, { shipped_out_on: "2026-10-01" })).error?.code).toBe("55000")
        expect((await setTyped("outsider", ipas.id, "delivered", "2026-10-02")).error?.code).toBe("55000")
        expect((await rpc("outsider", "ipas_stamp_actual_checking", { p_ipas_id: ipas.id })).error?.code).toBe("55000")
        const place = await optionByLabel("item_location", "BM Office")
        expect((await rpc("outsider", "ipas_set_item_location", { p_ipas_id: ipas.id, p_option_id: place.id })).error?.code).toBe("55000")
    })

    it("refuses a cancelled IPAS", async () => {
        const ipas = await raise("import")
        const waybill = await docByLabel(ipas.id, "Waybill")
        await setState(ipas.id, "cancelled")

        expect((await tick("outsider", waybill.id, "purchasing", true)).error?.code).toBe("55000")
        expect((await setTyped("outsider", ipas.id, "delivered", "2026-10-02")).error?.code).toBe("55000")
    })
})

describe("Supplier Origin", () => {
    const DATES = { shipped_out_on: "2026-10-01", onboard_on: "2026-10-03", arrived_in_ph_on: "2026-10-09", arrived_in_whs_on: "2026-10-11" }

    it("takes the four dates on an Import IPAS and records what changed", async () => {
        const ipas = await raise("import")

        const { data, error } = await setOrigin("outsider", ipas.id, DATES)

        expect(error).toBeNull()
        expect(data).toMatchObject(DATES)
        expect((await events(ipas.id, "supplier_origin_changed")).at(-1).detail.fields).toMatchObject({
            shipped_out_on: { from: null, to: "2026-10-01" },
            arrived_in_whs_on: { from: null, to: "2026-10-11" },
        })
    })

    it("changes only the keys given and clears with null or blank", async () => {
        const ipas = await raise("import")
        await setOrigin("outsider", ipas.id, DATES)

        const { data } = await setOrigin("outsider", ipas.id, { onboard_on: null, arrived_in_ph_on: "" })

        expect(data).toMatchObject({ shipped_out_on: "2026-10-01", onboard_on: null, arrived_in_ph_on: null, arrived_in_whs_on: "2026-10-11" })
        const quiet = await setOrigin("outsider", ipas.id, { shipped_out_on: "2026-10-01" })
        expect(quiet.error).toBeNull()
        expect(await events(ipas.id, "supplier_origin_changed")).toHaveLength(2)
    })

    it("refuses any Supplier Origin date on a Local IPAS, and stores nothing", async () => {
        const ipas = await raise("local")

        for (const key of Object.keys(DATES)) {
            const { error } = await setOrigin("outsider", ipas.id, { [key]: DATES[key] })
            expect(error?.code, key).toBe("22023")
            expect(error?.message).toMatch(/Import only/)
        }
        const row = await ipasRow(ipas.id)
        expect(row).toMatchObject({ shipped_out_on: null, onboard_on: null, arrived_in_ph_on: null, arrived_in_whs_on: null })
        expect(await events(ipas.id, "supplier_origin_changed")).toEqual([])
    })

    it("keeps the columns empty on a Local IPAS even against a direct write", async () => {
        const ipas = await raise("local")
        const refused = await sql()
            .query(`update public.ipas set shipped_out_on = '2026-10-01' where id = $1`, [ipas.id])
            .then(() => null, (error) => error)
        expect(refused?.code).toBe("23514")
        expect(refused?.constraint).toBe("ipas_supplier_origin_import_chk")
    })

    it("refuses an unknown key, a half-typed or impossible date, and a non-object", async () => {
        const ipas = await raise("import")
        expect((await setOrigin("outsider", ipas.id, { delivered_on: "2026-10-01" })).error?.code).toBe("22023")
        expect((await setOrigin("outsider", ipas.id, { shipped_out_on: "2026-10-" })).error?.code).toBe("22023")
        expect((await setOrigin("outsider", ipas.id, { shipped_out_on: "2026-02-31" })).error?.code).toBe("22023")
        expect((await setOrigin("outsider", ipas.id, { shipped_out_on: 20261001 })).error?.code).toBe("22023")
        expect((await rpc("outsider", "ipas_set_supplier_origin", { p_ipas_id: ipas.id, p_fields: [] })).error?.code).toBe("22023")
        expect((await ipasRow(ipas.id)).shipped_out_on).toBeNull()
    })

    it("refuses everyone but Purchasing", async () => {
        const ipas = await raise("import")
        for (const who of CAST_KEYS.filter((k) => k !== "outsider")) {
            const { error } = await setOrigin(who, ipas.id, { shipped_out_on: "2026-10-01" })
            expect(error?.code, `${who} typed Supplier Origin`).toBe("42501")
        }
        expect((await ipasRow(ipas.id)).shipped_out_on).toBeNull()
    })
})

describe("the buyer track", () => {
    it("types Import Clearance on an Import IPAS with who and when, and clears it", async () => {
        const ipas = await raise("import")

        const { data, error } = await setTyped("outsider", ipas.id, "import_clearance", "2026-10-05")

        expect(error).toBeNull()
        expect(data).toMatchObject({ import_clearance_on: "2026-10-05", import_clearance_typed_by: ids.outsider })
        expect(data.import_clearance_typed_at).toBeTruthy()
        expect((await events(ipas.id, "status_typed")).at(-1)).toMatchObject({
            actor_id: ids.outsider,
            detail: { status: "import_clearance", from: null, to: "2026-10-05" },
        })

        const cleared = await setTyped("outsider", ipas.id, "import_clearance", null)
        expect(cleared.data).toMatchObject({ import_clearance_on: null, import_clearance_typed_by: null, import_clearance_typed_at: null })
        expect((await events(ipas.id, "status_cleared")).at(-1).detail).toMatchObject({ status: "import_clearance", from: "2026-10-05", to: null })
    })

    it("refuses Import Clearance on a Local IPAS, in the function and in the table", async () => {
        const ipas = await raise("local")

        const { error } = await setTyped("outsider", ipas.id, "import_clearance", "2026-10-05")
        expect(error?.code).toBe("22023")
        expect((await ipasRow(ipas.id)).import_clearance_on).toBeNull()

        const direct = await sql()
            .query(`update public.ipas set import_clearance_on = '2026-10-05' where id = $1`, [ipas.id])
            .then(() => null, (e) => e)
        expect(direct?.constraint).toBe("ipas_import_clearance_import_chk")
    })

    it("types Delivered on either Source", async () => {
        for (const source of ["import", "local"]) {
            const ipas = await raise(source)
            const { data, error } = await setTyped("outsider", ipas.id, "delivered", "2026-10-07")
            expect(error, source).toBeNull()
            expect(data).toMatchObject({ delivered_on: "2026-10-07", delivered_typed_by: ids.outsider })
        }
    })

    it("records nothing when the date doesn't change, and keeps the first typist", async () => {
        const ipas = await raise("import")
        await setTyped("outsider", ipas.id, "delivered", "2026-10-07")

        const again = await setTyped("outsider", ipas.id, "delivered", "2026-10-07")

        expect(again.error).toBeNull()
        expect(await events(ipas.id, "status_typed")).toHaveLength(1)
    })

    it("refuses a status that isn't typed, and everyone but Purchasing", async () => {
        const ipas = await raise("import")
        expect((await setTyped("outsider", ipas.id, "actual_checking", "2026-10-07")).error?.code).toBe("22023")
        expect((await setTyped("outsider", ipas.id, null, "2026-10-07")).error?.code).toBe("22023")
        for (const who of CAST_KEYS.filter((k) => k !== "outsider")) {
            const { error } = await setTyped(who, ipas.id, "delivered", "2026-10-07")
            expect(error?.code, `${who} typed Delivered`).toBe("42501")
        }
        expect((await ipasRow(ipas.id)).delivered_on).toBeNull()
    })

    it("stamps Actual Checking by Purchasing, with who and when, and clears it", async () => {
        const ipas = await raise("local")

        const stamped = await rpc("outsider", "ipas_stamp_actual_checking", { p_ipas_id: ipas.id })
        expect(stamped.error).toBeNull()
        expect(stamped.data.actual_checking_by).toBe(ids.outsider)
        expect(stamped.data.actual_checking_at).toBeTruthy()
        expect((await events(ipas.id, "actual_checking_stamped")).at(-1).actor_id).toBe(ids.outsider)

        // Stamping again changes nothing, and keeps the first time.
        const again = await rpc("outsider", "ipas_stamp_actual_checking", { p_ipas_id: ipas.id })
        expect(again.data.actual_checking_at).toBe(stamped.data.actual_checking_at)
        expect(await events(ipas.id, "actual_checking_stamped")).toHaveLength(1)

        const cleared = await rpc("outsider", "ipas_stamp_actual_checking", { p_ipas_id: ipas.id, p_stamped: false })
        expect(cleared.data).toMatchObject({ actual_checking_by: null, actual_checking_at: null })
        expect((await events(ipas.id, "actual_checking_cleared")).at(-1).detail.was_by).toBe(ids.outsider)
    })

    it("refuses Actual Checking to everyone but Purchasing, and keeps who and when together", async () => {
        const ipas = await raise("local")
        for (const who of CAST_KEYS.filter((k) => k !== "outsider")) {
            const { error } = await rpc(who, "ipas_stamp_actual_checking", { p_ipas_id: ipas.id })
            expect(error?.code, `${who} stamped Actual Checking`).toBe("42501")
        }
        expect((await ipasRow(ipas.id)).actual_checking_by).toBeNull()

        const half = await sql()
            .query(`update public.ipas set actual_checking_by = $2 where id = $1`, [ipas.id, ids.outsider])
            .then(() => null, (e) => e)
        expect(half?.constraint).toBe("ipas_actual_checking_pair_chk")
    })
})

describe("Item Location", () => {
    it("types an Item Location from the list, and clears it", async () => {
        const ipas = await raise("local")
        const place = await optionByLabel("item_location", "BM Office")

        const { data, error } = await rpc("outsider", "ipas_set_item_location", { p_ipas_id: ipas.id, p_option_id: place.id })
        expect(error).toBeNull()
        expect(data.item_location_id).toBe(place.id)
        expect((await events(ipas.id, "item_location_changed")).at(-1).detail).toEqual({ from: null, to: "BM Office" })

        const cleared = await rpc("outsider", "ipas_set_item_location", { p_ipas_id: ipas.id, p_option_id: null })
        expect(cleared.data.item_location_id).toBeNull()
        expect((await events(ipas.id, "item_location_changed")).at(-1).detail).toEqual({ from: "BM Office", to: null })
    })

    it("refuses an option of another list and a deactivated location", async () => {
        const ipas = await raise("local")
        const method = await optionByLabel("payment_method", "Cash")
        expect((await rpc("outsider", "ipas_set_item_location", { p_ipas_id: ipas.id, p_option_id: method.id })).error?.code).toBe("22023")

        const { data: fresh } = await svc().from("ipas_options").insert({ list: "item_location", label: "Retired shelf", active: false }).select().single()
        created.push(fresh.id)
        expect((await rpc("outsider", "ipas_set_item_location", { p_ipas_id: ipas.id, p_option_id: fresh.id })).error?.code).toBe("22023")
    })

    it("refuses everyone but Purchasing", async () => {
        const ipas = await raise("local")
        const place = await optionByLabel("item_location", "BM Office")
        for (const who of CAST_KEYS.filter((k) => k !== "outsider")) {
            const { error } = await rpc(who, "ipas_set_item_location", { p_ipas_id: ipas.id, p_option_id: place.id })
            expect(error?.code, `${who} set the Item Location`).toBe("42501")
        }
        expect((await ipasRow(ipas.id)).item_location_id).toBeNull()
    })
})
