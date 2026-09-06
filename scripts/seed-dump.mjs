#!/usr/bin/env node
/**
 * Pulls a snapshot of staging's data, sanitizes it (src/lib/seedSanitize.js),
 * and writes it to a gitignored cache file — the source scripts/seed-restore.mjs
 * loads into the local database. Issue #87: local seeding comes from a cached
 * file rather than a live pull, so `supabase db reset` stays fast and
 * yesterday's reproduction is still reproducible today. Re-run this deliberately
 * (`pnpm db:seed:dump`) to refresh it.
 *
 * Reads STAGING_DB_URL from .env.local. Never touches production, and never
 * writes anywhere but the cache file below.
 */
import pg from "pg"
import { writeFileSync, mkdirSync } from "fs"
import { fileURLToPath } from "url"
import { dirname, join } from "path"
import { SANITIZERS } from "../src/lib/seedSanitize.js"
import { SEED_TABLES, loadDotEnvLocal } from "./lib/seedShared.mjs"

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(__dirname, "..")
const cacheDir = join(repoRoot, "supabase", ".seed")
const cacheFile = join(cacheDir, "staging-dump.json")

async function dumpTable(client, schema, table) {
  const sanitize = SANITIZERS[schema === "auth" ? `${schema}.${table}` : table]
  const { rows } = await client.query(`select * from ${schema}."${table}"`)
  return sanitize ? rows.map(sanitize) : rows
}

async function main() {
  const env = loadDotEnvLocal(repoRoot)
  const dbUrl = env.STAGING_DB_URL
  if (!dbUrl) {
    console.error("Missing STAGING_DB_URL in .env.local.")
    process.exit(1)
  }

  const client = new pg.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } })
  await client.connect()

  const dump = { dumpedAt: new Date().toISOString(), authUsers: [], tables: {} }

  console.log("Dumping auth.users...")
  dump.authUsers = await dumpTable(client, "auth", "users")

  for (const table of SEED_TABLES) {
    process.stdout.write(`- [${table}]... `)
    try {
      const rows = await dumpTable(client, "public", table)
      dump.tables[table] = rows
      console.log(`${rows.length} rows`)
    } catch (err) {
      console.log(`skipped (${err.message})`)
    }
  }

  await client.end()

  mkdirSync(cacheDir, { recursive: true })
  writeFileSync(cacheFile, JSON.stringify(dump, null, 2))
  console.log(`\nWrote ${cacheFile}`)
  console.log("Run 'pnpm db:seed:restore' to load it into the local database.")
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
