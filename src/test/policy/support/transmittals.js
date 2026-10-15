/**
 * Cleaning up Transmittal and Packing List fixtures (#252 to #257).
 *
 * A Transmittal and a Packing List are never deleted by the front door: triggers
 * refuse it, and the stages, lines and boxes hang off them. Teardown removes
 * what the fixture's employees raised by the one route that switches the
 * triggers off, the superuser connection this tier already uses for seeding,
 * as support/ipas.js does. Children go first, by hand, because the cascade is
 * off too. Teardown runs this before the IPAS and the employees go.
 */
import { sql } from "./stack.js"

/** Every table holding a Transmittal's rows is keyed by `transmittal_id`; they go before the slips. */
async function transmittalChildTables(client) {
    const { rows } = await client.query(
        `select table_name from information_schema.columns
          where table_schema = 'public' and column_name = 'transmittal_id' and table_name <> 'transmittals'`,
    )
    return rows.map((r) => r.table_name)
}

/** Removes the Transmittals and Packing Lists the fixture's employees made, with everything under them. */
export async function purgeFixtureTransmittals(emailLike) {
    const client = await sql().connect()
    try {
        await client.query("begin")
        await client.query("set local session_replication_role = replica")

        const { rows: slips } = await client.query(
            `select id from public.transmittals
              where prepared_by in (select id from public.employees where email like $1)`,
            [emailLike],
        )
        const slipIds = slips.map((r) => r.id)
        for (const table of await transmittalChildTables(client)) {
            await client.query(`delete from public.${table} where transmittal_id = any($1::uuid[])`, [slipIds])
        }
        await client.query(`delete from public.transmittals where id = any($1::uuid[])`, [slipIds])

        const { rows: lists } = await client.query(
            `select id from public.packing_lists
              where created_by in (select id from public.employees where email like $1)`,
            [emailLike],
        )
        const listIds = lists.map((r) => r.id)
        await client.query(
            `delete from public.packing_list_contents
              where box_id in (select id from public.packing_list_boxes where packing_list_id = any($1::uuid[]))`,
            [listIds],
        )
        await client.query(`delete from public.packing_list_boxes where packing_list_id = any($1::uuid[])`, [listIds])
        await client.query(
            `delete from public.pms_handoff_events where record_type = 'packing_list' and record_id = any($1::uuid[])`,
            [listIds],
        )
        await client.query(`delete from public.packing_lists where id = any($1::uuid[])`, [listIds])

        // The event trails the fixture's employees acted in, and evidence they uploaded.
        await client.query(
            `delete from public.pms_handoff_events where actor_id in (select id from public.employees where email like $1)`,
            [emailLike],
        )
        await client.query(
            `delete from public.pms_evidence where uploaded_by in (select id from public.employees where email like $1)`,
            [emailLike],
        )

        // Staff list memberships the tier seeded; the signer-list log keeps its own history.
        await client.query(
            `delete from public.ipas_signer_lists
              where employee_id in (select id from public.employees where email like $1)`,
            [emailLike],
        )

        await client.query("commit")
    } catch (error) {
        await client.query("rollback").catch(() => {})
        throw error
    } finally {
        client.release()
    }
}
