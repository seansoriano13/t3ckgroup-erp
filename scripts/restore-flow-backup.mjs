#!/usr/bin/env node
/**
 * Restores a flow from a backups/flows/*.json file (see backup-flows.mjs),
 * original UUIDs kept. Refuses if the flow id already exists on the target.
 * Runs in one transaction; without --apply it rolls back (rehearsal).
 *
 *   node scripts/restore-flow-backup.mjs --to staging flows/government-ab12cd34.json
 *   node scripts/restore-flow-backup.mjs --to staging --apply flows/government-ab12cd34.json
 *
 * `--to-url <url>` targets another database (a fresh branch, for a rehearsal).
 * Employees / Employee Groups the flow references must exist on the target.
 */
import pg from "pg"
import { readFileSync } from "fs"
import { fileURLToPath } from "url"
import { dirname, join } from "path"
import { loadDotEnvLocal } from "./lib/seedShared.mjs"
import { restoreBundle } from "./lib/flowBackup.mjs"

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..")
const args = process.argv.slice(2)
const apply = args.includes("--apply")
const opt = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined)
const file = args.find((a, i) => !a.startsWith("--") && !["--to", "--to-url"].includes(args[i - 1]))
const envVar = { staging: "STAGING_DB_URL", prod: "PROD_DB_URL" }[opt("--to")]
const url = opt("--to-url") ?? (envVar && (loadDotEnvLocal(repoRoot)[envVar] ?? process.env[envVar]))
if (!file || !url) {
    console.error("Usage: node scripts/restore-flow-backup.mjs --to staging|prod (or --to-url <url>) [--apply] <backup.json>")
    process.exit(1)
}

const bundle = JSON.parse(readFileSync(file, "utf8"))
if (bundle.format !== 1) throw new Error(`Unsupported backup format ${bundle.format}`)
const client = new pg.Client({ connectionString: url, ssl: url.includes("127.0.0.1") ? false : { rejectUnauthorized: false } })
await client.connect()
try {
    await client.query("begin")
    await restoreBundle(client, bundle)
    await client.query(apply ? "commit" : "rollback")
    const t = bundle.tables
    console.log(`${apply ? "Restored" : "Dry run OK (rolled back)"}: ${bundle.saleType?.name ?? bundle.flow.id}: ${t.flow_stages.length} stages, ${t.flow_edges.length} edges, ${t.flow_snapshots.length} snapshots`)
} catch (err) {
    await client.query("rollback").catch(() => {})
    console.error(`✖ ${err.message}\n  Nothing was written.`)
    process.exitCode = 1
} finally {
    await client.end()
}
