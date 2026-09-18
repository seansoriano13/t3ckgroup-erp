/**
 * Issue #179 — the six deprecated Quota System tables (quotas, quota logs,
 * weekly plans, activities, activity logs, revenue logs) are gone, along
 * with their policies. Row check recorded on the issue before the drop:
 * both staging and production held real historical rows (24/20/62/1895/
 * 4241/102 respectively) rather than the zero the spec asked to confirm —
 * dropped anyway on explicit instruction.
 *
 * `revenue_activity_logs` is a seventh, unnamed table hanging off
 * `sales_revenue_logs` by foreign key. It is not one of the six the ticket
 * names, so it is asserted to still exist rather than dropped.
 *
 * Seam A, direct SQL only (`rlsStatus` / `to_regclass`) — there is nothing
 * left to sign in as and ask, which is the point.
 */
import { describe, it, expect } from "vitest"
import { rlsStatus, sql } from "./support/stack.js"

const DROPPED_TABLES = [
    "sales_quotas",
    "sales_quota_logs",
    "sales_weekly_plans",
    "sales_activities",
    "sales_activity_logs",
    "sales_revenue_logs",
]

describe("the deprecated Quota System tables are gone", () => {
    it.each(DROPPED_TABLES)("%s no longer exists", async (table) => {
        const { rows } = await sql().query(`select to_regclass('public.' || $1) as reg`, [table])
        expect(rows[0].reg).toBeNull()
    })

    it.each(DROPPED_TABLES)("%s carries no leftover policies to find", async (table) => {
        await expect(rlsStatus(table)).rejects.toThrow(`No such table: public.${table}`)
    })

    it("leaves revenue_activity_logs in place — it was not one of the six named", async () => {
        const { rows } = await sql().query(`select to_regclass('public.revenue_activity_logs') as reg`)
        expect(rows[0].reg).toBe("revenue_activity_logs")
    })
})

describe("get_user_active_chats survives the drop", () => {
    it("no longer references a sales_chats branch built on the dropped tables", async () => {
        const { rows } = await sql().query(
            `select prosrc from pg_proc where proname = 'get_user_active_chats'`,
        )
        expect(rows).toHaveLength(1)
        expect(rows[0].prosrc).not.toMatch(/sales_activit/)
    })
})

describe("the dead quota trigger functions are gone with their table", () => {
    it.each(["update_sales_quota_metrics", "update_sales_quota_progress"])(
        "%s no longer exists",
        async (fn) => {
            const { rows } = await sql().query(`select 1 from pg_proc where proname = $1`, [fn])
            expect(rows).toHaveLength(0)
        },
    )
})
