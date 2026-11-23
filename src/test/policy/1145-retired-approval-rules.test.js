/**
 * The Approval Rules switches are gone from the database (#1145).
 *
 *   app_settings keeps only the storefront list, which odoo-sor-sync still reads
 *   Help & FAQ loses "What is Self-Verification?" (t-3), and nothing else
 *
 * The migration runs at `db reset`, before any FAQ exists, so this file seeds an
 * FAQ and re-runs the real migration file against it (twice: it must be
 * re-runnable). Prior art: 45-migrate-legacy-procurement.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { readFileSync } from "node:fs"
import { serviceClient, sql } from "./support/stack.js"

const MIGRATION = readFileSync(
    "supabase/migrations/20261225100000_1145_drop_retired_approval_rules_columns.sql",
    "utf8",
)
const svc = () => serviceClient()
const UNDEFINED_COLUMN = "42703"
const RETIRED = [
    "universal_task_submission",
    "marketing_approval_by_ops_manager",
    "enable_self_verification",
    "enable_bulk_approval",
    "enable_visual_shaming",
]

const logTask = { id: "t-1", q: "How do I log a new task?", a: "Click + Log Task." }
const selfVerify = {
    id: "t-3",
    q: 'What is "Self-Verification"?',
    a: "The owner can Self-Verify a task after 48 hours.",
    roleAnswers: { hr: "Flagged for audit.", head: null },
}
const deleteTask = { id: "t-4", q: "How do I delete a task?", a: "Use the delete button." }
// Same id, different question: the FAQ Editor could reuse t-3 one day.
const otherT3 = { id: "t-3", q: "Where do I see my payslip?", a: "Under Payroll." }
const FAQ = [
    { id: "tasks", label: "Tasks", icon: "CheckSquare", color: "blue", items: [logTask, selfVerify, deleteTask] },
    { id: "payroll", label: "Payroll", icon: "Wallet", color: "green", items: [otherT3] },
    { id: "empty", label: "Empty", icon: "Circle", color: "gray", items: [] },
]

let original

beforeAll(async () => {
    const { data, error } = await svc().from("faq_data").select("*").eq("id", 1).maybeSingle()
    if (error) throw error
    original = data
    const seeded = await svc().from("faq_data").upsert({ id: 1, categories: FAQ })
    if (seeded.error) throw seeded.error
    await sql().query(MIGRATION)
    await sql().query(MIGRATION)
})

afterAll(async () => {
    if (original) await svc().from("faq_data").upsert(original)
    else await svc().from("faq_data").delete().eq("id", 1)
})

describe("app_settings after Approval Rules is retired", () => {
    it.each(RETIRED)("no longer has %s", async (column) => {
        const { error } = await svc().from("app_settings").select(column).limit(1)
        expect(error?.code).toBe(UNDEFINED_COLUMN)
    })

    it("still has the storefront list odoo-sor-sync reads", async () => {
        const { error } = await svc().from("app_settings").select("id, updated_at, retail_storefronts").limit(1)
        expect(error).toBeNull()
    })
})

describe("Help & FAQ after Approval Rules is retired", () => {
    it("drops only the Self-Verification entry and keeps every other entry in its place", async () => {
        const { data, error } = await svc().from("faq_data").select("categories").eq("id", 1).single()
        expect(error).toBeNull()
        expect(data.categories).toEqual([
            { ...FAQ[0], items: [logTask, deleteTask] },
            FAQ[1],
            FAQ[2],
        ])
    })
})
