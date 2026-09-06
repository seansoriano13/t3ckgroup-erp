#!/usr/bin/env node
/**
 * Saves the local database's current data to a timestamped file before a
 * deliberate `supabase db reset`, so a working dataset survives the rebuild.
 * Issue #87. Pass the resulting file to scripts/seed-restore.mjs to bring it
 * back: `node scripts/seed-restore.mjs supabase/.seed/local-snapshot-<ts>.json`.
 *
 * Targets LOCAL_DB_URL, or the default `supabase start` connection string
 * when unset.
 */
import pg from "pg"
import { writeFileSync, mkdirSync } from "fs"
import { fileURLToPath } from "url"
import { dirname, join } from "path"

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(__dirname, "..")
const DEFAULT_LOCAL_DB_URL = "postgresql://postgres:postgres@127.0.0.1:54322/postgres"

// Same table list scripts/seed-dump.mjs uses, so a snapshot is restorable by
// the same script that loads a staging dump.
const TABLES = [
  "app_settings", "faq_data", "committee_roles", "crm_pipeline_stages", "crm_lead_sources",
  "commission_departments", "commission_positions", "commission_rates", "commission_splits",
  "employees", "categories", "group_task_templates", "group_task_template_members",
  "sales_quotas", "sales_weekly_plans", "system_updates", "chat_read_receipts",
  "sales_custom_templates", "chat_user_archives", "overtime_requests", "offset_leaves",
  "sil_leaves", "system_audit_logs", "sales_opportunities", "sales_opportunity_logs",
  "sales_opportunity_items", "sales_activities", "sales_activity_logs", "sales_revenue_logs",
  "revenue_activity_logs", "sales_quota_logs", "tasks", "task_activity", "committee_tasks",
  "committee_task_members", "committee_task_activity", "committee_task_logs", "notifications",
  "sor_procurement_requests",
]

async function main() {
  const dbUrl = process.env.LOCAL_DB_URL ?? DEFAULT_LOCAL_DB_URL
  const client = new pg.Client({ connectionString: dbUrl })
  await client.connect()

  const dump = { dumpedAt: new Date().toISOString(), authUsers: [], tables: {} }

  const { rows: authUsers } = await client.query("select * from auth.users")
  dump.authUsers = authUsers

  for (const table of TABLES) {
    try {
      const { rows } = await client.query(`select * from public."${table}"`)
      dump.tables[table] = rows
    } catch {
      // Table doesn't exist locally yet — skip rather than fail the snapshot.
    }
  }

  await client.end()

  const cacheDir = join(repoRoot, "supabase", ".seed")
  mkdirSync(cacheDir, { recursive: true })
  const stamp = dump.dumpedAt.replace(/[:.]/g, "-")
  const outFile = join(cacheDir, `local-snapshot-${stamp}.json`)
  writeFileSync(outFile, JSON.stringify(dump, null, 2))
  console.log(`Wrote ${outFile}`)
  console.log(`Restore it later with: node scripts/seed-restore.mjs ${outFile}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
