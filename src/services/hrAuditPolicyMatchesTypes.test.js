import { describe, it, expect } from "vitest"
import fs from "node:fs"
import path from "node:path"
import { HR_ENTITY_TYPES } from "./systemAuditLogService"

// The HR read policy on system_audit_logs must list exactly the entity types the
// HR Logs tab asks for, otherwise HR sees an empty tab for the missing ones.
const dir = path.resolve(__dirname, "../../supabase/migrations")

function latestHrPolicyTypes() {
    const files = fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()
    let types = null
    for (const f of files) {
        const sql = fs.readFileSync(path.join(dir, f), "utf8")
        const m = sql.match(/create policy "hr_read_system_audit_logs"[\s\S]*?entity_type\s+in\s*\(([^)]*)\)/i)
        if (m) types = [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1])
    }
    return types
}

describe("hr_read_system_audit_logs", () => {
    it("lists the same entity types as HR_ENTITY_TYPES", () => {
        const sqlTypes = latestHrPolicyTypes()
        expect(sqlTypes).not.toBeNull()
        expect([...sqlTypes].sort()).toEqual([...HR_ENTITY_TYPES].sort())
    })
})
