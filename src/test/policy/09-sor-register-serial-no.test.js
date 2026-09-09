/**
 * Issue #179 — `serial_no` was the SOR Register's first column and default
 * sort in production only. Nothing under supabase/migrations ever created
 * it, so staging never had it and the register sorted differently
 * depending on where you looked. Reconciled by
 * 20260909140000_reconcile_sor_register_serial_no.sql; this is the
 * assertion that proves the drift closed.
 *
 * Seam A, direct SQL only — this is a schema shape question, not a
 * permission one.
 */
import { describe, it, expect } from "vitest"
import { sql } from "./support/stack.js"

describe("sales_opportunities.serial_no is reconciled", () => {
    it("exists, is a not-null identity column, and is unique", async () => {
        const { rows } = await sql().query(
            `select is_nullable, is_identity
                 from information_schema.columns
                where table_schema = 'public'
                  and table_name = 'sales_opportunities'
                  and column_name = 'serial_no'`,
        )
        expect(rows).toEqual([{ is_nullable: "NO", is_identity: "YES" }])

        const { rows: constraints } = await sql().query(
            `select pg_get_constraintdef(oid) as def
                 from pg_constraint
                where conrelid = 'public.sales_opportunities'::regclass
                  and conname = 'sales_opportunities_serial_no_key'`,
        )
        expect(constraints).toEqual([{ def: "UNIQUE (serial_no)" }])
    })
})
