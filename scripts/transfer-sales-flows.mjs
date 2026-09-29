#!/usr/bin/env node
/**
 * #331 (release/2026-09, #325): carry named Sales Flows from one database to
 * another as their latest Flow Snapshot. CUTOVER STEP: see
 * docs/production-cutover-runbook.md for where it runs.
 *
 * The product has no file import/export, but `flow_snapshots.snapshot_data` is
 * already a complete, portable payload. Per flow this copies three rows with
 * their UUIDs kept (sale_types, sales_flows, flow_snapshots), then calls
 * `restore_flow_snapshot` on the target, which builds Stages, edges, Stage
 * Actions, Stage Conditions, Stage Fields, form fields and Follow-ups in one
 * transaction.
 *
 * References: every uuid in the snapshot (and the flow's own row) is looked up
 * in the source. Employees must already exist on the target under the same id
 * (staging's 45 all do on production); a missing one stops the run. Employee
 * Groups the target lacks are copied first, members and teams included.
 * Access configuration is not carried: the target ends with no
 * flow_access_settings for these flows.
 *
 * Everything on the target runs in ONE transaction. Without --apply it rolls
 * back at the end, so the default run is a full rehearsal that changes nothing.
 *
 * Usage:
 *   node scripts/transfer-sales-flows.mjs --from staging --to prod Government Outright
 *   node scripts/transfer-sales-flows.mjs --from staging --to prod --apply Government Outright
 *   node scripts/transfer-sales-flows.mjs --from staging --to prod --replace --apply Government
 *     --replace: first delete the target's same-id Sale Type (and its flow) in the same
 *     transaction. Refused if the target has any SORs on it.
 *
 * Reads STAGING_DB_URL / PROD_DB_URL from .env.local or the environment, the
 * same connections scripts/db-ledger-check.mjs uses. `--to-url <url>` points
 * the target somewhere else (a production clone branch for the rehearsal).
 */
import pg from "pg"
import { fileURLToPath } from "url"
import { dirname, join } from "path"
import { loadDotEnvLocal } from "./lib/seedShared.mjs"
import { collectUuids, classifyReferences } from "./lib/flowTransfer.mjs"

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..")
const ENV_VARS = { staging: "STAGING_DB_URL", prod: "PROD_DB_URL" }

function parseArgs(argv) {
    const args = { names: [], apply: false }
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i]
        if (a === "--from") args.from = argv[++i]
        else if (a === "--to") args.to = argv[++i]
        else if (a === "--to-url") args.toUrl = argv[++i]
        else if (a === "--apply") args.apply = true
        else if (a === "--replace") args.replace = true
        else args.names.push(a)
    }
    return args
}

function fail(message) {
    console.error(`\n✖ ${message}\n`)
    process.exit(1)
}

function urlFor(envName) {
    const envVar = ENV_VARS[envName]
    if (!envVar) fail(`Unknown environment "${envName}". Use staging or prod.`)
    const url = loadDotEnvLocal(repoRoot)[envVar] ?? process.env[envVar]
    if (!url) fail(`Missing ${envVar}. Set it in .env.local or the environment.`)
    return url
}

async function connect(url) {
    const client = new pg.Client({ connectionString: url, ssl: url.includes("127.0.0.1") ? false : { rejectUnauthorized: false } })
    await client.connect()
    return client
}

const columnCache = new Map()
async function columnsOf(client, table) {
    if (!columnCache.has(table)) {
        const { rows } = await client.query(
            "select column_name from information_schema.columns where table_schema = 'public' and table_name = $1",
            [table],
        )
        columnCache.set(table, new Set(rows.map((r) => r.column_name)))
    }
    return columnCache.get(table)
}

/** Insert `row` into the target, keeping only columns the target has. Json values go as json. */
async function insertRow(client, table, row, overrides = {}) {
    const targetColumns = await columnsOf(client, table)
    const merged = { ...row, ...overrides }
    const cols = Object.keys(merged).filter((c) => targetColumns.has(c))
    const values = cols.map((c) => {
        const v = merged[c]
        return v !== null && typeof v === "object" && !(v instanceof Date) ? JSON.stringify(v) : v
    })
    const placeholders = cols.map((_, i) => `$${i + 1}`)
    await client.query(`insert into public.${table} (${cols.join(", ")}) values (${placeholders.join(", ")})`, values)
}

async function idSet(client, table, ids) {
    if (ids.length === 0) return new Set()
    const { rows } = await client.query(`select id from public.${table} where id = any($1::uuid[])`, [ids])
    return new Set(rows.map((r) => r.id))
}

async function readSourceFlow(source, name) {
    const { rows: types } = await source.query(
        "select * from public.sale_types where name = $1 and archived_at is null",
        [name],
    )
    if (types.length !== 1) fail(`Source has ${types.length} active Sale Types named "${name}"; expected exactly 1.`)
    const saleType = types[0]

    const { rows: flows } = await source.query("select * from public.sales_flows where sale_type_id = $1", [saleType.id])
    if (flows.length !== 1) fail(`"${name}" has ${flows.length} Sales Flows on the source; expected 1.`)
    const flow = flows[0]

    const { rows: snapshots } = await source.query(
        `select * from public.flow_snapshots where flow_id = $1
          order by version desc, version_minor desc nulls last limit 1`,
        [flow.id],
    )
    if (snapshots.length !== 1) fail(`"${name}" has never been published: no Flow Snapshot to carry.`)
    return { name, saleType, flow, snapshot: snapshots[0] }
}

async function copyGroups(source, target, groupIds) {
    for (const groupId of groupIds) {
        const { rows: [group] } = await source.query("select * from public.employee_groups where id = $1", [groupId])
        const { rows: clash } = await target.query(
            "select id from public.employee_groups where archived_at is null and lower(trim(name)) = lower(trim($1))",
            [group.name],
        )
        if (group.archived_at == null && clash.length > 0) {
            throw new Error(`Target already has an active Employee Group named "${group.name}" under a different id (${clash[0].id}).`)
        }
        await insertRow(target, "employee_groups", group)

        const { rows: members } = await source.query("select * from public.employee_group_members where group_id = $1", [groupId])
        const memberEmployees = await idSet(target, "employees", members.map((m) => m.employee_id))
        const missing = members.filter((m) => !memberEmployees.has(m.employee_id)).map((m) => m.employee_id)
        if (missing.length) throw new Error(`Employee Group "${group.name}" has members the target lacks: ${missing.join(", ")}`)
        for (const member of members) await insertRow(target, "employee_group_members", member)

        const { rows: teams } = await source.query("select * from public.employee_group_teams where group_id = $1", [groupId])
        for (const team of teams) await insertRow(target, "employee_group_teams", team)
        console.log(`  + Employee Group "${group.name}" (${members.length} members, ${teams.length} teams)`)
    }
}

async function countsFor(target, flowId) {
    const q = async (sql) => Number((await target.query(sql, [flowId])).rows[0].n)
    const stagesOf = "select id from public.flow_stages where flow_id = $1"
    return {
        stages: await q(`select count(*) n from public.flow_stages where flow_id = $1`),
        edges: await q(`select count(*) n from public.flow_edges where flow_id = $1`),
        actions: await q(`select count(*) n from public.flow_stage_actions where stage_id in (${stagesOf})`),
        conditions: await q(`select count(*) n from public.stage_conditions where stage_id in (${stagesOf})`),
        fields: await q(`select count(*) n from public.flow_stage_fields where stage_id in (${stagesOf})`),
        formFields: await q(`select count(*) n from public.flow_form_fields where flow_id = $1`),
        followUps: await q(`select count(*) n from public.flow_stage_follow_ups where stage_id in (${stagesOf})`),
        accessSettings: await q(`select count(*) n from public.flow_access_settings where flow_id = $1`),
    }
}

async function transferOne(source, target, item, replace) {
    const { name, saleType, flow, snapshot } = item

    if (replace && (await idSet(target, "sale_types", [saleType.id])).size) {
        // A stale copy of the same flow (same ids). Refuse if anything real hangs off it:
        // sales_opportunities.sale_type_id is RESTRICT, the flow's own tables cascade.
        const { rows: [{ n }] } = await target.query("select count(*) n from public.sales_opportunities where sale_type_id = $1", [saleType.id])
        if (Number(n) > 0) throw new Error(`--replace: target Sale Type "${name}" has ${n} SORs; refusing to delete it.`)
        const before = await countsFor(target, flow.id)
        await target.query("delete from public.sale_types where id = $1", [saleType.id])
        console.log(`  - replaced stale "${name}" on target (${before.stages} Stages, ${before.edges} edges deleted)`)
    }

    if ((await idSet(target, "sale_types", [saleType.id])).size) throw new Error(`Target already has Sale Type ${saleType.id} ("${name}").`)
    const { rows: nameClash } = await target.query(
        "select id from public.sale_types where archived_at is null and name = $1",
        [name],
    )
    if (nameClash.length) throw new Error(`Target already has an active Sale Type named "${name}" (${nameClash[0].id}).`)

    // What the snapshot, flow and Sale Type rows point at (created_by etc. too).
    const referenced = collectUuids([snapshot, flow, saleType])
    const ids = [...referenced]
    const refs = classifyReferences({
        referenced,
        sourceEmployeeIds: await idSet(source, "employees", ids),
        sourceGroupIds: await idSet(source, "employee_groups", ids),
        targetEmployeeIds: await idSet(target, "employees", ids),
        targetGroupIds: await idSet(target, "employee_groups", ids),
    })
    if (refs.missingEmployeeIds.length) {
        throw new Error(`"${name}" references employees the target doesn't have: ${refs.missingEmployeeIds.join(", ")}`)
    }
    await copyGroups(source, target, refs.groupIdsToCopy)

    // The flow lands as an empty draft (restore refuses a locked flow and
    // sets won_stage_id itself), then takes the source's state afterwards.
    await insertRow(target, "sale_types", saleType)
    await insertRow(target, "sales_flows", flow, { state: "draft", won_stage_id: null, locked_at: null, locked_by: null })
    await insertRow(target, "flow_snapshots", snapshot)

    await target.query("select public.restore_flow_snapshot($1, $2)", [flow.id, snapshot.id])
    await target.query(
        "update public.sales_flows set state = $2, locked_at = $3, locked_by = $4 where id = $1",
        [flow.id, flow.state, flow.locked_at, flow.locked_by],
    )

    const counts = await countsFor(target, flow.id)
    if (counts.accessSettings !== 0) throw new Error(`"${name}" ended with ${counts.accessSettings} flow_access_settings rows; expected 0.`)
    console.log(
        `  ✔ ${name} v${snapshot.version}${snapshot.version_minor != null ? "." + snapshot.version_minor : ""}: ` +
        `${counts.stages} Stages, ${counts.edges} edges, ${counts.actions} actions, ${counts.conditions} conditions, ` +
        `${counts.fields} Stage Fields, ${counts.formFields} form fields, ${counts.followUps} follow-ups`,
    )
}

async function main() {
    const args = parseArgs(process.argv.slice(2))
    if (!args.from || !(args.to || args.toUrl) || args.names.length === 0) {
        fail("Usage: node scripts/transfer-sales-flows.mjs --from staging --to prod [--to-url <url>] [--apply] <Flow name>...")
    }
    const sourceUrl = urlFor(args.from)
    const targetUrl = args.toUrl ?? urlFor(args.to)
    if (sourceUrl === targetUrl) fail("Source and target are the same database.")

    const source = await connect(sourceUrl)
    const target = await connect(targetUrl)
    try {
        const items = []
        for (const name of args.names) items.push(await readSourceFlow(source, name))

        console.log(`${args.apply ? "APPLYING" : "DRY RUN (rolls back; pass --apply to commit)"}: ${args.from} → ${args.toUrl ? "--to-url" : args.to}`)
        await target.query("begin")
        try {
            for (const item of items) await transferOne(source, target, item, args.replace)
            await target.query(args.apply ? "commit" : "rollback")
        } catch (err) {
            await target.query("rollback")
            fail(`${err.message}\n  Nothing was written to the target.`)
        }
        console.log(args.apply ? "\nCommitted." : "\nRolled back (dry run).")
    } finally {
        await source.end()
        await target.end()
    }
}

await main()
