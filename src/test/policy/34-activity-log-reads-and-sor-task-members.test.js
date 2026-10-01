/**
 * (1) Activity Log tabs empty; (2) a member mentioned in an
 * SOR-linked Group Task cannot open it.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { createClient } from "@supabase/supabase-js"
import { ids, clientFor, ensureCastLoaded, CAST_PASSWORD } from "./support/cast.js"
import { serviceClient, API_URL, ANON_KEY } from "./support/stack.js"
import { MARKER, makeSor } from "./support/rows.js"
import { canRead } from "./support/access.js"

let logId
let hrLogId
beforeAll(async () => {
    await ensureCastLoaded()
    const hrLog = await serviceClient()
        .from("system_audit_logs")
        .insert({ author_id: ids.superAdmin, type: "SYSTEM", entity_type: "EMPLOYEE", content: `${MARKER} employee updated` })
        .select("id")
        .single()
    if (hrLog.error) throw new Error(hrLog.error.message)
    hrLogId = hrLog.data.id
    const { data, error } = await serviceClient()
        .from("system_audit_logs")
        .insert({ author_id: ids.superAdmin, type: "SYSTEM", entity_type: "OPPORTUNITY", content: `${MARKER} Sales opportunity S1 registered` })
        .select("id")
        .single()
    if (error) throw new Error(error.message)
    logId = data.id
})
afterAll(async () => {
    await serviceClient().from("system_audit_logs").delete().eq("id", logId)
    await serviceClient().from("system_audit_logs").delete().eq("id", hrLogId)
})

describe("system_audit_logs reads (Activity Log SOR/System/HR tabs)", () => {
    it("a super admin whose employees.id equals auth.uid reads it", async () => {
        expect(await canRead(await clientFor("superAdmin"), "system_audit_logs", logId)).toBe(true)
    })

    it("a super admin whose employees.id DIFFERS from auth.uid (email-linked, like get_employee_id) reads it", async () => {
        const svc = serviceClient()
        const email = `mismatch-sa@policy.fixture`
        const au = await svc.auth.admin.createUser({ email, password: CAST_PASSWORD, email_confirm: true })
        if (au.error) throw new Error(au.error.message)
        const empId = crypto.randomUUID()
        const emp = await svc.from("employees").insert({
            id: empId, email, name: "Mismatch SA", department: "ADMINISTRATION", role: "SYSADMIN",
            employment_status: "Regular", is_super_admin: true, offset_hours_balance: 0, sil_hours_balance: 0,
        })
        if (emp.error) throw new Error(emp.error.message)
        try {
            const c = createClient(API_URL, ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
            const s = await c.auth.signInWithPassword({ email, password: CAST_PASSWORD })
            if (s.error) throw new Error(s.error.message)
            expect(await canRead(c, "system_audit_logs", logId)).toBe(true)
        } finally {
            await svc.from("employees").delete().eq("id", empId)
            await svc.auth.admin.deleteUser(au.data.user.id)
        }
    })

    it("an HR officer reads HR entity logs (HR Logs tab) but not SOR logs", async () => {
        const hr = await clientFor("hr")
        expect(await canRead(hr, "system_audit_logs", hrLogId)).toBe(true)
        expect(await canRead(hr, "system_audit_logs", logId)).toBe(false)
    })
})

describe("Group Task under an SOR, member has no SOR access", () => {
    let sorId, taskId
    beforeAll(async () => {
        const svc = serviceClient()
        sorId = await makeSor({ registeredBy: ids.dealOwner, dealOwnerId: ids.dealOwner })
        const t = await svc.from("committee_tasks")
            .insert({ title: `${MARKER} SO evaluation`, created_by: ids.dealOwner, opportunity_id: sorId })
            .select("id").single()
        if (t.error) throw new Error(t.error.message)
        taskId = t.data.id
        const m = await svc.from("committee_task_members")
            .insert({ committee_task_id: taskId, employee_id: ids.ordinary, task_description: "x" })
        if (m.error) throw new Error(m.error.message)
    })
    afterAll(async () => {
        const svc = serviceClient()
        await svc.from("committee_tasks").delete().eq("id", taskId)
        await svc.from("sales_opportunities").delete().eq("id", sorId)
    })

    it("a task member can read the group task they were added to", async () => {
        expect(await canRead(await clientFor("ordinary"), "committee_tasks", taskId)).toBe(true)
    })
})
