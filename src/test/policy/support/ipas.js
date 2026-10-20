/**
 * Cleaning up IPAS fixtures.
 *
 * `ipas_events` is append-only for every role, the service role included: a
 * BEFORE UPDATE/DELETE/TRUNCATE trigger refuses, and `ipas.id` cascades into it.
 * That is the rule under test, so a fixture can't be removed by the front door.
 * `session_replication_role = replica` switches off ordinary triggers (and the
 * foreign-key cascade with them) for one transaction on the superuser
 * connection this tier already uses for seeding. Nothing outside tests does it.
 *
 * Children go first and by hand, because the cascade is off too.
 */
import { serviceClient, sql } from "./stack.js"
import { ids as castIds } from "./cast.js"

const CHILDREN = [
    ["ipas_events", "ipas_id"],
    ["ipas_signoffs", "ipas_id"],
    ["ipas_payments", "ipas_id"],
    ["ipas_charges", "ipas_id"],
    ["ipas_bank_details", "ipas_id"],
    ["ipas_documents", "ipas_id"],
    ["ipas_sors", "ipas_id"],
]

/**
 * Removes the given IPAS, with their history and SORs.
 * `ids` is a list of ipas ids.
 */
export async function purgeIpas(ids) {
    if (!ids?.length) return
    await withoutTriggers(async (client) => {
        for (const [table, column] of CHILDREN) {
            await client.query(`delete from public.${table} where ${column} = any($1::uuid[])`, [ids])
        }
        await client.query(`delete from public.ipas where id = any($1::uuid[])`, [ids])
    })
}

/**
 * Removes every IPAS the fixture's employees raised, cancelled or acted on,
 * whatever test left it behind. Used by teardown, before the employees go.
 */
export async function purgeFixtureIpas(emailLike) {
    await withoutTriggers(async (client) => {
        // The signer-list log is append-only and points at employees twice.
        await client.query(
            `delete from public.ipas_signer_list_log
              where employee_id in (select id from public.employees where email like $1)
                 or actor_id in (select id from public.employees where email like $1)`,
            [emailLike],
        )
        const { rows } = await client.query(
            `with mine as (select id from public.employees where email like $1)
             select id from public.ipas
              where created_by in (select id from mine) or cancelled_by in (select id from mine)
             union
             select ipas_id from public.ipas_events where actor_id in (select id from mine)`,
            [emailLike],
        )
        const ids = rows.map((r) => r.id ?? r.ipas_id)
        for (const [table, column] of CHILDREN) {
            await client.query(`delete from public.${table} where ${column} = any($1::uuid[])`, [ids])
        }
        await client.query(`delete from public.ipas where id = any($1::uuid[])`, [ids])
    })
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

/**
 * Raises an IPAS the way the app now does (#550): the server asks Odoo itself and
 * calls `ipas_raise_from_odoo` for the caller with its own verdict and copy. Odoo
 * is faked here by passing the answer: `p_odoo_copy` is what Odoo "said", and
 * `p_verdict` is 'found' (default), 'not_found' or 'unavailable'. Same argument
 * names as the old `ipas_create`; the result is `{ data, error }`.
 */
export function raiseIpas(actorId, args) {
    const { p_odoo_copy = null, p_verdict = "found", ...rest } = args
    return serviceClient().rpc("ipas_raise_from_odoo", {
        p_actor: actorId,
        ...rest,
        p_verdict,
        p_odoo_copy,
    })
}

/** Raises as the purchaser (the cast's `outsider`, who holds Purchasing in these files). */
export const raiseAsPurchaser = (args) => raiseIpas(castIds.outsider, args)
