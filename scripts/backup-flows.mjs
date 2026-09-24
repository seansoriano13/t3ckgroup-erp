#!/usr/bin/env node
/**
 * Backs up every Sales Flow (live canvas state, all Flow Snapshots, access
 * settings) to one JSON file per flow. Byte-stable: an unchanged flow rewrites
 * the same file, so committing the output gives per-change history in git.
 * Runs daily in .github/workflows/backup-flows.yml.
 *
 *   node scripts/backup-flows.mjs [--env staging|prod] [--out backups/flows]
 *
 * Reads STAGING_DB_URL / PROD_DB_URL from .env.local or the environment.
 * Read-only against the database. Files for flows deleted from the database
 * are kept, never pruned: that is the point.
 */
import pg from "pg"
import { mkdirSync, writeFileSync } from "fs"
import { fileURLToPath } from "url"
import { dirname, join, resolve } from "path"
import { loadDotEnvLocal } from "./lib/seedShared.mjs"
import { backupFileName, readFlowBundle, stableJson } from "./lib/flowBackup.mjs"

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..")
const args = process.argv.slice(2)
const opt = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback)
const env = opt("--env", "staging")
const outDir = resolve(repoRoot, opt("--out", "backups/flows"))
const envVar = { staging: "STAGING_DB_URL", prod: "PROD_DB_URL" }[env]
if (!envVar) throw new Error(`Unknown --env "${env}"`)
const url = loadDotEnvLocal(repoRoot)[envVar] ?? process.env[envVar]
if (!url) throw new Error(`Missing ${envVar}`)

const client = new pg.Client({ connectionString: url, ssl: url.includes("127.0.0.1") ? false : { rejectUnauthorized: false } })
await client.connect()
try {
    // One snapshot-consistent read so a flow is never captured half-edited.
    await client.query("begin isolation level repeatable read read only")
    const { rows: flows } = await client.query("select * from public.sales_flows order by id")
    if (flows.length === 0) throw new Error("No flows found; refusing to write an empty backup (wrong database?).")
    mkdirSync(outDir, { recursive: true })
    for (const flow of flows) {
        const bundle = await readFlowBundle(client, flow)
        const file = backupFileName(bundle.saleType, flow)
        writeFileSync(join(outDir, file), stableJson(bundle))
        console.log(`✔ ${file}: ${bundle.tables.flow_stages.length} stages, ${bundle.tables.flow_snapshots.length} snapshots`)
    }
    await client.query("commit")
} finally {
    await client.end()
}
