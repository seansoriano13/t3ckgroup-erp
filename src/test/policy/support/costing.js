/**
 * Cleaning up Costing Matrix fixtures (#267).
 *
 * `costing_events` is append-only for every role, the service role included: a
 * BEFORE UPDATE/DELETE/TRUNCATE trigger refuses, and `costing_matrices.id`
 * cascades into it. That is the rule under test, so a fixture can't be removed
 * by the front door. `session_replication_role = replica` switches off ordinary
 * triggers (and the foreign-key cascade with them) for one transaction on the
 * superuser connection this tier already uses for seeding. Nothing outside tests
 * does it. Children go first and by hand, because the cascade is off too.
 *
 * Every later Costing Matrix table (components, costs, ...) is keyed back to the
 * matrix, so the table list below is read from `costing_tables`, not typed here.
 */
import { sql } from "./stack.js"

/** Deletes the matrices (and everything under them) for the given SOR ids, plus events the given actors wrote. */
async function purge(client, { sorIds = null, emailLike = null } = {}) {
    const { rows: registered } = await client.query(
        `select table_name, parent_table from public.costing_tables where table_name <> 'costing_matrices'`,
    )
    // Deepest first: a child's "belongs to this matrix" test looks through its
    // parent, which has to still be there.
    const parentOf = new Map(registered.map((t) => [t.table_name, t.parent_table]))
    const depth = (name) => (parentOf.get(name) ? 1 + depth(parentOf.get(name)) : 0)
    const tables = [...registered].sort((a, b) => depth(b.table_name) - depth(a.table_name) || a.table_name.localeCompare(b.table_name))
    const matrixFilter = []
    const args = []
    if (sorIds) {
        args.push(sorIds)
        matrixFilter.push(`opportunity_id = any($${args.length}::uuid[])`)
    }
    if (emailLike) {
        args.push(emailLike)
        matrixFilter.push(
            `opportunity_id in (select id from public.sales_opportunities
               where registered_by in (select id from public.employees where email like $${args.length})
                  or deal_owner_id in (select id from public.employees where email like $${args.length}))`,
        )
        matrixFilter.push(
            `id in (select matrix_id from public.costing_events
               where actor_id in (select id from public.employees where email like $${args.length}))`,
        )
    }
    if (matrixFilter.length === 0) return
    const { rows } = await client.query(`select id from public.costing_matrices where ${matrixFilter.join(" or ")}`, args)
    const matrixIds = rows.map((r) => r.id)

    // Money and child tables hang off the matrix directly or through a parent;
    // costing_matrix_filter writes the same "belongs to matrix $1" test the read uses.
    await client.query(`delete from public.costing_events where matrix_id = any($1::uuid[])`, [matrixIds])
    for (const { table_name: name } of tables) {
        const { rows: filter } = await client.query(`select public.costing_matrix_filter($1, 't') as f`, [name])
        for (const matrixId of matrixIds) {
            await client.query(`delete from public.${name} t where ${filter[0].f.replace("$1", `'${matrixId}'::uuid`)}`)
        }
    }
    await client.query(`delete from public.costing_matrices where id = any($1::uuid[])`, [matrixIds])
}

async function withoutTriggers(work) {
    const client = await sql().connect()
    try {
        await client.query("begin")
        await client.query("set local session_replication_role = replica")
        await work(client)
        await client.query("commit")
    } catch (error) {
        await client.query("rollback").catch(() => {})
        throw error
    } finally {
        client.release()
    }
}

/** Removes the Costing Matrices of the given SORs, with their history. */
export async function purgeCostingForSors(sorIds) {
    if (!sorIds?.length) return
    await withoutTriggers((client) => purge(client, { sorIds }))
}

/**
 * Removes every matrix on an SOR the fixture's employees registered or own, and
 * every matrix they acted on, whatever test left it behind. Used by teardown,
 * before the SORs and employees go.
 */
export async function purgeFixtureCosting(emailLike) {
    await withoutTriggers((client) => purge(client, { emailLike }))
}
