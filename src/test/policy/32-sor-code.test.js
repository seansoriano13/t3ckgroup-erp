/**
 * SOR Code (`SOR-357`) — the SOR's reference, stored as a generated column
 * over `serial_no` by 20260930270000_sor_code.sql. These prove it can't be
 * written, can't drift from `serial_no`, and that `serial_no` itself can no
 * longer be rewritten underneath a code people have already quoted.
 *
 * Seam A, direct SQL — a schema and trigger question, not a permission one.
 * Each write runs inside a rolled-back transaction.
 */
import { describe, it, expect } from "vitest"
import { sql } from "./support/stack.js"

async function inRollback(fn) {
    const client = await sql().connect()
    try {
        await client.query("begin")
        return await fn(client)
    } finally {
        await client.query("rollback")
        client.release()
    }
}

describe("sales_opportunities.sor_code", () => {
    it("is SOR- plus serial_no, unpadded, on every row", async () => {
        const { rows } = await sql().query(
            `select count(*)::int as mismatched
               from public.sales_opportunities
              where sor_code is distinct from 'SOR-' || serial_no::text`,
        )
        expect(rows).toEqual([{ mismatched: 0 }])
    })

    it("is a stored generated column with a unique constraint", async () => {
        const { rows } = await sql().query(
            `select is_generated, generation_expression is not null as has_expr
               from information_schema.columns
              where table_schema = 'public'
                and table_name = 'sales_opportunities'
                and column_name = 'sor_code'`,
        )
        expect(rows).toEqual([{ is_generated: "ALWAYS", has_expr: true }])

        const { rows: constraints } = await sql().query(
            `select pg_get_constraintdef(oid) as def
               from pg_constraint
              where conrelid = 'public.sales_opportunities'::regclass
                and conname = 'sales_opportunities_sor_code_key'`,
        )
        expect(constraints).toEqual([{ def: "UNIQUE (sor_code)" }])
    })

    it("cannot be written directly", async () => {
        await expect(
            inRollback((c) => c.query(`update public.sales_opportunities set sor_code = 'SOR-X'`)),
        ).rejects.toThrow(/sor_code/)
    })

    it("refuses to rewrite serial_no", async () => {
        const { rows } = await sql().query(`select id from public.sales_opportunities limit 1`)
        if (rows.length === 0) return
        await expect(
            inRollback((c) =>
                c.query(
                    `update public.sales_opportunities set serial_no = serial_no + 1000000 where id = $1`,
                    [rows[0].id],
                ),
            ),
        ).rejects.toThrow(/serial_no is immutable/)
    })

    it("still allows ordinary updates to the same row", async () => {
        const { rows } = await sql().query(`select id from public.sales_opportunities limit 1`)
        if (rows.length === 0) return
        const updated = await inRollback((c) =>
            c.query(
                `update public.sales_opportunities set project_title = project_title
                  where id = $1 returning sor_code`,
                [rows[0].id],
            ),
        )
        expect(updated.rows[0].sor_code).toMatch(/^SOR-\d+$/)
    })
})
