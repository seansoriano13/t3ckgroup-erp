/**
 * IPAS options used by a filed IPAS keep their name (#241): the database rules.
 *
 * A filed IPAS is frozen but holds its payment method, charge kinds, document
 * kinds, freight service and item location by option id, so renaming an option
 * would rewrite what it says. An `ipas_options` row referenced by ANY filed
 * IPAS refuses a new label (and, for a document kind, a new Source or used-for
 * mark), for Purchasing, Super Admins and the service role alike. Deactivating,
 * reordering and adding stay open, and an option only open IPAS use can still
 * be renamed.
 *
 * `outsider` holds Purchasing access and is the purchaser; `ipasSigner`
 * approves sections 1, 3 and 7; `finance` is Received, `ordinary` Noted and
 * `support` Checked; `superAdmin` is on no list. Real functions throughout; the
 * cleanup removes filed IPAS in replica mode (support/ipas.js).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { CAST_KEYS, FIXTURE_DOMAIN, ids, clientFor, ensureCastLoaded } from "./support/cast.js"
import { serviceClient } from "./support/stack.js"
import { purgeFixtureIpas } from "./support/ipas.js"
import { tryUpdate } from "./support/access.js"

const svc = () => serviceClient()
const rpc = async (who, name, args) => (await clientFor(who)).rpc(name, args)
const CAST_IDS = () => CAST_KEYS.map((k) => ids[k])

const RUN = Date.now().toString(36)
let poSeq = 0
const nextPo = () => `P9${String(80000 + (poSeq += 1)).padStart(6, "0")}`

const copyFor = (po, supplierId) => ({
    po: { id: 850000 + poSeq, name: po, state: "purchase", company: "T3ck Trading", company_id: 1, currency: "Php", origin: null, partner_ref: null },
    supplier: { id: supplierId, name: "Option Guard Supplier", contact: null },
    lines: [
        { line_id: 860000 + poSeq * 10, product_id: 8300, name: "Item 1", quantity: 2, unit: "Unit", price_unit: 100, price_subtotal: 200, taxes: [], analytic: [], brand: null },
    ],
    receipts: { status: "pending", done: 0, total: 1 },
    bills: { count: 0, draft: 0 },
})

const created = []
let supplierSeq = 0
let opt // options used by the filed IPAS
let openOnly // options used by an open IPAS only
let filedIpas
let openIpas

async function makeOption(list, label, over = {}) {
    const marks = list === "document_kind" ? { applies_to: "both", used_for: "documentation" } : {}
    const { data, error } = await svc().from("ipas_options").insert({ list, label: `${label} ${RUN}`, ...marks, ...over }).select().single()
    if (error) throw new Error(`option ${label}: ${error.message}`)
    created.push(data.id)
    return data
}

async function raise() {
    const po = nextPo()
    const { data, error } = await rpc("outsider", "ipas_create", {
        p_po_number: po,
        p_priority: "high",
        p_source: "local",
        p_purpose: "inventory",
        p_sor_ids: [],
        p_remarks: null,
        p_odoo_copy: copyFor(po, 9_600_000 + (supplierSeq += 1)),
    })
    if (error) throw new Error(`ipas_create ${po}: ${error.message}`)
    return data
}

const must = (label, { error }) => {
    if (error) throw new Error(`${label}: ${error.message}`)
}

async function signOk(who, ipasId, section, role) {
    must(`ipas_sign ${who} ${section}/${role}`, await rpc(who, "ipas_sign", { p_ipas_id: ipasId, p_section: section, p_role: role }))
}

async function onList(listKey, who) {
    must(`list ${listKey}`, await svc().from("ipas_signer_lists").insert({ list_key: listKey, employee_id: ids[who] }))
}

/** An IPAS using the given option of every kind, filed. */
async function fileWith(o) {
    const ipas = await raise()
    must("payment", await rpc("outsider", "ipas_add_payment", {
        p_ipas_id: ipas.id, p_kind: "down_payment", p_paid_on: "2026-10-01", p_amount: 500,
        p_php_debited: null, p_charge_fee_php: 0, p_method_id: o.method.id, p_check_no: null, p_proof_url: null,
    }))
    must("charge", await rpc("outsider", "ipas_add_charge", {
        p_ipas_id: ipas.id, p_kind_id: o.charge.id, p_charged_on: "2026-10-02", p_amount_php: 4200,
    }))
    must("bank", await rpc("outsider", "ipas_set_bank_details", {
        p_ipas_id: ipas.id, p_bank_name: "BDO", p_account_name: "Option Guard", p_account_number: "0011-2233",
    }))
    must("freight", await rpc("outsider", "ipas_set_header", { p_ipas_id: ipas.id, p_fields: { freight_service_id: o.freight.id } }))
    must("location", await rpc("outsider", "ipas_set_item_location", { p_ipas_id: ipas.id, p_option_id: o.location.id }))
    must("status", await rpc("outsider", "ipas_set_header", { p_ipas_id: ipas.id, p_fields: { computation_status: "costs_complete" } }))
    for (const section of [1, 3]) {
        await signOk("outsider", ipas.id, section, "prepared")
        await signOk("ipasSigner", ipas.id, section, "approved")
    }
    await signOk("finance", ipas.id, 7, "received")
    await signOk("ordinary", ipas.id, 7, "noted")
    await signOk("support", ipas.id, 7, "checked")
    await signOk("ipasSigner", ipas.id, 7, "approved")
    return ipas
}

const optionRow = async (id) => (await svc().from("ipas_options").select("*").eq("id", id).single()).data
const stateOf = async (id) => (await svc().from("ipas").select("state").eq("id", id).single()).data.state

beforeAll(async () => {
    await ensureCastLoaded()
    must("flag", await svc().from("employees").update({ has_purchasing_flow: true }).eq("id", ids.outsider))
    must("lists clear", await svc().from("ipas_signer_lists").delete().in("employee_id", CAST_IDS()))
    for (const [key, who] of [
        ["s1_approved", "ipasSigner"], ["s3_approved", "ipasSigner"], ["s7_received", "finance"],
        ["s7_noted", "ordinary"], ["s7_checked", "support"], ["s7_approved", "ipasSigner"],
    ]) await onList(key, who)

    // The document kind is suggested to every IPAS raised after it, so only the
    // filed IPAS (which also holds the other four) is what we assert it on.
    opt = {
        method: await makeOption("payment_method", "Guard Method"),
        charge: await makeOption("charge_kind", "Guard Charge"),
        kind: await makeOption("document_kind", "Guard Document"),
        freight: await makeOption("freight_service", "Guard Freight"),
        location: await makeOption("item_location", "Guard Location"),
    }
    openOnly = {
        method: await makeOption("payment_method", "Open Method"),
        charge: await makeOption("charge_kind", "Open Charge"),
        freight: await makeOption("freight_service", "Open Freight"),
        location: await makeOption("item_location", "Open Location"),
    }

    openIpas = await raise()
    must("open payment", await rpc("outsider", "ipas_add_payment", {
        p_ipas_id: openIpas.id, p_kind: "down_payment", p_paid_on: "2026-10-01", p_amount: 100,
        p_php_debited: null, p_charge_fee_php: 0, p_method_id: openOnly.method.id, p_check_no: null, p_proof_url: null,
    }))
    must("open charge", await rpc("outsider", "ipas_add_charge", {
        p_ipas_id: openIpas.id, p_kind_id: openOnly.charge.id, p_charged_on: "2026-10-02", p_amount_php: 100,
    }))
    must("open freight", await rpc("outsider", "ipas_set_header", { p_ipas_id: openIpas.id, p_fields: { freight_service_id: openOnly.freight.id } }))
    must("open location", await rpc("outsider", "ipas_set_item_location", { p_ipas_id: openIpas.id, p_option_id: openOnly.location.id }))

    filedIpas = await fileWith(opt)
    expect(await stateOf(filedIpas.id)).toBe("filed")
    expect(await stateOf(openIpas.id)).toBe("open")
})

afterAll(async () => {
    await svc().from("ipas_signer_lists").delete().in("employee_id", CAST_IDS())
    await svc().from("employees").update({ has_purchasing_flow: false }).in("id", CAST_IDS())
    await purgeFixtureIpas(`%@${FIXTURE_DOMAIN}`)
    if (created.length) await svc().from("ipas_options").delete().in("id", created)
})

describe("an option a filed IPAS uses", () => {
    const KINDS = ["method", "charge", "kind", "freight", "location"]

    for (const who of ["outsider", "superAdmin"]) {
        for (const name of KINDS) {
            it(`can't be renamed by ${who}: ${name}`, async () => {
                const row = opt[name]
                const client = await clientFor(who)
                const result = await client.from("ipas_options").update({ label: `Renamed ${row.label}` }).eq("id", row.id).select("id")

                expect(result.error?.code).toBe("55000")
                expect(result.error?.message).toMatch(/used on a filed IPAS/)
                expect((await optionRow(row.id)).label).toBe(row.label)
            })
        }
    }

    it("can't be renamed by the service role either: the rule holds for every client", async () => {
        const { error } = await svc().from("ipas_options").update({ label: `Sneaky ${RUN}` }).eq("id", opt.method.id)

        expect(error?.code).toBe("55000")
        expect((await optionRow(opt.method.id)).label).toBe(opt.method.label)
    })

    it("keeps a document kind's Source and used-for marks", async () => {
        for (const patch of [{ applies_to: "import" }, { used_for: "filing" }, { applies_to: "local", used_for: "both" }]) {
            for (const who of ["outsider", "superAdmin"]) {
                const result = await tryUpdate(await clientFor(who), "ipas_options", opt.kind.id, patch)
                expect(result.code, `${who} ${JSON.stringify(patch)}`).toBe("55000")
            }
        }
        expect(await optionRow(opt.kind.id)).toMatchObject({ applies_to: "both", used_for: "documentation" })
    })

    it("can still be deactivated, reordered and reactivated, and its name is unchanged by those", async () => {
        for (const who of ["outsider", "superAdmin"]) {
            const client = await clientFor(who)
            for (const name of KINDS) {
                const row = opt[name]
                const off = await tryUpdate(client, "ipas_options", row.id, { active: false })
                expect(off, `${who} deactivate ${name}`).toMatchObject({ ok: true, affected: 1 })
                const sort = await tryUpdate(client, "ipas_options", row.id, { sort: 990 })
                expect(sort, `${who} sort ${name}`).toMatchObject({ ok: true, affected: 1 })
                const on = await tryUpdate(client, "ipas_options", row.id, { active: true, sort: 0 })
                expect(on, `${who} reactivate ${name}`).toMatchObject({ ok: true, affected: 1 })
                expect((await optionRow(row.id)).label).toBe(row.label)
            }
        }
    })

    it("lets a new option be added, and a label set to the value it already has pass", async () => {
        const added = await (await clientFor("outsider")).from("ipas_options").insert({ list: "payment_method", label: `Added ${RUN}` }).select().single()
        expect(added.error).toBeNull()
        created.push(added.data.id)

        const same = await tryUpdate(await clientFor("outsider"), "ipas_options", opt.method.id, { label: opt.method.label })
        expect(same).toMatchObject({ ok: true, affected: 1 })
    })
})

describe("an option only open IPAS use", () => {
    it("can still be renamed, by Purchasing and Super Admins", async () => {
        for (const [name, who] of [["method", "outsider"], ["charge", "superAdmin"], ["freight", "outsider"], ["location", "superAdmin"]]) {
            const row = openOnly[name]
            const result = await tryUpdate(await clientFor(who), "ipas_options", row.id, { label: `${row.label} renamed` })
            expect(result, `${who} ${name}`).toMatchObject({ ok: true, affected: 1 })
            expect((await optionRow(row.id)).label).toBe(`${row.label} renamed`)
        }
    })

    it("is refused once the IPAS using it is filed", async () => {
        const o = {
            method: await makeOption("payment_method", "Late Method"),
            charge: await makeOption("charge_kind", "Late Charge"),
            freight: await makeOption("freight_service", "Late Freight"),
            location: await makeOption("item_location", "Late Location"),
        }
        const ipas = await fileWith(o)
        expect(await stateOf(ipas.id)).toBe("filed")
        for (const row of Object.values(o)) {
            const result = await tryUpdate(await clientFor("outsider"), "ipas_options", row.id, { label: `${row.label} x` })
            expect(result.code).toBe("55000")
        }
    })
})

describe("ipas_filed_option_ids", () => {
    it("names the options a filed IPAS uses, for anyone who reads IPAS, and not the open-only ones", async () => {
        for (const who of ["outsider", "superAdmin", "finance"]) {
            const { data, error } = await rpc(who, "ipas_filed_option_ids")
            expect(error, who).toBeNull()
            for (const row of Object.values(opt)) expect(data, `${who} ${row.label}`).toContain(row.id)
            for (const row of Object.values(openOnly)) expect(data, `${who} ${row.label}`).not.toContain(row.id)
        }
    })

    it("answers nothing to someone who can't read IPAS", async () => {
        const { data, error } = await rpc("dealOwner", "ipas_filed_option_ids")

        expect(error).toBeNull()
        expect(data).toEqual([])
    })

    it("keeps the helper behind it out of the API", async () => {
        const { error } = await rpc("outsider", "ipas_option_on_filed", { p_option_id: opt.method.id })

        expect(error).not.toBeNull()
    })
})
