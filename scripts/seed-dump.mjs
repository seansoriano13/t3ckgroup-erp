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
import { readFileSync, writeFileSync, mkdirSync } from "fs"
import { fileURLToPath } from "url"
import { dirname, join } from "path"
import { SANITIZERS } from "../src/lib/seedSanitize.js"

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(__dirname, "..")
const cacheDir = join(repoRoot, "supabase", ".seed")
const cacheFile = join(cacheDir, "staging-dump.json")

function loadDotEnvLocal() {
  const path = join(repoRoot, ".env.local")
  const env = {}
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (!line || line.startsWith("#")) continue
    const i = line.indexOf("=")
    if (i < 0) continue
    env[line.slice(0, i).trim()] = line
      .slice(i + 1)
      .trim()
      .replace(/^"|"$/g, "")
  }
  return env
}

// Topological order: a table only follows the tables its foreign keys point
// at, so seed-restore.mjs can insert straight down this list without
// deferring constraints.
const TABLES = [
  "app_settings",
  "faq_data",
  "committee_roles",
  "crm_pipeline_stages",
  "crm_lead_sources",
  "commission_departments",
  "commission_positions",
  "commission_rates",
  "commission_splits",
  "employees",
  "categories",
  "group_task_templates",
  "group_task_template_members",
  "sales_quotas",
  "sales_weekly_plans",
  "system_updates",
  "chat_read_receipts",
  "sales_custom_templates",
  "chat_user_archives",
  "overtime_requests",
  "offset_leaves",
  "sil_leaves",
  "system_audit_logs",
  "sales_opportunities",
  "sales_opportunity_logs",
  "sales_opportunity_items",
  "sales_activities",
  "sales_activity_logs",
  "sales_revenue_logs",
  "revenue_activity_logs",
  "sales_quota_logs",
  "tasks",
  "task_activity",
  "committee_tasks",
  "committee_task_members",
  "committee_task_activity",
  "committee_task_logs",
  "notifications",
  "sor_procurement_requests",
]

async function dumpTable(sql, schema, table) {
  const sanitize = SANITIZERS[schema === "auth" ? `${schema}.${table}` : table]
  const { rows } = await sql.query(`select * from ${schema}."${table}"`)
  return sanitize ? rows.map(sanitize) : rows
}

async function main() {
  const env = loadDotEnvLocal()
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

  for (const table of TABLES) {
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
