// Shared by scripts/seed-dump.mjs, seed-restore.mjs and seed-snapshot.mjs.

import { readFileSync } from "fs"
import { join } from "path"

// Topological order: a table only follows the tables its foreign keys point
// at, so seed-restore.mjs can insert straight down this list without
// deferring constraints.
export const SEED_TABLES = [
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
  "sale_types",
  "sales_flows",
  "flow_stages",
  "flow_edges",
  "flow_snapshots",
]

export const DEFAULT_LOCAL_DB_URL = "postgresql://postgres:postgres@127.0.0.1:54322/postgres"

/** Parses .env.local by hand — these scripts run standalone via `node`, without Vite's env loading. */
export function loadDotEnvLocal(repoRoot) {
  const env = {}
  try {
    for (const line of readFileSync(join(repoRoot, ".env.local"), "utf8").split("\n")) {
      if (!line || line.startsWith("#")) continue
      const i = line.indexOf("=")
      if (i < 0) continue
      env[line.slice(0, i).trim()] = line
        .slice(i + 1)
        .trim()
        .replace(/^"|"$/g, "")
    }
  } catch {
    // .env.local is optional for scripts that have their own defaults (seed-restore's
    // local-db URL and test password); seed-dump's STAGING_DB_URL check reports its own error.
  }
  return env
}
