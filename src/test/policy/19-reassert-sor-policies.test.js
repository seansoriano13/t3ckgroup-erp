/**
 * Issue #380 (part of #377) — the re-assert migration.
 *
 * Runs the migration's SQL against the local stack. On a from-empty build it
 * must change nothing; after putting the database into production's drifted
 * state it must land back on staging's definitions. Wrapped in a transaction
 * that is rolled back, so the shared database is untouched.
 */
import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { sql } from "./support/stack.js"

const MIGRATION = readFileSync(
    new URL("../../../supabase/migrations/20260930060000_reassert_sor_policies.sql", import.meta.url),
    "utf8",
)

const TOUCHED = `
  (tablename = 'sales_opportunities' and policyname = 'sor_read')
  or (tablename = 'sales_opportunity_logs' and policyname = 'sor_log_read')
  or (tablename = 'sales_opportunity_members' and policyname = 'sales_opportunity_members_read')
`
const PROD_ONLY = `
  (tablename = 'system_audit_logs' and policyname in ('Allow all read','hr_read_system_audit_logs'))
  or (tablename = 'task_activity' and policyname in ('Authenticated users can insert task activity','Authenticated users can read task activity'))
`

async function snapshot(client) {
    const { rows } = await client.query(
        `select tablename, policyname, cmd, roles::text, qual, with_check
         from pg_policies where schemaname = 'public' and (${TOUCHED} or ${PROD_ONLY})
         order by tablename, policyname`,
    )
    return rows
}

async function inTransaction(fn) {
    const client = await sql().connect()
    try {
        await client.query("begin")
        return await fn(client)
    } finally {
        await client.query("rollback")
        client.release()
    }
}

describe("re-assert SOR policies migration", () => {
    it("leaves sor_update on the shared can-edit predicate", async () => {
        await inTransaction(async (c) => {
            await c.query(`drop policy "sor_update" on public.sales_opportunities;
              create policy "sor_update" on public.sales_opportunities for update to authenticated using (true);`)
            await c.query(MIGRATION)
            const { rows } = await c.query(
                `select qual from pg_policies where tablename = 'sales_opportunities' and policyname = 'sor_update'`,
            )
            expect(rows[0].qual).toContain("sor_can_edit_opportunity")
        })
    })

    it("changes nothing on a from-empty build, and is idempotent", async () => {
        await inTransaction(async (c) => {
            const before = await snapshot(c)
            await c.query(MIGRATION)
            expect(await snapshot(c)).toEqual(before)
            await c.query(MIGRATION)
            expect(await snapshot(c)).toEqual(before)
        })
    })

    it("brings production's drifted policies back to staging's", async () => {
        await inTransaction(async (c) => {
            const staging = await snapshot(c)
            await c.query(`
              drop policy "sor_read" on public.sales_opportunities;
              create policy "sor_read" on public.sales_opportunities for select to authenticated using (true);
              drop policy "sor_log_read" on public.sales_opportunity_logs;
              create policy "sor_log_read" on public.sales_opportunity_logs for select to authenticated using (true);
              drop policy "sales_opportunity_members_read" on public.sales_opportunity_members;
              create policy "sales_opportunity_members_read" on public.sales_opportunity_members for select to authenticated using (true);
              create policy "Allow all read" on public.system_audit_logs for select to public using (true);
              create policy "hr_read_system_audit_logs" on public.system_audit_logs for select to public using (true);
              create policy "Authenticated users can insert task activity" on public.task_activity for insert to authenticated with check (true);
              create policy "Authenticated users can read task activity" on public.task_activity for select to authenticated using (true);
            `)
            expect(await snapshot(c)).not.toEqual(staging)
            await c.query(MIGRATION)
            expect(await snapshot(c)).toEqual(staging)
        })
    })
})
