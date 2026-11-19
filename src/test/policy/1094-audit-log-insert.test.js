/**
 * Audit log insert rule (#1094, spec #1093 A1).
 *
 * An employee may add a row only as themselves. A row with another person's author, or with no author
 * ("System"), is refused with 42501.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { ids, clientFor, ensureCastLoaded } from "./support/cast.js"
import { serviceClient } from "./support/stack.js"
import { MARKER } from "./support/rows.js"

const row = (author_id, tag) => ({ author_id, type: "SYSTEM", entity_type: "TEST", content: `${MARKER} ${tag}` })

beforeAll(ensureCastLoaded)
afterAll(async () => {
    await serviceClient().from("system_audit_logs").delete().like("content", `${MARKER}%`)
})

describe("system_audit_logs insert rule (#1094)", () => {
    it("refuses a row written as someone else", async () => {
        const client = await clientFor("ordinary")
        const { error } = await client.from("system_audit_logs").insert(row(ids.superAdmin, "forged"))
        expect(error?.code).toBe("42501")
    })

    it("refuses a row with no author", async () => {
        const client = await clientFor("ordinary")
        const { error } = await client.from("system_audit_logs").insert(row(null, "system"))
        expect(error?.code).toBe("42501")
    })

    it("accepts a row written as yourself", async () => {
        const client = await clientFor("ordinary")
        const { error } = await client.from("system_audit_logs").insert(row(ids.ordinary, "own"))
        expect(error).toBeNull()
    })
})
