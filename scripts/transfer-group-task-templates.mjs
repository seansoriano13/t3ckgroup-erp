#!/usr/bin/env node
/**
 * #419 (#414): copy ALL Group Task Templates (archived included) and their
 * members from one database to another. CUTOVER STEP: see
 * docs/production-cutover-runbook.md.
 *
 * Ids are kept. `created_by` and member `employee_id` are remapped by employee
 * NAME on the target. A missing or ambiguous name, or a target template with
 * the same name, stops the run and lists them. Nothing is guessed or nulled.
 * `--skip-existing` leaves templates the target already has (by name) alone and
 * lists them, instead of stopping. One transaction; without --apply it rolls back (dry run).
 *
 * Usage:
 *   node scripts/transfer-group-task-templates.mjs --from staging --to prod
 *   node scripts/transfer-group-task-templates.mjs --from staging --to prod --apply
 *
 * Reads STAGING_DB_URL / PROD_DB_URL like transfer-sales-flows.mjs.
 * `--to-url <url>` points the target somewhere else (a prod clone).
 */
import pg from "pg"
import { fileURLToPath } from "url"
import { dirname, join } from "path"
import { loadDotEnvLocal } from "./lib/seedShared.mjs"
import { planTemplateTransfer } from "./lib/groupTaskTemplateTransfer.mjs"

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..")
const ENV_VARS = { staging: "STAGING_DB_URL", prod: "PROD_DB_URL" }

function parseArgs(argv) {
    const args = { apply: false }
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i]
        if (a === "--from") args.from = argv[++i]
        else if (a === "--to") args.to = argv[++i]
        else if (a === "--to-url") args.toUrl = argv[++i]
        else if (a === "--apply") args.apply = true
        else if (a === "--skip-existing") args.skipExisting = true
        else if (a === "--rename-clashes") args.renameClashes = " (staging)"
        else if (a === "--tag-all") args.tagAll = " (staging)"
        else if (a === "--unarchive") args.unarchive = true
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

async function insertRow(client, table, row) {
    const cols = Object.keys(row)
    const values = cols.map((c) => {
        const v = row[c]
        return v !== null && typeof v === "object" && !(v instanceof Date) ? JSON.stringify(v) : v
    })
    await client.query(
        `insert into public.${table} (${cols.join(", ")}) values (${cols.map((_, i) => `$${i + 1}`).join(", ")})`,
        values,
    )
}

async function main() {
    const args = parseArgs(process.argv.slice(2))
    if (!args.from || !(args.to || args.toUrl)) {
        fail("Usage: node scripts/transfer-group-task-templates.mjs --from staging --to prod [--to-url <url>] [--skip-existing | --rename-clashes | --tag-all] [--unarchive] [--apply]")
    }
    const sourceUrl = urlFor(args.from)
    const targetUrl = args.toUrl ?? urlFor(args.to)
    if (sourceUrl === targetUrl) fail("Source and target are the same database.")

    const source = await connect(sourceUrl)
    const target = await connect(targetUrl)
    try {
        const { rows: templates } = await source.query("select * from public.group_task_templates order by created_at")
        const { rows: members } = await source.query("select * from public.group_task_template_members order by template_id, sort_order")
        const { rows: sourceEmployees } = await source.query("select id, name from public.employees")

        console.log(`${args.apply ? "APPLYING" : "DRY RUN (rolls back; pass --apply to commit)"}: ${args.from} → ${args.toUrl ? "--to-url" : args.to}`)
        await target.query("begin")
        try {
            const { rows: targetEmployees } = await target.query("select id, name from public.employees")
            const { rows: existing } = await target.query("select name from public.group_task_templates")
            const plan = planTemplateTransfer({
                templates, members, sourceEmployees, targetEmployees,
                targetTemplateNames: existing.map((r) => r.name),
                skipExisting: args.skipExisting, renameClashes: args.renameClashes, tagAll: args.tagAll, unarchive: args.unarchive,
            })
            if (plan.errors.length) throw new Error(plan.errors.join("\n  "))

            for (const t of plan.templates.filter((t, i) => t.name !== templates[templates.findIndex((s) => s.id === t.id)]?.name)) console.log(`  ~ renamed to "${t.name}"`)
            for (const name of plan.skipped) console.log(`  = skipped "${name}" (target already has it)`)
            for (const t of plan.templates) await insertRow(target, "group_task_templates", t)
            for (const m of plan.members) await insertRow(target, "group_task_template_members", m)
            const archived = plan.templates.filter((t) => t.archived_at != null).length
            console.log(`  ✔ ${plan.templates.length} templates (${archived} archived), ${plan.members.length} members`)
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
