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
import { ids as castIds, castEmail } from "./cast.js"

const CHILDREN = [
    ["transmittal_ipas", "ipas_id"],
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
        await dropSlipsMadeByTheFixture(client)
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
        await dropSlipsMadeByTheFixture(client)
    })
}

/** The bare Transmittals `readyToSign` made for Logistics, once no IPAS points at them. */
async function dropSlipsMadeByTheFixture(client) {
    await client.query(
        `delete from public.transmittals t
          where t.entity = $1
            and not exists (select 1 from public.transmittal_ipas ti where ti.transmittal_id = t.id)`,
        [FIXTURE_SLIP_ENTITY],
    )
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

/**
 * Refresh-on-open as the server does it (#550): the odoo-po-ipas edge function reads
 * Odoo, then records the copy as the signed-in reader `who`. A signed-in caller can't
 * call `ipas_record_odoo_copy` itself any more. `args` are that RPC's arguments.
 */
export function recordOdooCopyAs(who, args) {
    return serviceClient().rpc("ipas_refresh_from_odoo", {
        p_actor_email: castEmail(who),
        p_ipas_id: args.p_ipas_id,
        p_odoo_copy: args.p_odoo_copy,
    })
}

const FIXTURE_SLIP_ENTITY = "policy-tier logistics fixture"
const FIXTURE_FILE = "https://example.test/policy-tier.pdf"

async function documentKind(label) {
    const { rows } = await sql().query(
        `select id from public.ipas_options where list = 'document_kind' and lower(btrim(label)) = lower($1)`,
        [label],
    )
    return rows[0].id
}

async function attachDocument(ipasId, label) {
    await sql().query(
        `insert into public.ipas_documents (ipas_id, kind_id, attachment_url)
         values ($1, $2, $3)
         on conflict (ipas_id, kind_id) where kind_id is not null
         do update set attachment_url = coalesce(public.ipas_documents.attachment_url, excluded.attachment_url)`,
        [ipasId, await documentKind(label), FIXTURE_FILE],
    )
}

/**
 * Gives an IPAS what a sign-off now asks for before it is given, so a test about something else can
 * sign without caring (#711 documents per section, #709 charges, #713 Logistics). Call it right
 * before `ipas_sign`; it does nothing for a sign-off that has no such rule, and it never signs.
 *
 *   screen 1 (stored 1)  the Proforma Invoice (import) or Quotation (Local)
 *   screen 2 (stored 3)  proof of payment on every payment; blank charges removed (#792)
 *   screen 3 (stored 6)  import: BL or Waybill, Packing List, Commercial Invoice, Freight Billing;
 *                        blank charges removed, charges with an amount given a file
 *   screen 4 (stored 7)  BIR 2307 (before Received)
 *   Logistics (stored 8) an Item Location, a Transmittal, and for an import the received date
 *
 * A test that is about the refusal itself calls `ipas_sign` without it.
 */
export async function readyToSign(ipasId, section, role) {
    try {
        await giveWhatTheSignoffAsks(ipasId, section, role)
    } catch {
        // A filed or cancelled IPAS refuses the extras; `ipas_sign` then gives its own refusal.
    }
}

async function giveWhatTheSignoffAsks(ipasId, section, role) {
    const { rows } = await sql().query(`select source from public.ipas where id = $1`, [ipasId])
    if (!rows.length) return
    const source = rows[0].source
    if (section === 1 && role === "prepared") {
        await attachDocument(ipasId, source === "import" ? "Proforma Invoice" : "Quotation (Local)")
    } else if (section === 3 && role === "prepared") {
        await sql().query(`update public.ipas_payments set proof_url = $2 where ipas_id = $1 and proof_url is null`, [ipasId, FIXTURE_FILE])
        await sql().query(`delete from public.ipas_charges where ipas_id = $1 and amount_php is null`, [ipasId])
    } else if (section === 6 && role === "prepared") {
        if (source === "import") {
            for (const label of ["BL or Waybill", "Packing List", "Commercial Invoice", "Freight Billing"]) {
                await attachDocument(ipasId, label)
            }
        }
        await sql().query(`delete from public.ipas_charges where ipas_id = $1 and amount_php is null`, [ipasId])
        await sql().query(
            `update public.ipas_charges set attachment_url = $2 where ipas_id = $1 and amount_php is not null and attachment_url is null`,
            [ipasId, FIXTURE_FILE],
        )
    } else if (section === 7 && role === "received") {
        await attachDocument(ipasId, "BIR 2307")
    } else if (section === 8 && role === "approved") {
        await placeGoods(ipasId, source)
    }
}

/** An Item Location, a bare Transmittal carrying the IPAS, and for an import the received date. */
async function placeGoods(ipasId) {
    const { rows: loc } = await sql().query(
        `select id from public.ipas_options where list = 'item_location' order by sort, label limit 1`,
    )
    await sql().query(
        `update public.ipas set item_location_id = coalesce(item_location_id, $2),
                arrived_in_whs_on = case when source = 'import' then coalesce(arrived_in_whs_on, current_date) end
          where id = $1`,
        [ipasId, loc[0].id],
    )
    const { rows: has } = await sql().query(`select 1 from public.transmittal_ipas where ipas_id = $1`, [ipasId])
    if (has.length) return
    const { rows: slip } = await sql().query(
        `insert into public.transmittals (origin, priority, entity, check_warehouse, item_location_id, prepared_by)
         values ('warehouse', 'low', $1, true, $2, $3) returning id`,
        [FIXTURE_SLIP_ENTITY, loc[0].id, castIds.outsider],
    )
    await sql().query(`insert into public.transmittal_ipas (transmittal_id, ipas_id) values ($1, $2)`, [slip[0].id, ipasId])
}
