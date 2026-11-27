/**
 * The papers of a Compliance Requirement kind (#1287, spec #1284), against the real database.
 *
 * `outsider` holds Purchasing access and raises; `ipasSigner` is given Logistics access for the file;
 * `superAdmin` is a Super Admin with neither flag; `finance` and `ordinary` are nobody to this feature.
 *
 * ipas_add_compliance_file / ipas_remove_compliance_file: same rights as ipas_set_compliance, same own-file-store
 * link check as the document files (#1153), refused on a filed or cancelled IPAS, one ipas_events row each.
 * Marking done stays apart from attaching. The SOR summary carries no file. "Compliance (Local)" is retired.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { CAST_KEYS, FIXTURE_DOMAIN, ids, clientFor, ensureCastLoaded } from "./support/cast.js"
import { serviceClient, sql } from "./support/stack.js"
import { purgeFixtureIpas, raiseAsPurchaser } from "./support/ipas.js"

const svc = () => serviceClient()
const rpc = async (who, name, args) => (await clientFor(who)).rpc(name, args)
const BASE = "https://res.cloudinary.com/demo/raw/upload"

let poSeq = 0

const copyFor = (po) => ({
    po: { id: 1287000 + poSeq, name: po, state: "purchase", company: "T3ck Trading", company_id: 1, currency: "Php", origin: null, partner_ref: null },
    supplier: { id: 9_287_000 + poSeq, name: "Compliance Files Supplier", contact: null },
    lines: [{ line_id: 1287500 + poSeq * 10, product_id: 7730, name: "Item 1", quantity: 10, unit: "Unit", price_unit: 100, price_subtotal: 1000, taxes: [], analytic: [], brand: null }],
    receipts: { status: "pending", done: 0, total: 1 },
    bills: { count: 0, draft: 0 },
})

async function raise(source = "local") {
    const po = `P9${String(128700 + (poSeq += 1)).padStart(6, "0")}`
    const { data, error } = await raiseAsPurchaser({
        p_po_number: po,
        p_priority: "high",
        p_source: source,
        p_purpose: "inventory",
        p_sor_ids: [],
        p_remarks: null,
        p_odoo_copy: copyFor(po),
    })
    if (error) throw new Error(`raise ${po}: ${error.message}`)
    return data
}

const kindId = async (label) => (await svc().from("ipas_options").select("id").eq("list", "compliance_kind").eq("label", label).single()).data.id

/** An IPAS that asks, answered Yes with the given kinds. Returns { ipas, req: { [label]: requirementId } }. */
async function asking(labels = ["FDA", "NTC"]) {
    const ipas = await raise()
    const picked = await Promise.all(labels.map(kindId))
    const set = await rpc("outsider", "ipas_set_compliance", { p_ipas_id: ipas.id, p_needed: true, p_kind_ids: picked })
    if (set.error) throw new Error(`ipas_set_compliance: ${set.error.message}`)
    const rows = (await svc().from("ipas_compliance_requirements").select("id, kind:ipas_options!ipas_compliance_requirements_kind_id_fkey(label)").eq("ipas_id", ipas.id)).data
    return { ipas, req: Object.fromEntries(rows.map((r) => [r.kind.label, r.id])) }
}

const add = (who, requirementId, name) => rpc(who, "ipas_add_compliance_file", { p_requirement_id: requirementId, p_url: `${BASE}/${name}`, p_file_name: name })
const filesOf = async (requirementId) =>
    (await sql().query(`select id, file_name from public.ipas_compliance_requirement_files where requirement_id = $1 order by created_at, file_name`, [requirementId])).rows
const fileEvents = async (ipasId) =>
    (await svc().from("ipas_events").select("*").eq("ipas_id", ipasId).like("kind", "compliance_file_%").order("created_at", { ascending: true })).data

beforeAll(async () => {
    await ensureCastLoaded()
    const flag = await svc().from("employees").update({ has_purchasing_flow: true }).eq("id", ids.outsider)
    if (flag.error) throw flag.error
    const logistics = await svc().from("employees").update({ has_logistics_flow: true }).eq("id", ids.ipasSigner)
    if (logistics.error) throw logistics.error
})

afterAll(async () => {
    await svc().from("employees").update({ has_logistics_flow: false }).eq("id", ids.ipasSigner)
    await purgeFixtureIpas(`%@${FIXTURE_DOMAIN}`)
    await svc().from("employees").update({ has_purchasing_flow: false }).eq("id", ids.outsider)
    await sql().query(`delete from public.purchase_request_members where employee_id = $1`, [ids.outsider])
})

describe("files on one kind", () => {
    it("takes two files on FDA, removes one and keeps the other; NTC stays empty", async () => {
        const { req } = await asking()
        expect((await add("outsider", req.FDA, "permit.pdf")).error).toBeNull()
        expect((await add("outsider", req.FDA, "receipt.pdf")).error).toBeNull()
        const two = await filesOf(req.FDA)
        expect(two.map((f) => f.file_name)).toEqual(["permit.pdf", "receipt.pdf"])

        const removed = await rpc("outsider", "ipas_remove_compliance_file", { p_file_id: two[0].id })
        expect(removed.error).toBeNull()
        expect((await filesOf(req.FDA)).map((f) => f.file_name)).toEqual(["receipt.pdf"])
        expect(await filesOf(req.NTC)).toEqual([])
    })

    it("lets Purchasing, Logistics and a Super Admin attach and remove", async () => {
        const { req } = await asking(["FDA"])
        for (const who of ["outsider", "ipasSigner", "superAdmin"]) {
            const added = await add(who, req.FDA, `${who}.pdf`)
            expect(added.error, `${who} attached`).toBeNull()
            expect((await rpc(who, "ipas_remove_compliance_file", { p_file_id: added.data.id })).error, `${who} removed`).toBeNull()
        }
        expect(await filesOf(req.FDA)).toEqual([])
    })

    it("refuses Finance and everyone else, in the database", async () => {
        const { req } = await asking(["FDA"])
        const mine = await add("outsider", req.FDA, "mine.pdf")
        for (const who of CAST_KEYS.filter((k) => !["outsider", "ipasSigner", "superAdmin"].includes(k))) {
            const added = await add(who, req.FDA, `${who}.pdf`)
            expect(added.error?.code, `${who} attached`).toBe("42501")
            const removed = await rpc(who, "ipas_remove_compliance_file", { p_file_id: mine.data.id })
            expect(removed.error?.code, `${who} removed`).toBe("42501")
        }
        expect((await filesOf(req.FDA)).map((f) => f.file_name)).toEqual(["mine.pdf"])
    })

    it("refuses a link outside the app's file store", async () => {
        const { req } = await asking(["FDA"])
        const other = await rpc("outsider", "ipas_add_compliance_file", { p_requirement_id: req.FDA, p_url: "https://example.com/x.pdf", p_file_name: "x.pdf" })
        expect(other.error?.message).toContain("not a link to another site")
        expect(await filesOf(req.FDA)).toEqual([])
    })

    it("refuses add and remove on a filed IPAS, and on a cancelled one", async () => {
        for (const state of ["filed", "cancelled"]) {
            const { ipas, req } = await asking(["FDA"])
            const first = await add("outsider", req.FDA, "keep.pdf")
            expect(first.error).toBeNull()
            if (state === "filed") await sql().query(`update public.ipas set state = 'filed', filed_at = now() where id = $1`, [ipas.id])
            else await sql().query(`update public.ipas set state = 'cancelled', cancelled_at = now(), cancelled_by = $2, cancel_reason = 'test' where id = $1`, [ipas.id, ids.outsider])
            expect((await add("outsider", req.FDA, "late.pdf")).error, `${state} add`).not.toBeNull()
            expect((await rpc("outsider", "ipas_remove_compliance_file", { p_file_id: first.data.id })).error, `${state} remove`).not.toBeNull()
            expect(await filesOf(req.FDA)).toHaveLength(1)
        }
    })

    it("refuses an IPAS that does not ask", async () => {
        const { ipas, req } = await asking(["FDA"])
        await sql().query(`update public.ipas set compliance_asked = false where id = $1`, [ipas.id])
        expect((await add("outsider", req.FDA, "x.pdf")).error).not.toBeNull()
    })

    it("lets a kind be done with no file, and attaching does not mark it done", async () => {
        const { req } = await asking(["FDA", "NTC"])
        expect((await rpc("outsider", "ipas_tick_compliance", { p_requirement_id: req.NTC })).error).toBeNull()
        expect((await add("outsider", req.FDA, "form.pdf")).error).toBeNull()
        const rows = (await svc().from("ipas_compliance_requirements").select("id, done_on").in("id", [req.FDA, req.NTC])).data
        const by = Object.fromEntries(rows.map((r) => [r.id, r.done_on]))
        expect(by[req.NTC]).not.toBeNull()
        expect(by[req.FDA]).toBeNull()
    })
})

describe("the history", () => {
    it("writes one row for each attach and each remove", async () => {
        const { ipas, req } = await asking(["FDA"])
        const added = await add("outsider", req.FDA, "permit.pdf")
        await rpc("outsider", "ipas_remove_compliance_file", { p_file_id: added.data.id })
        const events = await fileEvents(ipas.id)
        expect(events.map((e) => e.kind)).toEqual(["compliance_file_added", "compliance_file_removed"])
        expect(events[0].actor_id).toBe(ids.outsider)
        expect(events[0].detail).toMatchObject({ kind: "FDA", file_name: "permit.pdf", requirement_id: req.FDA })
    })
})

describe("the files go with their kind", () => {
    it("unpicking a kind takes its files; answering No takes all", async () => {
        const { ipas, req } = await asking(["FDA", "NTC"])
        await add("outsider", req.FDA, "a.pdf")
        await add("outsider", req.NTC, "b.pdf")

        const keepNtc = await rpc("outsider", "ipas_set_compliance", { p_ipas_id: ipas.id, p_needed: true, p_kind_ids: [await kindId("NTC")] })
        expect(keepNtc.error).toBeNull()
        expect(await filesOf(req.FDA)).toEqual([])
        expect(await filesOf(req.NTC)).toHaveLength(1)

        const no = await rpc("outsider", "ipas_set_compliance", { p_ipas_id: ipas.id, p_needed: false, p_kind_ids: [] })
        expect(no.error).toBeNull()
        expect(await filesOf(req.NTC)).toEqual([])
    })
})

describe("who reads the files", () => {
    it("reads them as the IPAS is read, and the SOR summary carries none", async () => {
        const { ipas, req } = await asking(["FDA"])
        await add("outsider", req.FDA, "permit.pdf")
        const read = await (await clientFor("outsider")).from("ipas_compliance_requirements").select("id, files:ipas_compliance_requirement_files(file_name)").eq("ipas_id", ipas.id)
        expect(read.error).toBeNull()
        expect(read.data[0].files.map((f) => f.file_name)).toEqual(["permit.pdf"])

        // The SOR summary reads the kinds and their done days only: its definition never touches the files.
        const def = (await sql().query(`select pg_get_functiondef('public.ipas_summaries_for_sor(uuid)'::regprocedure) as def`)).rows[0].def
        expect(def).not.toContain("ipas_compliance_requirement_files")
    })

    it("cannot be written to directly, only through the functions", async () => {
        const { req } = await asking(["FDA"])
        const direct = await (await clientFor("outsider")).from("ipas_compliance_requirement_files").insert({ requirement_id: req.FDA, url: `${BASE}/z.pdf`, file_name: "z.pdf" })
        expect(direct.error).not.toBeNull()
        expect(await filesOf(req.FDA)).toEqual([])
    })
})

describe("Compliance (Local)", () => {
    afterAll(async () => {
        // Back to what the migration left.
        await sql().query(`update public.ipas_options set active = false where list = 'document_kind' and label = 'Compliance (Local)'`)
    })

    it("is retired: a new IPAS does not get it, and an old one keeps its document and files", async () => {
        const kind = (await svc().from("ipas_options").select("id, active").eq("list", "document_kind").eq("label", "Compliance (Local)").single()).data
        expect(kind.active).toBe(false)

        // An old IPAS: raised while the kind was active, with a file on it.
        await sql().query(`update public.ipas_options set active = true where id = $1`, [kind.id])
        const old = await raise("local")
        const doc = (await sql().query(`select id from public.ipas_documents where ipas_id = $1 and kind_id = $2`, [old.id, kind.id])).rows[0]
        expect(doc).toBeTruthy()
        const file = await rpc("outsider", "ipas_add_document_file", { p_document_id: doc.id, p_url: `${BASE}/old.pdf`, p_file_name: "old.pdf" })
        expect(file.error).toBeNull()

        // The migration's retirement, run again: new IPAS stop getting it.
        await sql().query(`update public.ipas_options set active = false where id = $1`, [kind.id])
        const fresh = await raise("local")
        expect((await sql().query(`select 1 from public.ipas_documents where ipas_id = $1 and kind_id = $2`, [fresh.id, kind.id])).rows).toHaveLength(0)

        // The old IPAS still has its document and its file.
        expect((await sql().query(`select 1 from public.ipas_documents where id = $1`, [doc.id])).rows).toHaveLength(1)
        expect((await sql().query(`select file_name from public.ipas_document_files where document_id = $1`, [doc.id])).rows.map((r) => r.file_name)).toEqual(["old.pdf"])
    })
})
