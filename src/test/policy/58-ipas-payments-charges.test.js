/**
 * IPAS payments, charges and the option lists (#244, spec #241): the database
 * rules.
 *
 * `outsider` holds Purchasing access for the file and is the purchaser;
 * `finance` holds Finance access alone; `ipasSigner` is a plain employee put on
 * the `s1_approved` sign-off list (a signer-list-only member); `superAdmin` is a
 * Super Admin with neither flag; `ordinary` and `dealOwner` are nobody to the
 * IPAS.
 *
 * Everything runs through the real `ipas_create`, `ipas_add_payment`,
 * `ipas_update_payment`, `ipas_remove_payment`, `ipas_add_charge`,
 * `ipas_update_charge`, `ipas_remove_charge` and `ipas_set_header`. Landed Cost
 * is worked out by the database (`_ipas_landed_cost`, #283); its maths is held
 * to the fake's in 96-ipas-landed-cost-parity.test.js.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { CAST_KEYS, FIXTURE_DOMAIN, ids, clientFor, anonymousClient, ensureCastLoaded } from "./support/cast.js"
import { serviceClient, sql, rlsStatus } from "./support/stack.js"
import { purgeFixtureIpas, raiseAsPurchaser } from "./support/ipas.js"
import { canRead, tryInsert, tryUpdate, tryDelete, RLS_VIOLATION } from "./support/access.js"

const svc = () => serviceClient()

let poSeq = 0
/** A PO number nothing else in the tier uses. */
const nextPo = () => `P9${String(60000 + (poSeq += 1)).padStart(6, "0")}`

const copyFor = (po, currency) => ({
    po: { id: 660000 + poSeq, name: po, state: "purchase", company: "T3ck Trading", company_id: 1, currency, origin: null, partner_ref: null },
    supplier: { id: 553, name: "Scorpe Technologies", contact: null },
    lines: [
        { line_id: 700001 + poSeq * 10, product_id: 5350, name: "Cutter", quantity: 6, unit: "Unit", price_unit: 1250, price_subtotal: 7500, taxes: [], analytic: [], brand: null },
    ],
    receipts: { status: "pending", done: 0, total: 1 },
    bills: { count: 0, draft: 0 },
})

const rpc = async (who, name, args) => (await clientFor(who)).rpc(name, args)

/** Raises an IPAS as the purchaser (pesos unless `currency` says otherwise). */
async function raise(currency = "Php") {
    const po = nextPo()
    const { data, error } = await raiseAsPurchaser({
        p_po_number: po,
        p_priority: "high",
        p_source: "local",
        p_purpose: "inventory",
        p_sor_ids: [],
        p_remarks: null,
        p_odoo_copy: copyFor(po, currency),
    })
    if (error) throw new Error(`ipas_create ${po}: ${error.message}`)
    return data
}

let methodIds = {}
let kindIds = {}
let freightIds = {}
let testOptionIds = []

async function optionId(list, label) {
    const { data, error } = await svc().from("ipas_options").select("id").eq("list", list).eq("label", label).maybeSingle()
    if (error) throw error
    if (!data) throw new Error(`Option ${list}/${label} isn't seeded`)
    return data.id
}

const payment = (ipasId, over = {}) => ({
    p_ipas_id: ipasId,
    p_kind: "down_payment",
    p_paid_on: "2026-10-01",
    p_amount: 500,
    p_php_debited: null,
    p_charge_fee_php: 0,
    p_method_id: methodIds.check,
    p_check_no: null,
    p_proof_url: null,
    ...over,
})

const addPayment = (who, ipasId, over) => rpc(who, "ipas_add_payment", payment(ipasId, over))

async function paymentRow(id) {
    const { data, error } = await svc().from("ipas_payments").select("*").eq("id", id).maybeSingle()
    if (error) throw error
    return data
}

async function events(ipasId, ...kinds) {
    let query = svc().from("ipas_events").select("*").eq("ipas_id", ipasId).order("created_at")
    if (kinds.length) query = query.in("kind", kinds)
    const { data, error } = await query
    if (error) throw error
    return data
}

const file = (id) => sql().query(`update public.ipas set state = 'filed', filed_at = now() where id = $1`, [id])

beforeAll(async () => {
    await ensureCastLoaded()
    const flag = await svc().from("employees").update({ has_purchasing_flow: true }).eq("id", ids.outsider)
    if (flag.error) throw flag.error
    const member = await svc().from("ipas_signer_lists").insert({ list_key: "s1_approved", employee_id: ids.ipasSigner })
    if (member.error) throw member.error

    methodIds = {
        check: await optionId("payment_method", "Dated Check"),
        alipay: await optionId("payment_method", "Alipay"),
        other: await optionId("payment_method", "Others"),
    }
    kindIds = {
        brokerage: await optionId("charge_kind", "Brokerage Fee"),
        duties: await optionId("charge_kind", "Duties & Taxes"),
    }
    freightIds = { dhl: await optionId("freight_service", "DHL"), fedex: await optionId("freight_service", "FedEx") }
})

afterAll(async () => {
    await svc().from("employees").update({ has_purchasing_flow: false }).eq("id", ids.outsider)
    await svc().from("ipas_signer_lists").delete().eq("employee_id", ids.ipasSigner)
    await purgeFixtureIpas(`%@${FIXTURE_DOMAIN}`)
    // Options can't be deleted through the API; the service role cleans up the ones this file added.
    if (testOptionIds.length) await svc().from("ipas_options").delete().in("id", testOptionIds)
    await svc().from("ipas_options").update({ active: true }).in("id", [methodIds.alipay, freightIds.fedex].filter(Boolean))
})

describe("the new tables are protected", () => {
    it.each([["ipas_options"], ["ipas_payments"], ["ipas_charges"]])(
        "has row level security on and a policy: %s",
        async (table) => {
            const { enabled, policies } = await rlsStatus(table)
            expect(enabled, `${table} has RLS switched off`).toBe(true)
            expect(policies, `${table} has no policy`).toBeGreaterThan(0)
        },
    )
})

describe("the option lists", () => {
    it("start from the sheet's values: the payment methods run Alipay to Others, and there are seven charge kinds", async () => {
        const { data } = await svc().from("ipas_options").select("list, label, sort, active").order("sort")
        const labels = (list) => data.filter((o) => o.list === list && o.active).map((o) => o.label)

        const methods = labels("payment_method")
        expect(methods[0]).toBe("Alipay")
        expect(methods.at(-1)).toBe("Others")
        expect(methods).toContain("Dated Check")
        expect(labels("charge_kind")).toHaveLength(7)
        expect(labels("freight_service").length).toBeGreaterThan(0)
    })

    it("are read by everyone who reads IPAS and nobody else", async () => {
        for (const who of ["outsider", "finance", "ipasSigner", "superAdmin"]) {
            const { data, error } = await (await clientFor(who)).from("ipas_options").select("id").limit(1)
            expect(error).toBeNull()
            expect(data.length, `${who} read no options`).toBe(1)
        }
        for (const who of CAST_KEYS.filter((k) => !["outsider", "finance", "ipasSigner", "superAdmin"].includes(k))) {
            const { data } = await (await clientFor(who)).from("ipas_options").select("id").limit(1)
            expect(data ?? [], `${who} read the option lists`).toEqual([])
        }
    })

    it("are writable by Purchasing access and Super Admins, and by nobody else", async () => {
        const stamp = Date.now()
        const labelFor = (who) => `Test ${who} ${stamp}`

        for (const who of ["outsider", "superAdmin"]) {
            const outcome = await tryInsert(await clientFor(who), "ipas_options", { list: "payment_method", label: labelFor(who), sort: 900 })
            expect(outcome.ok, `${who} was refused: ${outcome.message}`).toBe(true)
            testOptionIds.push(outcome.id)
        }

        const refused = CAST_KEYS.filter((k) => !["outsider", "superAdmin"].includes(k))
        for (const who of refused) {
            const outcome = await tryInsert(await clientFor(who), "ipas_options", { list: "payment_method", label: labelFor(who), sort: 900 })
            expect(outcome.ok, `${who} added an option`).toBe(false)
            expect(outcome.code).toBe(RLS_VIOLATION)
        }
    })

    it("can be renamed, reordered and deactivated by Purchasing and Super Admins; Finance and signers change nothing", async () => {
        const added = await svc().from("ipas_options").insert({ list: "charge_kind", label: `Edit me ${Date.now()}`, sort: 910 }).select("id").single()
        testOptionIds.push(added.data.id)
        const id = added.data.id

        for (const who of ["outsider", "superAdmin"]) {
            const outcome = await tryUpdate(await clientFor(who), "ipas_options", id, { sort: 920, active: false })
            expect(outcome.affected, `${who} changed the option`).toBe(1)
            await svc().from("ipas_options").update({ sort: 910, active: true }).eq("id", id)
        }
        for (const who of ["finance", "ipasSigner", "ordinary", "dealOwner"]) {
            const outcome = await tryUpdate(await clientFor(who), "ipas_options", id, { active: false })
            expect(outcome.affected, `${who} changed the option`).toBe(0)
        }
        const { data } = await svc().from("ipas_options").select("active, sort").eq("id", id).single()
        expect(data).toEqual({ active: true, sort: 910 })
    })

    it("are never deleted through the API, by anyone", async () => {
        for (const who of CAST_KEYS) {
            const outcome = await tryDelete(await clientFor(who), "ipas_options", methodIds.other)
            expect(outcome.affected, `${who} deleted an option`).toBe(0)
        }
        expect(await svc().from("ipas_options").select("id").eq("id", methodIds.other).maybeSingle().then((r) => r.data)).toBeTruthy()
    })

    it("never move an option to another list, and keep a label once per list", async () => {
        const moved = await svc().from("ipas_options").update({ list: "charge_kind" }).eq("id", methodIds.other)
        expect(moved.error?.code).toBe("42501")

        const dupe = await svc().from("ipas_options").insert({ list: "payment_method", label: "  alipay " })
        expect(dupe.error?.code).toBe("23505")
    })
})

describe("recording payments", () => {
    it("is open to Purchasing and Finance, in pesos or in a foreign currency", async () => {
        for (const who of ["outsider", "finance"]) {
            const php = await raise("Php")
            const peso = await addPayment(who, php.id, { p_check_no: "  CHK-0042 " })
            expect(peso.error, `${who} refused a peso payment`).toBeNull()
            expect(peso.data).toMatchObject({
                ipas_id: php.id,
                kind: "down_payment",
                paid_on: "2026-10-01",
                created_by: ids[who],
                check_no: "CHK-0042",
                php_debited: null,
                // Nothing approves section 1 here, so the insert trigger (#247) flags it.
                paid_before_approval: true,
            })
            expect(Number(peso.data.amount)).toBe(500)

            const usd = await raise("USD")
            const foreign = await addPayment(who, usd.id, { p_amount: 640, p_php_debited: 36160, p_charge_fee_php: 350 })
            expect(foreign.error, `${who} refused a USD payment`).toBeNull()
            expect(Number(foreign.data.php_debited)).toBe(36160)
            expect(Number(foreign.data.charge_fee_php)).toBe(350)
        }
    })

    it("is refused to a plain employee, a signer-list-only member and a Super Admin with neither flag", async () => {
        const ipas = await raise()
        for (const who of CAST_KEYS.filter((k) => !["outsider", "finance"].includes(k))) {
            const { error } = await addPayment(who, ipas.id)
            expect(error?.code, `${who} recorded a payment`).toBe("42501")
        }
        const { data } = await svc().from("ipas_payments").select("id").eq("ipas_id", ipas.id)
        expect(data).toEqual([])
    })

    it("can't be written to the table directly, by anyone", async () => {
        const ipas = await raise()
        const { data: row } = await addPayment("outsider", ipas.id)
        for (const who of ["outsider", "finance", "superAdmin", "ipasSigner"]) {
            const client = await clientFor(who)
            const inserted = await tryInsert(client, "ipas_payments", {
                ipas_id: ipas.id,
                kind: "payment",
                paid_on: "2026-10-02",
                amount: 1,
                method_id: methodIds.check,
            })
            expect(inserted.ok, `${who} inserted a payment`).toBe(false)
            expect((await tryUpdate(client, "ipas_payments", row.id, { amount: 1 })).affected).toBe(0)
            expect((await tryDelete(client, "ipas_payments", row.id)).affected).toBe(0)
        }
        expect(Number((await paymentRow(row.id)).amount)).toBe(500)
    })

    // #604: "Pesos taken from the bank" is optional; a figure that is given still has to be above zero.
    // The blank-save and LC Odoo Done rules are 116-ipas-pesos-taken-from-the-bank.
    it("refuses a foreign-currency payment whose pesos taken from the bank aren't more than zero, and says so in a sentence", async () => {
        const usd = await raise("USD")
        for (const php of [0, -5]) {
            const { error } = await addPayment("outsider", usd.id, { p_php_debited: php })
            expect(error?.code).toBe("22023")
            expect(error?.message).toMatch(/pesos taken from the bank must be more than zero/)
        }
        const { data } = await svc().from("ipas_payments").select("id").eq("ipas_id", usd.id)
        expect(data).toEqual([])
    })

    it("stores no PHP debited on a peso PO, whatever was sent", async () => {
        const ipas = await raise("Php")
        const { data } = await addPayment("outsider", ipas.id, { p_php_debited: 999 })
        expect(data.php_debited).toBeNull()
    })

    it.each([
        ["a kind that isn't one", { p_kind: "refund" }],
        ["no date", { p_paid_on: null }],
        ["a zero amount", { p_amount: 0 }],
        ["a negative amount", { p_amount: -1 }],
        ["no amount", { p_amount: null }],
        ["a negative charge fee", { p_charge_fee_php: -1 }],
        ["a proof that isn't a link", { p_proof_url: "javascript:alert(1)" }],
    ])("refuses %s", async (_, over) => {
        const ipas = await raise()
        const { error } = await addPayment("outsider", ipas.id, over)
        expect(error?.code).toBe("22023")
    })

    it("takes any number of payments, kinds and proofs", async () => {
        const ipas = await raise()
        const kinds = ["down_payment", "payment", "payment", "full_payment", "shipping_fee"]
        for (const kind of kinds) {
            const { error } = await addPayment("finance", ipas.id, {
                p_kind: kind,
                p_proof_url: kind === "full_payment" ? "https://res.cloudinary.com/demo/image/upload/pop.png" : null,
            })
            expect(error).toBeNull()
        }
        const { data } = await svc().from("ipas_payments").select("kind, proof_url").eq("ipas_id", ipas.id)
        expect(data).toHaveLength(5)
        expect(data.filter((p) => p.proof_url)).toHaveLength(1)
    })

    it("needs a payment method from the payment method list", async () => {
        const ipas = await raise()
        const charge = await addPayment("outsider", ipas.id, { p_method_id: kindIds.brokerage })
        expect(charge.error?.code).toBe("22023")
        expect(charge.error?.message).toMatch(/payment method/)

        const none = await addPayment("outsider", ipas.id, { p_method_id: null })
        expect(none.error?.code).toBe("22023")
    })

    it("refuses an IPAS that is filed or cancelled, and one that doesn't exist", async () => {
        const filed = await raise()
        const { data: row } = await addPayment("outsider", filed.id)
        await file(filed.id)

        const added = await addPayment("outsider", filed.id)
        expect(added.error?.code).toBe("22023")
        const changed = await rpc("outsider", "ipas_update_payment", { ...payment(filed.id), p_ipas_id: undefined, p_payment_id: row.id, p_amount: 1 })
        expect(changed.error?.code).toBe("22023")
        const removed = await rpc("outsider", "ipas_remove_payment", { p_payment_id: row.id })
        expect(removed.error?.code).toBe("22023")
        expect(Number((await paymentRow(row.id)).amount)).toBe(500)

        const cancelled = await raise()
        await rpc("outsider", "ipas_cancel", { p_ipas_id: cancelled.id, p_reason: "Dropped" })
        expect((await addPayment("outsider", cancelled.id)).error?.code).toBe("22023")

        const missing = await addPayment("outsider", "00000000-0000-0000-0000-000000000000")
        expect(missing.error?.code).toBe("22023")
    })
})

describe("changing and removing payments", () => {
    const update = (who, id, over = {}) => {
        const { p_ipas_id, ...rest } = payment("x", over)
        void p_ipas_id
        return rpc(who, "ipas_update_payment", { p_payment_id: id, ...rest })
    }

    it("keeps every add, change and removal in history, with what changed and a snapshot of what was removed", async () => {
        const ipas = await raise("USD")
        const { data: row } = await addPayment("outsider", ipas.id, { p_amount: 640, p_php_debited: 36160 })

        const edited = await update("finance", row.id, {
            p_kind: "full_payment",
            p_amount: 640,
            p_php_debited: 36240,
            p_charge_fee_php: 350,
            p_method_id: methodIds.alipay,
            p_check_no: "CHK-9",
        })
        expect(edited.error).toBeNull()
        expect(Number(edited.data.php_debited)).toBe(36240)

        const removed = await rpc("outsider", "ipas_remove_payment", { p_payment_id: row.id })
        expect(removed.error).toBeNull()
        expect(await paymentRow(row.id)).toBeNull()

        const trail = await events(ipas.id, "payment_added", "payment_changed", "payment_removed")
        expect(trail.map((e) => [e.kind, e.actor_id])).toEqual([
            ["payment_added", ids.outsider],
            ["payment_changed", ids.finance],
            ["payment_removed", ids.outsider],
        ])
        expect(trail[0].detail).toMatchObject({ payment_id: row.id, kind: "down_payment", method: "Dated Check", currency: "USD" })
        expect(trail[1].detail.changes).toMatchObject({
            kind: { from: "down_payment", to: "full_payment" },
            php_debited: { to: 36240 },
            charge_fee_php: { from: 0, to: 350 },
            method: { from: "Dated Check", to: "Alipay" },
            check_no: { from: null, to: "CHK-9" },
        })
        expect(trail[1].detail.changes.amount).toBeUndefined()
        expect(trail[2].detail).toMatchObject({ payment_id: row.id, kind: "full_payment", method: "Alipay" })
        expect(Number(trail[2].detail.php_debited)).toBe(36240)
    })

    it("writes no history when nothing changed", async () => {
        const ipas = await raise()
        const { data: row } = await addPayment("outsider", ipas.id)
        const same = await update("outsider", row.id)
        expect(same.error).toBeNull()
        expect((await events(ipas.id, "payment_changed")).length).toBe(0)
    })

    it("holds a changed payment to the same rules as a new one", async () => {
        const usd = await raise("USD")
        const { data: row } = await addPayment("outsider", usd.id, { p_amount: 100, p_php_debited: 5600 })
        const zero = await update("outsider", row.id, { p_amount: 0, p_php_debited: 5600 })
        expect(zero.error?.code).toBe("22023")
        expect(Number((await paymentRow(row.id)).php_debited)).toBe(5600)
        // #604: the pesos taken from the bank may be blanked again (Landed Cost is then an estimate).
        const noPhp = await update("outsider", row.id, { p_amount: 100, p_php_debited: null })
        expect(noPhp.error).toBeNull()
        expect((await paymentRow(row.id)).php_debited).toBeNull()
    })

    it("is refused to anyone without Purchasing or Finance access", async () => {
        const ipas = await raise()
        const { data: row } = await addPayment("outsider", ipas.id)
        for (const who of ["ordinary", "ipasSigner", "superAdmin", "dealOwner"]) {
            expect((await update(who, row.id, { p_amount: 1 })).error?.code, `${who} changed a payment`).toBe("42501")
            expect(
                (await rpc(who, "ipas_remove_payment", { p_payment_id: row.id })).error?.code,
                `${who} removed a payment`,
            ).toBe("42501")
        }
        expect(await paymentRow(row.id)).toMatchObject({ id: row.id })
    })

    it("lets a deactivated method stay on the payment that used it, and refuses it for a new one", async () => {
        const ipas = await raise()
        const { data: row } = await addPayment("outsider", ipas.id, { p_method_id: methodIds.alipay })
        const off = await svc().from("ipas_options").update({ active: false }).eq("id", methodIds.alipay)
        expect(off.error).toBeNull()

        const kept = await update("outsider", row.id, { p_method_id: methodIds.alipay, p_amount: 750 })
        expect(kept.error).toBeNull()
        expect(kept.data.method_id).toBe(methodIds.alipay)

        const fresh = await addPayment("outsider", ipas.id, { p_method_id: methodIds.alipay })
        expect(fresh.error?.code).toBe("22023")
        expect(fresh.error?.message).toMatch(/deactivated/)

        const moved = await update("outsider", (await addPayment("outsider", ipas.id)).data.id, { p_method_id: methodIds.alipay })
        expect(moved.error?.code).toBe("22023")

        await svc().from("ipas_options").update({ active: true }).eq("id", methodIds.alipay)
    })
})

describe("recording charges", () => {
    const charge = (ipasId, over = {}) => ({
        p_ipas_id: ipasId,
        p_kind_id: kindIds.brokerage,
        p_charged_on: "2026-10-05",
        p_amount_php: 4200,
        ...over,
    })

    it("is open to Purchasing and Finance and refused to everyone else", async () => {
        const ipas = await raise()
        for (const who of ["outsider", "finance"]) {
            const { data, error } = await rpc(who, "ipas_add_charge", charge(ipas.id))
            expect(error, `${who} refused a charge`).toBeNull()
            expect(data).toMatchObject({ ipas_id: ipas.id, kind_id: kindIds.brokerage, created_by: ids[who] })
            expect(Number(data.amount_php)).toBe(4200)
        }
        for (const who of CAST_KEYS.filter((k) => !["outsider", "finance"].includes(k))) {
            const { error } = await rpc(who, "ipas_add_charge", charge(ipas.id))
            expect(error?.code, `${who} recorded a charge`).toBe("42501")
        }
        const { data } = await svc().from("ipas_charges").select("id").eq("ipas_id", ipas.id)
        expect(data).toHaveLength(2)
    })

    it("can't be written to the table directly", async () => {
        const ipas = await raise()
        const { data: row } = await rpc("outsider", "ipas_add_charge", charge(ipas.id))
        for (const who of ["outsider", "finance", "superAdmin"]) {
            const client = await clientFor(who)
            const inserted = await tryInsert(client, "ipas_charges", {
                ipas_id: ipas.id,
                kind_id: kindIds.duties,
                charged_on: "2026-10-05",
                amount_php: 1,
            })
            expect(inserted.ok, `${who} inserted a charge`).toBe(false)
            expect((await tryUpdate(client, "ipas_charges", row.id, { amount_php: 1 })).affected).toBe(0)
            expect((await tryDelete(client, "ipas_charges", row.id)).affected).toBe(0)
        }
    })

    it.each([
        ["no kind", { p_kind_id: null }],
        ["a kind from another list", () => ({ p_kind_id: methodIds.check })],
        ["no date", { p_charged_on: null }],
        ["a zero amount", { p_amount_php: 0 }],
        ["a negative amount", { p_amount_php: -10 }],
    ])("refuses %s", async (_, over) => {
        const ipas = await raise()
        const { error } = await rpc("outsider", "ipas_add_charge", charge(ipas.id, typeof over === "function" ? over() : over))
        expect(error?.code).toBe("22023")
    })

    it("keeps each add, change and removal in history, and refuses a filed IPAS", async () => {
        const ipas = await raise()
        const { data: row } = await rpc("finance", "ipas_add_charge", charge(ipas.id))
        const edited = await rpc("outsider", "ipas_update_charge", {
            p_charge_id: row.id,
            p_kind_id: kindIds.duties,
            p_charged_on: "2026-10-06",
            p_amount_php: 9870,
        })
        expect(edited.error).toBeNull()
        expect(Number(edited.data.amount_php)).toBe(9870)

        const same = await rpc("outsider", "ipas_update_charge", {
            p_charge_id: row.id,
            p_kind_id: kindIds.duties,
            p_charged_on: "2026-10-06",
            p_amount_php: 9870,
        })
        expect(same.error).toBeNull()

        const removed = await rpc("finance", "ipas_remove_charge", { p_charge_id: row.id })
        expect(removed.error).toBeNull()

        const trail = await events(ipas.id, "charge_added", "charge_changed", "charge_removed")
        expect(trail.map((e) => [e.kind, e.actor_id])).toEqual([
            ["charge_added", ids.finance],
            ["charge_changed", ids.outsider],
            ["charge_removed", ids.finance],
        ])
        expect(trail[1].detail.changes).toMatchObject({
            kind: { from: "Brokerage Fee", to: "Duties & Taxes" },
            charged_on: { to: "2026-10-06" },
            amount_php: { from: 4200, to: 9870 },
        })
        expect(trail[2].detail).toMatchObject({ kind: "Duties & Taxes" })

        const kept = await rpc("outsider", "ipas_add_charge", charge(ipas.id))
        await file(ipas.id)
        expect((await rpc("outsider", "ipas_add_charge", charge(ipas.id))).error?.code).toBe("22023")
        expect((await rpc("outsider", "ipas_remove_charge", { p_charge_id: kept.data.id })).error?.code).toBe("22023")
    })

    it("reads rows to Purchasing, Finance, signers and Super Admins, and none to a plain employee", async () => {
        const ipas = await raise()
        const { data: row } = await rpc("outsider", "ipas_add_charge", charge(ipas.id))
        const { data: pay } = await addPayment("outsider", ipas.id)
        for (const who of ["outsider", "finance", "ipasSigner", "superAdmin"]) {
            const client = await clientFor(who)
            expect(await canRead(client, "ipas_charges", row.id), `${who} read the charge`).toBe(true)
            expect(await canRead(client, "ipas_payments", pay.id), `${who} read the payment`).toBe(true)
        }
        for (const who of ["ordinary", "dealOwner"]) {
            const client = await clientFor(who)
            expect(await canRead(client, "ipas_charges", row.id), `${who} read the charge`).toBe(false)
            expect(await canRead(client, "ipas_payments", pay.id), `${who} read the payment`).toBe(false)
        }
    })
})

describe("the typed header values", () => {
    const setHeader = (who, id, fields) => rpc(who, "ipas_set_header", { p_ipas_id: id, p_fields: fields })

    it("types P.I/QT Amount, picks the freight service, the spread and the computation status", async () => {
        const ipas = await raise()
        expect(ipas).toMatchObject({ landed_cost_split: "value", computation_status: "encoding", pi_qt_amount: null, freight_service_id: null })

        const { data, error } = await setHeader("outsider", ipas.id, {
            pi_qt_amount: "1,250.50",
            freight_service_id: freightIds.dhl,
            landed_cost_split: "quantity",
            computation_status: "lc_odoo_done",
        })
        expect(error).toBeNull()
        expect(Number(data.pi_qt_amount)).toBe(1250.5)
        expect(data).toMatchObject({
            freight_service_id: freightIds.dhl,
            landed_cost_split: "quantity",
            computation_status: "lc_odoo_done",
        })

        const [event] = await events(ipas.id, "header_changed")
        expect(event.actor_id).toBe(ids.outsider)
        expect(event.detail.fields).toMatchObject({
            pi_qt_amount: { from: null, to: 1250.5 },
            freight_service_id: { from: null, to: "DHL" },
            landed_cost_split: { from: "value", to: "quantity" },
            computation_status: { from: "encoding", to: "lc_odoo_done" },
        })
    })

    it("clears P.I/QT Amount and the freight service, and keeps the earlier contact and P.I # keys working", async () => {
        const ipas = await raise()
        await setHeader("outsider", ipas.id, { pi_qt_amount: 100, freight_service_id: freightIds.dhl, pi_number: "PI-1" })
        const { data } = await setHeader("outsider", ipas.id, { pi_qt_amount: "", freight_service_id: null })
        expect(data.pi_qt_amount).toBeNull()
        expect(data.freight_service_id).toBeNull()
        expect(data.pi_number).toBe("PI-1")
    })

    it.each([
        ["a half-typed amount", { pi_qt_amount: "12abc" }],
        ["a negative amount", { pi_qt_amount: -5 }],
        ["a spread that isn't one", { landed_cost_split: "weight" }],
        ["a status that isn't one", { computation_status: "done" }],
        ["a charge kind as the freight service", { freight_service_id: "kind" }],
        ["a field it doesn't type", { state: "filed" }],
    ])("refuses %s", async (_, fields) => {
        const ipas = await raise()
        const withKind = fields.freight_service_id === "kind" ? { freight_service_id: kindIds.brokerage } : fields
        const { error } = await setHeader("outsider", ipas.id, withKind)
        expect(error?.code).toBe("22023")
    })

    it("is Purchasing only: Finance, signers and Super Admins change none of it", async () => {
        const ipas = await raise()
        for (const who of ["finance", "ipasSigner", "superAdmin", "ordinary"]) {
            const { error } = await setHeader(who, ipas.id, { pi_qt_amount: 1 })
            expect(error?.code, `${who} typed the amount`).toBe("42501")
        }
    })

    it("refuses a filed IPAS, and a deactivated freight service for a new pick but not for the one already held", async () => {
        const ipas = await raise()
        await setHeader("outsider", ipas.id, { freight_service_id: freightIds.fedex })
        await svc().from("ipas_options").update({ active: false }).eq("id", freightIds.fedex)

        const again = await setHeader("outsider", ipas.id, { freight_service_id: freightIds.fedex, pi_qt_amount: 10 })
        expect(again.error).toBeNull()

        const other = await raise()
        const fresh = await setHeader("outsider", other.id, { freight_service_id: freightIds.fedex })
        expect(fresh.error?.code).toBe("22023")
        await svc().from("ipas_options").update({ active: true }).eq("id", freightIds.fedex)

        await file(ipas.id)
        expect((await setHeader("outsider", ipas.id, { pi_qt_amount: 99 })).error?.code).toBe("22023")
    })

    it("writes no history for a repeat", async () => {
        const ipas = await raise()
        await setHeader("outsider", ipas.id, { landed_cost_split: "equal" })
        await setHeader("outsider", ipas.id, { landed_cost_split: "equal", computation_status: "encoding" })
        expect((await events(ipas.id, "header_changed")).length).toBe(1)
    })
})

describe("the section 2 ticks (#241)", () => {
    const setHeader = (who, id, fields) => rpc(who, "ipas_set_header", { p_ipas_id: id, p_fields: fields })

    it("are plain ticks, off until ticked, and a change is one header_changed event with before and after", async () => {
        const ipas = await raise()
        expect(ipas).toMatchObject({ google_sheet: false, gantt_chart: false })

        const on = await setHeader("outsider", ipas.id, { google_sheet: true, gantt_chart: true })
        expect(on.error).toBeNull()
        expect(on.data).toMatchObject({ google_sheet: true, gantt_chart: true })

        const off = await setHeader("outsider", ipas.id, { google_sheet: false })
        expect(off.data).toMatchObject({ google_sheet: false, gantt_chart: true })

        const changes = await events(ipas.id, "header_changed")
        expect(changes).toHaveLength(2)
        expect(changes[0].actor_id).toBe(ids.outsider)
        expect(changes[0].detail.fields).toMatchObject({
            google_sheet: { from: false, to: true },
            gantt_chart: { from: false, to: true },
        })
        expect(changes[1].detail.fields).toEqual({ google_sheet: { from: true, to: false } })
    })

    it("writes no history for a repeat", async () => {
        const ipas = await raise()
        await setHeader("outsider", ipas.id, { gantt_chart: true })
        await setHeader("outsider", ipas.id, { gantt_chart: true })
        expect((await events(ipas.id, "header_changed")).length).toBe(1)
    })

    it("are not sign-off gated: ticking clears no approval", async () => {
        const ipas = await raise()
        await setHeader("outsider", ipas.id, { google_sheet: true })
        expect(await events(ipas.id, "approvals_cleared")).toHaveLength(0)
    })

    it.each([
        ["a text value", { google_sheet: "true" }],
        ["a number", { gantt_chart: 1 }],
        ["null", { google_sheet: null }],
        ["an object", { gantt_chart: {} }],
    ])("refuses %s with a sentence (22023), and writes nothing", async (_, fields) => {
        const ipas = await raise()
        const { error } = await setHeader("outsider", ipas.id, fields)
        expect(error?.code).toBe("22023")
        expect(await events(ipas.id, "header_changed")).toHaveLength(0)
    })

    it("is Purchasing only: Finance, signers, Super Admins and ordinary employees can't tick", async () => {
        const ipas = await raise()
        for (const who of ["finance", "ipasSigner", "superAdmin", "ordinary"]) {
            const { error } = await setHeader(who, ipas.id, { google_sheet: true })
            expect(error?.code, `${who} ticked Googlesheet`).toBe("42501")
        }
    })

    it("is refused to the signed-out", async () => {
        const ipas = await raise()
        const { error } = await anonymousClient().rpc("ipas_set_header", { p_ipas_id: ipas.id, p_fields: { google_sheet: true } })
        expect(error).not.toBeNull()
    })

    it("refuses a filed IPAS (the frozen-state 55000) and a cancelled one", async () => {
        const filedIpas = await raise()
        await file(filedIpas.id)
        expect((await setHeader("outsider", filedIpas.id, { google_sheet: true })).error?.code).toBe("22023")

        const cancelled = await raise()
        expect((await rpc("outsider", "ipas_cancel", { p_ipas_id: cancelled.id, p_reason: "Dropped" })).error).toBeNull()
        expect((await setHeader("outsider", cancelled.id, { gantt_chart: true })).error?.code).toBe("22023")
    })

    it("can't be written to the table directly by Purchasing", async () => {
        const ipas = await raise()
        const { error } = await (await clientFor("outsider")).from("ipas").update({ google_sheet: true }).eq("id", ipas.id).select("id")
        expect(error?.code === RLS_VIOLATION || error === null).toBe(true)
        expect((await svc().from("ipas").select("google_sheet").eq("id", ipas.id).maybeSingle()).data.google_sheet).toBe(false)
    })
})
