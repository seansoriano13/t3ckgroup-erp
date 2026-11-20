/**
 * Several files per IPAS document (#1153, spec #1151 T7), against the real database.
 *
 * ipas_add_document_file / ipas_remove_document_file replace ipas_set_document_attachment: same writer rule
 * (Purchasing access, `outsider` here), same own-file-store link check (#1128), same refusal on a filed IPAS.
 * "Required before" counts a document as present with at least one file.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest"
import { CAST_KEYS, FIXTURE_DOMAIN, ids, clientFor, ensureCastLoaded } from "./support/cast.js"
import { serviceClient, sql } from "./support/stack.js"
import { purgeFixtureIpas, raiseAsPurchaser } from "./support/ipas.js"

const svc = () => serviceClient()
const CAST_IDS = () => CAST_KEYS.map((k) => ids[k])
const rpc = async (who, name, args) => (await clientFor(who)).rpc(name, args)
const BASE = "https://res.cloudinary.com/demo/raw/upload"

let poSeq = 0
const copyFor = (po) => ({
    po: { id: 1153000 + poSeq, name: po, state: "purchase", company: "T3ck Trading", company_id: 1, currency: "Php", origin: null, partner_ref: null },
    supplier: { id: 9_153_000 + poSeq, name: "Document Files Supplier", contact: null },
    lines: [{ line_id: 1153100 + poSeq * 10, product_id: 7700, name: "Item 1", quantity: 2, unit: "Unit", price_unit: 100, price_subtotal: 200, taxes: [], analytic: [], brand: null }],
    receipts: { status: "pending", done: 0, total: 1 },
    bills: { count: 0, draft: 0 },
})

async function raise(source = "local") {
    const po = `P9${String(115300 + (poSeq += 1)).padStart(6, "0")}`
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

const documentOf = async (ipasId, label = "Quotation (Local)") =>
    (
        await sql().query(
            `select d.id from public.ipas_documents d join public.ipas_options o on o.id = d.kind_id
              where d.ipas_id = $1 and o.label = $2`,
            [ipasId, label],
        )
    ).rows[0]
const filesOf = async (documentId) =>
    (await sql().query(`select id, file_name from public.ipas_document_files where document_id = $1 order by created_at, file_name`, [documentId])).rows
const missing = async (ipasId, section) =>
    (await sql().query(`select public._ipas_missing_documents($1, $2) as m`, [ipasId, section])).rows[0].m
const add = (documentId, name) => rpc("outsider", "ipas_add_document_file", { p_document_id: documentId, p_url: `${BASE}/${name}`, p_file_name: name })

beforeAll(async () => {
    await ensureCastLoaded()
    const flag = await svc().from("employees").update({ has_purchasing_flow: true }).eq("id", ids.outsider)
    if (flag.error) throw flag.error
})

afterEach(async () => {
    await sql().query(`update public.ipas_options set required_before = 1 where list = 'document_kind' and label in ('Proforma Invoice', 'Quotation (Local)')`)
})

afterAll(async () => {
    await svc().from("employees").update({ has_purchasing_flow: false }).in("id", CAST_IDS())
    await purgeFixtureIpas(`%@${FIXTURE_DOMAIN}`)
})

describe("files on one document", () => {
    it("takes three files, removes the middle one and keeps the other two", async () => {
        const ipas = await raise()
        const doc = await documentOf(ipas.id)
        for (const name of ["a.pdf", "b.pdf", "c.pdf"]) expect((await add(doc.id, name)).error).toBeNull()
        const three = await filesOf(doc.id)
        expect(three.map((f) => f.file_name)).toEqual(["a.pdf", "b.pdf", "c.pdf"])

        const removed = await rpc("outsider", "ipas_remove_document_file", { p_file_id: three[1].id })
        expect(removed.error).toBeNull()
        expect((await filesOf(doc.id)).map((f) => f.file_name)).toEqual(["a.pdf", "c.pdf"])
    })

    it("refuses a link outside the app's file store, and anyone without Purchasing access", async () => {
        const ipas = await raise()
        const doc = await documentOf(ipas.id)
        const other = await rpc("outsider", "ipas_add_document_file", { p_document_id: doc.id, p_url: "https://example.com/x.pdf", p_file_name: "x.pdf" })
        expect(other.error?.message).toContain("not a link to another site")
        for (const who of CAST_KEYS.filter((k) => k !== "outsider")) {
            const { error } = await rpc(who, "ipas_add_document_file", { p_document_id: doc.id, p_url: `${BASE}/y.pdf`, p_file_name: "y.pdf" })
            expect(error?.code, `${who} added a file`).toBe("42501")
        }
        expect(await filesOf(doc.id)).toEqual([])
    })

    it("refuses add and remove on a filed IPAS", async () => {
        const ipas = await raise()
        const doc = await documentOf(ipas.id)
        const first = await add(doc.id, "keep.pdf")
        expect(first.error).toBeNull()
        await sql().query(`update public.ipas set state = 'filed', filed_at = now() where id = $1`, [ipas.id])

        expect((await add(doc.id, "late.pdf")).error).not.toBeNull()
        expect((await rpc("outsider", "ipas_remove_document_file", { p_file_id: first.data.id })).error).not.toBeNull()
        expect(await filesOf(doc.id)).toHaveLength(1)
    })
})

describe("Required before counts a document with at least one file", () => {
    it("still counts with one of three removed, and waits again when all are removed", async () => {
        const ipas = await raise()
        const doc = await documentOf(ipas.id)
        expect(await missing(ipas.id, 1)).toContain("Quotation (Local)")

        for (const name of ["a.pdf", "b.pdf", "c.pdf"]) await add(doc.id, name)
        expect(await missing(ipas.id, 1)).not.toContain("Quotation (Local)")

        const [first, ...rest] = await filesOf(doc.id)
        await rpc("outsider", "ipas_remove_document_file", { p_file_id: first.id })
        expect(await missing(ipas.id, 1)).not.toContain("Quotation (Local)")

        for (const file of rest) await rpc("outsider", "ipas_remove_document_file", { p_file_id: file.id })
        expect(await missing(ipas.id, 1)).toContain("Quotation (Local)")
    })
})

describe("the move from attachment_url", () => {
    it("a document added with a link starts with that file, and attachment_url stays as it was", async () => {
        const ipas = await raise()
        const added = await rpc("outsider", "ipas_add_document", { p_ipas_id: ipas.id, p_kind_id: null, p_label: "Memo", p_attachment_url: `${BASE}/memo.pdf` })
        expect(added.error).toBeNull()
        expect((await filesOf(added.data.id)).map((f) => f.file_name)).toEqual(["memo.pdf"])
        expect(added.data.attachment_url).toBe(`${BASE}/memo.pdf`)
    })
})
