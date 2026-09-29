#!/usr/bin/env node
/**
 * #419 (#414) CUTOVER STEP, after transfer-group-task-templates.mjs: Government's
 * "Project Delivery" Stage Action creates a Group Task from a template by id. The
 * flow arrives pointing at staging's thin "Delivery" (copied as "Delivery (staging)").
 * Prod's own "DELIVERY" is the real one, so point the action, and the Government
 * flow snapshots that carry the same id, at it.
 *
 * Stops (writes nothing) unless the action currently points at a template named
 * "Delivery (staging)" and the target has exactly one template named "DELIVERY".
 * Already pointing at DELIVERY is a no-op. One transaction; dry run by default.
 *
 * Usage:
 *   node scripts/repoint-government-delivery-template.mjs --to prod
 *   node scripts/repoint-government-delivery-template.mjs --to prod --apply
 * `--to-url <url>` points the target somewhere else (a prod clone).
 */
import pg from "pg"
import { fileURLToPath } from "url"
import { dirname, join } from "path"
import { loadDotEnvLocal } from "./lib/seedShared.mjs"

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..")
const ENV_VARS = { staging: "STAGING_DB_URL", prod: "PROD_DB_URL" }

const args = { apply: false }
const argv = process.argv.slice(2)
for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--to") args.to = argv[++i]
    else if (argv[i] === "--to-url") args.toUrl = argv[++i]
    else if (argv[i] === "--apply") args.apply = true
}

function fail(message) {
    console.error(`\n✖ ${message}\n`)
    process.exit(1)
}

let url = args.toUrl
if (!url) {
    const envVar = ENV_VARS[args.to]
    if (!envVar) fail("Usage: node scripts/repoint-government-delivery-template.mjs --to staging|prod [--to-url <url>] [--apply]")
    url = loadDotEnvLocal(repoRoot)[envVar] ?? process.env[envVar]
    if (!url) fail(`Missing ${envVar}. Set it in .env.local or the environment.`)
}

const client = new pg.Client({ connectionString: url, ssl: url.includes("127.0.0.1") ? false : { rejectUnauthorized: false } })
await client.connect()
try {
    console.log(`${args.apply ? "APPLYING" : "DRY RUN (rolls back; pass --apply to commit)"}: ${args.toUrl ? "--to-url" : args.to}`)
    await client.query("begin")
    try {
        const { rows: real } = await client.query("select id from public.group_task_templates where name = 'DELIVERY'")
        if (real.length !== 1) throw new Error(`Target has ${real.length} templates named "DELIVERY"; expected exactly 1.`)
        const newId = real[0].id

        const { rows: actions } = await client.query(
            `select a.id, a.config->>'templateId' as template_id, f.id as flow_id
               from public.flow_stage_actions a
               join public.flow_stages s on s.id = a.stage_id
               join public.sales_flows f on f.id = s.flow_id
               join public.sale_types st on st.id = f.sale_type_id
              where st.name = 'Government' and s.name = 'Project Delivery' and a.kind = 'create_group_task'
                and a.archived_at is null`,
        )
        if (actions.length !== 1) throw new Error(`Found ${actions.length} Government "Project Delivery" group-task actions; expected 1.`)
        const { id: actionId, template_id: oldId, flow_id: flowId } = actions[0]
        if (oldId === newId) {
            console.log("  = already points at DELIVERY, nothing to do")
        } else {
            const { rows: [old] } = await client.query("select name from public.group_task_templates where id = $1", [oldId])
            if (old?.name !== "Delivery (staging)") {
                throw new Error(`The action points at ${old ? `"${old.name}"` : `unknown template ${oldId}`}; expected "Delivery (staging)". Not touching it.`)
            }
            await client.query(
                "update public.flow_stage_actions set config = jsonb_set(config, '{templateId}', to_jsonb($2::text)) where id = $1",
                [actionId, newId],
            )
            const { rowCount } = await client.query(
                `update public.flow_snapshots set snapshot_data = replace(snapshot_data::text, $2, $3)::jsonb
                  where flow_id = $1 and snapshot_data::text like '%' || $2 || '%'`,
                [flowId, oldId, newId],
            )
            console.log(`  ✔ Project Delivery: "Delivery (staging)" → "DELIVERY" (action + ${rowCount} snapshot(s))`)
        }
        await client.query(args.apply ? "commit" : "rollback")
    } catch (err) {
        await client.query("rollback")
        fail(`${err.message}\n  Nothing was written.`)
    }
    console.log(args.apply ? "\nCommitted." : "\nRolled back (dry run).")
} finally {
    await client.end()
}
