// Shared by scripts/seed-dump.mjs, seed-restore.mjs and seed-snapshot.mjs.

import { readFileSync } from "fs"
import { join } from "path"

// Topological order: a table only follows the tables its foreign keys point
// at, so seed-restore.mjs can insert straight down this list without
// deferring constraints. (Self-references and the sales_flows <-> flow_stages
// pair are cycles; the restore runs with replication role `replica`.)
//
// Issue #199 — this list plus SEED_EXCLUDED_TABLES must cover exactly the
// public tables the migrations build. src/lib/seedCoverage.test.js fails when
// a migration adds a table that is in neither.
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
  "companies",
  "hr_leave_categories",
  "hr_day_shift_config",
  "employees",
  "employee_groups",
  "employee_group_members",
  "employee_group_teams",
  "categories",
  "group_task_templates",
  "group_task_template_members",
  "system_updates",
  "chat_read_receipts",
  "sales_custom_templates",
  "chat_user_archives",
  "overtime_requests",
  "undertime_requests",
  "offset_leaves",
  "sil_leaves",
  "system_audit_logs",
  "sale_types",
  "sales_flows",
  "flow_stages",
  "flow_edges",
  "stage_conditions",
  "flow_stage_actions",
  "flow_snapshots",
  "sales_opportunities",
  "sales_opportunity_logs",
  "sales_opportunity_items",
  "sales_opportunity_members",
  "sor_condition_status",
  "revenue_activity_logs",
  "tasks",
  "task_activity",
  "committee_tasks",
  "committee_task_members",
  "committee_task_activity",
  "committee_task_logs",
  "notifications",
  "sor_inclusions",
  "sor_procurement_requests",
  "sor_canvasses",
  "sor_canvass_offers",
  "sor_project_evaluations",
  "sor_purchase_order_links",
  "odoo_retail_queue",
]

/** Tables the migrations build that the seed deliberately leaves out, each with why. */
export const SEED_EXCLUDED_TABLES = {
  push_subscriptions:
    "Real browser push endpoints and keys. A local stack must never push to a colleague's real device.",
  verification_rate_limits:
    "IP addresses and throttle state for public document verification. Personal data, and meaningless off the server.",
}

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
