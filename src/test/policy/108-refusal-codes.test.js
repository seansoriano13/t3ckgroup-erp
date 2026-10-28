/**
 * Refusals carry a proper code (#556, spec #544, story 55).
 *
 * Every refusal the IPAS, Transmittal and Costing functions raise carries one of
 *   42501  not allowed        22023  invalid value or wrong state        23505  already exists
 * so none falls through as a generic error (P0001) or a "wrong state" 55000, which
 * PostgREST turns into HTTP 500 and the screen into "the app broke".
 *
 * Two kinds of check:
 *   - the catalog sweep reads every IPAS, Transmittal and Costing function's source
 *     and fails on any `raise exception` without one of the three codes, so a refusal
 *     added later can't slip back to a generic error;
 *   - the named refusals from the run (sign order, send back, removing a document,
 *     cancelling an already cancelled IPAS, changing a filed IPAS) are asked for real.
 *
 * `outsider` holds Purchasing access for the file; `ipasSigner` is put on the section 1
 * lists; `finance` holds Finance access alone; `ordinary` is nobody.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { CAST_KEYS, FIXTURE_DOMAIN, ids, clientFor, ensureCastLoaded } from "./support/cast.js"
import { serviceClient, sql } from "./support/stack.js"
import { purgeFixtureIpas, raiseAsPurchaser, readyToSign } from "./support/ipas.js"

const svc = () => serviceClient()
const rpc = async (who, name, args) => {
    // A sign-off now asks for documents, a Logistics placement and so on (#711, #713); give it what it asks for.
    if (name === "ipas_sign") await readyToSign(args.p_ipas_id, args.p_section, args.p_role)
    return (await clientFor(who)).rpc(name, args)
}
const THE_THREE = ["42501", "22023", "23505"]
// ipas_assert_unchanged (#581) refuses a stale save with 40001 (serialization
// failure) on purpose: the screen keys its "someone else saved" notice on it.
const STALE_SAVE = { ipas_assert_unchanged: "40001" }
const NOBODY = "00000000-0000-0000-0000-000000000000"

// ── the sweep ─────────────────────────────────────────────────────────────

/** The `raise exception ...;` statements of a function body, skipping any ';' inside quotes. */
function refusalsIn(source) {
    const found = []
    const start = /raise\s+exception\b/gi
    let m
    while ((m = start.exec(source))) {
        let quoted = false
        let end = m.index
        for (; end < source.length; end += 1) {
            if (source[end] === "'") quoted = !quoted
            else if (source[end] === ";" && !quoted) break
        }
        const text = source.slice(m.index, end + 1)
        const code = /errcode\s*=\s*'(\w+)'/i.exec(text.replace(/'(?:[^']|'')*'/g, "''")) ?? /errcode\s*=\s*'(\w+)'/i.exec(text)
        found.push({ text: text.replace(/\s+/g, " ").slice(0, 110), code: code?.[1] ?? null })
        start.lastIndex = end
    }
    return found
}

describe("the IPAS, Transmittal and Costing functions", () => {
    it("raise every refusal with 42501, 22023 or 23505, none generic", async () => {
        const { rows } = await sql().query(
            `select p.proname, p.prosrc
               from pg_proc p
               join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public'
                and p.prokind = 'f'
                and (p.proname ~ '^_?(ipas|transmittal|costing)' or p.proname ~ '^_pms_evidence' or p.proname ~ '^_lc_')
              order by p.proname`,
        )
        expect(rows.length).toBeGreaterThan(100)
        const strays = []
        let seen = 0
        for (const { proname, prosrc } of rows) {
            for (const r of refusalsIn(prosrc)) {
                seen += 1
                if (!THE_THREE.includes(r.code) && STALE_SAVE[proname] !== r.code) strays.push(`${proname}: ${r.code ?? "no code"} | ${r.text}`)
            }
        }
        expect(seen).toBeGreaterThan(200)
        expect(strays).toEqual([])
    })
})

// ── the named refusals ────────────────────────────────────────────────────

let poSeq = 0
const copyFor = (po) => ({
    po: { id: 860000 + poSeq, name: po, state: "purchase", company: "T3ck Trading", company_id: 1, currency: "Php", origin: null, partner_ref: null },
    supplier: { id: 9_800_000 + poSeq, name: "Refusal Supplier", contact: null },
    lines: [{ line_id: 870000 + poSeq * 10, product_id: 7600, name: "Item 1", quantity: 2, unit: "Unit", price_unit: 100, price_subtotal: 200, taxes: [], analytic: [], brand: null }],
    receipts: { status: "pending", done: 0, total: 1 },
    bills: { count: 0, draft: 0 },
})
const argsFor = (po) => ({
    p_po_number: po,
    p_priority: "high",
    p_source: "import",
    p_purpose: "inventory",
    p_sor_ids: [],
    p_remarks: null,
    p_odoo_copy: copyFor(po),
})
const nextPo = () => `P9${String(80000 + (poSeq += 1)).padStart(6, "0")}`

async function raise() {
    const { data, error } = await raiseAsPurchaser(argsFor(nextPo()))
    if (error) throw new Error(`raise: ${error.message}`)
    return data
}

const file = (id) => sql().query(`update public.ipas set state = 'filed', filed_at = now() where id = $1`, [id])
const code = (res) => res.error?.code

const CAST_IDS = () => CAST_KEYS.map((k) => ids[k])

beforeAll(async () => {
    await ensureCastLoaded()
    const flag = await svc().from("employees").update({ has_purchasing_flow: true }).eq("id", ids.outsider)
    if (flag.error) throw flag.error
    await svc().from("ipas_signer_lists").delete().in("employee_id", CAST_IDS())
    for (const list_key of ["s1_approved"]) {
        const { error } = await svc().from("ipas_signer_lists").insert({ list_key, employee_id: ids.ipasSigner })
        if (error) throw error
    }
})

afterAll(async () => {
    await svc().from("ipas_signer_lists").delete().in("employee_id", CAST_IDS())
    await svc().from("employees").update({ has_purchasing_flow: false }).eq("id", ids.outsider)
    await purgeFixtureIpas(`%@${FIXTURE_DOMAIN}`)
})

describe("sign order and sending back", () => {
    it("refuse Approved before Prepared, and a send back with nothing signed (22023)", async () => {
        const ipas = await raise()
        const early = await rpc("ipasSigner", "ipas_sign", { p_ipas_id: ipas.id, p_section: 1, p_role: "approved" })
        expect(code(early)).toBe("22023")
        expect(early.error?.message).toMatch(/hasn't been prepared/)

        const back = await rpc("ipasSigner", "ipas_send_back", { p_ipas_id: ipas.id, p_section: 1, p_reason: "Nothing here" })
        expect(code(back)).toBe("22023")
    })

    it("refuse someone who isn't on the list (42501) and an IPAS that doesn't exist (22023)", async () => {
        const ipas = await raise()
        expect(code(await rpc("ordinary", "ipas_sign", { p_ipas_id: ipas.id, p_section: 1, p_role: "prepared" }))).toBe("42501")
        expect(code(await rpc("ipasSigner", "ipas_sign", { p_ipas_id: NOBODY, p_section: 1, p_role: "prepared" }))).toBe("22023")
    })
})

describe("removing a document", () => {
    it("is refused for a document Finance has ticked, and for one that isn't there (22023)", async () => {
        const ipas = await raise()
        const added = await rpc("outsider", "ipas_add_document", { p_ipas_id: ipas.id, p_kind_id: null, p_label: "Cover letter", p_attachment_url: null })
        expect(added.error).toBeNull()
        expect(code(await rpc("finance", "ipas_tick_document", { p_document_id: added.data.id, p_side: "finance", p_value: true }))).toBeUndefined()

        const ticked = await rpc("outsider", "ipas_remove_document", { p_document_id: added.data.id })
        expect(code(ticked)).toBe("22023")
        expect(ticked.error?.message).toMatch(/Finance has ticked/)
        expect(code(await rpc("outsider", "ipas_remove_document", { p_document_id: NOBODY }))).toBe("22023")
    })

    it("a document added twice is refused as a duplicate (23505)", async () => {
        const ipas = await raise()
        const add = () => rpc("outsider", "ipas_add_document", { p_ipas_id: ipas.id, p_kind_id: null, p_label: "Memo", p_attachment_url: null })
        expect((await add()).error).toBeNull()
        expect(code(await add())).toBe("23505")
    })
})

describe("cancelling", () => {
    it("an IPAS that is already cancelled is refused (22023), and a stranger is not allowed (42501)", async () => {
        const ipas = await raise()
        expect(code(await rpc("ordinary", "ipas_cancel", { p_ipas_id: ipas.id, p_reason: "Not mine" }))).toBe("42501")
        expect((await rpc("outsider", "ipas_cancel", { p_ipas_id: ipas.id, p_reason: "Raised in error" })).error).toBeNull()
        const again = await rpc("outsider", "ipas_cancel", { p_ipas_id: ipas.id, p_reason: "Again" })
        expect(code(again)).toBe("22023")
        expect(again.error?.message).toMatch(/already cancelled/)
    })

    it("a second live IPAS for one PO is refused as a duplicate (23505)", async () => {
        const po = nextPo()
        expect((await raiseAsPurchaser(argsFor(po))).error).toBeNull()
        expect(code(await raiseAsPurchaser(argsFor(po)))).toBe("23505")
    })
})

describe("changing a filed IPAS", () => {
    it("is refused with 22023 by the functions and by the freeze, service role included", async () => {
        const ipas = await raise()
        await file(ipas.id)
        expect(code(await rpc("outsider", "ipas_set_header", { p_ipas_id: ipas.id, p_fields: { remarks: "After filing" } }))).toBe("22023")
        expect(code(await rpc("outsider", "ipas_cancel", { p_ipas_id: ipas.id, p_reason: "Too late" }))).toBe("22023")
        expect(code(await rpc("outsider", "ipas_add_document", { p_ipas_id: ipas.id, p_kind_id: null, p_label: "Late", p_attachment_url: null }))).toBe("22023")

        const direct = await svc().from("ipas").update({ purpose: "supplies" }).eq("id", ipas.id)
        expect(code(direct)).toBe("22023")
        const payments = await svc().from("ipas_documents").insert({ ipas_id: ipas.id, label: "Direct" })
        expect(code(payments)).toBe("22023")
    })
})

describe("Transmittals and Costing", () => {
    it("refuse an unknown Transmittal with one of the three codes, and a caller who is not signed in (42501)", async () => {
        expect(code(await rpc("warehouse", "transmittal_submit", { p_transmittal_id: NOBODY }))).toSatisfy((c) => THE_THREE.includes(c))
        expect(code(await rpc("warehouse", "transmittal_cancel", { p_transmittal_id: NOBODY, p_reason: "None" }))).toSatisfy((c) => THE_THREE.includes(c))
        expect(code(await rpc("deleted", "transmittal_submit", { p_transmittal_id: NOBODY }))).toBe("42501")
    })

    it("refuse an unknown Costing Matrix", async () => {
        expect(THE_THREE).toContain(code(await rpc("outsider", "costing_sign", { p_matrix_id: NOBODY, p_role: "evaluation_approved" })))
        expect(THE_THREE).toContain(code(await rpc("outsider", "costing_decide_bid", { p_matrix_id: NOBODY, p_verdict: "go", p_reason: "x" })))
        expect(THE_THREE).toContain(code(await rpc("outsider", "costing_add_cost_row", { p_matrix_id: NOBODY, p_description: "x", p_quantity: 1 })))
    })
})
