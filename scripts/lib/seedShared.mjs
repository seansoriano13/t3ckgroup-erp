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
  "lwop_leaves",
  "system_audit_logs",
  "sale_types",
  "sales_flows",
  "flow_stages",
  "flow_edges",
  "stage_conditions",
  "flow_stage_actions",
  "flow_stage_fields",
  "flow_stage_follow_ups",
  // Flow and Stage access settings (#292). After sales_flows and flow_stages,
  // which they point at.
  "flow_access_settings",
  "flow_stage_access",
  // The flow's registration-form customization. After sales_flows, which it
  // points at.
  "flow_form_fields",
  "flow_snapshots",
  "sales_opportunities",
  "sor_stage_visits",
  "sor_stage_participants",
  "sales_opportunity_logs",
  "sales_opportunity_items",
  "sales_opportunity_members",
  // Read-only grants from a note Mention (ADR 0021 amendment). After
  // sales_opportunities and employees, which it points at.
  "sor_mention_viewers",
  "sor_condition_status",
  "sor_stage_field_values",
  // Answers to the flow's custom registration fields. After both tables it
  // points at: sales_opportunities above, flow_form_fields further up.
  "sor_form_values",
  "revenue_activity_logs",
  "tasks",
  "task_activity",
  "committee_tasks",
  "committee_task_members",
  "committee_task_activity",
  "committee_task_logs",
  "committee_task_tags",
  "task_tags",
  "notifications",
  "sor_inclusions",
  "sor_procurement_requests",
  "sor_canvasses",
  "sor_canvass_offers",
  "sor_canvass_offer_prices",
  "sor_canvass_signoff_events",
  "sor_canvass_no_other_supplier",
  "sor_purchase_order_links",
  // Purchase Requests (#303). After sales_opportunities, flow_stage_actions
  // and sor_stage_visits, which the request points at; the rest point at it.
  "purchase_requests",
  "purchase_request_members",
  "purchase_request_items",
  // #582: the winning Offer price per item, after the items it points at.
  "purchase_request_item_prices",
  "purchase_request_messages",
  // IPAS (#242). After sales_opportunities and employees, which they point at;
  // ipas_sors and ipas_events point at ipas. ipas_options (#244) comes first:
  // the business-edited lists (payment methods, charge kinds, freight services)
  // that ipas.freight_service_id and the payment and charge rows point at. It is
  // seeded rather than left to the migration so a restored IPAS keeps the
  // option ids it was written with.
  "ipas_options",
  "ipas",
  "ipas_sors",
  "ipas_events",
  "ipas_payments",
  "ipas_charges",
  // Documents (#246) point at ipas and at the document_kind options above.
  "ipas_documents",
  // Sign-offs (#247) point at ipas and employees. Seeded with the lists beside
  // them: an approval and who gave it are facts about the work, and the restore
  // runs in replica mode, so the paid-before-approval flags it carries are kept
  // as written rather than recomputed from the rows loaded so far. The
  // signature_version column holds a storage path, never the image.
  "ipas_signoffs",
  "ipas_signer_lists",
  // Who changed those lists (#241): history about employees, no sensitive data.
  "ipas_signer_list_log",
  "odoo_retail_queue",
  // TG03 Transmittals (#251) point at employees, ipas, ipas_options and SORs;
  // the lines, links and stages point at the slip. pms_evidence holds storage
  // paths, never the files.
  "transmittals",
  "transmittal_products",
  "transmittal_references",
  "transmittal_lines",
  "transmittal_ipas",
  "transmittal_sors",
  "transmittal_stages",
  "transmittal_cleared_signatures",
  "pms_handoff_events",
  "pms_evidence",
  // Packing Lists (#255) point at SORs; boxes at the list, contents at the box.
  "packing_lists",
  "packing_list_boxes",
  "packing_list_contents",
  // Order Monitoring ageing rules (#262): one number per step, no people in it.
  "order_ageing_rules",
  "order_deadline_setting",
  // Costing Matrix (#266): settings, presets, the cost guide categories (#723) and signer lists first; the matrix
  // points at an SOR, its rows at the matrix, money rows at their row, and
  // decisions, sign-offs and events at the matrix.
  "costing_settings",
  "costing_evaluation_settings",
  "costing_markup_presets",
  "costing_landed_defaults",
  "costing_cost_categories",
  "costing_signer_lists",
  "costing_matrices",
  "costing_matrix_money",
  "costing_tender_lines",
  "costing_tender_line_prices",
  "costing_components",
  "costing_component_costs",
  "costing_inclusions",
  "costing_cost_rows",
  "costing_bid_decisions",
  "costing_signoffs",
  "costing_events",
  "currency_rate_currencies",
  "currency_rates",
]

/** Tables the migrations build that the seed deliberately leaves out, each with why. */
export const SEED_EXCLUDED_TABLES = {
  meal_break_settings:
    "The default meal-break windows (#759) are inserted by the migration itself, so a seed would only replace them with whatever the remote held.",
  calendar_venues:
    "The two Venues (#619) are inserted by the migration itself, so a seed would only replace them with whatever the remote held.",
  meeting_requests:
    "Meeting Requests (#619) are transactional bookings tied to real people and dates. A local stack files its own.",
  meeting_request_participants:
    "Belongs to meeting_requests, which the seed leaves out.",
  meeting_request_events:
    "The history of meeting_requests, which the seed leaves out.",
  costing_tables:
    "The Costing Matrix access registry (#267): which tier reads and which band writes each column. The migrations write every row, so a seed would only replace them with whatever the remote held.",
  costing_column_tiers:
    "The Costing Matrix access registry (#267): which tier reads and which band writes each column. The migrations write every row, so a seed would only replace them with whatever the remote held.",
  costing_column_bands:
    "The Costing Matrix access registry (#267): which tier reads and which band writes each column. The migrations write every row, so a seed would only replace them with whatever the remote held.",
  costing_virtual_columns:
    "The Costing Matrix access registry (#267): which tier reads and which band writes each column. The migrations write every row, so a seed would only replace them with whatever the remote held.",
  push_subscriptions:
    "Real browser push endpoints and keys. A local stack must never push to a colleague's real device.",
  verification_rate_limits:
    "IP addresses and throttle state for public document verification. Personal data, and meaningless off the server.",
  sor_stock_snapshots:
    "A timestamped Odoo stock reading, not a fact about the deal. A local stack has no Odoo credentials to refresh it against, so a seeded row would go stale the moment it landed.",
  retail_orders:
    "Marketplace orders synced from Odoo by odoo-sor-sync, carrying individual buyers' names. A local stack has no Odoo credentials to re-sync it, and unlike odoo_retail_queue no sanitizer covers it yet.",
  bug_reports:
    "Reports point at files in the remote environment's private bug-reports bucket, which a local stack cannot read, and carry each sender's browser details. Send a fresh one locally with the bug button.",
  bug_report_notes:
    "The thread on a Bug Report, and bug_reports itself is not seeded, so there is nothing for a note to hang on.",
  ipas_bank_details:
    "Suppliers' bank account numbers (#245). Narrow read policy by design (Purchasing, Finance, Super Admins and the section 1 and 3 approvers), and a local stack or a colleague's seed has no business carrying real account numbers. Type fresh ones locally on an IPAS.",
  sor_action_runs:
    "A fire-once ledger derived from Stage Actions actually firing (issue #204), not a fact to seed — a local stack regenerates it the first time a seeded deal moves through a Flow Stage.",
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

// Plain sequences behind the document numbers (PR_0001, CNV_0001, PKL_001,
// TG03-1). The restore inserts rows with their numbers already set, so the
// sequences stay at 1 and the first new row collides (issue #794).
export const NUMBER_SEQUENCES = [
  { sequence: "purchase_request_number_seq", table: "purchase_requests", column: "pr_number" },
  { sequence: "sor_canvass_number_seq", table: "sor_canvasses", column: "number" },
  { sequence: "packing_list_number_seq", table: "packing_lists", column: "number" },
  { sequence: "transmittal_number_seq", table: "transmittals", column: "number" },
]

// SQL that moves a number sequence to the highest number used in its table.
// An empty table (or one with no digits) leaves the next number at 1.
export function numberSequenceResyncSql({ sequence, table, column }) {
  return `select setval('public.${sequence}',
    coalesce((select max(substring("${column}" from '[0-9]+$')::bigint) from public."${table}"), 1),
    exists (select 1 from public."${table}" where "${column}" ~ '[0-9]+$'))`
}
