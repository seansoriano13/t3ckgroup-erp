/**
 * ipas_options.system_key (#1191 follow-up, spec #1187): the P.I and Quotation document kinds keep a
 * fixed key through a rename, and the settings screen's writes can't set or change it.
 *
 * `outsider` holds Purchasing access (the settings writer); `superAdmin` is a Super Admin.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { clientFor, ensureCastLoaded } from "./support/cast.js"
import { serviceClient, sql } from "./support/stack.js"

const svc = () => serviceClient()
const made = []

beforeAll(async () => {
    await ensureCastLoaded()
})

afterAll(async () => {
    if (made.length) await sql().query(`delete from public.ipas_options where id = any($1::uuid[])`, [made])
})

const keyOf = async (id) =>
    (await sql().query(`select system_key from public.ipas_options where id = $1`, [id])).rows[0].system_key

describe("ipas_options.system_key", () => {
    it("is placed on the seeded P.I and Quotation kinds", async () => {
        const { rows } = await sql().query(
            `select system_key, label from public.ipas_options where system_key is not null order by system_key`,
        )
        expect(rows.map((r) => r.system_key)).toEqual(["proforma_invoice", "quotation"])
    })

    it("survives a rename through the settings write path", async () => {
        const { rows } = await sql().query(`select id, label from public.ipas_options where system_key = 'quotation'`)
        const { id, label } = rows[0]
        for (const who of ["outsider", "superAdmin"]) {
            const client = await clientFor(who)
            const renamed = await client.from("ipas_options").update({ label: `${label} renamed by ${who}` }).eq("id", id).select("id")
            expect(renamed.error, `${who} rename`).toBeNull()
            expect(renamed.data).toHaveLength(1)
            expect(await keyOf(id), `${who} rename kept the key`).toBe("quotation")
        }
        await sql().query(`update public.ipas_options set label = $2 where id = $1`, [id, label])
    })

    it("can't be set, changed or cleared by an admin write", async () => {
        const stamp = Date.now()
        const added = await svc().from("ipas_options").insert({ list: "document_kind", label: `Key probe ${stamp}`, sort: 990, applies_to: "both", used_for: "documentation" }).select("id").single()
        made.push(added.data.id)
        const probe = added.data.id
        const { rows } = await sql().query(`select id from public.ipas_options where system_key = 'proforma_invoice'`)
        const piId = rows[0].id

        for (const who of ["outsider", "superAdmin"]) {
            const client = await clientFor(who)
            const set = await client.from("ipas_options").update({ system_key: "quotation" }).eq("id", probe)
            expect(set.error?.code, `${who} set a key`).toBe("42501")
            const cleared = await client.from("ipas_options").update({ system_key: null }).eq("id", piId)
            expect(cleared.error?.code, `${who} cleared a key`).toBe("42501")
            const inserted = await client.from("ipas_options").insert({ list: "document_kind", label: `Key insert ${who} ${stamp}`, sort: 991, applies_to: "both", used_for: "documentation", system_key: "proforma_invoice" })
            expect(inserted.error, `${who} inserted with a key`).not.toBeNull()
        }
        expect(await keyOf(probe)).toBeNull()
        expect(await keyOf(piId)).toBe("proforma_invoice")
    })

    it("is only allowed on a document kind, and one row per key", async () => {
        const wrongList = await svc().from("ipas_options").insert({ list: "payment_method", label: `Key wrong list ${Date.now()}`, sort: 992, system_key: "x" })
        expect(wrongList.error).not.toBeNull()
        const dup = await svc().from("ipas_options").insert({ list: "document_kind", label: `Key dup ${Date.now()}`, sort: 993, applies_to: "both", used_for: "documentation", system_key: "quotation" })
        expect(dup.error).not.toBeNull()
    })
})
