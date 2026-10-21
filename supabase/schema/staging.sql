-- ==============================================================================
-- GENERATED — DO NOT EDIT OR APPLY
--
-- Schema mirror — staging (fpjxdyowngpnovotbzqi)
-- Regenerate with: pnpm db:snapshot:staging
--
-- This is a read-only snapshot of the live schema for reference and drift
-- detection. It is NOT a migration file, is not in supabase/migrations/,
-- and must never be run against any database — running it against
-- prod would error on objects the two databases already have in
-- common (or lack entirely).
-- ==============================================================================

-- ============================================================
-- Extensions
-- ============================================================

create extension if not exists "pg_cron" with schema "pg_catalog";
create extension if not exists "pg_net" with schema "extensions";
create extension if not exists "pg_stat_statements" with schema "extensions";
create extension if not exists "pgcrypto" with schema "extensions";
create extension if not exists "supabase_vault" with schema "vault";
create extension if not exists "uuid-ossp" with schema "extensions";

-- ============================================================
-- Tables
-- ============================================================


create table if not exists public."app_settings" (
  "id" boolean not null default true,
  "updated_at" timestamp with time zone not null default now(),
  "universal_task_submission" boolean not null default false,
  "marketing_approval_by_ops_manager" boolean default false,
  "enable_self_verification" boolean not null default false,
  "enable_bulk_approval" boolean not null default false,
  "enable_visual_shaming" boolean not null default false,
  "retail_storefronts" text[] not null default '{Shopee,Lazada}'::text[]
);

create table if not exists public."bug_report_notes" (
  "id" uuid not null default gen_random_uuid(),
  "report_id" uuid not null,
  "author_id" uuid not null,
  "kind" text not null default 'note'::text,
  "body" text,
  "created_at" timestamp with time zone not null default now()
);

create table if not exists public."bug_reports" (
  "id" uuid not null default gen_random_uuid(),
  "reporter_id" uuid not null,
  "description" text not null,
  "attachments" jsonb not null default '[]'::jsonb,
  "page_url" text,
  "user_agent" text,
  "app_version" text,
  "environment" text,
  "created_at" timestamp with time zone not null default now(),
  "resolved_at" timestamp with time zone,
  "resolved_by" uuid,
  "attachments_purged_at" timestamp with time zone
);

create table if not exists public."categories" (
  "id" bigint not null generated always as identity,
  "created_at" timestamp with time zone not null default now(),
  "updated_at" timestamp with time zone not null default now(),
  "updated_by" uuid,
  "category_id" text not null,
  "description" text,
  "department" text,
  "sub_department" text
);

create table if not exists public."chat_read_receipts" (
  "user_id" uuid not null,
  "entity_type" text not null,
  "entity_id" text not null,
  "last_read_at" timestamp with time zone not null default now()
);

create table if not exists public."chat_user_archives" (
  "user_id" uuid not null,
  "entity_type" text not null,
  "entity_id" text not null,
  "archived_at" timestamp with time zone default now()
);

create table if not exists public."commission_departments" (
  "id" uuid not null default gen_random_uuid(),
  "key" text not null,
  "name" text not null,
  "allocation_percent" numeric(6,3) not null default 0,
  "created_at" timestamp with time zone not null default now(),
  "updated_at" timestamp with time zone not null default now()
);

create table if not exists public."commission_positions" (
  "id" uuid not null default gen_random_uuid(),
  "department_id" uuid not null,
  "name" text not null,
  "allocation_percent" numeric(6,3) not null default 0,
  "created_at" timestamp with time zone not null default now(),
  "updated_at" timestamp with time zone not null default now()
);

create table if not exists public."commission_rates" (
  "id" uuid not null default gen_random_uuid(),
  "rate_type" text not null,
  "percent" numeric(6,3) not null,
  "effective_from" date not null,
  "created_at" timestamp with time zone not null default now(),
  "updated_at" timestamp with time zone not null default now()
);

create table if not exists public."commission_splits" (
  "id" uuid not null default gen_random_uuid(),
  "project_type" text not null,
  "share_role" text not null,
  "percent" numeric(6,3) not null default 0,
  "created_at" timestamp with time zone not null default now(),
  "updated_at" timestamp with time zone not null default now()
);

create table if not exists public."committee_roles" (
  "id" uuid not null default gen_random_uuid(),
  "role_name" text not null,
  "created_at" timestamp with time zone default now()
);

create table if not exists public."committee_task_activity" (
  "id" uuid not null default gen_random_uuid(),
  "task_id" uuid not null,
  "author_id" uuid,
  "type" text not null,
  "content" text not null,
  "metadata" jsonb,
  "created_at" timestamp with time zone not null default now()
);

create table if not exists public."committee_task_logs" (
  "id" uuid not null default gen_random_uuid(),
  "committee_task_id" uuid not null,
  "action" text not null,
  "actor_id" uuid,
  "details" jsonb default '{}'::jsonb,
  "created_at" timestamp with time zone default now()
);

create table if not exists public."committee_task_members" (
  "id" uuid not null default gen_random_uuid(),
  "committee_task_id" uuid not null,
  "employee_id" uuid not null,
  "task_description" text not null,
  "role" text,
  "custom_role" text,
  "status" text not null default 'PENDING'::text,
  "grade" integer,
  "grade_remarks" text,
  "rated_at" timestamp with time zone,
  "rated_by" uuid,
  "created_at" timestamp with time zone default now(),
  "checklist" jsonb,
  "attachments" jsonb default '[]'::jsonb
);

create table if not exists public."committee_task_tags" (
  "committee_task_id" uuid not null,
  "tag_id" uuid not null,
  "added_by" uuid,
  "added_at" timestamp with time zone not null default now()
);

create table if not exists public."committee_tasks" (
  "id" uuid not null default gen_random_uuid(),
  "title" text not null,
  "description" text,
  "created_by" uuid not null,
  "due_date" timestamp with time zone,
  "status" text not null default 'ACTIVE'::text,
  "hr_verified" boolean not null default false,
  "hr_verified_at" timestamp with time zone,
  "hr_verified_by" uuid,
  "hr_remarks" text,
  "committee_role" text,
  "created_at" timestamp with time zone default now(),
  "updated_at" timestamp with time zone default now(),
  "template_id" uuid,
  "opportunity_id" uuid,
  "stage_action_id" uuid,
  "stage_visit_id" uuid,
  "cancel_reason" text,
  "held_prev_status" text,
  "held_at" timestamp with time zone,
  "held_from_visit_id" uuid,
  "carried_from_visit_id" uuid,
  "cancelled_by_visit_id" uuid,
  "start_date" date,
  "lead_time" text
);

create table if not exists public."companies" (
  "id" uuid not null default gen_random_uuid(),
  "name" text not null,
  "is_active" boolean not null default true,
  "sort_order" integer not null,
  "created_at" timestamp with time zone not null default now(),
  "updated_at" timestamp with time zone not null default now()
);

create table if not exists public."costing_bid_decisions" (
  "id" uuid not null default gen_random_uuid(),
  "matrix_id" uuid not null,
  "verdict" text not null,
  "reason" text not null,
  "decided_by" uuid,
  "decided_at" timestamp with time zone not null default now(),
  "final_offer_total" numeric(18,2) not null,
  "abc_total" numeric(18,2),
  "cleared_at" timestamp with time zone,
  "cleared_reason" text
);

create table if not exists public."costing_column_bands" (
  "table_name" text not null,
  "column_name" text not null,
  "bands" text[] not null
);

create table if not exists public."costing_column_tiers" (
  "table_name" text not null,
  "column_name" text not null,
  "tiers" text[] not null
);

create table if not exists public."costing_component_costs" (
  "component_id" uuid not null,
  "acquire_unit" numeric(18,2),
  "odoo_unit" numeric(18,2),
  "final_acquire_unit" numeric(18,2),
  "markup_factor" numeric(10,4),
  "acquire_from_offer_id" uuid
);

create table if not exists public."costing_components" (
  "id" uuid not null default gen_random_uuid(),
  "tender_line_id" uuid not null,
  "position" integer not null,
  "name" text not null default ''::text,
  "offer_specification" text,
  "brand" text,
  "status" text,
  "availability" text,
  "source" text,
  "po_rfq_no" text,
  "is_bundle" boolean not null default false,
  "quantity" numeric(12,2) not null default 1,
  "unit" text,
  "odoo_product_id" integer,
  "sales_incharge_id" uuid,
  "purchasing_incharge_id" uuid,
  "created_at" timestamp with time zone not null default now(),
  "compliance" text,
  "compliance_note" text,
  "recommended_alternative" text,
  "offer_specification_from_offer_id" uuid,
  "documents" jsonb not null default '[]'::jsonb
);

create table if not exists public."costing_cost_rows" (
  "id" uuid not null default gen_random_uuid(),
  "matrix_id" uuid not null,
  "position" integer not null,
  "description" text not null default ''::text,
  "quantity" numeric(12,2) not null default 1,
  "acquire_unit" numeric(18,2),
  "odoo_unit" numeric(18,2),
  "final_acquire_unit" numeric(18,2),
  "markup_factor" numeric(10,4) default 1.00,
  "created_at" timestamp with time zone not null default now()
);

create table if not exists public."costing_evaluation_settings" (
  "id" boolean not null default true,
  "evaluation_template_id" uuid,
  "updated_at" timestamp with time zone not null default now()
);

create table if not exists public."costing_events" (
  "id" uuid not null default gen_random_uuid(),
  "matrix_id" uuid not null,
  "actor_id" uuid,
  "kind" text not null,
  "detail" jsonb not null,
  "created_at" timestamp with time zone not null default now()
);

create table if not exists public."costing_inclusions" (
  "id" uuid not null default gen_random_uuid(),
  "component_id" uuid not null,
  "heading" text,
  "position" integer not null,
  "description" text not null,
  "quantity" numeric(12,2) not null default 1,
  "unit" text,
  "completeness" text not null default 'MISSING'::text,
  "legacy_sor_inclusion_id" uuid,
  "created_at" timestamp with time zone not null default now()
);

create table if not exists public."costing_markup_presets" (
  "id" uuid not null default gen_random_uuid(),
  "label" text not null,
  "factor" numeric(10,4) not null,
  "sort" integer not null default 0,
  "active" boolean not null default true,
  "created_at" timestamp with time zone not null default now(),
  "updated_at" timestamp with time zone not null default now()
);

create table if not exists public."costing_matrices" (
  "id" uuid not null default gen_random_uuid(),
  "opportunity_id" uuid not null,
  "sales_incharge_id" uuid,
  "purchasing_incharge_id" uuid,
  "bid_submitted_at" timestamp with time zone,
  "created_at" timestamp with time zone not null default now(),
  "updated_at" timestamp with time zone not null default now()
);

create table if not exists public."costing_matrix_money" (
  "matrix_id" uuid not null,
  "created_at" timestamp with time zone not null default now(),
  "updated_at" timestamp with time zone not null default now(),
  "default_factor" numeric(10,4),
  "default_preset_id" uuid,
  "marketing" numeric(18,2),
  "opex" numeric(18,2)
);

create table if not exists public."costing_settings" (
  "id" smallint not null default 1,
  "vat_divisor" numeric(10,6) not null default 1.12,
  "tax_rate" numeric(10,6) not null default 0.06,
  "retention_rate" numeric(10,6) not null default 0.01,
  "itr_rate" numeric(10,6) not null default 0.08,
  "itr_allowance" numeric(18,2) not null default 250000,
  "updated_at" timestamp with time zone not null default now(),
  "updated_by" uuid
);

create table if not exists public."costing_signer_lists" (
  "id" uuid not null default gen_random_uuid(),
  "list_key" text not null,
  "employee_id" uuid not null,
  "created_at" timestamp with time zone not null default now()
);

create table if not exists public."costing_signoffs" (
  "id" uuid not null default gen_random_uuid(),
  "matrix_id" uuid not null,
  "role" text not null,
  "signed_by" uuid not null,
  "signed_at" timestamp with time zone not null default now(),
  "signature_declined" boolean not null default false,
  "cleared_at" timestamp with time zone,
  "cleared_reason" text,
  "signature_version" text
);

create table if not exists public."costing_tables" (
  "table_name" text not null,
  "parent_table" text,
  "parent_column" text,
  "parent_key" text not null default 'id'::text,
  "key_column" text not null default 'id'::text,
  "order_by" text not null default 't.created_at'::text,
  "money" boolean not null default false
);

create table if not exists public."costing_tender_line_prices" (
  "tender_line_id" uuid not null,
  "abc_unit" numeric(18,2),
  "final_offer_unit" numeric(18,2)
);

create table if not exists public."costing_tender_lines" (
  "id" uuid not null default gen_random_uuid(),
  "matrix_id" uuid not null,
  "position" integer not null,
  "tender_specification" text not null default ''::text,
  "unit" text,
  "quantity" numeric(12,2) not null default 1,
  "source" text not null default 'typed'::text,
  "sor_item_id" uuid,
  "odoo_product_id" integer,
  "sor_line_snapshot" jsonb,
  "created_by" uuid,
  "created_at" timestamp with time zone not null default now()
);

create table if not exists public."costing_virtual_columns" (
  "table_name" text not null,
  "column_name" text not null,
  "expression" text not null
);

create table if not exists public."crm_lead_sources" (
  "value" text not null,
  "label" text not null,
  "is_active" boolean not null default true,
  "created_at" timestamp with time zone not null default now()
);

create table if not exists public."crm_pipeline_stages" (
  "code" text not null,
  "label" text not null,
  "sort_order" integer not null,
  "theme" text not null default 'mauve'::text,
  "is_active" boolean not null default true,
  "is_system" boolean not null default false,
  "is_default" boolean not null default false,
  "is_anchor" boolean not null default false,
  "is_won" boolean not null default false,
  "is_lost" boolean not null default false,
  "created_at" timestamp with time zone not null default now(),
  "updated_at" timestamp with time zone not null default now(),
  "is_itb_gate" boolean not null default false
);

create table if not exists public."currency_rate_currencies" (
  "currency" text not null,
  "divergence_pct" numeric not null default 2,
  "created_at" timestamp with time zone not null default now()
);

create table if not exists public."currency_rates" (
  "id" uuid not null default gen_random_uuid(),
  "currency" text not null,
  "rate_date" date not null,
  "php_per_unit" numeric not null,
  "source" text not null,
  "fetched_at" timestamp with time zone not null default now(),
  "overridden_by" uuid,
  "overridden_at" timestamp with time zone,
  "replaced_php_per_unit" numeric
);

create table if not exists public."employee_group_members" (
  "id" uuid not null default gen_random_uuid(),
  "group_id" uuid not null,
  "employee_id" uuid not null,
  "added_by" uuid,
  "added_at" timestamp with time zone not null default now()
);

create table if not exists public."employee_group_teams" (
  "id" uuid not null default gen_random_uuid(),
  "group_id" uuid not null,
  "team" text not null
);

create table if not exists public."employee_groups" (
  "id" uuid not null default gen_random_uuid(),
  "name" text not null,
  "description" text,
  "archived_at" timestamp with time zone,
  "created_by" uuid,
  "created_at" timestamp with time zone not null default now(),
  "updated_at" timestamp with time zone not null default now()
);

create table if not exists public."employees" (
  "id" uuid not null default gen_random_uuid(),
  "created_at" timestamp with time zone not null default now(),
  "updated_at" timestamp with time zone not null default now(),
  "updated_by" uuid,
  "email" text,
  "name" text,
  "department" text,
  "sub_department" text,
  "role" character varying,
  "is_head" boolean default false,
  "is_hr" boolean default false,
  "is_super_admin" boolean default false,
  "is_deleted" boolean default false,
  "avatar_path" text,
  "dashboard_banner_path" text,
  "dashboard_quote" text,
  "has_sales_flow" boolean default false,
  "has_task_flow" boolean default true,
  "offset_hours_balance" numeric not null default 0,
  "employment_status" text,
  "sil_hours_balance" numeric default 0,
  "has_purchasing_flow" boolean not null default false,
  "can_manage_leaves" boolean not null default false,
  "signature_path" text,
  "last_seen_changelog_version" text,
  "is_role_simulator" boolean not null default false,
  "hidden_nav_keys" text[] not null default '{}'::text[],
  "company_id" uuid,
  "is_issued_password" boolean not null default false,
  "can_edit_sales_flows" boolean not null default false,
  "has_retail_access" boolean not null default false,
  "has_bug_report_access" boolean not null default false,
  "has_finance_flow" boolean not null default false,
  "call_sign" text
);

create table if not exists public."faq_data" (
  "id" integer not null default 1,
  "categories" jsonb not null default '[]'::jsonb,
  "updated_at" timestamp with time zone not null default now()
);

create table if not exists public."flow_access_settings" (
  "flow_id" uuid not null,
  "always_sees" jsonb not null default '[]'::jsonb,
  "journey_viewers" jsonb,
  "created_at" timestamp with time zone not null default now(),
  "updated_at" timestamp with time zone not null default now(),
  "always_edits" jsonb not null default '[]'::jsonb
);

create table if not exists public."flow_edges" (
  "id" uuid not null default gen_random_uuid(),
  "flow_id" uuid not null,
  "from_stage_id" uuid not null,
  "to_stage_id" uuid not null,
  "created_at" timestamp with time zone not null default now()
);

create table if not exists public."flow_form_fields" (
  "id" uuid not null default gen_random_uuid(),
  "flow_id" uuid not null,
  "source" text not null,
  "default_key" text,
  "label" text,
  "help" text,
  "field_type" text,
  "options" jsonb not null default '[]'::jsonb,
  "is_required" boolean,
  "is_hidden" boolean not null default false,
  "sort_order" integer not null default 0,
  "archived_at" timestamp with time zone,
  "created_at" timestamp with time zone not null default now(),
  "updated_at" timestamp with time zone not null default now()
);

create table if not exists public."flow_snapshots" (
  "id" uuid not null default gen_random_uuid(),
  "flow_id" uuid not null,
  "version" integer not null,
  "snapshot_data" jsonb not null,
  "created_at" timestamp with time zone not null default now(),
  "created_by" uuid,
  "version_minor" integer not null default 0,
  "note" text
);

create table if not exists public."flow_stage_access" (
  "stage_id" uuid not null,
  "shut_out_roles" text[] not null default '{}'::text[],
  "excluded_group_ids" uuid[] not null default '{}'::uuid[],
  "created_at" timestamp with time zone not null default now(),
  "updated_at" timestamp with time zone not null default now()
);

create table if not exists public."flow_stage_actions" (
  "id" uuid not null default gen_random_uuid(),
  "stage_id" uuid not null,
  "kind" text not null,
  "config" jsonb not null default '{}'::jsonb,
  "sort_order" integer not null default 0,
  "archived_at" timestamp with time zone,
  "created_at" timestamp with time zone not null default now(),
  "updated_at" timestamp with time zone not null default now()
);

create table if not exists public."flow_stage_fields" (
  "id" uuid not null default gen_random_uuid(),
  "stage_id" uuid not null,
  "label" text not null,
  "help" text,
  "source" text not null,
  "sor_field" text,
  "field_type" text not null,
  "options" jsonb not null default '[]'::jsonb,
  "is_required" boolean not null default true,
  "sort_order" integer not null default 0,
  "archived_at" timestamp with time zone,
  "created_at" timestamp with time zone not null default now(),
  "updated_at" timestamp with time zone not null default now()
);

create table if not exists public."flow_stage_follow_ups" (
  "stage_id" uuid not null,
  "enabled" boolean not null default false,
  "every_days" integer,
  "recipients" jsonb not null default '[{"role": "deal_owner", "type": "role"}]'::jsonb,
  "proof_required" boolean not null default true,
  "created_at" timestamp with time zone not null default now(),
  "updated_at" timestamp with time zone not null default now()
);

create table if not exists public."flow_stages" (
  "id" uuid not null default gen_random_uuid(),
  "flow_id" uuid not null,
  "name" text not null,
  "sort_order" integer not null default 0,
  "is_terminal" boolean not null default false,
  "created_at" timestamp with time zone not null default now(),
  "updated_at" timestamp with time zone not null default now(),
  "pos_x" integer not null default 0,
  "pos_y" integer not null default 0,
  "color" text,
  "bracket_label" text,
  "terminal_outcome" text
);

create table if not exists public."group_task_template_members" (
  "id" uuid not null default gen_random_uuid(),
  "template_id" uuid not null,
  "employee_id" uuid,
  "task_description" text,
  "checklist" jsonb,
  "role" text,
  "custom_role" text,
  "sort_order" integer not null default 0,
  "created_at" timestamp with time zone not null default now()
);

create table if not exists public."group_task_templates" (
  "id" uuid not null default gen_random_uuid(),
  "name" text not null,
  "title" text,
  "description" text,
  "due_date_offset_days" integer,
  "created_by" uuid not null,
  "archived_at" timestamp with time zone,
  "created_at" timestamp with time zone not null default now(),
  "updated_at" timestamp with time zone not null default now()
);

create table if not exists public."hr_day_shift_config" (
  "weekday" smallint not null,
  "start_time" time without time zone,
  "end_time" time without time zone,
  "is_working_day" boolean not null default true,
  "updated_at" timestamp with time zone not null default now()
);

create table if not exists public."hr_leave_categories" (
  "id" uuid not null default gen_random_uuid(),
  "label" text not null,
  "is_active" boolean not null default true,
  "sort_order" integer not null,
  "created_at" timestamp with time zone not null default now(),
  "updated_at" timestamp with time zone not null default now()
);

create table if not exists public."ipas" (
  "id" uuid not null default gen_random_uuid(),
  "number" text not null default ipas_format_number(nextval('ipas_number_seq'::regclass)),
  "po_number" text not null,
  "odoo_po_id" integer,
  "priority" text not null,
  "source" text not null,
  "purpose" text not null,
  "remarks" text,
  "odoo_copy" jsonb not null,
  "odoo_fetched_at" timestamp with time zone not null default now(),
  "state" text not null default 'open'::text,
  "cancel_reason" text,
  "cancelled_by" uuid,
  "cancelled_at" timestamp with time zone,
  "filed_at" timestamp with time zone,
  "created_by" uuid,
  "created_at" timestamp with time zone not null default now(),
  "updated_at" timestamp with time zone not null default now(),
  "supplier_contact" text,
  "pi_number" text,
  "entity_override" text,
  "source_doc_override" text,
  "analytic_override" text,
  "odoo_change_note" jsonb,
  "odoo_changed_since_filing" boolean not null default false,
  "pi_qt_amount" numeric(14,2),
  "freight_service_id" uuid,
  "landed_cost_split" text not null default 'value'::text,
  "computation_status" text not null default 'encoding'::text,
  "shipped_out_on" date,
  "onboard_on" date,
  "arrived_in_ph_on" date,
  "arrived_in_whs_on" date,
  "import_clearance_on" date,
  "import_clearance_typed_by" uuid,
  "import_clearance_typed_at" timestamp with time zone,
  "delivered_on" date,
  "delivered_typed_by" uuid,
  "delivered_typed_at" timestamp with time zone,
  "actual_checking_by" uuid,
  "actual_checking_at" timestamp with time zone,
  "item_location_id" uuid,
  "google_sheet" boolean not null default false,
  "gantt_chart" boolean not null default false,
  "on_hold" boolean not null default false,
  "on_hold_note" text
);

create table if not exists public."ipas_bank_details" (
  "ipas_id" uuid not null,
  "bank_name" text,
  "account_name" text,
  "account_number" text,
  "account_flagged" boolean not null default false,
  "updated_by" uuid,
  "created_at" timestamp with time zone not null default now(),
  "updated_at" timestamp with time zone not null default now()
);

create table if not exists public."ipas_charges" (
  "id" uuid not null default gen_random_uuid(),
  "ipas_id" uuid not null,
  "kind_id" uuid not null,
  "charged_on" date not null,
  "amount_php" numeric(14,2) not null,
  "created_by" uuid,
  "created_at" timestamp with time zone not null default now(),
  "updated_at" timestamp with time zone not null default now()
);

create table if not exists public."ipas_documents" (
  "id" uuid not null default gen_random_uuid(),
  "ipas_id" uuid not null,
  "kind_id" uuid,
  "label" text,
  "attachment_url" text,
  "purchasing_has" boolean not null default false,
  "finance_has" boolean not null default false,
  "created_by" uuid,
  "created_at" timestamp with time zone not null default now(),
  "updated_at" timestamp with time zone not null default now()
);

create table if not exists public."ipas_events" (
  "id" uuid not null default gen_random_uuid(),
  "ipas_id" uuid not null,
  "actor_id" uuid,
  "kind" text not null,
  "detail" jsonb not null default '{}'::jsonb,
  "created_at" timestamp with time zone not null default now()
);

create table if not exists public."ipas_options" (
  "id" uuid not null default gen_random_uuid(),
  "list" text not null,
  "label" text not null,
  "sort" integer not null default 0,
  "active" boolean not null default true,
  "applies_to" text,
  "used_for" text,
  "created_at" timestamp with time zone not null default now(),
  "updated_at" timestamp with time zone not null default now()
);

create table if not exists public."ipas_payments" (
  "id" uuid not null default gen_random_uuid(),
  "ipas_id" uuid not null,
  "kind" text not null,
  "paid_on" date not null,
  "amount" numeric(14,2) not null,
  "php_debited" numeric(14,2),
  "charge_fee_php" numeric(14,2) not null default 0,
  "method_id" uuid not null,
  "check_no" text,
  "proof_url" text,
  "paid_before_approval" boolean not null default false,
  "created_by" uuid,
  "created_at" timestamp with time zone not null default now(),
  "updated_at" timestamp with time zone not null default now()
);

create table if not exists public."ipas_signer_list_log" (
  "id" uuid not null default gen_random_uuid(),
  "list_key" text not null,
  "employee_id" uuid not null,
  "action" text not null,
  "actor_id" uuid not null,
  "created_at" timestamp with time zone not null default now()
);

create table if not exists public."ipas_signer_lists" (
  "id" uuid not null default gen_random_uuid(),
  "list_key" text not null,
  "employee_id" uuid not null,
  "created_at" timestamp with time zone not null default now()
);

create table if not exists public."ipas_signoffs" (
  "id" uuid not null default gen_random_uuid(),
  "ipas_id" uuid not null,
  "section" smallint not null,
  "role" text not null,
  "signed_by" uuid not null,
  "signed_at" timestamp with time zone not null default now(),
  "signature_declined" boolean not null default false,
  "signature_version" text,
  "cleared_at" timestamp with time zone,
  "cleared_by" uuid,
  "cleared_reason" text,
  "lc_fingerprint" text
);

create table if not exists public."ipas_sors" (
  "id" uuid not null default gen_random_uuid(),
  "ipas_id" uuid not null,
  "opportunity_id" uuid not null,
  "created_at" timestamp with time zone not null default now()
);

create table if not exists public."notifications" (
  "id" uuid not null default gen_random_uuid(),
  "recipient_id" uuid not null,
  "sender_id" uuid,
  "type" character varying not null,
  "title" text not null,
  "message" text not null,
  "is_read" boolean default false,
  "reference_id" text,
  "created_at" timestamp with time zone not null default timezone('utc'::text, now())
);

create table if not exists public."odoo_retail_queue" (
  "id" uuid not null default gen_random_uuid(),
  "created_at" timestamp with time zone not null default now(),
  "updated_at" timestamp with time zone not null default now(),
  "odoo_so_number" text not null,
  "odoo_so_id" integer not null,
  "odoo_partner_name" text not null,
  "odoo_person_name" text,
  "odoo_amount" numeric not null,
  "odoo_salesperson_name" text,
  "odoo_date_order" timestamp with time zone,
  "odoo_create_date" timestamp with time zone,
  "status" text not null default 'pending'::text,
  "reviewed_by" uuid,
  "reviewed_at" timestamp with time zone,
  "client_name" text,
  "contact_person" text,
  "expected_value" numeric,
  "lead_source" text default 'SHOPEE'::text,
  "project_title" text,
  "deal_owner_id" uuid,
  "sales_director_id" uuid,
  "opportunity_id" uuid
);

create table if not exists public."offset_leaves" (
  "id" uuid not null default gen_random_uuid(),
  "employee_id" uuid not null,
  "date" date not null,
  "hours" numeric not null,
  "status" text not null default 'PENDING'::text,
  "hr_notes" text,
  "created_at" timestamp with time zone not null default now(),
  "updated_at" timestamp with time zone not null default now(),
  "reason" text,
  "attachments" jsonb,
  "start_time" time without time zone,
  "end_time" time without time zone,
  "leave_group_id" uuid not null default gen_random_uuid(),
  "category_id" uuid,
  "verification_token" text default encode(gen_random_bytes(16), 'hex'::text),
  "application_hash" text,
  "approval_hash" text,
  "employee_signature_version" text,
  "employee_signature_timestamp" timestamp with time zone,
  "hr_signature_version" text,
  "hr_signature_timestamp" timestamp with time zone,
  "approval_credits_snapshot" numeric,
  "hr_processed_by" uuid,
  "printed_at" timestamp with time zone,
  "printed_by" uuid,
  "head_id" uuid,
  "head_status" text not null default 'APPROVED'::text,
  "head_note" text,
  "head_decided_at" timestamp with time zone,
  "head_signature_version" text,
  "hr_override" boolean not null default false,
  "company_id" uuid,
  "approved_hours" numeric
);

create table if not exists public."order_ageing_rules" (
  "step" text not null,
  "days" integer,
  "updated_by" uuid,
  "updated_at" timestamp with time zone not null default now()
);

create table if not exists public."order_deadline_setting" (
  "id" boolean not null default true,
  "near_days" integer not null default 5,
  "updated_by" uuid,
  "updated_at" timestamp with time zone not null default now()
);

create table if not exists public."overtime_requests" (
  "id" uuid not null default gen_random_uuid(),
  "employee_id" uuid not null,
  "date" date not null,
  "hours" numeric not null,
  "status" text not null default 'PENDING'::text,
  "hr_notes" text,
  "created_at" timestamp with time zone not null default now(),
  "updated_at" timestamp with time zone not null default now(),
  "reason" text,
  "attachments" jsonb,
  "start_time" time without time zone,
  "end_time" time without time zone,
  "approved_hours" numeric,
  "category_id" uuid,
  "verification_token" text default encode(gen_random_bytes(16), 'hex'::text),
  "application_hash" text,
  "approval_hash" text,
  "employee_signature_version" text,
  "employee_signature_timestamp" timestamp with time zone,
  "hr_signature_version" text,
  "hr_signature_timestamp" timestamp with time zone,
  "approval_credits_snapshot" numeric,
  "hr_processed_by" uuid,
  "printed_at" timestamp with time zone,
  "printed_by" uuid,
  "head_id" uuid,
  "head_status" text not null default 'APPROVED'::text,
  "head_note" text,
  "head_decided_at" timestamp with time zone,
  "head_signature_version" text,
  "hr_override" boolean not null default false,
  "company_id" uuid
);

create table if not exists public."packing_list_boxes" (
  "id" uuid not null default gen_random_uuid(),
  "packing_list_id" uuid not null,
  "box_no" integer not null,
  "marks" text,
  "seal_no" text,
  "gross_weight_kg" numeric,
  "created_at" timestamp with time zone not null default now()
);

create table if not exists public."packing_list_contents" (
  "id" uuid not null default gen_random_uuid(),
  "box_id" uuid not null,
  "position" integer not null,
  "description" text not null,
  "quantity" numeric not null,
  "unit" text,
  "sor_line_snapshot" jsonb,
  "created_at" timestamp with time zone not null default now()
);

create table if not exists public."packing_lists" (
  "id" uuid not null default gen_random_uuid(),
  "number" text not null default ('PKL_'::text || lpad((nextval('packing_list_number_seq'::regclass))::text, 3, '0'::text)),
  "opportunity_id" uuid not null,
  "odoo_delivery_ref" text,
  "state" text not null default 'draft'::text,
  "packed_by" uuid,
  "packed_at" timestamp with time zone,
  "signature_declined" boolean not null default false,
  "created_by" uuid not null,
  "created_at" timestamp with time zone not null default now()
);

create table if not exists public."pms_evidence" (
  "id" uuid not null default gen_random_uuid(),
  "record_type" text not null,
  "record_id" uuid not null,
  "transmittal_id" uuid not null,
  "kind" text not null,
  "storage_path" text not null,
  "file_name" text not null,
  "mime_type" text,
  "size_bytes" bigint not null,
  "uploaded_by" uuid,
  "created_at" timestamp with time zone not null default now()
);

create table if not exists public."pms_handoff_events" (
  "id" uuid not null default gen_random_uuid(),
  "record_type" text not null,
  "record_id" uuid not null,
  "actor_id" uuid,
  "kind" text not null,
  "detail" jsonb not null default '{}'::jsonb,
  "created_at" timestamp with time zone not null default now()
);

create table if not exists public."purchase_request_item_prices" (
  "item_id" uuid not null,
  "unit_price" numeric(14,2) not null,
  "currency" text not null default 'PHP'::text,
  "comparison_rate" numeric(14,6),
  "updated_at" timestamp with time zone not null default now()
);

create table if not exists public."purchase_request_items" (
  "id" uuid not null default gen_random_uuid(),
  "request_id" uuid not null,
  "source" text not null,
  "odoo_product_id" integer,
  "name" text not null,
  "unit" text,
  "quantity" numeric(12,2) not null default 1,
  "description" text,
  "images" jsonb not null default '[]'::jsonb,
  "sor_line_snapshot" jsonb,
  "status" text not null default 'requested'::text,
  "po_number" text,
  "po_verification" text not null default 'UNVERIFIED'::text,
  "substitute_for_item_id" uuid,
  "odoo_po_line_ids" int4[] not null default '{}'::integer[],
  "requested_by" uuid not null,
  "status_changed_by" uuid,
  "status_changed_at" timestamp with time zone,
  "created_at" timestamp with time zone not null default now(),
  "legacy_procurement_request_id" uuid,
  "component_id" uuid
);

create table if not exists public."purchase_request_members" (
  "id" uuid not null default gen_random_uuid(),
  "request_id" uuid not null,
  "employee_id" uuid not null,
  "side" text not null,
  "added_by" uuid,
  "added_at" timestamp with time zone not null default now()
);

create table if not exists public."purchase_request_messages" (
  "id" uuid not null default gen_random_uuid(),
  "request_id" uuid not null,
  "author_id" uuid,
  "content" text not null,
  "metadata" jsonb not null default '{}'::jsonb,
  "created_at" timestamp with time zone not null default now()
);

create table if not exists public."purchase_requests" (
  "id" uuid not null default gen_random_uuid(),
  "opportunity_id" uuid,
  "opened_by_action_id" uuid,
  "opened_visit_id" uuid,
  "buyer_id" uuid,
  "created_by" uuid,
  "created_at" timestamp with time zone not null default now(),
  "updated_at" timestamp with time zone not null default now(),
  "access_until" text not null default 'stage_left'::text,
  "access_until_stage_id" uuid,
  "title" text,
  "requesters" jsonb
);

create table if not exists public."push_subscriptions" (
  "id" uuid not null default gen_random_uuid(),
  "employee_id" uuid not null,
  "endpoint" text not null,
  "p256dh" text not null,
  "auth" text not null,
  "created_at" timestamp with time zone not null default timezone('utc'::text, now())
);

create table if not exists public."retail_orders" (
  "id" uuid not null default gen_random_uuid(),
  "created_at" timestamp with time zone not null default now(),
  "updated_at" timestamp with time zone not null default now(),
  "odoo_so_number" text not null,
  "odoo_so_id" integer,
  "marketplace" text not null,
  "partner_name" text not null,
  "buyer_name" text,
  "odoo_salesperson_name" text,
  "amount" numeric not null default 0,
  "ordered_at" timestamp with time zone,
  "odoo_state" text,
  "is_excluded" boolean not null default false,
  "excluded_reason" text,
  "source" text not null default 'sync'::text,
  "marketplace_order_id" text,
  "marketplace_fee" numeric,
  "order_income" numeric
);

create table if not exists public."revenue_activity_logs" (
  "id" uuid not null default gen_random_uuid(),
  "revenue_log_id" bigint,
  "author_id" uuid,
  "content" text not null,
  "type" text not null default 'SYSTEM'::text,
  "metadata" jsonb default '{}'::jsonb,
  "created_at" timestamp with time zone default now()
);

create table if not exists public."sale_types" (
  "id" uuid not null default gen_random_uuid(),
  "name" text not null,
  "created_by" uuid,
  "created_at" timestamp with time zone not null default now(),
  "updated_at" timestamp with time zone not null default now(),
  "archived_at" timestamp with time zone
);

create table if not exists public."sales_custom_templates" (
  "id" uuid not null default gen_random_uuid(),
  "employee_id" uuid not null,
  "template_name" text not null,
  "template_payload" jsonb not null,
  "created_at" timestamp with time zone not null default timezone('utc'::text, now())
);

create table if not exists public."sales_flows" (
  "id" uuid not null default gen_random_uuid(),
  "sale_type_id" uuid not null,
  "state" text not null default 'draft'::text,
  "won_stage_id" uuid,
  "locked_at" timestamp with time zone,
  "locked_by" uuid,
  "created_at" timestamp with time zone not null default now(),
  "updated_at" timestamp with time zone not null default now()
);

create table if not exists public."sales_opportunities" (
  "id" uuid not null default gen_random_uuid(),
  "opportunity_no" text,
  "registration_date" date not null default CURRENT_DATE,
  "registered_at" timestamp with time zone not null default now(),
  "registered_by" uuid not null,
  "lead_source" text not null,
  "lead_source_detail" text,
  "client_name" text not null,
  "contact_person" text,
  "project_title" text not null,
  "project_type" text not null default 'SSP'::text,
  "expected_value" numeric(18,2) not null default 0,
  "expected_award_date" date,
  "deal_owner_id" uuid,
  "support_sales_1_id" uuid,
  "support_sales_2_id" uuid,
  "sales_director_id" uuid,
  "status" text not null default 'LEAD'::text,
  "lost_reason" text,
  "is_deleted" boolean not null default false,
  "created_at" timestamp with time zone not null default now(),
  "updated_at" timestamp with time zone not null default now(),
  "sales_reference" text,
  "contract_date" date,
  "closing_sales_id" uuid,
  "itb_number" text,
  "itb_exempt" boolean not null default false,
  "po_date" date,
  "is_scratch" boolean not null default false,
  "sale_type_id" uuid,
  "flow_stage_id" uuid,
  "metadata" jsonb default '{}'::jsonb,
  "odoo_partner_id" bigint,
  "flow_snapshot_id" uuid,
  "is_retail" boolean not null default false,
  "serial_no" bigint not null generated by default as identity,
  "deleted_at" timestamp with time zone,
  "deleted_by" uuid,
  "sor_code" text
);

create table if not exists public."sales_opportunity_items" (
  "id" uuid not null default gen_random_uuid(),
  "opportunity_id" uuid not null,
  "product_name" text not null,
  "unit" text,
  "quantity" numeric(12,2) not null default 1,
  "unit_price" numeric(18,2) not null default 0,
  "sort_order" integer not null default 0,
  "created_at" timestamp with time zone not null default now(),
  "updated_at" timestamp with time zone not null default now(),
  "odoo_product_id" integer
);

create table if not exists public."sales_opportunity_logs" (
  "id" uuid not null default gen_random_uuid(),
  "opportunity_id" uuid not null,
  "author_id" uuid,
  "type" text not null default 'COMMENT'::text,
  "content" text not null,
  "metadata" jsonb,
  "created_at" timestamp with time zone not null default now(),
  "stage_visit_id" uuid
);

create table if not exists public."sales_opportunity_members" (
  "id" uuid not null default gen_random_uuid(),
  "opportunity_id" uuid not null,
  "employee_id" uuid not null,
  "added_by" uuid,
  "added_at" timestamp with time zone not null default now()
);

create table if not exists public."sil_leaves" (
  "id" uuid not null default gen_random_uuid(),
  "created_at" timestamp with time zone not null default now(),
  "employee_id" uuid not null,
  "date" date not null,
  "hours" numeric not null,
  "reason" text not null,
  "status" text not null default 'PENDING'::text,
  "hr_notes" text,
  "hr_processed_by" uuid,
  "hr_processed_at" timestamp with time zone,
  "attachments" jsonb,
  "start_time" time without time zone,
  "end_time" time without time zone,
  "leave_group_id" uuid not null default gen_random_uuid(),
  "category_id" uuid,
  "verification_token" text default encode(gen_random_bytes(16), 'hex'::text),
  "application_hash" text,
  "approval_hash" text,
  "employee_signature_version" text,
  "employee_signature_timestamp" timestamp with time zone,
  "hr_signature_version" text,
  "hr_signature_timestamp" timestamp with time zone,
  "approval_credits_snapshot" numeric,
  "printed_at" timestamp with time zone,
  "printed_by" uuid,
  "head_id" uuid,
  "head_status" text not null default 'APPROVED'::text,
  "head_note" text,
  "head_decided_at" timestamp with time zone,
  "head_signature_version" text,
  "hr_override" boolean not null default false,
  "company_id" uuid
);

create table if not exists public."sor_action_runs" (
  "id" uuid not null default gen_random_uuid(),
  "opportunity_id" uuid not null,
  "stage_id" uuid not null,
  "action_id" uuid not null,
  "stage_visit_id" uuid,
  "outcome" text not null default 'pending'::text,
  "decider" jsonb,
  "decided_by" uuid,
  "decided_at" timestamp with time zone,
  "task_id" uuid,
  "group_task_id" uuid,
  "created_at" timestamp with time zone not null default now(),
  "closed_off_at" timestamp with time zone,
  "closed_off_reason" text,
  "carried_from_visit_id" uuid,
  "held_at" timestamp with time zone,
  "purchase_request_id" uuid,
  "costing_matrix_id" uuid,
  "packing_list_id" uuid
);

create table if not exists public."sor_canvass_offer_prices" (
  "offer_id" uuid not null,
  "unit_price" numeric(14,2),
  "comparison_rate" numeric(14,6),
  "updated_at" timestamp with time zone not null default now()
);

create table if not exists public."sor_canvass_offers" (
  "id" uuid not null default gen_random_uuid(),
  "canvass_id" uuid not null,
  "brand" text,
  "description" text,
  "source_link" text,
  "brochure" jsonb not null default '[]'::jsonb,
  "remarks" text,
  "lead_time" text,
  "quality_note" text,
  "is_winner" boolean not null default false,
  "sort_order" integer not null default 0,
  "created_by" uuid,
  "created_at" timestamp with time zone not null default now(),
  "updated_at" timestamp with time zone not null default now(),
  "supplier_name" text,
  "odoo_supplier_id" integer,
  "currency" text not null default 'PHP'::text,
  "valid_until" date
);

create table if not exists public."sor_canvass_signoff_events" (
  "id" uuid not null default gen_random_uuid(),
  "canvass_id" uuid not null,
  "kind" text not null,
  "actor_id" uuid,
  "reason" text,
  "offer_count" integer not null default 0,
  "created_at" timestamp with time zone not null default now()
);

create table if not exists public."sor_canvasses" (
  "id" uuid not null default gen_random_uuid(),
  "attachments" jsonb not null default '[]'::jsonb,
  "signed_off_by" uuid,
  "signed_off_at" timestamp with time zone,
  "created_by" uuid,
  "created_at" timestamp with time zone not null default now(),
  "updated_at" timestamp with time zone not null default now(),
  "component_id" uuid,
  "requested_item_id" uuid,
  "number" text,
  "reason" text,
  "product_name" text,
  "canvasser_id" uuid
);

create table if not exists public."sor_condition_status" (
  "id" uuid not null default gen_random_uuid(),
  "opportunity_id" uuid not null,
  "condition_id" uuid not null,
  "satisfied_by" uuid,
  "satisfied_at" timestamp with time zone not null default now(),
  "stage_visit_id" uuid,
  "carried_from_visit_id" uuid
);

create table if not exists public."sor_form_values" (
  "id" uuid not null default gen_random_uuid(),
  "opportunity_id" uuid not null,
  "field_id" uuid not null,
  "value" jsonb,
  "updated_by" uuid,
  "updated_at" timestamp with time zone not null default now()
);

create table if not exists public."sor_inclusions" (
  "id" uuid not null default gen_random_uuid(),
  "opportunity_id" uuid not null,
  "description" text not null,
  "quantity" numeric(12,2) not null default 1,
  "unit" text,
  "note" text,
  "completeness" text not null default 'MISSING'::text,
  "sourcing" text,
  "sort_order" integer not null default 0,
  "created_by" uuid,
  "created_at" timestamp with time zone not null default now(),
  "updated_at" timestamp with time zone not null default now(),
  "cost_amount" numeric(14,2),
  "cost_source" text,
  "cost_established_at" timestamp with time zone
);

create table if not exists public."sor_mention_viewers" (
  "opportunity_id" uuid not null,
  "employee_id" uuid not null,
  "granted_by" uuid,
  "created_at" timestamp with time zone not null default now(),
  "id" uuid not null default gen_random_uuid(),
  "stage_visit_id" uuid
);

create table if not exists public."sor_procurement_requests" (
  "id" uuid not null default gen_random_uuid(),
  "opportunity_id" uuid not null,
  "task_id" uuid,
  "requested_name" text not null,
  "requested_unit" text,
  "requested_quantity" numeric(12,2) not null default 1,
  "requested_description" text,
  "requested_images" jsonb not null default '[]'::jsonb,
  "outcome" text,
  "outcome_note" text,
  "po_number" text,
  "odoo_product_ref" text,
  "eta" date,
  "verification" text not null default 'UNVERIFIED'::text,
  "requested_by" uuid not null,
  "assigned_to" uuid,
  "resolved_by" uuid,
  "resolved_at" timestamp with time zone,
  "created_at" timestamp with time zone not null default now(),
  "updated_at" timestamp with time zone not null default now(),
  "odoo_vendor" text,
  "inclusion_id" uuid
);

create table if not exists public."sor_purchase_order_links" (
  "id" uuid not null default gen_random_uuid(),
  "opportunity_id" uuid not null,
  "po_number" text not null,
  "origin" text not null,
  "is_detached" boolean not null default false,
  "created_by" uuid,
  "created_at" timestamp with time zone not null default now(),
  "updated_at" timestamp with time zone not null default now()
);

create table if not exists public."sor_stage_field_values" (
  "id" uuid not null default gen_random_uuid(),
  "opportunity_id" uuid not null,
  "stage_visit_id" uuid not null,
  "field_id" uuid not null,
  "value" jsonb,
  "updated_by" uuid,
  "updated_at" timestamp with time zone not null default now(),
  "carried_from_visit_id" uuid
);

create table if not exists public."sor_stage_participants" (
  "id" uuid not null default gen_random_uuid(),
  "opportunity_id" uuid not null,
  "employee_id" uuid not null,
  "source" text not null,
  "source_id" uuid,
  "opened_visit_id" uuid not null,
  "until_rule" text not null,
  "until_stage_id" uuid,
  "closed_at" timestamp with time zone,
  "closed_reason" text,
  "removed_by" uuid,
  "created_at" timestamp with time zone not null default now()
);

create table if not exists public."sor_stage_visits" (
  "id" uuid not null default gen_random_uuid(),
  "opportunity_id" uuid not null,
  "flow_stage_id" uuid not null,
  "flow_snapshot_id" uuid,
  "sequence" integer not null,
  "entered_at" timestamp with time zone not null default now(),
  "entered_by" uuid,
  "left_at" timestamp with time zone,
  "left_by" uuid,
  "undone_at" timestamp with time zone,
  "undone_by" uuid,
  "contract_date_stamped" boolean not null default false,
  "return_choice" text,
  "resumed_at" timestamp with time zone,
  "resumed_by" uuid,
  "resumed_into_visit_id" uuid,
  "revert_choice" text,
  "opened_by_revert" boolean not null default false
);

create table if not exists public."sor_stock_snapshots" (
  "opportunity_id" uuid not null,
  "fetched_at" timestamp with time zone not null default now(),
  "fetched_by" uuid,
  "data" jsonb not null default '{}'::jsonb
);

create table if not exists public."stage_conditions" (
  "id" uuid not null default gen_random_uuid(),
  "stage_id" uuid not null,
  "kind" text not null,
  "label" text not null,
  "is_required" boolean not null default true,
  "sort_order" integer not null default 0,
  "config" jsonb not null default '{}'::jsonb,
  "archived_at" timestamp with time zone,
  "created_at" timestamp with time zone not null default now(),
  "updated_at" timestamp with time zone not null default now()
);

create table if not exists public."system_audit_logs" (
  "id" uuid not null default gen_random_uuid(),
  "author_id" uuid,
  "entity_type" text,
  "entity_id" text,
  "content" text not null,
  "type" text not null default 'SYSTEM'::text,
  "metadata" jsonb default '{}'::jsonb,
  "created_at" timestamp with time zone default now()
);

create table if not exists public."system_updates" (
  "id" uuid not null default gen_random_uuid(),
  "content" text not null,
  "created_by" uuid,
  "type" text not null default 'feature'::text,
  "is_active" boolean not null default true,
  "expires_at" timestamp with time zone not null default (now() + '24:00:00'::interval),
  "created_at" timestamp with time zone default now()
);

create table if not exists public."task_activity" (
  "id" uuid not null default gen_random_uuid(),
  "created_at" timestamp with time zone not null default timezone('utc'::text, now()),
  "task_id" uuid not null,
  "author_id" uuid,
  "type" character varying not null,
  "content" text not null,
  "metadata" jsonb
);

create table if not exists public."task_tags" (
  "id" uuid not null default gen_random_uuid(),
  "name" text not null,
  "color" text not null,
  "archived_at" timestamp with time zone,
  "created_by" uuid,
  "created_at" timestamp with time zone not null default now(),
  "updated_at" timestamp with time zone not null default now()
);

create table if not exists public."tasks" (
  "id" uuid not null default gen_random_uuid(),
  "created_at" timestamp with time zone not null default now(),
  "category_id" text,
  "logged_by" uuid,
  "reported_to" uuid,
  "task_description" text,
  "project_title" text,
  "priority" text default 'LOW'::text,
  "status" text default 'INCOMPLETE'::text,
  "remarks" text default ''::text,
  "grade" smallint default '0'::smallint,
  "start_at" timestamp with time zone,
  "end_at" timestamp with time zone,
  "hr_verified" boolean default false,
  "hr_verified_at" timestamp with time zone,
  "hr_remarks" text default ''::text,
  "evaluated_by" uuid,
  "evaluated_at" timestamp with time zone,
  "edited_by" uuid,
  "edited_at" timestamp with time zone,
  "payment_voucher" text,
  "attachment_urls" text[] default '{}'::text[],
  "checklist" jsonb,
  "opportunity_id" uuid,
  "stage_action_id" uuid,
  "stage_visit_id" uuid,
  "cancel_reason" text,
  "held_at" timestamp with time zone,
  "held_prev_status" text,
  "held_from_visit_id" uuid,
  "carried_from_visit_id" uuid,
  "cancelled_by_visit_id" uuid
);

create table if not exists public."transmittal_cleared_signatures" (
  "id" uuid not null default gen_random_uuid(),
  "transmittal_id" uuid not null,
  "kind" text not null,
  "stage" text,
  "slot" integer,
  "signer_id" uuid,
  "signer_name" text,
  "signed_at" timestamp with time zone,
  "other_signer_id" uuid,
  "other_signer_name" text,
  "receipt_ref" text,
  "cleared_by" uuid not null,
  "cleared_at" timestamp with time zone not null default now(),
  "cleared_reason" text not null
);

create table if not exists public."transmittal_ipas" (
  "id" uuid not null default gen_random_uuid(),
  "transmittal_id" uuid not null,
  "ipas_id" uuid not null,
  "created_at" timestamp with time zone not null default now()
);

create table if not exists public."transmittal_lines" (
  "id" uuid not null default gen_random_uuid(),
  "transmittal_id" uuid not null,
  "position" integer not null,
  "kind" text not null,
  "ipas_id" uuid,
  "odoo_po_line_id" integer,
  "description" text not null,
  "quantity" numeric not null,
  "unit" text,
  "opportunity_id" uuid,
  "serial_numbers" text,
  "box_quantity" text,
  "wh_in_charge_id" uuid,
  "wh_rating" text,
  "wh_remark" text,
  "tech_in_charge_id" uuid,
  "tech_rating" text,
  "tech_remark" text,
  "quantity_received" numeric,
  "created_at" timestamp with time zone not null default now()
);

create table if not exists public."transmittal_products" (
  "id" uuid not null default gen_random_uuid(),
  "transmittal_id" uuid not null,
  "option_id" uuid not null,
  "created_at" timestamp with time zone not null default now()
);

create table if not exists public."transmittal_references" (
  "id" uuid not null default gen_random_uuid(),
  "transmittal_id" uuid not null,
  "option_id" uuid not null,
  "created_at" timestamp with time zone not null default now()
);

create table if not exists public."transmittal_sors" (
  "id" uuid not null default gen_random_uuid(),
  "transmittal_id" uuid not null,
  "opportunity_id" uuid not null,
  "created_at" timestamp with time zone not null default now()
);

create table if not exists public."transmittal_stages" (
  "id" uuid not null default gen_random_uuid(),
  "transmittal_id" uuid not null,
  "stage" text not null,
  "remarks" text,
  "no_pictures_reason" text,
  "completed_by" uuid,
  "completed_at" timestamp with time zone,
  "first_signer_id" uuid,
  "first_signed_at" timestamp with time zone,
  "first_confirmed" boolean not null default false,
  "first_signature_declined" boolean not null default false,
  "second_signer_id" uuid,
  "second_signer_name" text,
  "second_signed_at" timestamp with time zone,
  "second_confirmed" boolean not null default false,
  "second_signature_declined" boolean not null default false,
  "created_at" timestamp with time zone not null default now()
);

create table if not exists public."transmittals" (
  "id" uuid not null default gen_random_uuid(),
  "number" text not null default ('TG03-'::text || (nextval('transmittal_number_seq'::regclass))::text),
  "prepared_on" timestamp with time zone not null default now(),
  "origin" text not null,
  "origin_other" text,
  "check_warehouse" boolean not null default false,
  "check_technical" boolean not null default false,
  "check_other" text,
  "priority" text not null,
  "entity" text not null,
  "product_other" text,
  "item_location_id" uuid,
  "odoo_received_by" uuid,
  "odoo_received_at" timestamp with time zone,
  "odoo_receipt_ref" text,
  "state" text not null default 'draft'::text,
  "prepared_by" uuid not null,
  "submitted_at" timestamp with time zone,
  "closed_at" timestamp with time zone,
  "cancelled_by" uuid,
  "cancelled_at" timestamp with time zone,
  "cancel_reason" text,
  "created_at" timestamp with time zone not null default now(),
  "updated_at" timestamp with time zone not null default now(),
  "check_by_first_id" uuid,
  "check_by_first_at" timestamp with time zone,
  "check_by_second_id" uuid,
  "check_by_second_at" timestamp with time zone,
  "check_by_first_signature_declined" boolean not null default false,
  "check_by_second_signature_declined" boolean not null default false
);

create table if not exists public."undertime_requests" (
  "id" uuid not null default gen_random_uuid(),
  "employee_id" uuid not null,
  "date" date not null,
  "hours" numeric not null,
  "status" text not null default 'PENDING'::text,
  "hr_notes" text,
  "created_at" timestamp with time zone not null default now(),
  "updated_at" timestamp with time zone not null default now(),
  "reason" text,
  "attachments" jsonb,
  "original_start_time" time without time zone,
  "original_end_time" time without time zone,
  "actual_start_time" time without time zone,
  "actual_end_time" time without time zone,
  "approved_hours" numeric,
  "category_id" uuid,
  "verification_token" text default encode(gen_random_bytes(16), 'hex'::text),
  "application_hash" text,
  "approval_hash" text,
  "employee_signature_version" text,
  "employee_signature_timestamp" timestamp with time zone,
  "hr_signature_version" text,
  "hr_signature_timestamp" timestamp with time zone,
  "hr_processed_by" uuid,
  "hr_processed_at" timestamp with time zone,
  "printed_at" timestamp with time zone,
  "printed_by" uuid,
  "company_id" uuid,
  "head_id" uuid,
  "head_status" text not null default 'APPROVED'::text,
  "head_note" text,
  "head_decided_at" timestamp with time zone,
  "head_signature_version" text,
  "hr_override" boolean not null default false
);

create table if not exists public."verification_rate_limits" (
  "ip_address" text not null,
  "request_count" integer not null default 1,
  "last_request" timestamp with time zone not null default now()
);

-- ============================================================
-- Constraints (primary key, unique, foreign key, check)
-- ============================================================

alter table app_settings add constraint "app_settings_pkey" PRIMARY KEY (id);
alter table bug_report_notes add constraint "bug_report_notes_pkey" PRIMARY KEY (id);
alter table bug_reports add constraint "bug_reports_pkey" PRIMARY KEY (id);
alter table categories add constraint "categories_pkey" PRIMARY KEY (id);
alter table chat_read_receipts add constraint "chat_read_receipts_pkey" PRIMARY KEY (user_id, entity_type, entity_id);
alter table chat_user_archives add constraint "chat_user_archives_pkey" PRIMARY KEY (user_id, entity_type, entity_id);
alter table commission_departments add constraint "commission_departments_pkey" PRIMARY KEY (id);
alter table commission_positions add constraint "commission_positions_pkey" PRIMARY KEY (id);
alter table commission_rates add constraint "commission_rates_pkey" PRIMARY KEY (id);
alter table commission_splits add constraint "commission_splits_pkey" PRIMARY KEY (id);
alter table committee_roles add constraint "committee_roles_pkey" PRIMARY KEY (id);
alter table committee_task_activity add constraint "committee_task_activity_pkey" PRIMARY KEY (id);
alter table committee_task_logs add constraint "committee_task_logs_pkey" PRIMARY KEY (id);
alter table committee_task_members add constraint "committee_task_members_pkey" PRIMARY KEY (id);
alter table committee_task_tags add constraint "committee_task_tags_pkey" PRIMARY KEY (committee_task_id, tag_id);
alter table committee_tasks add constraint "committee_tasks_pkey" PRIMARY KEY (id);
alter table companies add constraint "companies_pkey" PRIMARY KEY (id);
alter table costing_bid_decisions add constraint "costing_bid_decisions_pkey" PRIMARY KEY (id);
alter table costing_column_bands add constraint "costing_column_bands_pkey" PRIMARY KEY (table_name, column_name);
alter table costing_column_tiers add constraint "costing_column_tiers_pkey" PRIMARY KEY (table_name, column_name);
alter table costing_component_costs add constraint "costing_component_costs_pkey" PRIMARY KEY (component_id);
alter table costing_components add constraint "costing_components_pkey" PRIMARY KEY (id);
alter table costing_cost_rows add constraint "costing_cost_rows_pkey" PRIMARY KEY (id);
alter table costing_evaluation_settings add constraint "costing_evaluation_settings_pkey" PRIMARY KEY (id);
alter table costing_events add constraint "costing_events_pkey" PRIMARY KEY (id);
alter table costing_inclusions add constraint "costing_inclusions_pkey" PRIMARY KEY (id);
alter table costing_markup_presets add constraint "costing_markup_presets_pkey" PRIMARY KEY (id);
alter table costing_matrices add constraint "costing_matrices_pkey" PRIMARY KEY (id);
alter table costing_matrix_money add constraint "costing_matrix_money_pkey" PRIMARY KEY (matrix_id);
alter table costing_settings add constraint "costing_settings_pkey" PRIMARY KEY (id);
alter table costing_signer_lists add constraint "costing_signer_lists_pkey" PRIMARY KEY (id);
alter table costing_signoffs add constraint "costing_signoffs_pkey" PRIMARY KEY (id);
alter table costing_tables add constraint "costing_tables_pkey" PRIMARY KEY (table_name);
alter table costing_tender_line_prices add constraint "costing_tender_line_prices_pkey" PRIMARY KEY (tender_line_id);
alter table costing_tender_lines add constraint "costing_tender_lines_pkey" PRIMARY KEY (id);
alter table costing_virtual_columns add constraint "costing_virtual_columns_pkey" PRIMARY KEY (table_name, column_name);
alter table crm_lead_sources add constraint "crm_lead_sources_pkey" PRIMARY KEY (value);
alter table crm_pipeline_stages add constraint "crm_pipeline_stages_pkey" PRIMARY KEY (code);
alter table currency_rate_currencies add constraint "currency_rate_currencies_pkey" PRIMARY KEY (currency);
alter table currency_rates add constraint "currency_rates_pkey" PRIMARY KEY (id);
alter table employee_group_members add constraint "employee_group_members_pkey" PRIMARY KEY (id);
alter table employee_group_teams add constraint "employee_group_teams_pkey" PRIMARY KEY (id);
alter table employee_groups add constraint "employee_groups_pkey" PRIMARY KEY (id);
alter table employees add constraint "employees_pkey" PRIMARY KEY (id);
alter table faq_data add constraint "faq_data_pkey" PRIMARY KEY (id);
alter table flow_access_settings add constraint "flow_access_settings_pkey" PRIMARY KEY (flow_id);
alter table flow_edges add constraint "flow_edges_pkey" PRIMARY KEY (id);
alter table flow_form_fields add constraint "flow_form_fields_pkey" PRIMARY KEY (id);
alter table flow_snapshots add constraint "flow_snapshots_pkey" PRIMARY KEY (id);
alter table flow_stage_access add constraint "flow_stage_access_pkey" PRIMARY KEY (stage_id);
alter table flow_stage_actions add constraint "flow_stage_actions_pkey" PRIMARY KEY (id);
alter table flow_stage_fields add constraint "flow_stage_fields_pkey" PRIMARY KEY (id);
alter table flow_stage_follow_ups add constraint "flow_stage_follow_ups_pkey" PRIMARY KEY (stage_id);
alter table flow_stages add constraint "flow_stages_pkey" PRIMARY KEY (id);
alter table group_task_template_members add constraint "group_task_template_members_pkey" PRIMARY KEY (id);
alter table group_task_templates add constraint "group_task_templates_pkey" PRIMARY KEY (id);
alter table hr_day_shift_config add constraint "hr_day_shift_config_pkey" PRIMARY KEY (weekday);
alter table hr_leave_categories add constraint "hr_leave_categories_pkey" PRIMARY KEY (id);
alter table ipas add constraint "ipas_pkey" PRIMARY KEY (id);
alter table ipas_bank_details add constraint "ipas_bank_details_pkey" PRIMARY KEY (ipas_id);
alter table ipas_charges add constraint "ipas_charges_pkey" PRIMARY KEY (id);
alter table ipas_documents add constraint "ipas_documents_pkey" PRIMARY KEY (id);
alter table ipas_events add constraint "ipas_events_pkey" PRIMARY KEY (id);
alter table ipas_options add constraint "ipas_options_pkey" PRIMARY KEY (id);
alter table ipas_payments add constraint "ipas_payments_pkey" PRIMARY KEY (id);
alter table ipas_signer_list_log add constraint "ipas_signer_list_log_pkey" PRIMARY KEY (id);
alter table ipas_signer_lists add constraint "ipas_signer_lists_pkey" PRIMARY KEY (id);
alter table ipas_signoffs add constraint "ipas_signoffs_pkey" PRIMARY KEY (id);
alter table ipas_sors add constraint "ipas_sors_pkey" PRIMARY KEY (id);
alter table notifications add constraint "notifications_pkey" PRIMARY KEY (id);
alter table odoo_retail_queue add constraint "odoo_retail_queue_pkey" PRIMARY KEY (id);
alter table offset_leaves add constraint "offset_leaves_pkey" PRIMARY KEY (id);
alter table order_ageing_rules add constraint "order_ageing_rules_pkey" PRIMARY KEY (step);
alter table order_deadline_setting add constraint "order_deadline_setting_pkey" PRIMARY KEY (id);
alter table overtime_requests add constraint "overtime_requests_pkey" PRIMARY KEY (id);
alter table packing_list_boxes add constraint "packing_list_boxes_pkey" PRIMARY KEY (id);
alter table packing_list_contents add constraint "packing_list_contents_pkey" PRIMARY KEY (id);
alter table packing_lists add constraint "packing_lists_pkey" PRIMARY KEY (id);
alter table pms_evidence add constraint "pms_evidence_pkey" PRIMARY KEY (id);
alter table pms_handoff_events add constraint "pms_handoff_events_pkey" PRIMARY KEY (id);
alter table purchase_request_item_prices add constraint "purchase_request_item_prices_pkey" PRIMARY KEY (item_id);
alter table purchase_request_items add constraint "purchase_request_items_pkey" PRIMARY KEY (id);
alter table purchase_request_members add constraint "purchase_request_members_pkey" PRIMARY KEY (id);
alter table purchase_request_messages add constraint "purchase_request_messages_pkey" PRIMARY KEY (id);
alter table purchase_requests add constraint "purchase_requests_pkey" PRIMARY KEY (id);
alter table push_subscriptions add constraint "push_subscriptions_pkey" PRIMARY KEY (id);
alter table retail_orders add constraint "retail_orders_pkey" PRIMARY KEY (id);
alter table revenue_activity_logs add constraint "revenue_activity_logs_pkey" PRIMARY KEY (id);
alter table sale_types add constraint "sale_types_pkey" PRIMARY KEY (id);
alter table sales_custom_templates add constraint "sales_custom_templates_pkey" PRIMARY KEY (id);
alter table sales_flows add constraint "sales_flows_pkey" PRIMARY KEY (id);
alter table sales_opportunities add constraint "sales_opportunities_pkey" PRIMARY KEY (id);
alter table sales_opportunity_items add constraint "sales_opportunity_items_pkey" PRIMARY KEY (id);
alter table sales_opportunity_logs add constraint "sales_opportunity_logs_pkey" PRIMARY KEY (id);
alter table sales_opportunity_members add constraint "sales_opportunity_members_pkey" PRIMARY KEY (id);
alter table sil_leaves add constraint "sil_leaves_pkey" PRIMARY KEY (id);
alter table sor_action_runs add constraint "sor_action_runs_pkey" PRIMARY KEY (id);
alter table sor_canvass_offer_prices add constraint "sor_canvass_offer_prices_pkey" PRIMARY KEY (offer_id);
alter table sor_canvass_offers add constraint "sor_canvass_offers_pkey" PRIMARY KEY (id);
alter table sor_canvass_signoff_events add constraint "sor_canvass_signoff_events_pkey" PRIMARY KEY (id);
alter table sor_canvasses add constraint "sor_canvasses_pkey" PRIMARY KEY (id);
alter table sor_condition_status add constraint "sor_requirement_status_pkey" PRIMARY KEY (id);
alter table sor_form_values add constraint "sor_form_values_pkey" PRIMARY KEY (id);
alter table sor_inclusions add constraint "sor_inclusions_pkey" PRIMARY KEY (id);
alter table sor_mention_viewers add constraint "sor_mention_viewers_pkey" PRIMARY KEY (id);
alter table sor_procurement_requests add constraint "sor_procurement_requests_pkey" PRIMARY KEY (id);
alter table sor_purchase_order_links add constraint "sor_purchase_order_links_pkey" PRIMARY KEY (id);
alter table sor_stage_field_values add constraint "sor_stage_field_values_pkey" PRIMARY KEY (id);
alter table sor_stage_participants add constraint "sor_stage_participants_pkey" PRIMARY KEY (id);
alter table sor_stage_visits add constraint "sor_stage_visits_pkey" PRIMARY KEY (id);
alter table sor_stock_snapshots add constraint "sor_stock_snapshots_pkey" PRIMARY KEY (opportunity_id);
alter table stage_conditions add constraint "stage_requirements_pkey" PRIMARY KEY (id);
alter table system_audit_logs add constraint "system_audit_logs_pkey" PRIMARY KEY (id);
alter table system_updates add constraint "system_updates_pkey" PRIMARY KEY (id);
alter table task_activity add constraint "task_activity_pkey" PRIMARY KEY (id);
alter table task_tags add constraint "task_tags_pkey" PRIMARY KEY (id);
alter table tasks add constraint "tasks_pkey" PRIMARY KEY (id);
alter table transmittal_cleared_signatures add constraint "transmittal_cleared_signatures_pkey" PRIMARY KEY (id);
alter table transmittal_ipas add constraint "transmittal_ipas_pkey" PRIMARY KEY (id);
alter table transmittal_lines add constraint "transmittal_lines_pkey" PRIMARY KEY (id);
alter table transmittal_products add constraint "transmittal_products_pkey" PRIMARY KEY (id);
alter table transmittal_references add constraint "transmittal_references_pkey" PRIMARY KEY (id);
alter table transmittal_sors add constraint "transmittal_sors_pkey" PRIMARY KEY (id);
alter table transmittal_stages add constraint "transmittal_stages_pkey" PRIMARY KEY (id);
alter table transmittals add constraint "transmittals_pkey" PRIMARY KEY (id);
alter table undertime_requests add constraint "undertime_requests_pkey" PRIMARY KEY (id);
alter table verification_rate_limits add constraint "verification_rate_limits_pkey" PRIMARY KEY (ip_address);
alter table categories add constraint "categories_category_id_key" UNIQUE (category_id);
alter table commission_departments add constraint "commission_departments_key_key" UNIQUE (key);
alter table commission_departments add constraint "commission_departments_name_key" UNIQUE (name);
alter table commission_positions add constraint "commission_positions_unique_name_per_department" UNIQUE (department_id, name);
alter table commission_rates add constraint "commission_rates_unique_type_date" UNIQUE (rate_type, effective_from);
alter table commission_splits add constraint "commission_splits_unique_role" UNIQUE (project_type, share_role);
alter table committee_roles add constraint "committee_roles_role_name_key" UNIQUE (role_name);
alter table costing_matrices add constraint "costing_matrices_opportunity_key" UNIQUE (opportunity_id);
alter table costing_signer_lists add constraint "costing_signer_lists_unique" UNIQUE (list_key, employee_id);
alter table currency_rates add constraint "currency_rates_currency_day_key" UNIQUE (currency, rate_date);
alter table employee_group_members add constraint "employee_group_members_group_employee_key" UNIQUE (group_id, employee_id);
alter table employee_group_teams add constraint "employee_group_teams_group_team_key" UNIQUE (group_id, team);
alter table flow_edges add constraint "flow_edges_unique" UNIQUE (flow_id, from_stage_id, to_stage_id);
alter table flow_form_fields add constraint "flow_form_fields_default_unique" UNIQUE (flow_id, default_key);
alter table flow_snapshots add constraint "flow_snapshots_version_unique" UNIQUE (flow_id, version, version_minor);
alter table flow_stages add constraint "flow_stages_flow_scoped_key" UNIQUE (flow_id, id);
alter table ipas add constraint "ipas_number_key" UNIQUE (number);
alter table ipas_signer_lists add constraint "ipas_signer_lists_key_employee_key" UNIQUE (list_key, employee_id);
alter table ipas_sors add constraint "ipas_sors_ipas_opportunity_key" UNIQUE (ipas_id, opportunity_id);
alter table odoo_retail_queue add constraint "odoo_retail_queue_odoo_so_number_key" UNIQUE (odoo_so_number);
alter table offset_leaves add constraint "offset_leaves_verification_token_key" UNIQUE (verification_token);
alter table overtime_requests add constraint "overtime_requests_verification_token_key" UNIQUE (verification_token);
alter table packing_list_boxes add constraint "packing_list_boxes_key" UNIQUE (packing_list_id, box_no);
alter table packing_list_contents add constraint "packing_list_contents_key" UNIQUE (box_id, "position");
alter table packing_lists add constraint "packing_lists_number_key" UNIQUE (number);
alter table pms_evidence add constraint "pms_evidence_path_key" UNIQUE (storage_path);
alter table purchase_request_members add constraint "purchase_request_members_request_employee_key" UNIQUE (request_id, employee_id);
alter table push_subscriptions add constraint "push_subscriptions_employee_endpoint_key" UNIQUE (employee_id, endpoint);
alter table retail_orders add constraint "retail_orders_odoo_so_number_key" UNIQUE (odoo_so_number);
alter table sales_flows add constraint "sales_flows_sale_type_id_key" UNIQUE (sale_type_id);
alter table sales_opportunities add constraint "sales_opportunities_opportunity_no_key" UNIQUE (opportunity_no);
alter table sales_opportunities add constraint "sales_opportunities_serial_no_key" UNIQUE (serial_no);
alter table sales_opportunities add constraint "sales_opportunities_sor_code_key" UNIQUE (sor_code);
alter table sales_opportunity_members add constraint "sales_opportunity_members_unique" UNIQUE (opportunity_id, employee_id);
alter table sil_leaves add constraint "sil_leaves_verification_token_key" UNIQUE (verification_token);
alter table sor_condition_status add constraint "sor_condition_status_visit_unique" UNIQUE (stage_visit_id, condition_id);
alter table sor_form_values add constraint "sor_form_values_unique" UNIQUE (opportunity_id, field_id);
alter table sor_mention_viewers add constraint "sor_mention_viewers_window_key" UNIQUE NULLS NOT DISTINCT (opportunity_id, employee_id, stage_visit_id);
alter table sor_purchase_order_links add constraint "sor_purchase_order_links_unique" UNIQUE (opportunity_id, po_number);
alter table sor_stage_field_values add constraint "sor_stage_field_values_unique" UNIQUE (stage_visit_id, field_id);
alter table sor_stage_visits add constraint "sor_stage_visits_unique_sequence" UNIQUE (opportunity_id, sequence);
alter table transmittal_ipas add constraint "transmittal_ipas_key" UNIQUE (transmittal_id, ipas_id);
alter table transmittal_lines add constraint "transmittal_lines_position_key" UNIQUE (transmittal_id, "position");
alter table transmittal_products add constraint "transmittal_products_key" UNIQUE (transmittal_id, option_id);
alter table transmittal_references add constraint "transmittal_references_key" UNIQUE (transmittal_id, option_id);
alter table transmittal_sors add constraint "transmittal_sors_key" UNIQUE (transmittal_id, opportunity_id);
alter table transmittal_stages add constraint "transmittal_stages_key" UNIQUE (transmittal_id, stage);
alter table transmittals add constraint "transmittals_number_key" UNIQUE (number);
alter table undertime_requests add constraint "undertime_requests_verification_token_key" UNIQUE (verification_token);
alter table app_settings add constraint "app_settings_id_check" CHECK ((id = true));
alter table bug_report_notes add constraint "bug_report_notes_kind_check" CHECK ((kind = ANY (ARRAY['note'::text, 'resolved'::text, 'reopened'::text])));
alter table bug_reports add constraint "bug_reports_description_check" CHECK ((length(btrim(description)) > 0));
alter table chat_read_receipts add constraint "chat_read_receipts_entity_type_check" CHECK ((entity_type = ANY (ARRAY['TASK'::text, 'SALES'::text, 'COMMITTEE_TASK'::text, 'GROUP_TASK'::text])));
alter table commission_rates add constraint "commission_rates_rate_type_chk" CHECK ((rate_type = ANY (ARRAY['VAT'::text, 'WITHHOLDING'::text, 'POOL'::text, 'RETENTION'::text])));
alter table commission_splits add constraint "commission_splits_project_type_chk" CHECK ((project_type = ANY (ARRAY['SSP'::text, 'CP'::text, 'STRATEGIC'::text])));
alter table commission_splits add constraint "commission_splits_share_role_chk" CHECK ((share_role = ANY (ARRAY['deal_owner'::text, 'supporting_salesperson'::text, 'closing_salesperson'::text, 'sales_director'::text])));
alter table costing_bid_decisions add constraint "costing_bid_decisions_cleared_chk" CHECK (((cleared_at IS NULL) = (cleared_reason IS NULL)));
alter table costing_bid_decisions add constraint "costing_bid_decisions_reason_chk" CHECK ((length(btrim(reason)) > 0));
alter table costing_bid_decisions add constraint "costing_bid_decisions_verdict_chk" CHECK ((verdict = ANY (ARRAY['go'::text, 'no_go'::text, 'revise'::text])));
alter table costing_column_bands add constraint "costing_column_bands_bands_chk" CHECK ((bands <@ ARRAY['sales'::text, 'purchasing'::text, 'management'::text, 'technical'::text, 'finance'::text, 'super_admin_only'::text]));
alter table costing_column_tiers add constraint "costing_column_tiers_tiers_chk" CHECK ((tiers <@ ARRAY['participant'::text, 'price'::text, 'cost'::text, 'closed_book'::text]));
alter table costing_component_costs add constraint "costing_component_costs_acquire_chk" CHECK (((acquire_unit IS NULL) OR (acquire_unit >= (0)::numeric)));
alter table costing_component_costs add constraint "costing_component_costs_factor_chk" CHECK (((markup_factor IS NULL) OR (markup_factor > (0)::numeric)));
alter table costing_component_costs add constraint "costing_component_costs_final_chk" CHECK (((final_acquire_unit IS NULL) OR (final_acquire_unit >= (0)::numeric)));
alter table costing_component_costs add constraint "costing_component_costs_odoo_chk" CHECK (((odoo_unit IS NULL) OR (odoo_unit >= (0)::numeric)));
alter table costing_components add constraint "costing_components_availability_chk" CHECK (((availability IS NULL) OR (availability = ANY (ARRAY['available'::text, 'for_order'::text]))));
alter table costing_components add constraint "costing_components_compliance_chk" CHECK (((compliance IS NULL) OR (compliance = ANY (ARRAY['complies'::text, 'deviates'::text]))));
alter table costing_components add constraint "costing_components_deviation_note_chk" CHECK (((compliance IS DISTINCT FROM 'deviates'::text) OR (NULLIF(btrim(compliance_note), ''::text) IS NOT NULL)));
alter table costing_components add constraint "costing_components_quantity_chk" CHECK ((quantity > (0)::numeric));
alter table costing_components add constraint "costing_components_source_chk" CHECK (((source IS NULL) OR (source = ANY (ARRAY['local'::text, 'import'::text]))));
alter table costing_components add constraint "costing_components_status_chk" CHECK (((status IS NULL) OR (status = ANY (ARRAY['source_out'::text, 'stockable'::text]))));
alter table costing_cost_rows add constraint "costing_cost_rows_acquire_chk" CHECK (((acquire_unit IS NULL) OR (acquire_unit >= (0)::numeric)));
alter table costing_cost_rows add constraint "costing_cost_rows_factor_chk" CHECK (((markup_factor IS NULL) OR (markup_factor > (0)::numeric)));
alter table costing_cost_rows add constraint "costing_cost_rows_final_chk" CHECK (((final_acquire_unit IS NULL) OR (final_acquire_unit >= (0)::numeric)));
alter table costing_cost_rows add constraint "costing_cost_rows_odoo_chk" CHECK (((odoo_unit IS NULL) OR (odoo_unit >= (0)::numeric)));
alter table costing_cost_rows add constraint "costing_cost_rows_quantity_chk" CHECK ((quantity > (0)::numeric));
alter table costing_evaluation_settings add constraint "costing_evaluation_settings_single" CHECK (id);
alter table costing_events add constraint "costing_events_kind_chk" CHECK ((kind = ANY (ARRAY['added'::text, 'changed'::text, 'removed'::text])));
alter table costing_inclusions add constraint "costing_inclusions_completeness_chk" CHECK ((completeness = ANY (ARRAY['COVERED'::text, 'MISSING'::text, 'SUBSTITUTED'::text, 'NOT_REQUIRED'::text])));
alter table costing_inclusions add constraint "costing_inclusions_quantity_chk" CHECK ((quantity > (0)::numeric));
alter table costing_markup_presets add constraint "costing_markup_presets_factor_chk" CHECK ((factor > (0)::numeric));
alter table costing_matrix_money add constraint "costing_matrix_money_factor_chk" CHECK (((default_factor IS NULL) OR (default_factor > (0)::numeric)));
alter table costing_matrix_money add constraint "costing_matrix_money_marketing_chk" CHECK (((marketing IS NULL) OR (marketing >= (0)::numeric)));
alter table costing_matrix_money add constraint "costing_matrix_money_opex_chk" CHECK (((opex IS NULL) OR (opex >= (0)::numeric)));
alter table costing_settings add constraint "costing_settings_allowance_chk" CHECK ((itr_allowance >= (0)::numeric));
alter table costing_settings add constraint "costing_settings_itr_chk" CHECK (((itr_rate >= (0)::numeric) AND (itr_rate <= (1)::numeric)));
alter table costing_settings add constraint "costing_settings_retention_chk" CHECK (((retention_rate >= (0)::numeric) AND (retention_rate <= (1)::numeric)));
alter table costing_settings add constraint "costing_settings_single_chk" CHECK ((id = 1));
alter table costing_settings add constraint "costing_settings_tax_chk" CHECK (((tax_rate >= (0)::numeric) AND (tax_rate <= (1)::numeric)));
alter table costing_settings add constraint "costing_settings_vat_chk" CHECK ((vat_divisor >= (1)::numeric));
alter table costing_signer_lists add constraint "costing_signer_lists_key_chk" CHECK ((list_key = ANY (ARRAY['final_acquire'::text, 'evaluation'::text])));
alter table costing_signoffs add constraint "costing_signoffs_cleared_chk" CHECK ((((cleared_at IS NULL) AND (cleared_reason IS NULL)) OR ((cleared_at IS NOT NULL) AND (NULLIF(btrim(cleared_reason), ''::text) IS NOT NULL))));
alter table costing_signoffs add constraint "costing_signoffs_role_chk" CHECK ((role = ANY (ARRAY['prepared'::text, 'costed'::text, 'evaluation_approved'::text, 'final_approved'::text])));
alter table costing_tender_line_prices add constraint "costing_tender_line_prices_abc_chk" CHECK (((abc_unit IS NULL) OR (abc_unit >= (0)::numeric)));
alter table costing_tender_line_prices add constraint "costing_tender_line_prices_offer_chk" CHECK (((final_offer_unit IS NULL) OR (final_offer_unit >= (0)::numeric)));
alter table costing_tender_lines add constraint "costing_tender_lines_quantity_chk" CHECK ((quantity > (0)::numeric));
alter table costing_tender_lines add constraint "costing_tender_lines_source_chk" CHECK ((source = ANY (ARRAY['typed'::text, 'sor_line'::text])));
alter table currency_rate_currencies add constraint "currency_rate_currencies_currency_check" CHECK (((currency ~ '^[A-Z]{3}$'::text) AND (currency <> 'PHP'::text)));
alter table currency_rate_currencies add constraint "currency_rate_currencies_divergence_pct_check" CHECK ((divergence_pct > (0)::numeric));
alter table currency_rates add constraint "currency_rates_php_per_unit_check" CHECK ((php_per_unit > (0)::numeric));
alter table employees add constraint "employees_call_sign_chk" CHECK (((call_sign IS NULL) OR ((length(btrim(call_sign)) > 0) AND (call_sign = btrim(call_sign)))));
alter table faq_data add constraint "faq_data_id_check" CHECK ((id = 1));
alter table flow_edges add constraint "flow_edges_no_self_loop" CHECK ((from_stage_id <> to_stage_id));
alter table flow_form_fields add constraint "flow_form_fields_custom_shape_chk" CHECK (((source <> 'custom'::text) OR ((label IS NOT NULL) AND (btrim(label) <> ''::text) AND (field_type IS NOT NULL))));
alter table flow_form_fields add constraint "flow_form_fields_default_key_chk" CHECK ((((source = 'default'::text) AND (default_key IS NOT NULL)) OR ((source = 'custom'::text) AND (default_key IS NULL))));
alter table flow_form_fields add constraint "flow_form_fields_source_chk" CHECK ((source = ANY (ARRAY['default'::text, 'custom'::text])));
alter table flow_form_fields add constraint "flow_form_fields_type_chk" CHECK (((field_type IS NULL) OR (field_type = ANY (ARRAY['text'::text, 'number'::text, 'date'::text, 'choice'::text]))));
alter table flow_stage_actions add constraint "flow_stage_actions_kind_chk" CHECK ((kind = ANY (ARRAY['create_group_task'::text, 'create_individual_task'::text, 'open_purchase_request'::text, 'open_costing_matrix'::text, 'request_packing_list'::text])));
alter table flow_stage_fields add constraint "flow_stage_fields_label_not_blank" CHECK ((btrim(label) <> ''::text));
alter table flow_stage_fields add constraint "flow_stage_fields_sor_field_chk" CHECK ((((source = 'sor'::text) AND (sor_field IS NOT NULL)) OR ((source = 'custom'::text) AND (sor_field IS NULL))));
alter table flow_stage_fields add constraint "flow_stage_fields_source_chk" CHECK ((source = ANY (ARRAY['sor'::text, 'custom'::text])));
alter table flow_stage_fields add constraint "flow_stage_fields_type_chk" CHECK ((field_type = ANY (ARRAY['text'::text, 'number'::text, 'date'::text, 'choice'::text])));
alter table flow_stage_follow_ups add constraint "flow_stage_follow_ups_days_when_enabled" CHECK (((NOT enabled) OR (every_days IS NOT NULL)));
alter table flow_stage_follow_ups add constraint "flow_stage_follow_ups_every_days_check" CHECK (((every_days IS NULL) OR (every_days > 0)));
alter table flow_stages add constraint "flow_stages_color_check" CHECK (((color IS NULL) OR (color = ANY (ARRAY['tomato'::text, 'red'::text, 'crimson'::text, 'pink'::text, 'plum'::text, 'violet'::text, 'indigo'::text, 'blue'::text, 'sky'::text, 'cyan'::text, 'teal'::text, 'jade'::text, 'green'::text, 'lime'::text, 'yellow'::text, 'amber'::text, 'orange'::text, 'gold'::text, 'brown'::text, 'mauve'::text]))));
alter table flow_stages add constraint "flow_stages_name_not_blank" CHECK ((btrim(name) <> ''::text));
alter table flow_stages add constraint "flow_stages_terminal_outcome_chk" CHECK (((terminal_outcome IS NULL) OR (is_terminal AND (terminal_outcome = ANY (ARRAY['won'::text, 'lost'::text])))));
alter table hr_day_shift_config add constraint "hr_day_shift_config_weekday_check" CHECK (((weekday >= 0) AND (weekday <= 6)));
alter table ipas add constraint "ipas_actual_checking_pair_chk" CHECK (((actual_checking_by IS NULL) = (actual_checking_at IS NULL)));
alter table ipas add constraint "ipas_cancelled_chk" CHECK (((state <> 'cancelled'::text) OR ((cancelled_at IS NOT NULL) AND (cancel_reason IS NOT NULL) AND (length(btrim(cancel_reason)) > 0))));
alter table ipas add constraint "ipas_change_note_chk" CHECK (((odoo_change_note IS NULL) OR (jsonb_typeof(odoo_change_note) = 'object'::text)));
alter table ipas add constraint "ipas_computation_status_chk" CHECK ((computation_status = ANY (ARRAY['encoding'::text, 'encoded'::text, 'lc_gs_done'::text, 'lc_odoo_done'::text])));
alter table ipas add constraint "ipas_import_clearance_import_chk" CHECK (((source = 'import'::text) OR (import_clearance_on IS NULL)));
alter table ipas add constraint "ipas_landed_cost_split_chk" CHECK ((landed_cost_split = ANY (ARRAY['value'::text, 'quantity'::text, 'equal'::text])));
alter table ipas add constraint "ipas_odoo_copy_chk" CHECK ((jsonb_typeof(odoo_copy) = 'object'::text));
alter table ipas add constraint "ipas_on_hold_note_chk" CHECK ((on_hold OR (on_hold_note IS NULL)));
alter table ipas add constraint "ipas_overrides_chk" CHECK ((((entity_override IS NULL) OR (length(btrim(entity_override)) > 0)) AND ((source_doc_override IS NULL) OR (length(btrim(source_doc_override)) > 0)) AND ((analytic_override IS NULL) OR (length(btrim(analytic_override)) > 0))));
alter table ipas add constraint "ipas_pi_qt_amount_chk" CHECK (((pi_qt_amount IS NULL) OR (pi_qt_amount >= (0)::numeric)));
alter table ipas add constraint "ipas_po_number_chk" CHECK ((po_number ~ '^P[0-9]+$'::text));
alter table ipas add constraint "ipas_priority_chk" CHECK ((priority = ANY (ARRAY['very_high'::text, 'high'::text, 'medium'::text])));
alter table ipas add constraint "ipas_purpose_chk" CHECK ((purpose = ANY (ARRAY['project'::text, 'inventory'::text, 'supplies'::text, 'events'::text])));
alter table ipas add constraint "ipas_source_chk" CHECK ((source = ANY (ARRAY['import'::text, 'local'::text])));
alter table ipas add constraint "ipas_state_chk" CHECK ((state = ANY (ARRAY['open'::text, 'filed'::text, 'cancelled'::text])));
alter table ipas add constraint "ipas_supplier_origin_import_chk" CHECK (((source = 'import'::text) OR ((shipped_out_on IS NULL) AND (onboard_on IS NULL) AND (arrived_in_ph_on IS NULL) AND (arrived_in_whs_on IS NULL))));
alter table ipas_bank_details add constraint "ipas_bank_details_account_name_chk" CHECK (((account_name IS NULL) OR (length(account_name) <= 200)));
alter table ipas_bank_details add constraint "ipas_bank_details_account_number_chk" CHECK (((account_number IS NULL) OR (length(account_number) <= 100)));
alter table ipas_bank_details add constraint "ipas_bank_details_bank_name_chk" CHECK (((bank_name IS NULL) OR (length(bank_name) <= 200)));
alter table ipas_charges add constraint "ipas_charges_amount_chk" CHECK ((amount_php > (0)::numeric));
alter table ipas_documents add constraint "ipas_documents_attachment_url_chk" CHECK (((attachment_url IS NULL) OR (attachment_url ~* '^https?://'::text)));
alter table ipas_documents add constraint "ipas_documents_kind_or_label_chk" CHECK ((((kind_id IS NOT NULL) AND (label IS NULL)) OR ((kind_id IS NULL) AND (label IS NOT NULL) AND (length(btrim(label)) > 0) AND (length(label) <= 200))));
alter table ipas_events add constraint "ipas_events_detail_chk" CHECK ((jsonb_typeof(detail) = 'object'::text));
alter table ipas_events add constraint "ipas_events_kind_chk" CHECK ((length(btrim(kind)) > 0));
alter table ipas_options add constraint "ipas_options_applies_to_chk" CHECK (((applies_to IS NULL) OR (applies_to = ANY (ARRAY['import'::text, 'local'::text, 'both'::text]))));
alter table ipas_options add constraint "ipas_options_document_columns_chk" CHECK (((list = 'document_kind'::text) OR ((applies_to IS NULL) AND (used_for IS NULL))));
alter table ipas_options add constraint "ipas_options_document_kind_marked_chk" CHECK (((list <> 'document_kind'::text) OR ((applies_to IS NOT NULL) AND (used_for IS NOT NULL))));
alter table ipas_options add constraint "ipas_options_label_chk" CHECK ((length(btrim(label)) > 0));
alter table ipas_options add constraint "ipas_options_list_chk" CHECK ((list = ANY (ARRAY['payment_method'::text, 'charge_kind'::text, 'document_kind'::text, 'freight_service'::text, 'item_location'::text, 'transmittal_product'::text, 'transmittal_reference'::text])));
alter table ipas_options add constraint "ipas_options_used_for_chk" CHECK (((used_for IS NULL) OR (used_for = ANY (ARRAY['documentation'::text, 'filing'::text, 'both'::text]))));
alter table ipas_payments add constraint "ipas_payments_amount_chk" CHECK ((amount > (0)::numeric));
alter table ipas_payments add constraint "ipas_payments_charge_fee_chk" CHECK ((charge_fee_php >= (0)::numeric));
alter table ipas_payments add constraint "ipas_payments_check_no_chk" CHECK (((check_no IS NULL) OR (length(btrim(check_no)) > 0)));
alter table ipas_payments add constraint "ipas_payments_kind_chk" CHECK ((kind = ANY (ARRAY['down_payment'::text, 'payment'::text, 'full_payment'::text, 'shipping_fee'::text])));
alter table ipas_payments add constraint "ipas_payments_php_debited_chk" CHECK (((php_debited IS NULL) OR (php_debited > (0)::numeric)));
alter table ipas_payments add constraint "ipas_payments_proof_url_chk" CHECK (((proof_url IS NULL) OR (proof_url ~* '^https?://'::text)));
alter table ipas_signer_list_log add constraint "ipas_signer_list_log_action_chk" CHECK ((action = ANY (ARRAY['added'::text, 'removed'::text])));
alter table ipas_signer_list_log add constraint "ipas_signer_list_log_key_chk" CHECK ((list_key = ANY (ARRAY['s1_approved'::text, 's3_approved'::text, 's6_approved'::text, 's7_received'::text, 's7_noted'::text, 's7_checked'::text, 's7_approved'::text, 'transmittal_warehouse'::text, 'transmittal_technical'::text, 'transmittal_logistics'::text, 'transmittal_check_by'::text])));
alter table ipas_signer_lists add constraint "ipas_signer_lists_key_chk" CHECK ((list_key = ANY (ARRAY['s1_approved'::text, 's3_approved'::text, 's6_approved'::text, 's7_received'::text, 's7_noted'::text, 's7_checked'::text, 's7_approved'::text, 'transmittal_warehouse'::text, 'transmittal_technical'::text, 'transmittal_logistics'::text, 'transmittal_check_by'::text])));
alter table ipas_signoffs add constraint "ipas_signoffs_cleared_chk" CHECK ((((cleared_at IS NULL) AND (cleared_reason IS NULL) AND (cleared_by IS NULL)) OR ((cleared_at IS NOT NULL) AND (cleared_reason IS NOT NULL) AND (length(btrim(cleared_reason)) > 0))));
alter table ipas_signoffs add constraint "ipas_signoffs_pair_chk" CHECK (_ipas_signoff_pair_ok((section)::integer, role));
alter table ipas_signoffs add constraint "ipas_signoffs_role_chk" CHECK ((role = ANY (ARRAY['prepared'::text, 'approved'::text, 'received'::text, 'noted'::text, 'checked'::text])));
alter table ipas_signoffs add constraint "ipas_signoffs_section_chk" CHECK ((section = ANY (ARRAY[1, 3, 6, 7])));
alter table odoo_retail_queue add constraint "odoo_retail_queue_status_check" CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'dismissed'::text])));
alter table offset_leaves add constraint "offset_leaves_head_status_check" CHECK ((head_status = ANY (ARRAY['PENDING'::text, 'APPROVED'::text, 'REJECTED'::text])));
alter table offset_leaves add constraint "offset_leaves_status_check" CHECK ((status = ANY (ARRAY['PENDING'::text, 'APPROVED'::text, 'REJECTED'::text, 'CANCELLED'::text])));
alter table order_ageing_rules add constraint "order_ageing_rules_days_chk" CHECK (((days IS NULL) OR (days > 0)));
alter table order_ageing_rules add constraint "order_ageing_rules_step_chk" CHECK ((step = ANY (ARRAY['purchase_order'::text, 'with_pop'::text, 'import_clearance'::text, 'delivered'::text, 'received_in_odoo'::text, 'create_bill'::text, 'actual_checking'::text, 'no_transmittal'::text, 'check_open'::text, 'section_3_approval'::text, 'ready_to_file'::text])));
alter table order_deadline_setting add constraint "order_deadline_setting_days_chk" CHECK ((near_days > 0));
alter table order_deadline_setting add constraint "order_deadline_setting_one_row_chk" CHECK ((id = true));
alter table overtime_requests add constraint "overtime_requests_head_status_check" CHECK ((head_status = ANY (ARRAY['PENDING'::text, 'APPROVED'::text, 'REJECTED'::text])));
alter table overtime_requests add constraint "overtime_requests_status_check" CHECK ((status = ANY (ARRAY['PENDING'::text, 'APPROVED_PAID'::text, 'APPROVED_OFFSET'::text, 'REJECTED'::text, 'CANCELLED'::text])));
alter table packing_list_boxes add constraint "packing_list_boxes_box_no_chk" CHECK ((box_no >= 1));
alter table packing_list_boxes add constraint "packing_list_boxes_weight_chk" CHECK (((gross_weight_kg IS NULL) OR (gross_weight_kg >= (0)::numeric)));
alter table packing_list_contents add constraint "packing_list_contents_description_chk" CHECK ((length(btrim(description)) > 0));
alter table packing_list_contents add constraint "packing_list_contents_quantity_chk" CHECK ((quantity > (0)::numeric));
alter table packing_list_contents add constraint "packing_list_contents_snapshot_chk" CHECK (((sor_line_snapshot IS NULL) OR (jsonb_typeof(sor_line_snapshot) = 'object'::text)));
alter table packing_lists add constraint "packing_lists_delivery_ref_chk" CHECK (((odoo_delivery_ref IS NULL) OR (length(btrim(odoo_delivery_ref)) > 0)));
alter table packing_lists add constraint "packing_lists_packed_chk" CHECK (((state <> 'packed'::text) OR ((packed_by IS NOT NULL) AND (packed_at IS NOT NULL))));
alter table packing_lists add constraint "packing_lists_state_chk" CHECK ((state = ANY (ARRAY['draft'::text, 'packed'::text])));
alter table pms_evidence add constraint "pms_evidence_kind_chk" CHECK ((kind = ANY (ARRAY['picture'::text, 'video'::text])));
alter table pms_evidence add constraint "pms_evidence_name_chk" CHECK ((length(btrim(file_name)) > 0));
alter table pms_evidence add constraint "pms_evidence_record_type_chk" CHECK ((record_type = 'transmittal_stage'::text));
alter table pms_evidence add constraint "pms_evidence_size_chk" CHECK (((size_bytes > 0) AND (size_bytes <= 52428800)));
alter table pms_handoff_events add constraint "pms_handoff_events_detail_chk" CHECK ((jsonb_typeof(detail) = 'object'::text));
alter table pms_handoff_events add constraint "pms_handoff_events_kind_chk" CHECK ((length(btrim(kind)) > 0));
alter table pms_handoff_events add constraint "pms_handoff_events_record_type_chk" CHECK ((record_type = ANY (ARRAY['transmittal'::text, 'packing_list'::text])));
alter table purchase_request_item_prices add constraint "purchase_request_item_prices_comparison_rate_check" CHECK (((comparison_rate IS NULL) OR (comparison_rate > (0)::numeric)));
alter table purchase_request_item_prices add constraint "purchase_request_item_prices_currency_check" CHECK ((currency ~ '^[A-Z]{3}$'::text));
alter table purchase_request_items add constraint "purchase_request_items_images_chk" CHECK ((jsonb_typeof(images) = 'array'::text));
alter table purchase_request_items add constraint "purchase_request_items_name_chk" CHECK ((length(btrim(name)) > 0));
alter table purchase_request_items add constraint "purchase_request_items_po_verification_chk" CHECK ((po_verification = ANY (ARRAY['UNVERIFIED'::text, 'VERIFIED'::text, 'PENDING_VERIFICATION'::text, 'NOT_FOUND'::text])));
alter table purchase_request_items add constraint "purchase_request_items_quantity_chk" CHECK ((quantity > (0)::numeric));
alter table purchase_request_items add constraint "purchase_request_items_source_chk" CHECK ((source = ANY (ARRAY['sor_line'::text, 'new'::text, 'component'::text])));
alter table purchase_request_items add constraint "purchase_request_items_status_chk" CHECK ((status = ANY (ARRAY['requested'::text, 'from_stock'::text, 'to_order'::text, 'canvassing'::text, 'ordered'::text, 'received'::text, 'substituted'::text, 'cannot_source'::text, 'cancelled'::text])));
alter table purchase_request_members add constraint "purchase_request_members_side_chk" CHECK ((side = ANY (ARRAY['purchasing'::text, 'sales'::text, 'requester'::text, 'other'::text])));
alter table purchase_requests add constraint "purchase_requests_access_until_chk" CHECK ((access_until = ANY (ARRAY['stage_left'::text, 'stage_entered'::text, 'later_stage_left'::text, 'terminal'::text])));
alter table purchase_requests add constraint "purchase_requests_title_chk" CHECK ((((title IS NULL) OR ((char_length(title) >= 1) AND (char_length(title) <= 120))) AND ((opportunity_id IS NOT NULL) OR (NULLIF(btrim(title), ''::text) IS NOT NULL))));
alter table retail_orders add constraint "retail_orders_source_check" CHECK ((source = ANY (ARRAY['sync'::text, 'queue'::text, 'sor'::text])));
alter table sale_types add constraint "sale_types_name_not_blank" CHECK ((btrim(name) <> ''::text));
alter table sales_flows add constraint "sales_flows_state_chk" CHECK ((state = ANY (ARRAY['draft'::text, 'locked'::text])));
alter table sales_opportunities add constraint "sales_opportunities_flow_pairing_chk" CHECK ((((sale_type_id IS NULL) AND (flow_stage_id IS NULL)) OR ((sale_type_id IS NOT NULL) AND (flow_stage_id IS NOT NULL))));
alter table sales_opportunities add constraint "sales_opportunities_project_type_chk" CHECK ((project_type = ANY (ARRAY['SSP'::text, 'CP'::text, 'STRATEGIC'::text])));
alter table sales_opportunities add constraint "sales_opportunities_sales_reference_chk" CHECK (((sales_reference IS NULL) OR (sales_reference ~ '^S[0-9]+$'::text)));
alter table sales_opportunity_logs add constraint "sales_opportunity_logs_type_chk" CHECK ((type = ANY (ARRAY['COMMENT'::text, 'SYSTEM'::text])));
alter table sil_leaves add constraint "sil_leaves_head_status_check" CHECK ((head_status = ANY (ARRAY['PENDING'::text, 'APPROVED'::text, 'REJECTED'::text])));
alter table sil_leaves add constraint "sil_leaves_hours_check" CHECK ((hours > (0)::numeric));
alter table sil_leaves add constraint "sil_leaves_status_check" CHECK ((status = ANY (ARRAY['PENDING'::text, 'APPROVED'::text, 'REJECTED'::text, 'CANCELLED'::text])));
alter table sor_action_runs add constraint "sor_action_runs_outcome_check" CHECK ((outcome = ANY (ARRAY['pending'::text, 'created'::text, 'skipped'::text, 'failed'::text])));
alter table sor_canvass_offer_prices add constraint "sor_canvass_offer_prices_rate_chk" CHECK (((comparison_rate IS NULL) OR (comparison_rate > (0)::numeric)));
alter table sor_canvass_offers add constraint "sor_canvass_offers_currency_chk" CHECK ((currency ~ '^[A-Z]{3}$'::text));
alter table sor_canvass_signoff_events add constraint "sor_canvass_signoff_events_cleared_reason_chk" CHECK (((kind <> 'cleared'::text) OR (length(btrim(COALESCE(reason, ''::text))) > 0)));
alter table sor_canvass_signoff_events add constraint "sor_canvass_signoff_events_kind_chk" CHECK ((kind = ANY (ARRAY['signed'::text, 'cleared'::text])));
alter table sor_canvasses add constraint "sor_canvasses_at_most_one_subject_chk" CHECK (((((component_id IS NOT NULL))::integer + ((requested_item_id IS NOT NULL))::integer) <= 1));
alter table sor_canvasses add constraint "sor_canvasses_says_what_chk" CHECK (((component_id IS NOT NULL) OR (requested_item_id IS NOT NULL) OR (NULLIF(btrim(COALESCE(product_name, ''::text)), ''::text) IS NOT NULL)));
alter table sor_inclusions add constraint "sor_inclusions_completeness_check" CHECK ((completeness = ANY (ARRAY['COVERED'::text, 'MISSING'::text, 'SUBSTITUTED'::text, 'NOT_REQUIRED'::text])));
alter table sor_inclusions add constraint "sor_inclusions_cost_source_chk" CHECK (((cost_source IS NULL) OR (cost_source = ANY (ARRAY['CANVASS_OFFER'::text, 'ODOO_CATALOG'::text, 'MANUAL'::text]))));
alter table sor_inclusions add constraint "sor_inclusions_sourcing_check" CHECK ((sourcing = ANY (ARRAY['STOCKABLE_AVAILABLE'::text, 'STOCKABLE_NEEDS_ORDERING'::text, 'SOURCE_OUT'::text])));
alter table sor_procurement_requests add constraint "sor_procurement_requests_outcome_check" CHECK ((outcome = ANY (ARRAY['IN_PROGRESS'::text, 'PURCHASED'::text, 'DELIVERED'::text, 'ON_ORDER'::text, 'ALREADY_EXISTS'::text, 'SUBSTITUTED'::text, 'UNAVAILABLE'::text])));
alter table sor_procurement_requests add constraint "sor_procurement_requests_verification_check" CHECK ((verification = ANY (ARRAY['UNVERIFIED'::text, 'VERIFIED'::text, 'PENDING_VERIFICATION'::text, 'NOT_FOUND'::text])));
alter table sor_purchase_order_links add constraint "sor_purchase_order_links_origin_check" CHECK ((origin = ANY (ARRAY['ODOO_ORIGIN'::text, 'MANUAL'::text])));
alter table sor_stage_participants add constraint "sor_stage_participants_source_chk" CHECK ((source = ANY (ARRAY['action'::text, 'assignment'::text, 'purchase_request'::text, 'costing_matrix'::text])));
alter table sor_stage_participants add constraint "sor_stage_participants_until_rule_chk" CHECK ((until_rule = ANY (ARRAY['stage_left'::text, 'stage_entered'::text, 'later_stage_left'::text, 'terminal'::text])));
alter table sor_stage_visits add constraint "sor_stage_visits_return_choice_check" CHECK ((return_choice = ANY (ARRAY['resume'::text, 'start_fresh'::text])));
alter table sor_stage_visits add constraint "sor_stage_visits_revert_choice_check" CHECK ((revert_choice = ANY (ARRAY['keep'::text, 'remove'::text])));
alter table stage_conditions add constraint "stage_conditions_kind_chk" CHECK ((kind = ANY (ARRAY['attachment'::text, 'field'::text, 'tickbox'::text, 'assignment'::text, 'deadline'::text, 'project_evaluation'::text, 'inclusions'::text, 'purchasing'::text, 'purchasing_settled'::text, 'costing_settled'::text, 'costing_priced'::text, 'goods_checked'::text, 'orders_filed'::text])));
alter table task_activity add constraint "task_activity_type_check" CHECK (((type)::text = ANY (ARRAY[('SYSTEM'::character varying)::text, ('COMMENT'::character varying)::text, ('APPROVAL'::character varying)::text, ('HR_NOTE'::character varying)::text])));
alter table task_tags add constraint "task_tags_color_check" CHECK ((color = ANY (ARRAY['mauve'::text, 'amber'::text, 'blue'::text, 'red'::text, 'violet'::text, 'orange'::text, 'green'::text])));
alter table transmittal_cleared_signatures add constraint "transmittal_cleared_signatures_kind_chk" CHECK ((kind = ANY (ARRAY['stage'::text, 'odoo'::text, 'check_by'::text])));
alter table transmittal_cleared_signatures add constraint "transmittal_cleared_signatures_reason_chk" CHECK ((length(btrim(cleared_reason)) > 0));
alter table transmittal_cleared_signatures add constraint "transmittal_cleared_signatures_slot_chk" CHECK ((((kind = 'check_by'::text) = (slot IS NOT NULL)) AND ((slot IS NULL) OR (slot = ANY (ARRAY[1, 2])))));
alter table transmittal_cleared_signatures add constraint "transmittal_cleared_signatures_stage_chk" CHECK ((((kind = 'stage'::text) = (stage IS NOT NULL)) AND ((stage IS NULL) OR (stage = ANY (ARRAY['warehouse_checking'::text, 'warehouse_releasing'::text, 'technical_inspection'::text])))));
alter table transmittal_lines add constraint "transmittal_lines_description_chk" CHECK ((length(btrim(description)) > 0));
alter table transmittal_lines add constraint "transmittal_lines_kind_chk" CHECK ((kind = ANY (ARRAY['po_line'::text, 'typed'::text])));
alter table transmittal_lines add constraint "transmittal_lines_po_chk" CHECK ((((kind = 'po_line'::text) AND (ipas_id IS NOT NULL) AND (odoo_po_line_id IS NOT NULL)) OR ((kind = 'typed'::text) AND (ipas_id IS NULL) AND (odoo_po_line_id IS NULL))));
alter table transmittal_lines add constraint "transmittal_lines_quantity_chk" CHECK ((quantity > (0)::numeric));
alter table transmittal_lines add constraint "transmittal_lines_quantity_received_chk" CHECK (((quantity_received IS NULL) OR (quantity_received >= (0)::numeric)));
alter table transmittal_lines add constraint "transmittal_lines_tech_na_remark_chk" CHECK (((tech_rating IS DISTINCT FROM 'na'::text) OR ((tech_remark IS NOT NULL) AND (length(btrim(tech_remark)) > 0))));
alter table transmittal_lines add constraint "transmittal_lines_tech_rating_chk" CHECK (((tech_rating IS NULL) OR (tech_rating = ANY (ARRAY['gc'::text, 'na'::text]))));
alter table transmittal_lines add constraint "transmittal_lines_wh_na_remark_chk" CHECK (((wh_rating IS DISTINCT FROM 'na'::text) OR ((wh_remark IS NOT NULL) AND (length(btrim(wh_remark)) > 0))));
alter table transmittal_lines add constraint "transmittal_lines_wh_rating_chk" CHECK (((wh_rating IS NULL) OR (wh_rating = ANY (ARRAY['gc'::text, 'na'::text]))));
alter table transmittal_stages add constraint "transmittal_stages_completed_chk" CHECK (((completed_at IS NULL) OR (completed_by IS NOT NULL)));
alter table transmittal_stages add constraint "transmittal_stages_stage_chk" CHECK ((stage = ANY (ARRAY['warehouse_checking'::text, 'warehouse_releasing'::text, 'technical_inspection'::text])));
alter table transmittals add constraint "transmittals_cancelled_chk" CHECK (((state <> 'cancelled'::text) OR ((cancelled_at IS NOT NULL) AND (cancel_reason IS NOT NULL) AND (length(btrim(cancel_reason)) > 0))));
alter table transmittals add constraint "transmittals_check_by_chk" CHECK ((((check_by_first_id IS NULL) = (check_by_first_at IS NULL)) AND ((check_by_second_id IS NULL) = (check_by_second_at IS NULL)) AND ((check_by_second_id IS NULL) OR (check_by_first_id IS NULL) OR (check_by_second_id <> check_by_first_id)) AND ((state <> 'closed'::text) OR (check_by_second_id IS NOT NULL))));
alter table transmittals add constraint "transmittals_checking_chk" CHECK ((check_warehouse OR check_technical));
alter table transmittals add constraint "transmittals_closed_chk" CHECK (((state <> 'closed'::text) OR (closed_at IS NOT NULL)));
alter table transmittals add constraint "transmittals_entity_chk" CHECK ((length(btrim(entity)) > 0));
alter table transmittals add constraint "transmittals_origin_chk" CHECK ((origin = ANY (ARRAY['purchasing'::text, 'logistics'::text, 'warehouse'::text, 'other'::text])));
alter table transmittals add constraint "transmittals_origin_other_chk" CHECK (((origin <> 'other'::text) OR ((origin_other IS NOT NULL) AND (length(btrim(origin_other)) > 0))));
alter table transmittals add constraint "transmittals_priority_chk" CHECK ((priority = ANY (ARRAY['high'::text, 'medium'::text, 'low'::text])));
alter table transmittals add constraint "transmittals_state_chk" CHECK ((state = ANY (ARRAY['draft'::text, 'warehouse_checking'::text, 'warehouse_releasing'::text, 'technical_inspection'::text, 'awaiting_check'::text, 'closed'::text, 'cancelled'::text])));
alter table transmittals add constraint "transmittals_submitted_chk" CHECK (((state = 'draft'::text) OR (submitted_at IS NOT NULL)));
alter table undertime_requests add constraint "undertime_requests_head_status_check" CHECK ((head_status = ANY (ARRAY['PENDING'::text, 'APPROVED'::text, 'REJECTED'::text])));
alter table undertime_requests add constraint "undertime_requests_status_check" CHECK ((status = ANY (ARRAY['PENDING'::text, 'APPROVED'::text, 'REJECTED'::text, 'CANCELLED'::text])));
alter table bug_report_notes add constraint "bug_report_notes_author_id_fkey" FOREIGN KEY (author_id) REFERENCES employees(id);
alter table bug_report_notes add constraint "bug_report_notes_report_id_fkey" FOREIGN KEY (report_id) REFERENCES bug_reports(id) ON DELETE CASCADE;
alter table bug_reports add constraint "bug_reports_reporter_id_fkey" FOREIGN KEY (reporter_id) REFERENCES employees(id);
alter table bug_reports add constraint "bug_reports_resolved_by_fkey" FOREIGN KEY (resolved_by) REFERENCES employees(id);
alter table categories add constraint "categories_updated_by_fkey" FOREIGN KEY (updated_by) REFERENCES employees(id);
alter table chat_read_receipts add constraint "chat_read_receipts_user_id_fkey" FOREIGN KEY (user_id) REFERENCES employees(id);
alter table chat_user_archives add constraint "chat_user_archives_user_id_fkey" FOREIGN KEY (user_id) REFERENCES employees(id);
alter table commission_positions add constraint "commission_positions_department_id_fkey" FOREIGN KEY (department_id) REFERENCES commission_departments(id) ON DELETE CASCADE;
alter table committee_task_activity add constraint "committee_task_activity_author_id_fkey" FOREIGN KEY (author_id) REFERENCES employees(id);
alter table committee_task_activity add constraint "committee_task_activity_task_id_fkey" FOREIGN KEY (task_id) REFERENCES committee_tasks(id);
alter table committee_task_logs add constraint "committee_task_logs_actor_id_fkey" FOREIGN KEY (actor_id) REFERENCES employees(id);
alter table committee_task_logs add constraint "committee_task_logs_committee_task_id_fkey" FOREIGN KEY (committee_task_id) REFERENCES committee_tasks(id);
alter table committee_task_members add constraint "committee_task_members_committee_task_id_fkey" FOREIGN KEY (committee_task_id) REFERENCES committee_tasks(id);
alter table committee_task_members add constraint "committee_task_members_employee_id_fkey" FOREIGN KEY (employee_id) REFERENCES employees(id);
alter table committee_task_members add constraint "committee_task_members_rated_by_fkey" FOREIGN KEY (rated_by) REFERENCES employees(id);
alter table committee_task_tags add constraint "committee_task_tags_added_by_fkey" FOREIGN KEY (added_by) REFERENCES employees(id);
alter table committee_task_tags add constraint "committee_task_tags_committee_task_id_fkey" FOREIGN KEY (committee_task_id) REFERENCES committee_tasks(id) ON DELETE CASCADE;
alter table committee_task_tags add constraint "committee_task_tags_tag_id_fkey" FOREIGN KEY (tag_id) REFERENCES task_tags(id);
alter table committee_tasks add constraint "committee_tasks_cancelled_by_visit_id_fkey" FOREIGN KEY (cancelled_by_visit_id) REFERENCES sor_stage_visits(id) ON DELETE SET NULL;
alter table committee_tasks add constraint "committee_tasks_carried_from_visit_id_fkey" FOREIGN KEY (carried_from_visit_id) REFERENCES sor_stage_visits(id) ON DELETE SET NULL;
alter table committee_tasks add constraint "committee_tasks_created_by_fkey" FOREIGN KEY (created_by) REFERENCES employees(id);
alter table committee_tasks add constraint "committee_tasks_held_from_visit_id_fkey" FOREIGN KEY (held_from_visit_id) REFERENCES sor_stage_visits(id) ON DELETE SET NULL;
alter table committee_tasks add constraint "committee_tasks_hr_verified_by_fkey" FOREIGN KEY (hr_verified_by) REFERENCES employees(id);
alter table committee_tasks add constraint "committee_tasks_opportunity_id_fkey" FOREIGN KEY (opportunity_id) REFERENCES sales_opportunities(id) ON DELETE SET NULL;
alter table committee_tasks add constraint "committee_tasks_stage_action_id_fkey" FOREIGN KEY (stage_action_id) REFERENCES flow_stage_actions(id) ON DELETE SET NULL;
alter table committee_tasks add constraint "committee_tasks_stage_visit_id_fkey" FOREIGN KEY (stage_visit_id) REFERENCES sor_stage_visits(id) ON DELETE SET NULL;
alter table committee_tasks add constraint "committee_tasks_template_id_fkey" FOREIGN KEY (template_id) REFERENCES group_task_templates(id) ON DELETE SET NULL;
alter table costing_bid_decisions add constraint "costing_bid_decisions_decided_by_fkey" FOREIGN KEY (decided_by) REFERENCES employees(id) ON DELETE SET NULL;
alter table costing_bid_decisions add constraint "costing_bid_decisions_matrix_id_fkey" FOREIGN KEY (matrix_id) REFERENCES costing_matrices(id) ON DELETE CASCADE;
alter table costing_component_costs add constraint "costing_component_costs_acquire_from_offer_id_fkey" FOREIGN KEY (acquire_from_offer_id) REFERENCES sor_canvass_offers(id) ON DELETE SET NULL;
alter table costing_component_costs add constraint "costing_component_costs_component_id_fkey" FOREIGN KEY (component_id) REFERENCES costing_components(id) ON DELETE CASCADE;
alter table costing_components add constraint "costing_components_offer_specification_from_offer_id_fkey" FOREIGN KEY (offer_specification_from_offer_id) REFERENCES sor_canvass_offers(id) ON DELETE SET NULL;
alter table costing_components add constraint "costing_components_purchasing_incharge_id_fkey" FOREIGN KEY (purchasing_incharge_id) REFERENCES employees(id) ON DELETE SET NULL;
alter table costing_components add constraint "costing_components_sales_incharge_id_fkey" FOREIGN KEY (sales_incharge_id) REFERENCES employees(id) ON DELETE SET NULL;
alter table costing_components add constraint "costing_components_tender_line_id_fkey" FOREIGN KEY (tender_line_id) REFERENCES costing_tender_lines(id) ON DELETE CASCADE;
alter table costing_cost_rows add constraint "costing_cost_rows_matrix_id_fkey" FOREIGN KEY (matrix_id) REFERENCES costing_matrices(id) ON DELETE CASCADE;
alter table costing_evaluation_settings add constraint "costing_evaluation_settings_evaluation_template_id_fkey" FOREIGN KEY (evaluation_template_id) REFERENCES group_task_templates(id) ON DELETE SET NULL;
alter table costing_events add constraint "costing_events_actor_id_fkey" FOREIGN KEY (actor_id) REFERENCES employees(id);
alter table costing_events add constraint "costing_events_matrix_id_fkey" FOREIGN KEY (matrix_id) REFERENCES costing_matrices(id) ON DELETE CASCADE;
alter table costing_inclusions add constraint "costing_inclusions_component_id_fkey" FOREIGN KEY (component_id) REFERENCES costing_components(id) ON DELETE CASCADE;
alter table costing_matrices add constraint "costing_matrices_opportunity_id_fkey" FOREIGN KEY (opportunity_id) REFERENCES sales_opportunities(id) ON DELETE CASCADE;
alter table costing_matrices add constraint "costing_matrices_purchasing_incharge_id_fkey" FOREIGN KEY (purchasing_incharge_id) REFERENCES employees(id) ON DELETE SET NULL;
alter table costing_matrices add constraint "costing_matrices_sales_incharge_id_fkey" FOREIGN KEY (sales_incharge_id) REFERENCES employees(id) ON DELETE SET NULL;
alter table costing_matrix_money add constraint "costing_matrix_money_default_preset_id_fkey" FOREIGN KEY (default_preset_id) REFERENCES costing_markup_presets(id);
alter table costing_matrix_money add constraint "costing_matrix_money_matrix_id_fkey" FOREIGN KEY (matrix_id) REFERENCES costing_matrices(id) ON DELETE CASCADE;
alter table costing_settings add constraint "costing_settings_updated_by_fkey" FOREIGN KEY (updated_by) REFERENCES employees(id) ON DELETE SET NULL;
alter table costing_signer_lists add constraint "costing_signer_lists_employee_id_fkey" FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE;
alter table costing_signoffs add constraint "costing_signoffs_matrix_id_fkey" FOREIGN KEY (matrix_id) REFERENCES costing_matrices(id) ON DELETE CASCADE;
alter table costing_signoffs add constraint "costing_signoffs_signed_by_fkey" FOREIGN KEY (signed_by) REFERENCES employees(id);
alter table costing_tables add constraint "costing_tables_parent_table_fkey" FOREIGN KEY (parent_table) REFERENCES costing_tables(table_name);
alter table costing_tender_line_prices add constraint "costing_tender_line_prices_tender_line_id_fkey" FOREIGN KEY (tender_line_id) REFERENCES costing_tender_lines(id) ON DELETE CASCADE;
alter table costing_tender_lines add constraint "costing_tender_lines_created_by_fkey" FOREIGN KEY (created_by) REFERENCES employees(id) ON DELETE SET NULL;
alter table costing_tender_lines add constraint "costing_tender_lines_matrix_id_fkey" FOREIGN KEY (matrix_id) REFERENCES costing_matrices(id) ON DELETE CASCADE;
alter table currency_rates add constraint "currency_rates_currency_fkey" FOREIGN KEY (currency) REFERENCES currency_rate_currencies(currency) ON UPDATE CASCADE;
alter table currency_rates add constraint "currency_rates_overridden_by_fkey" FOREIGN KEY (overridden_by) REFERENCES employees(id);
alter table employee_group_members add constraint "employee_group_members_added_by_fkey" FOREIGN KEY (added_by) REFERENCES employees(id) ON DELETE SET NULL;
alter table employee_group_members add constraint "employee_group_members_employee_id_fkey" FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE;
alter table employee_group_members add constraint "employee_group_members_group_id_fkey" FOREIGN KEY (group_id) REFERENCES employee_groups(id) ON DELETE CASCADE;
alter table employee_group_teams add constraint "employee_group_teams_group_id_fkey" FOREIGN KEY (group_id) REFERENCES employee_groups(id) ON DELETE CASCADE;
alter table employee_groups add constraint "employee_groups_created_by_fkey" FOREIGN KEY (created_by) REFERENCES employees(id) ON DELETE SET NULL;
alter table employees add constraint "employees_company_id_fkey" FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE SET NULL;
alter table employees add constraint "employees_updated_by_fkey" FOREIGN KEY (updated_by) REFERENCES employees(id);
alter table flow_access_settings add constraint "flow_access_settings_flow_id_fkey" FOREIGN KEY (flow_id) REFERENCES sales_flows(id) ON DELETE CASCADE;
alter table flow_edges add constraint "flow_edges_flow_id_fkey" FOREIGN KEY (flow_id) REFERENCES sales_flows(id) ON DELETE CASCADE;
alter table flow_edges add constraint "flow_edges_from_in_flow" FOREIGN KEY (flow_id, from_stage_id) REFERENCES flow_stages(flow_id, id) ON DELETE CASCADE;
alter table flow_edges add constraint "flow_edges_to_in_flow" FOREIGN KEY (flow_id, to_stage_id) REFERENCES flow_stages(flow_id, id) ON DELETE CASCADE;
alter table flow_form_fields add constraint "flow_form_fields_flow_id_fkey" FOREIGN KEY (flow_id) REFERENCES sales_flows(id) ON DELETE CASCADE;
alter table flow_snapshots add constraint "flow_snapshots_created_by_fkey" FOREIGN KEY (created_by) REFERENCES employees(id);
alter table flow_snapshots add constraint "flow_snapshots_flow_id_fkey" FOREIGN KEY (flow_id) REFERENCES sales_flows(id) ON DELETE CASCADE;
alter table flow_stage_access add constraint "flow_stage_access_stage_id_fkey" FOREIGN KEY (stage_id) REFERENCES flow_stages(id) ON DELETE CASCADE;
alter table flow_stage_actions add constraint "flow_stage_actions_stage_id_fkey" FOREIGN KEY (stage_id) REFERENCES flow_stages(id) ON DELETE CASCADE;
alter table flow_stage_fields add constraint "flow_stage_fields_stage_id_fkey" FOREIGN KEY (stage_id) REFERENCES flow_stages(id) ON DELETE CASCADE;
alter table flow_stage_follow_ups add constraint "flow_stage_follow_ups_stage_id_fkey" FOREIGN KEY (stage_id) REFERENCES flow_stages(id) ON DELETE CASCADE;
alter table flow_stages add constraint "flow_stages_flow_id_fkey" FOREIGN KEY (flow_id) REFERENCES sales_flows(id) ON DELETE CASCADE;
alter table group_task_template_members add constraint "group_task_template_members_employee_id_fkey" FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE SET NULL;
alter table group_task_template_members add constraint "group_task_template_members_template_id_fkey" FOREIGN KEY (template_id) REFERENCES group_task_templates(id) ON DELETE CASCADE;
alter table group_task_templates add constraint "group_task_templates_created_by_fkey" FOREIGN KEY (created_by) REFERENCES employees(id);
alter table ipas add constraint "ipas_actual_checking_by_fkey" FOREIGN KEY (actual_checking_by) REFERENCES employees(id);
alter table ipas add constraint "ipas_cancelled_by_fkey" FOREIGN KEY (cancelled_by) REFERENCES employees(id);
alter table ipas add constraint "ipas_created_by_fkey" FOREIGN KEY (created_by) REFERENCES employees(id);
alter table ipas add constraint "ipas_delivered_typed_by_fkey" FOREIGN KEY (delivered_typed_by) REFERENCES employees(id);
alter table ipas add constraint "ipas_freight_service_id_fkey" FOREIGN KEY (freight_service_id) REFERENCES ipas_options(id);
alter table ipas add constraint "ipas_import_clearance_typed_by_fkey" FOREIGN KEY (import_clearance_typed_by) REFERENCES employees(id);
alter table ipas add constraint "ipas_item_location_id_fkey" FOREIGN KEY (item_location_id) REFERENCES ipas_options(id);
alter table ipas_bank_details add constraint "ipas_bank_details_ipas_id_fkey" FOREIGN KEY (ipas_id) REFERENCES ipas(id) ON DELETE CASCADE;
alter table ipas_bank_details add constraint "ipas_bank_details_updated_by_fkey" FOREIGN KEY (updated_by) REFERENCES employees(id);
alter table ipas_charges add constraint "ipas_charges_created_by_fkey" FOREIGN KEY (created_by) REFERENCES employees(id);
alter table ipas_charges add constraint "ipas_charges_ipas_id_fkey" FOREIGN KEY (ipas_id) REFERENCES ipas(id) ON DELETE CASCADE;
alter table ipas_charges add constraint "ipas_charges_kind_id_fkey" FOREIGN KEY (kind_id) REFERENCES ipas_options(id);
alter table ipas_documents add constraint "ipas_documents_created_by_fkey" FOREIGN KEY (created_by) REFERENCES employees(id);
alter table ipas_documents add constraint "ipas_documents_ipas_id_fkey" FOREIGN KEY (ipas_id) REFERENCES ipas(id) ON DELETE CASCADE;
alter table ipas_documents add constraint "ipas_documents_kind_id_fkey" FOREIGN KEY (kind_id) REFERENCES ipas_options(id);
alter table ipas_events add constraint "ipas_events_actor_id_fkey" FOREIGN KEY (actor_id) REFERENCES employees(id);
alter table ipas_events add constraint "ipas_events_ipas_id_fkey" FOREIGN KEY (ipas_id) REFERENCES ipas(id) ON DELETE CASCADE;
alter table ipas_payments add constraint "ipas_payments_created_by_fkey" FOREIGN KEY (created_by) REFERENCES employees(id);
alter table ipas_payments add constraint "ipas_payments_ipas_id_fkey" FOREIGN KEY (ipas_id) REFERENCES ipas(id) ON DELETE CASCADE;
alter table ipas_payments add constraint "ipas_payments_method_id_fkey" FOREIGN KEY (method_id) REFERENCES ipas_options(id);
alter table ipas_signer_list_log add constraint "ipas_signer_list_log_actor_id_fkey" FOREIGN KEY (actor_id) REFERENCES employees(id);
alter table ipas_signer_list_log add constraint "ipas_signer_list_log_employee_id_fkey" FOREIGN KEY (employee_id) REFERENCES employees(id);
alter table ipas_signer_lists add constraint "ipas_signer_lists_employee_id_fkey" FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE;
alter table ipas_signoffs add constraint "ipas_signoffs_cleared_by_fkey" FOREIGN KEY (cleared_by) REFERENCES employees(id);
alter table ipas_signoffs add constraint "ipas_signoffs_ipas_id_fkey" FOREIGN KEY (ipas_id) REFERENCES ipas(id) ON DELETE CASCADE;
alter table ipas_signoffs add constraint "ipas_signoffs_signed_by_fkey" FOREIGN KEY (signed_by) REFERENCES employees(id);
alter table ipas_sors add constraint "ipas_sors_ipas_id_fkey" FOREIGN KEY (ipas_id) REFERENCES ipas(id) ON DELETE CASCADE;
alter table ipas_sors add constraint "ipas_sors_opportunity_id_fkey" FOREIGN KEY (opportunity_id) REFERENCES sales_opportunities(id) ON DELETE RESTRICT;
alter table notifications add constraint "notifications_recipient_id_fkey" FOREIGN KEY (recipient_id) REFERENCES employees(id);
alter table notifications add constraint "notifications_sender_id_fkey" FOREIGN KEY (sender_id) REFERENCES employees(id);
alter table odoo_retail_queue add constraint "odoo_retail_queue_deal_owner_id_fkey" FOREIGN KEY (deal_owner_id) REFERENCES employees(id);
alter table odoo_retail_queue add constraint "odoo_retail_queue_opportunity_id_fkey" FOREIGN KEY (opportunity_id) REFERENCES sales_opportunities(id);
alter table odoo_retail_queue add constraint "odoo_retail_queue_reviewed_by_fkey" FOREIGN KEY (reviewed_by) REFERENCES employees(id);
alter table odoo_retail_queue add constraint "odoo_retail_queue_sales_director_id_fkey" FOREIGN KEY (sales_director_id) REFERENCES employees(id);
alter table offset_leaves add constraint "offset_leaves_category_id_fkey" FOREIGN KEY (category_id) REFERENCES hr_leave_categories(id) ON DELETE SET NULL;
alter table offset_leaves add constraint "offset_leaves_company_id_fkey" FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE SET NULL;
alter table offset_leaves add constraint "offset_leaves_employee_id_fkey" FOREIGN KEY (employee_id) REFERENCES employees(id);
alter table offset_leaves add constraint "offset_leaves_head_id_fkey" FOREIGN KEY (head_id) REFERENCES employees(id) ON DELETE SET NULL;
alter table offset_leaves add constraint "offset_leaves_hr_processed_by_fkey" FOREIGN KEY (hr_processed_by) REFERENCES employees(id) ON DELETE SET NULL;
alter table offset_leaves add constraint "offset_leaves_printed_by_fkey" FOREIGN KEY (printed_by) REFERENCES employees(id);
alter table order_ageing_rules add constraint "order_ageing_rules_updated_by_fkey" FOREIGN KEY (updated_by) REFERENCES employees(id) ON DELETE SET NULL;
alter table order_deadline_setting add constraint "order_deadline_setting_updated_by_fkey" FOREIGN KEY (updated_by) REFERENCES employees(id) ON DELETE SET NULL;
alter table overtime_requests add constraint "overtime_requests_category_id_fkey" FOREIGN KEY (category_id) REFERENCES hr_leave_categories(id) ON DELETE SET NULL;
alter table overtime_requests add constraint "overtime_requests_company_id_fkey" FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE SET NULL;
alter table overtime_requests add constraint "overtime_requests_employee_id_fkey" FOREIGN KEY (employee_id) REFERENCES employees(id);
alter table overtime_requests add constraint "overtime_requests_head_id_fkey" FOREIGN KEY (head_id) REFERENCES employees(id) ON DELETE SET NULL;
alter table overtime_requests add constraint "overtime_requests_hr_processed_by_fkey" FOREIGN KEY (hr_processed_by) REFERENCES employees(id) ON DELETE SET NULL;
alter table overtime_requests add constraint "overtime_requests_printed_by_fkey" FOREIGN KEY (printed_by) REFERENCES employees(id);
alter table packing_list_boxes add constraint "packing_list_boxes_packing_list_id_fkey" FOREIGN KEY (packing_list_id) REFERENCES packing_lists(id) ON DELETE CASCADE;
alter table packing_list_contents add constraint "packing_list_contents_box_id_fkey" FOREIGN KEY (box_id) REFERENCES packing_list_boxes(id) ON DELETE CASCADE;
alter table packing_lists add constraint "packing_lists_created_by_fkey" FOREIGN KEY (created_by) REFERENCES employees(id);
alter table packing_lists add constraint "packing_lists_opportunity_id_fkey" FOREIGN KEY (opportunity_id) REFERENCES sales_opportunities(id) ON DELETE RESTRICT;
alter table packing_lists add constraint "packing_lists_packed_by_fkey" FOREIGN KEY (packed_by) REFERENCES employees(id);
alter table pms_evidence add constraint "pms_evidence_transmittal_id_fkey" FOREIGN KEY (transmittal_id) REFERENCES transmittals(id) ON DELETE CASCADE;
alter table pms_evidence add constraint "pms_evidence_uploaded_by_fkey" FOREIGN KEY (uploaded_by) REFERENCES employees(id);
alter table pms_handoff_events add constraint "pms_handoff_events_actor_id_fkey" FOREIGN KEY (actor_id) REFERENCES employees(id);
alter table purchase_request_item_prices add constraint "purchase_request_item_prices_item_id_fkey" FOREIGN KEY (item_id) REFERENCES purchase_request_items(id) ON DELETE CASCADE;
alter table purchase_request_items add constraint "purchase_request_items_component_id_fkey" FOREIGN KEY (component_id) REFERENCES costing_components(id) ON DELETE SET NULL;
alter table purchase_request_items add constraint "purchase_request_items_request_id_fkey" FOREIGN KEY (request_id) REFERENCES purchase_requests(id) ON DELETE CASCADE;
alter table purchase_request_items add constraint "purchase_request_items_requested_by_fkey" FOREIGN KEY (requested_by) REFERENCES employees(id);
alter table purchase_request_items add constraint "purchase_request_items_status_changed_by_fkey" FOREIGN KEY (status_changed_by) REFERENCES employees(id);
alter table purchase_request_items add constraint "purchase_request_items_substitute_for_item_id_fkey" FOREIGN KEY (substitute_for_item_id) REFERENCES purchase_request_items(id) ON DELETE SET NULL;
alter table purchase_request_members add constraint "purchase_request_members_added_by_fkey" FOREIGN KEY (added_by) REFERENCES employees(id);
alter table purchase_request_members add constraint "purchase_request_members_employee_id_fkey" FOREIGN KEY (employee_id) REFERENCES employees(id);
alter table purchase_request_members add constraint "purchase_request_members_request_id_fkey" FOREIGN KEY (request_id) REFERENCES purchase_requests(id) ON DELETE CASCADE;
alter table purchase_request_messages add constraint "purchase_request_messages_author_id_fkey" FOREIGN KEY (author_id) REFERENCES employees(id);
alter table purchase_request_messages add constraint "purchase_request_messages_request_id_fkey" FOREIGN KEY (request_id) REFERENCES purchase_requests(id) ON DELETE CASCADE;
alter table purchase_requests add constraint "purchase_requests_access_until_stage_id_fkey" FOREIGN KEY (access_until_stage_id) REFERENCES flow_stages(id);
alter table purchase_requests add constraint "purchase_requests_buyer_id_fkey" FOREIGN KEY (buyer_id) REFERENCES employees(id);
alter table purchase_requests add constraint "purchase_requests_created_by_fkey" FOREIGN KEY (created_by) REFERENCES employees(id);
alter table purchase_requests add constraint "purchase_requests_opened_by_action_id_fkey" FOREIGN KEY (opened_by_action_id) REFERENCES flow_stage_actions(id) ON DELETE SET NULL;
alter table purchase_requests add constraint "purchase_requests_opened_visit_id_fkey" FOREIGN KEY (opened_visit_id) REFERENCES sor_stage_visits(id) ON DELETE SET NULL;
alter table purchase_requests add constraint "purchase_requests_opportunity_id_fkey" FOREIGN KEY (opportunity_id) REFERENCES sales_opportunities(id) ON DELETE CASCADE;
alter table push_subscriptions add constraint "push_subscriptions_employee_id_fkey" FOREIGN KEY (employee_id) REFERENCES employees(id);
alter table revenue_activity_logs add constraint "revenue_activity_logs_author_id_fkey" FOREIGN KEY (author_id) REFERENCES employees(id);
alter table sale_types add constraint "sale_types_created_by_fkey" FOREIGN KEY (created_by) REFERENCES employees(id);
alter table sales_custom_templates add constraint "sales_custom_templates_employee_id_fkey" FOREIGN KEY (employee_id) REFERENCES employees(id);
alter table sales_flows add constraint "sales_flows_locked_by_fkey" FOREIGN KEY (locked_by) REFERENCES employees(id);
alter table sales_flows add constraint "sales_flows_sale_type_id_fkey" FOREIGN KEY (sale_type_id) REFERENCES sale_types(id) ON DELETE CASCADE;
alter table sales_flows add constraint "sales_flows_won_stage_fkey" FOREIGN KEY (won_stage_id) REFERENCES flow_stages(id) ON DELETE RESTRICT;
alter table sales_opportunities add constraint "sales_opportunities_closing_sales_id_fkey" FOREIGN KEY (closing_sales_id) REFERENCES employees(id) ON DELETE SET NULL;
alter table sales_opportunities add constraint "sales_opportunities_deal_owner_id_fkey" FOREIGN KEY (deal_owner_id) REFERENCES employees(id);
alter table sales_opportunities add constraint "sales_opportunities_deleted_by_fkey" FOREIGN KEY (deleted_by) REFERENCES employees(id);
alter table sales_opportunities add constraint "sales_opportunities_flow_snapshot_id_fkey" FOREIGN KEY (flow_snapshot_id) REFERENCES flow_snapshots(id);
alter table sales_opportunities add constraint "sales_opportunities_flow_stage_id_fkey" FOREIGN KEY (flow_stage_id) REFERENCES flow_stages(id) ON DELETE RESTRICT;
alter table sales_opportunities add constraint "sales_opportunities_registered_by_fkey" FOREIGN KEY (registered_by) REFERENCES employees(id);
alter table sales_opportunities add constraint "sales_opportunities_sale_type_id_fkey" FOREIGN KEY (sale_type_id) REFERENCES sale_types(id) ON DELETE RESTRICT;
alter table sales_opportunities add constraint "sales_opportunities_sales_director_id_fkey" FOREIGN KEY (sales_director_id) REFERENCES employees(id);
alter table sales_opportunities add constraint "sales_opportunities_status_fkey" FOREIGN KEY (status) REFERENCES crm_pipeline_stages(code);
alter table sales_opportunities add constraint "sales_opportunities_support_sales_1_id_fkey" FOREIGN KEY (support_sales_1_id) REFERENCES employees(id);
alter table sales_opportunities add constraint "sales_opportunities_support_sales_2_id_fkey" FOREIGN KEY (support_sales_2_id) REFERENCES employees(id);
alter table sales_opportunity_items add constraint "sales_opportunity_items_opportunity_id_fkey" FOREIGN KEY (opportunity_id) REFERENCES sales_opportunities(id) ON DELETE CASCADE;
alter table sales_opportunity_logs add constraint "sales_opportunity_logs_author_id_fkey" FOREIGN KEY (author_id) REFERENCES employees(id);
alter table sales_opportunity_logs add constraint "sales_opportunity_logs_opportunity_id_fkey" FOREIGN KEY (opportunity_id) REFERENCES sales_opportunities(id) ON DELETE CASCADE;
alter table sales_opportunity_logs add constraint "sales_opportunity_logs_stage_visit_id_fkey" FOREIGN KEY (stage_visit_id) REFERENCES sor_stage_visits(id) ON DELETE SET NULL;
alter table sales_opportunity_members add constraint "sales_opportunity_members_added_by_fkey" FOREIGN KEY (added_by) REFERENCES employees(id);
alter table sales_opportunity_members add constraint "sales_opportunity_members_employee_id_fkey" FOREIGN KEY (employee_id) REFERENCES employees(id);
alter table sales_opportunity_members add constraint "sales_opportunity_members_opportunity_id_fkey" FOREIGN KEY (opportunity_id) REFERENCES sales_opportunities(id) ON DELETE CASCADE;
alter table sil_leaves add constraint "sil_leaves_category_id_fkey" FOREIGN KEY (category_id) REFERENCES hr_leave_categories(id) ON DELETE SET NULL;
alter table sil_leaves add constraint "sil_leaves_company_id_fkey" FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE SET NULL;
alter table sil_leaves add constraint "sil_leaves_employee_id_fkey" FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE;
alter table sil_leaves add constraint "sil_leaves_head_id_fkey" FOREIGN KEY (head_id) REFERENCES employees(id) ON DELETE SET NULL;
alter table sil_leaves add constraint "sil_leaves_hr_processed_by_fkey" FOREIGN KEY (hr_processed_by) REFERENCES employees(id) ON DELETE SET NULL;
alter table sil_leaves add constraint "sil_leaves_printed_by_fkey" FOREIGN KEY (printed_by) REFERENCES employees(id);
alter table sor_action_runs add constraint "sor_action_runs_action_id_fkey" FOREIGN KEY (action_id) REFERENCES flow_stage_actions(id) ON DELETE CASCADE;
alter table sor_action_runs add constraint "sor_action_runs_carried_from_visit_id_fkey" FOREIGN KEY (carried_from_visit_id) REFERENCES sor_stage_visits(id) ON DELETE SET NULL;
alter table sor_action_runs add constraint "sor_action_runs_costing_matrix_id_fkey" FOREIGN KEY (costing_matrix_id) REFERENCES costing_matrices(id) ON DELETE SET NULL;
alter table sor_action_runs add constraint "sor_action_runs_decided_by_fkey" FOREIGN KEY (decided_by) REFERENCES employees(id);
alter table sor_action_runs add constraint "sor_action_runs_group_task_id_fkey" FOREIGN KEY (group_task_id) REFERENCES committee_tasks(id) ON DELETE SET NULL;
alter table sor_action_runs add constraint "sor_action_runs_opportunity_id_fkey" FOREIGN KEY (opportunity_id) REFERENCES sales_opportunities(id) ON DELETE CASCADE;
alter table sor_action_runs add constraint "sor_action_runs_packing_list_id_fkey" FOREIGN KEY (packing_list_id) REFERENCES packing_lists(id) ON DELETE SET NULL;
alter table sor_action_runs add constraint "sor_action_runs_purchase_request_id_fkey" FOREIGN KEY (purchase_request_id) REFERENCES purchase_requests(id) ON DELETE SET NULL;
alter table sor_action_runs add constraint "sor_action_runs_stage_id_fkey" FOREIGN KEY (stage_id) REFERENCES flow_stages(id) ON DELETE CASCADE;
alter table sor_action_runs add constraint "sor_action_runs_stage_visit_id_fkey" FOREIGN KEY (stage_visit_id) REFERENCES sor_stage_visits(id) ON DELETE SET NULL;
alter table sor_action_runs add constraint "sor_action_runs_task_id_fkey" FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE SET NULL;
alter table sor_canvass_offer_prices add constraint "sor_canvass_offer_prices_offer_id_fkey" FOREIGN KEY (offer_id) REFERENCES sor_canvass_offers(id) ON DELETE CASCADE;
alter table sor_canvass_offers add constraint "sor_canvass_offers_canvass_id_fkey" FOREIGN KEY (canvass_id) REFERENCES sor_canvasses(id) ON DELETE CASCADE;
alter table sor_canvass_offers add constraint "sor_canvass_offers_created_by_fkey" FOREIGN KEY (created_by) REFERENCES employees(id);
alter table sor_canvass_signoff_events add constraint "sor_canvass_signoff_events_actor_id_fkey" FOREIGN KEY (actor_id) REFERENCES employees(id) ON DELETE SET NULL;
alter table sor_canvass_signoff_events add constraint "sor_canvass_signoff_events_canvass_id_fkey" FOREIGN KEY (canvass_id) REFERENCES sor_canvasses(id) ON DELETE CASCADE;
alter table sor_canvasses add constraint "sor_canvasses_canvasser_id_fkey" FOREIGN KEY (canvasser_id) REFERENCES employees(id) ON DELETE SET NULL;
alter table sor_canvasses add constraint "sor_canvasses_component_id_fkey" FOREIGN KEY (component_id) REFERENCES costing_components(id) ON DELETE CASCADE;
alter table sor_canvasses add constraint "sor_canvasses_created_by_fkey" FOREIGN KEY (created_by) REFERENCES employees(id);
alter table sor_canvasses add constraint "sor_canvasses_requested_item_id_fkey" FOREIGN KEY (requested_item_id) REFERENCES purchase_request_items(id) ON DELETE CASCADE;
alter table sor_canvasses add constraint "sor_canvasses_signed_off_by_fkey" FOREIGN KEY (signed_off_by) REFERENCES employees(id);
alter table sor_condition_status add constraint "sor_condition_status_carried_from_visit_id_fkey" FOREIGN KEY (carried_from_visit_id) REFERENCES sor_stage_visits(id) ON DELETE SET NULL;
alter table sor_condition_status add constraint "sor_condition_status_stage_visit_id_fkey" FOREIGN KEY (stage_visit_id) REFERENCES sor_stage_visits(id) ON DELETE CASCADE;
alter table sor_condition_status add constraint "sor_requirement_status_opportunity_id_fkey" FOREIGN KEY (opportunity_id) REFERENCES sales_opportunities(id) ON DELETE CASCADE;
alter table sor_condition_status add constraint "sor_requirement_status_requirement_id_fkey" FOREIGN KEY (condition_id) REFERENCES stage_conditions(id) ON DELETE CASCADE;
alter table sor_condition_status add constraint "sor_requirement_status_satisfied_by_fkey" FOREIGN KEY (satisfied_by) REFERENCES employees(id);
alter table sor_form_values add constraint "sor_form_values_field_id_fkey" FOREIGN KEY (field_id) REFERENCES flow_form_fields(id) ON DELETE CASCADE;
alter table sor_form_values add constraint "sor_form_values_opportunity_id_fkey" FOREIGN KEY (opportunity_id) REFERENCES sales_opportunities(id) ON DELETE CASCADE;
alter table sor_form_values add constraint "sor_form_values_updated_by_fkey" FOREIGN KEY (updated_by) REFERENCES employees(id);
alter table sor_inclusions add constraint "sor_inclusions_created_by_fkey" FOREIGN KEY (created_by) REFERENCES employees(id);
alter table sor_inclusions add constraint "sor_inclusions_opportunity_id_fkey" FOREIGN KEY (opportunity_id) REFERENCES sales_opportunities(id) ON DELETE CASCADE;
alter table sor_mention_viewers add constraint "sor_mention_viewers_employee_id_fkey" FOREIGN KEY (employee_id) REFERENCES employees(id);
alter table sor_mention_viewers add constraint "sor_mention_viewers_granted_by_fkey" FOREIGN KEY (granted_by) REFERENCES employees(id);
alter table sor_mention_viewers add constraint "sor_mention_viewers_opportunity_id_fkey" FOREIGN KEY (opportunity_id) REFERENCES sales_opportunities(id) ON DELETE CASCADE;
alter table sor_mention_viewers add constraint "sor_mention_viewers_stage_visit_id_fkey" FOREIGN KEY (stage_visit_id) REFERENCES sor_stage_visits(id) ON DELETE CASCADE;
alter table sor_procurement_requests add constraint "sor_procurement_requests_assigned_to_fkey" FOREIGN KEY (assigned_to) REFERENCES employees(id);
alter table sor_procurement_requests add constraint "sor_procurement_requests_inclusion_id_fkey" FOREIGN KEY (inclusion_id) REFERENCES sor_inclusions(id) ON DELETE SET NULL;
alter table sor_procurement_requests add constraint "sor_procurement_requests_opportunity_id_fkey" FOREIGN KEY (opportunity_id) REFERENCES sales_opportunities(id) ON DELETE CASCADE;
alter table sor_procurement_requests add constraint "sor_procurement_requests_requested_by_fkey" FOREIGN KEY (requested_by) REFERENCES employees(id);
alter table sor_procurement_requests add constraint "sor_procurement_requests_resolved_by_fkey" FOREIGN KEY (resolved_by) REFERENCES employees(id);
alter table sor_procurement_requests add constraint "sor_procurement_requests_task_id_fkey" FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE SET NULL;
alter table sor_purchase_order_links add constraint "sor_purchase_order_links_created_by_fkey" FOREIGN KEY (created_by) REFERENCES employees(id);
alter table sor_purchase_order_links add constraint "sor_purchase_order_links_opportunity_id_fkey" FOREIGN KEY (opportunity_id) REFERENCES sales_opportunities(id) ON DELETE CASCADE;
alter table sor_stage_field_values add constraint "sor_stage_field_values_carried_from_visit_id_fkey" FOREIGN KEY (carried_from_visit_id) REFERENCES sor_stage_visits(id) ON DELETE SET NULL;
alter table sor_stage_field_values add constraint "sor_stage_field_values_field_id_fkey" FOREIGN KEY (field_id) REFERENCES flow_stage_fields(id) ON DELETE CASCADE;
alter table sor_stage_field_values add constraint "sor_stage_field_values_opportunity_id_fkey" FOREIGN KEY (opportunity_id) REFERENCES sales_opportunities(id) ON DELETE CASCADE;
alter table sor_stage_field_values add constraint "sor_stage_field_values_stage_visit_id_fkey" FOREIGN KEY (stage_visit_id) REFERENCES sor_stage_visits(id) ON DELETE CASCADE;
alter table sor_stage_field_values add constraint "sor_stage_field_values_updated_by_fkey" FOREIGN KEY (updated_by) REFERENCES employees(id);
alter table sor_stage_participants add constraint "sor_stage_participants_employee_id_fkey" FOREIGN KEY (employee_id) REFERENCES employees(id);
alter table sor_stage_participants add constraint "sor_stage_participants_opened_visit_id_fkey" FOREIGN KEY (opened_visit_id) REFERENCES sor_stage_visits(id);
alter table sor_stage_participants add constraint "sor_stage_participants_opportunity_id_fkey" FOREIGN KEY (opportunity_id) REFERENCES sales_opportunities(id) ON DELETE CASCADE;
alter table sor_stage_participants add constraint "sor_stage_participants_removed_by_fkey" FOREIGN KEY (removed_by) REFERENCES employees(id);
alter table sor_stage_participants add constraint "sor_stage_participants_until_stage_id_fkey" FOREIGN KEY (until_stage_id) REFERENCES flow_stages(id);
alter table sor_stage_visits add constraint "sor_stage_visits_entered_by_fkey" FOREIGN KEY (entered_by) REFERENCES employees(id);
alter table sor_stage_visits add constraint "sor_stage_visits_flow_snapshot_id_fkey" FOREIGN KEY (flow_snapshot_id) REFERENCES flow_snapshots(id);
alter table sor_stage_visits add constraint "sor_stage_visits_flow_stage_id_fkey" FOREIGN KEY (flow_stage_id) REFERENCES flow_stages(id) ON DELETE CASCADE;
alter table sor_stage_visits add constraint "sor_stage_visits_left_by_fkey" FOREIGN KEY (left_by) REFERENCES employees(id);
alter table sor_stage_visits add constraint "sor_stage_visits_opportunity_id_fkey" FOREIGN KEY (opportunity_id) REFERENCES sales_opportunities(id) ON DELETE CASCADE;
alter table sor_stage_visits add constraint "sor_stage_visits_resumed_by_fkey" FOREIGN KEY (resumed_by) REFERENCES employees(id);
alter table sor_stage_visits add constraint "sor_stage_visits_resumed_into_visit_id_fkey" FOREIGN KEY (resumed_into_visit_id) REFERENCES sor_stage_visits(id) ON DELETE SET NULL;
alter table sor_stage_visits add constraint "sor_stage_visits_undone_by_fkey" FOREIGN KEY (undone_by) REFERENCES employees(id);
alter table sor_stock_snapshots add constraint "sor_stock_snapshots_fetched_by_fkey" FOREIGN KEY (fetched_by) REFERENCES employees(id) ON DELETE SET NULL;
alter table sor_stock_snapshots add constraint "sor_stock_snapshots_opportunity_id_fkey" FOREIGN KEY (opportunity_id) REFERENCES sales_opportunities(id) ON DELETE CASCADE;
alter table stage_conditions add constraint "stage_requirements_stage_id_fkey" FOREIGN KEY (stage_id) REFERENCES flow_stages(id) ON DELETE CASCADE;
alter table system_audit_logs add constraint "system_audit_logs_author_id_fkey" FOREIGN KEY (author_id) REFERENCES employees(id);
alter table system_updates add constraint "system_updates_created_by_fkey" FOREIGN KEY (created_by) REFERENCES employees(id);
alter table task_activity add constraint "task_activity_author_id_fkey" FOREIGN KEY (author_id) REFERENCES employees(id);
alter table task_activity add constraint "task_activity_task_id_fkey" FOREIGN KEY (task_id) REFERENCES tasks(id);
alter table task_tags add constraint "task_tags_created_by_fkey" FOREIGN KEY (created_by) REFERENCES employees(id);
alter table tasks add constraint "tasks_cancelled_by_visit_id_fkey" FOREIGN KEY (cancelled_by_visit_id) REFERENCES sor_stage_visits(id) ON DELETE SET NULL;
alter table tasks add constraint "tasks_carried_from_visit_id_fkey" FOREIGN KEY (carried_from_visit_id) REFERENCES sor_stage_visits(id) ON DELETE SET NULL;
alter table tasks add constraint "tasks_category_fk" FOREIGN KEY (category_id) REFERENCES categories(category_id);
alter table tasks add constraint "tasks_edited_by_fk" FOREIGN KEY (edited_by) REFERENCES employees(id);
alter table tasks add constraint "tasks_evaluated_by_fkey" FOREIGN KEY (evaluated_by) REFERENCES employees(id);
alter table tasks add constraint "tasks_held_from_visit_id_fkey" FOREIGN KEY (held_from_visit_id) REFERENCES sor_stage_visits(id) ON DELETE SET NULL;
alter table tasks add constraint "tasks_logged_by_fk" FOREIGN KEY (logged_by) REFERENCES employees(id);
alter table tasks add constraint "tasks_opportunity_id_fkey" FOREIGN KEY (opportunity_id) REFERENCES sales_opportunities(id) ON DELETE SET NULL;
alter table tasks add constraint "tasks_reported_to_fkey" FOREIGN KEY (reported_to) REFERENCES employees(id);
alter table tasks add constraint "tasks_stage_action_id_fkey" FOREIGN KEY (stage_action_id) REFERENCES flow_stage_actions(id) ON DELETE SET NULL;
alter table tasks add constraint "tasks_stage_visit_id_fkey" FOREIGN KEY (stage_visit_id) REFERENCES sor_stage_visits(id) ON DELETE SET NULL;
alter table transmittal_cleared_signatures add constraint "transmittal_cleared_signatures_cleared_by_fkey" FOREIGN KEY (cleared_by) REFERENCES employees(id);
alter table transmittal_cleared_signatures add constraint "transmittal_cleared_signatures_other_signer_id_fkey" FOREIGN KEY (other_signer_id) REFERENCES employees(id);
alter table transmittal_cleared_signatures add constraint "transmittal_cleared_signatures_signer_id_fkey" FOREIGN KEY (signer_id) REFERENCES employees(id);
alter table transmittal_cleared_signatures add constraint "transmittal_cleared_signatures_transmittal_id_fkey" FOREIGN KEY (transmittal_id) REFERENCES transmittals(id) ON DELETE CASCADE;
alter table transmittal_ipas add constraint "transmittal_ipas_ipas_id_fkey" FOREIGN KEY (ipas_id) REFERENCES ipas(id) ON DELETE RESTRICT;
alter table transmittal_ipas add constraint "transmittal_ipas_transmittal_id_fkey" FOREIGN KEY (transmittal_id) REFERENCES transmittals(id) ON DELETE CASCADE;
alter table transmittal_lines add constraint "transmittal_lines_ipas_id_fkey" FOREIGN KEY (ipas_id) REFERENCES ipas(id) ON DELETE RESTRICT;
alter table transmittal_lines add constraint "transmittal_lines_opportunity_id_fkey" FOREIGN KEY (opportunity_id) REFERENCES sales_opportunities(id) ON DELETE RESTRICT;
alter table transmittal_lines add constraint "transmittal_lines_tech_in_charge_id_fkey" FOREIGN KEY (tech_in_charge_id) REFERENCES employees(id);
alter table transmittal_lines add constraint "transmittal_lines_transmittal_id_fkey" FOREIGN KEY (transmittal_id) REFERENCES transmittals(id) ON DELETE CASCADE;
alter table transmittal_lines add constraint "transmittal_lines_wh_in_charge_id_fkey" FOREIGN KEY (wh_in_charge_id) REFERENCES employees(id);
alter table transmittal_products add constraint "transmittal_products_option_id_fkey" FOREIGN KEY (option_id) REFERENCES ipas_options(id) ON DELETE RESTRICT;
alter table transmittal_products add constraint "transmittal_products_transmittal_id_fkey" FOREIGN KEY (transmittal_id) REFERENCES transmittals(id) ON DELETE CASCADE;
alter table transmittal_references add constraint "transmittal_references_option_id_fkey" FOREIGN KEY (option_id) REFERENCES ipas_options(id) ON DELETE RESTRICT;
alter table transmittal_references add constraint "transmittal_references_transmittal_id_fkey" FOREIGN KEY (transmittal_id) REFERENCES transmittals(id) ON DELETE CASCADE;
alter table transmittal_sors add constraint "transmittal_sors_opportunity_id_fkey" FOREIGN KEY (opportunity_id) REFERENCES sales_opportunities(id) ON DELETE RESTRICT;
alter table transmittal_sors add constraint "transmittal_sors_transmittal_id_fkey" FOREIGN KEY (transmittal_id) REFERENCES transmittals(id) ON DELETE CASCADE;
alter table transmittal_stages add constraint "transmittal_stages_completed_by_fkey" FOREIGN KEY (completed_by) REFERENCES employees(id);
alter table transmittal_stages add constraint "transmittal_stages_first_signer_id_fkey" FOREIGN KEY (first_signer_id) REFERENCES employees(id);
alter table transmittal_stages add constraint "transmittal_stages_second_signer_id_fkey" FOREIGN KEY (second_signer_id) REFERENCES employees(id);
alter table transmittal_stages add constraint "transmittal_stages_transmittal_id_fkey" FOREIGN KEY (transmittal_id) REFERENCES transmittals(id) ON DELETE CASCADE;
alter table transmittals add constraint "transmittals_cancelled_by_fkey" FOREIGN KEY (cancelled_by) REFERENCES employees(id);
alter table transmittals add constraint "transmittals_check_by_first_id_fkey" FOREIGN KEY (check_by_first_id) REFERENCES employees(id);
alter table transmittals add constraint "transmittals_check_by_second_id_fkey" FOREIGN KEY (check_by_second_id) REFERENCES employees(id);
alter table transmittals add constraint "transmittals_item_location_id_fkey" FOREIGN KEY (item_location_id) REFERENCES ipas_options(id) ON DELETE RESTRICT;
alter table transmittals add constraint "transmittals_odoo_received_by_fkey" FOREIGN KEY (odoo_received_by) REFERENCES employees(id);
alter table transmittals add constraint "transmittals_prepared_by_fkey" FOREIGN KEY (prepared_by) REFERENCES employees(id);
alter table undertime_requests add constraint "undertime_requests_category_id_fkey" FOREIGN KEY (category_id) REFERENCES hr_leave_categories(id) ON DELETE SET NULL;
alter table undertime_requests add constraint "undertime_requests_company_id_fkey" FOREIGN KEY (company_id) REFERENCES companies(id);
alter table undertime_requests add constraint "undertime_requests_employee_id_fkey" FOREIGN KEY (employee_id) REFERENCES employees(id);
alter table undertime_requests add constraint "undertime_requests_head_id_fkey" FOREIGN KEY (head_id) REFERENCES employees(id) ON DELETE SET NULL;
alter table undertime_requests add constraint "undertime_requests_hr_processed_by_fkey" FOREIGN KEY (hr_processed_by) REFERENCES employees(id) ON DELETE SET NULL;
alter table undertime_requests add constraint "undertime_requests_printed_by_fkey" FOREIGN KEY (printed_by) REFERENCES employees(id);
alter table ipas add constraint "ipas_sor_rule_on_ipas" TRIGGER DEFERRABLE INITIALLY DEFERRED;
alter table ipas_sors add constraint "ipas_sor_rule_on_sors" TRIGGER DEFERRABLE INITIALLY DEFERRED;

-- ============================================================
-- Indexes (excluding those backing constraints)
-- ============================================================

CREATE INDEX bug_report_notes_report_idx ON public.bug_report_notes USING btree (report_id, created_at);
CREATE INDEX bug_reports_created_at_idx ON public.bug_reports USING btree (created_at DESC);
CREATE INDEX commission_positions_department_id_idx ON public.commission_positions USING btree (department_id);
CREATE INDEX commission_rates_rate_type_idx ON public.commission_rates USING btree (rate_type);
CREATE INDEX commission_splits_project_type_idx ON public.commission_splits USING btree (project_type);
CREATE INDEX committee_tasks_opportunity_id_idx ON public.committee_tasks USING btree (opportunity_id);
CREATE INDEX committee_tasks_stage_visit_id_idx ON public.committee_tasks USING btree (stage_visit_id);
CREATE INDEX committee_tasks_template_idx ON public.committee_tasks USING btree (template_id);
CREATE UNIQUE INDEX companies_sort_order_key ON public.companies USING btree (sort_order);
CREATE UNIQUE INDEX costing_bid_decisions_live_key ON public.costing_bid_decisions USING btree (matrix_id) WHERE (cleared_at IS NULL);
CREATE INDEX costing_bid_decisions_matrix_idx ON public.costing_bid_decisions USING btree (matrix_id, decided_at);
CREATE INDEX costing_components_line_idx ON public.costing_components USING btree (tender_line_id, "position");
CREATE INDEX costing_cost_rows_matrix_idx ON public.costing_cost_rows USING btree (matrix_id, "position");
CREATE INDEX costing_events_matrix_idx ON public.costing_events USING btree (matrix_id, created_at DESC);
CREATE INDEX costing_inclusions_component_idx ON public.costing_inclusions USING btree (component_id, "position");
CREATE UNIQUE INDEX costing_inclusions_legacy_key ON public.costing_inclusions USING btree (legacy_sor_inclusion_id) WHERE (legacy_sor_inclusion_id IS NOT NULL);
CREATE UNIQUE INDEX costing_markup_presets_label_key ON public.costing_markup_presets USING btree (lower(btrim(label)));
CREATE UNIQUE INDEX costing_signoffs_live_key ON public.costing_signoffs USING btree (matrix_id, role) WHERE (cleared_at IS NULL);
CREATE INDEX costing_signoffs_matrix_idx ON public.costing_signoffs USING btree (matrix_id, signed_at DESC);
CREATE INDEX costing_tender_lines_matrix_idx ON public.costing_tender_lines USING btree (matrix_id, "position");
CREATE UNIQUE INDEX crm_pipeline_stages_one_anchor ON public.crm_pipeline_stages USING btree ((true)) WHERE is_anchor;
CREATE UNIQUE INDEX crm_pipeline_stages_one_default ON public.crm_pipeline_stages USING btree ((true)) WHERE is_default;
CREATE UNIQUE INDEX crm_pipeline_stages_one_itb_gate ON public.crm_pipeline_stages USING btree ((true)) WHERE is_itb_gate;
CREATE UNIQUE INDEX crm_pipeline_stages_one_lost ON public.crm_pipeline_stages USING btree ((true)) WHERE is_lost;
CREATE UNIQUE INDEX crm_pipeline_stages_one_won ON public.crm_pipeline_stages USING btree ((true)) WHERE is_won;
CREATE UNIQUE INDEX crm_pipeline_stages_sort_order_key ON public.crm_pipeline_stages USING btree (sort_order);
CREATE INDEX employee_group_members_employee_idx ON public.employee_group_members USING btree (employee_id);
CREATE UNIQUE INDEX employee_groups_active_name_key ON public.employee_groups USING btree (lower(TRIM(BOTH FROM name))) WHERE (archived_at IS NULL);
CREATE UNIQUE INDEX employees_call_sign_key ON public.employees USING btree (call_sign) WHERE (call_sign IS NOT NULL);
CREATE INDEX employees_company_id_idx ON public.employees USING btree (company_id);
CREATE INDEX flow_edges_from_idx ON public.flow_edges USING btree (flow_id, from_stage_id);
CREATE INDEX flow_form_fields_flow_id_idx ON public.flow_form_fields USING btree (flow_id);
CREATE INDEX flow_stage_actions_stage_idx ON public.flow_stage_actions USING btree (stage_id, sort_order);
CREATE INDEX flow_stage_fields_stage_id_idx ON public.flow_stage_fields USING btree (stage_id);
CREATE INDEX flow_stages_flow_idx ON public.flow_stages USING btree (flow_id, sort_order);
CREATE UNIQUE INDEX flow_stages_name_per_flow_key ON public.flow_stages USING btree (flow_id, lower(btrim(name)));
CREATE INDEX group_task_template_members_template_idx ON public.group_task_template_members USING btree (template_id);
CREATE INDEX group_task_templates_active_idx ON public.group_task_templates USING btree (created_at DESC) WHERE (archived_at IS NULL);
CREATE UNIQUE INDEX hr_leave_categories_sort_order_key ON public.hr_leave_categories USING btree (sort_order);
CREATE INDEX ipas_actual_checking_by_idx ON public.ipas USING btree (actual_checking_by);
CREATE INDEX ipas_created_by_idx ON public.ipas USING btree (created_by);
CREATE INDEX ipas_delivered_typed_by_idx ON public.ipas USING btree (delivered_typed_by);
CREATE INDEX ipas_freight_service_id_idx ON public.ipas USING btree (freight_service_id);
CREATE INDEX ipas_import_clearance_typed_by_idx ON public.ipas USING btree (import_clearance_typed_by);
CREATE INDEX ipas_item_location_id_idx ON public.ipas USING btree (item_location_id);
CREATE UNIQUE INDEX ipas_live_po_number_key ON public.ipas USING btree (po_number) WHERE (state <> 'cancelled'::text);
CREATE INDEX ipas_state_idx ON public.ipas USING btree (state, created_at DESC);
CREATE INDEX ipas_bank_details_updated_by_idx ON public.ipas_bank_details USING btree (updated_by);
CREATE INDEX ipas_charges_created_by_idx ON public.ipas_charges USING btree (created_by);
CREATE INDEX ipas_charges_ipas_id_idx ON public.ipas_charges USING btree (ipas_id, charged_on);
CREATE INDEX ipas_charges_kind_id_idx ON public.ipas_charges USING btree (kind_id);
CREATE INDEX ipas_documents_created_by_idx ON public.ipas_documents USING btree (created_by);
CREATE INDEX ipas_documents_kind_id_idx ON public.ipas_documents USING btree (kind_id);
CREATE UNIQUE INDEX ipas_documents_kind_key ON public.ipas_documents USING btree (ipas_id, kind_id) WHERE (kind_id IS NOT NULL);
CREATE UNIQUE INDEX ipas_documents_label_key ON public.ipas_documents USING btree (ipas_id, lower(btrim(label))) WHERE (kind_id IS NULL);
CREATE INDEX ipas_events_actor_id_idx ON public.ipas_events USING btree (actor_id);
CREATE INDEX ipas_events_ipas_id_idx ON public.ipas_events USING btree (ipas_id, created_at);
CREATE UNIQUE INDEX ipas_options_list_label_key ON public.ipas_options USING btree (list, lower(btrim(label)));
CREATE INDEX ipas_options_list_sort_idx ON public.ipas_options USING btree (list, sort);
CREATE INDEX ipas_payments_created_by_idx ON public.ipas_payments USING btree (created_by);
CREATE INDEX ipas_payments_ipas_id_idx ON public.ipas_payments USING btree (ipas_id, paid_on);
CREATE INDEX ipas_payments_method_id_idx ON public.ipas_payments USING btree (method_id);
CREATE INDEX ipas_signer_list_log_actor_id_idx ON public.ipas_signer_list_log USING btree (actor_id);
CREATE INDEX ipas_signer_list_log_created_at_idx ON public.ipas_signer_list_log USING btree (created_at DESC);
CREATE INDEX ipas_signer_list_log_employee_id_idx ON public.ipas_signer_list_log USING btree (employee_id);
CREATE INDEX ipas_signer_lists_employee_id_idx ON public.ipas_signer_lists USING btree (employee_id);
CREATE INDEX ipas_signoffs_cleared_by_idx ON public.ipas_signoffs USING btree (cleared_by);
CREATE INDEX ipas_signoffs_ipas_id_idx ON public.ipas_signoffs USING btree (ipas_id, section);
CREATE UNIQUE INDEX ipas_signoffs_live_key ON public.ipas_signoffs USING btree (ipas_id, section, role) WHERE (cleared_at IS NULL);
CREATE INDEX ipas_signoffs_signed_by_idx ON public.ipas_signoffs USING btree (signed_by);
CREATE INDEX ipas_sors_opportunity_id_idx ON public.ipas_sors USING btree (opportunity_id);
CREATE INDEX odoo_retail_queue_created_at_idx ON public.odoo_retail_queue USING btree (created_at DESC);
CREATE INDEX odoo_retail_queue_status_idx ON public.odoo_retail_queue USING btree (status);
CREATE INDEX offset_leaves_company_id_idx ON public.offset_leaves USING btree (company_id);
CREATE INDEX offset_leaves_head_id_idx ON public.offset_leaves USING btree (head_id);
CREATE INDEX offset_leaves_leave_group_id_idx ON public.offset_leaves USING btree (leave_group_id);
CREATE INDEX overtime_requests_company_id_idx ON public.overtime_requests USING btree (company_id);
CREATE INDEX overtime_requests_head_id_idx ON public.overtime_requests USING btree (head_id);
CREATE INDEX packing_list_boxes_packing_list_id_idx ON public.packing_list_boxes USING btree (packing_list_id);
CREATE INDEX packing_list_contents_box_id_idx ON public.packing_list_contents USING btree (box_id);
CREATE INDEX packing_lists_created_by_idx ON public.packing_lists USING btree (created_by);
CREATE INDEX packing_lists_opportunity_id_idx ON public.packing_lists USING btree (opportunity_id);
CREATE INDEX pms_evidence_record_idx ON public.pms_evidence USING btree (record_type, record_id);
CREATE INDEX pms_evidence_transmittal_id_idx ON public.pms_evidence USING btree (transmittal_id);
CREATE INDEX pms_evidence_uploaded_by_idx ON public.pms_evidence USING btree (uploaded_by);
CREATE INDEX pms_handoff_events_actor_id_idx ON public.pms_handoff_events USING btree (actor_id);
CREATE INDEX pms_handoff_events_record_idx ON public.pms_handoff_events USING btree (record_type, record_id, created_at);
CREATE INDEX purchase_request_items_component_idx ON public.purchase_request_items USING btree (component_id) WHERE (component_id IS NOT NULL);
CREATE UNIQUE INDEX purchase_request_items_legacy_procurement_request_id_key ON public.purchase_request_items USING btree (legacy_procurement_request_id) WHERE (legacy_procurement_request_id IS NOT NULL);
CREATE INDEX purchase_request_items_request_id_idx ON public.purchase_request_items USING btree (request_id);
CREATE INDEX purchase_request_members_employee_id_idx ON public.purchase_request_members USING btree (employee_id);
CREATE INDEX purchase_request_messages_request_id_idx ON public.purchase_request_messages USING btree (request_id, created_at);
CREATE UNIQUE INDEX purchase_requests_opportunity_id_key ON public.purchase_requests USING btree (opportunity_id);
CREATE INDEX purchase_requests_unassigned_idx ON public.purchase_requests USING btree (created_at) WHERE (buyer_id IS NULL);
CREATE INDEX push_subscriptions_employee_id_idx ON public.push_subscriptions USING btree (employee_id);
CREATE INDEX retail_orders_ordered_at_idx ON public.retail_orders USING btree (ordered_at DESC);
CREATE UNIQUE INDEX sale_types_live_name_key ON public.sale_types USING btree (lower(btrim(name))) WHERE (archived_at IS NULL);
CREATE INDEX sales_opportunities_active_idx ON public.sales_opportunities USING btree (is_deleted, status);
CREATE INDEX sales_opportunities_closing_sales_idx ON public.sales_opportunities USING btree (closing_sales_id);
CREATE INDEX sales_opportunities_deal_owner_idx ON public.sales_opportunities USING btree (deal_owner_id);
CREATE INDEX sales_opportunities_flow_snapshot_idx ON public.sales_opportunities USING btree (flow_snapshot_id) WHERE (flow_snapshot_id IS NOT NULL);
CREATE INDEX sales_opportunities_flow_stage_idx ON public.sales_opportunities USING btree (flow_stage_id) WHERE (flow_stage_id IS NOT NULL);
CREATE INDEX sales_opportunities_lead_source_idx ON public.sales_opportunities USING btree (lead_source);
CREATE INDEX sales_opportunities_live_idx ON public.sales_opportunities USING btree (registration_date DESC, created_at DESC) WHERE ((is_scratch = false) AND (is_retail = false) AND (is_deleted = false));
CREATE INDEX sales_opportunities_reg_date_idx ON public.sales_opportunities USING btree (registration_date DESC);
CREATE INDEX sales_opportunities_registered_by_idx ON public.sales_opportunities USING btree (registered_by);
CREATE INDEX sales_opportunities_sales_reference_idx ON public.sales_opportunities USING btree (sales_reference);
CREATE INDEX sales_opportunities_status_idx ON public.sales_opportunities USING btree (status);
CREATE INDEX sales_opportunity_items_opp_idx ON public.sales_opportunity_items USING btree (opportunity_id, sort_order);
CREATE INDEX sales_opportunity_logs_opp_idx ON public.sales_opportunity_logs USING btree (opportunity_id, created_at);
CREATE INDEX sales_opportunity_logs_stage_visit_id_idx ON public.sales_opportunity_logs USING btree (stage_visit_id);
CREATE INDEX sales_opportunity_members_opp_idx ON public.sales_opportunity_members USING btree (opportunity_id);
CREATE INDEX sil_leaves_company_id_idx ON public.sil_leaves USING btree (company_id);
CREATE INDEX sil_leaves_head_id_idx ON public.sil_leaves USING btree (head_id);
CREATE INDEX sil_leaves_leave_group_id_idx ON public.sil_leaves USING btree (leave_group_id);
CREATE UNIQUE INDEX sor_action_runs_live_unique ON public.sor_action_runs USING btree (opportunity_id, stage_id, action_id) WHERE (closed_off_at IS NULL);
CREATE INDEX sor_action_runs_opportunity_id_idx ON public.sor_action_runs USING btree (opportunity_id);
CREATE INDEX sor_action_runs_pending_idx ON public.sor_action_runs USING btree (stage_visit_id) WHERE (outcome = 'pending'::text);
CREATE INDEX sor_canvass_offers_canvass_idx ON public.sor_canvass_offers USING btree (canvass_id, sort_order);
CREATE UNIQUE INDEX sor_canvass_offers_one_winner_per_canvass ON public.sor_canvass_offers USING btree (canvass_id) WHERE is_winner;
CREATE INDEX sor_canvass_signoff_events_canvass_idx ON public.sor_canvass_signoff_events USING btree (canvass_id, created_at);
CREATE UNIQUE INDEX sor_canvasses_component_key ON public.sor_canvasses USING btree (component_id) WHERE (component_id IS NOT NULL);
CREATE UNIQUE INDEX sor_canvasses_number_key ON public.sor_canvasses USING btree (number);
CREATE UNIQUE INDEX sor_canvasses_requested_item_key ON public.sor_canvasses USING btree (requested_item_id) WHERE (requested_item_id IS NOT NULL);
CREATE INDEX sor_condition_status_opp_idx ON public.sor_condition_status USING btree (opportunity_id);
CREATE INDEX sor_condition_status_stage_visit_id_idx ON public.sor_condition_status USING btree (stage_visit_id);
CREATE INDEX sor_form_values_opportunity_id_idx ON public.sor_form_values USING btree (opportunity_id);
CREATE INDEX sor_inclusions_opp_idx ON public.sor_inclusions USING btree (opportunity_id, sort_order);
CREATE INDEX sor_mention_viewers_employee_idx ON public.sor_mention_viewers USING btree (employee_id);
CREATE INDEX sor_procurement_requests_inclusion_idx ON public.sor_procurement_requests USING btree (inclusion_id) WHERE (inclusion_id IS NOT NULL);
CREATE INDEX sor_procurement_requests_open_idx ON public.sor_procurement_requests USING btree (assigned_to) WHERE (outcome IS NULL);
CREATE INDEX sor_procurement_requests_opp_idx ON public.sor_procurement_requests USING btree (opportunity_id);
CREATE INDEX sor_procurement_requests_task_idx ON public.sor_procurement_requests USING btree (task_id);
CREATE INDEX sor_purchase_order_links_opp_idx ON public.sor_purchase_order_links USING btree (opportunity_id);
CREATE INDEX sor_stage_field_values_opportunity_id_idx ON public.sor_stage_field_values USING btree (opportunity_id);
CREATE INDEX sor_stage_participants_open_idx ON public.sor_stage_participants USING btree (opportunity_id) WHERE (closed_at IS NULL);
CREATE INDEX sor_stage_participants_opportunity_id_idx ON public.sor_stage_participants USING btree (opportunity_id);
CREATE INDEX sor_stage_visits_open_idx ON public.sor_stage_visits USING btree (opportunity_id) WHERE (left_at IS NULL);
CREATE INDEX sor_stage_visits_opportunity_id_idx ON public.sor_stage_visits USING btree (opportunity_id);
CREATE INDEX stage_conditions_stage_idx ON public.stage_conditions USING btree (stage_id, sort_order);
CREATE UNIQUE INDEX task_tags_active_name_key ON public.task_tags USING btree (lower(name)) WHERE (archived_at IS NULL);
CREATE INDEX tasks_opportunity_id_idx ON public.tasks USING btree (opportunity_id);
CREATE INDEX tasks_stage_visit_id_idx ON public.tasks USING btree (stage_visit_id);
CREATE INDEX transmittal_cleared_signatures_cleared_by_idx ON public.transmittal_cleared_signatures USING btree (cleared_by);
CREATE INDEX transmittal_cleared_signatures_other_signer_idx ON public.transmittal_cleared_signatures USING btree (other_signer_id);
CREATE INDEX transmittal_cleared_signatures_signer_idx ON public.transmittal_cleared_signatures USING btree (signer_id);
CREATE INDEX transmittal_cleared_signatures_transmittal_idx ON public.transmittal_cleared_signatures USING btree (transmittal_id, cleared_at);
CREATE INDEX transmittal_ipas_ipas_id_idx ON public.transmittal_ipas USING btree (ipas_id);
CREATE INDEX transmittal_lines_ipas_id_idx ON public.transmittal_lines USING btree (ipas_id);
CREATE INDEX transmittal_lines_opportunity_id_idx ON public.transmittal_lines USING btree (opportunity_id);
CREATE INDEX transmittal_lines_transmittal_id_idx ON public.transmittal_lines USING btree (transmittal_id);
CREATE INDEX transmittal_products_option_id_idx ON public.transmittal_products USING btree (option_id);
CREATE INDEX transmittal_references_option_id_idx ON public.transmittal_references USING btree (option_id);
CREATE INDEX transmittal_sors_opportunity_id_idx ON public.transmittal_sors USING btree (opportunity_id);
CREATE INDEX transmittal_stages_transmittal_id_idx ON public.transmittal_stages USING btree (transmittal_id);
CREATE INDEX transmittals_item_location_id_idx ON public.transmittals USING btree (item_location_id);
CREATE INDEX transmittals_prepared_by_idx ON public.transmittals USING btree (prepared_by);
CREATE INDEX transmittals_state_idx ON public.transmittals USING btree (state, created_at DESC);
CREATE INDEX undertime_requests_employee_id_idx ON public.undertime_requests USING btree (employee_id);
CREATE INDEX undertime_requests_head_id_idx ON public.undertime_requests USING btree (head_id);

-- ============================================================
-- Row Level Security (enable/force)
-- ============================================================

alter table public."app_settings" enable row level security;
alter table public."bug_report_notes" enable row level security;
alter table public."bug_reports" enable row level security;
alter table public."categories" enable row level security;
alter table public."chat_read_receipts" enable row level security;
alter table public."chat_user_archives" enable row level security;
alter table public."commission_departments" enable row level security;
alter table public."commission_positions" enable row level security;
alter table public."commission_rates" enable row level security;
alter table public."commission_splits" enable row level security;
alter table public."committee_roles" enable row level security;
alter table public."committee_task_activity" enable row level security;
alter table public."committee_task_logs" enable row level security;
alter table public."committee_task_members" enable row level security;
alter table public."committee_task_tags" enable row level security;
alter table public."committee_tasks" enable row level security;
alter table public."companies" enable row level security;
alter table public."costing_bid_decisions" enable row level security;
alter table public."costing_column_bands" enable row level security;
alter table public."costing_column_tiers" enable row level security;
alter table public."costing_component_costs" enable row level security;
alter table public."costing_components" enable row level security;
alter table public."costing_cost_rows" enable row level security;
alter table public."costing_evaluation_settings" enable row level security;
alter table public."costing_events" enable row level security;
alter table public."costing_inclusions" enable row level security;
alter table public."costing_markup_presets" enable row level security;
alter table public."costing_matrices" enable row level security;
alter table public."costing_matrix_money" enable row level security;
alter table public."costing_settings" enable row level security;
alter table public."costing_signer_lists" enable row level security;
alter table public."costing_signoffs" enable row level security;
alter table public."costing_tables" enable row level security;
alter table public."costing_tender_line_prices" enable row level security;
alter table public."costing_tender_lines" enable row level security;
alter table public."costing_virtual_columns" enable row level security;
alter table public."crm_pipeline_stages" enable row level security;
alter table public."currency_rate_currencies" enable row level security;
alter table public."currency_rates" enable row level security;
alter table public."employee_group_members" enable row level security;
alter table public."employee_group_teams" enable row level security;
alter table public."employee_groups" enable row level security;
alter table public."employees" enable row level security;
alter table public."faq_data" enable row level security;
alter table public."flow_access_settings" enable row level security;
alter table public."flow_edges" enable row level security;
alter table public."flow_form_fields" enable row level security;
alter table public."flow_snapshots" enable row level security;
alter table public."flow_stage_access" enable row level security;
alter table public."flow_stage_actions" enable row level security;
alter table public."flow_stage_fields" enable row level security;
alter table public."flow_stage_follow_ups" enable row level security;
alter table public."flow_stages" enable row level security;
alter table public."group_task_template_members" enable row level security;
alter table public."group_task_templates" enable row level security;
alter table public."hr_day_shift_config" enable row level security;
alter table public."hr_leave_categories" enable row level security;
alter table public."ipas" enable row level security;
alter table public."ipas_bank_details" enable row level security;
alter table public."ipas_charges" enable row level security;
alter table public."ipas_documents" enable row level security;
alter table public."ipas_events" enable row level security;
alter table public."ipas_options" enable row level security;
alter table public."ipas_payments" enable row level security;
alter table public."ipas_signer_list_log" enable row level security;
alter table public."ipas_signer_lists" enable row level security;
alter table public."ipas_signoffs" enable row level security;
alter table public."ipas_sors" enable row level security;
alter table public."notifications" enable row level security;
alter table public."odoo_retail_queue" enable row level security;
alter table public."offset_leaves" enable row level security;
alter table public."order_ageing_rules" enable row level security;
alter table public."order_deadline_setting" enable row level security;
alter table public."overtime_requests" enable row level security;
alter table public."packing_list_boxes" enable row level security;
alter table public."packing_list_contents" enable row level security;
alter table public."packing_lists" enable row level security;
alter table public."pms_evidence" enable row level security;
alter table public."pms_handoff_events" enable row level security;
alter table public."purchase_request_item_prices" enable row level security;
alter table public."purchase_request_items" enable row level security;
alter table public."purchase_request_members" enable row level security;
alter table public."purchase_request_messages" enable row level security;
alter table public."purchase_requests" enable row level security;
alter table public."push_subscriptions" enable row level security;
alter table public."retail_orders" enable row level security;
alter table public."revenue_activity_logs" enable row level security;
alter table public."sale_types" enable row level security;
alter table public."sales_custom_templates" enable row level security;
alter table public."sales_flows" enable row level security;
alter table public."sales_opportunities" enable row level security;
alter table public."sales_opportunity_items" enable row level security;
alter table public."sales_opportunity_logs" enable row level security;
alter table public."sales_opportunity_members" enable row level security;
alter table public."sil_leaves" enable row level security;
alter table public."sor_action_runs" enable row level security;
alter table public."sor_canvass_offer_prices" enable row level security;
alter table public."sor_canvass_offers" enable row level security;
alter table public."sor_canvass_signoff_events" enable row level security;
alter table public."sor_canvasses" enable row level security;
alter table public."sor_form_values" enable row level security;
alter table public."sor_inclusions" enable row level security;
alter table public."sor_mention_viewers" enable row level security;
alter table public."sor_procurement_requests" enable row level security;
alter table public."sor_purchase_order_links" enable row level security;
alter table public."sor_stage_field_values" enable row level security;
alter table public."sor_stage_participants" enable row level security;
alter table public."sor_stage_visits" enable row level security;
alter table public."sor_stock_snapshots" enable row level security;
alter table public."stage_conditions" enable row level security;
alter table public."system_audit_logs" enable row level security;
alter table public."task_activity" enable row level security;
alter table public."task_tags" enable row level security;
alter table public."tasks" enable row level security;
alter table public."transmittal_cleared_signatures" enable row level security;
alter table public."transmittal_ipas" enable row level security;
alter table public."transmittal_lines" enable row level security;
alter table public."transmittal_products" enable row level security;
alter table public."transmittal_references" enable row level security;
alter table public."transmittal_sors" enable row level security;
alter table public."transmittal_stages" enable row level security;
alter table public."transmittals" enable row level security;
alter table public."undertime_requests" enable row level security;
alter table public."verification_rate_limits" enable row level security;

-- ============================================================
-- RLS Policies
-- ============================================================

create policy "Allow Super Admin to insert app_settings" on public."app_settings"
  as permissive
  for insert
  to public
  with check ((is_super_admin() = true));
create policy "Allow Super Admin to update app_settings" on public."app_settings"
  as permissive
  for update
  to public
  using ((is_super_admin() = true));
create policy "Allow public read of app_settings" on public."app_settings"
  as permissive
  for select
  to public
  using (true);
create policy "Bug report notes follow their report" on public."bug_report_notes"
  as permissive
  for select
  to authenticated
  using ((EXISTS ( SELECT 1
   FROM bug_reports r
  WHERE (r.id = bug_report_notes.report_id))));
create policy "Bug report readers and the sender can view" on public."bug_reports"
  as permissive
  for select
  to authenticated
  using ((can_read_bug_reports() OR (reporter_id = get_employee_id())));
create policy "Allow HR to manage categories" on public."categories"
  as permissive
  for all
  to public
  using (((is_hr() = true) OR (is_super_admin() = true)));
create policy "Allow public read of categories" on public."categories"
  as permissive
  for select
  to public
  using (true);
create policy "Users manage their own read receipts" on public."chat_read_receipts"
  as permissive
  for all
  to public
  using ((user_id = get_employee_id()));
create policy "chat_read_receipts_insert_own" on public."chat_read_receipts"
  as permissive
  for insert
  to authenticated
  with check ((auth.uid() = user_id));
create policy "chat_read_receipts_select_all" on public."chat_read_receipts"
  as permissive
  for select
  to authenticated
  using (true);
create policy "chat_read_receipts_update_own" on public."chat_read_receipts"
  as permissive
  for update
  to authenticated
  using ((auth.uid() = user_id));
create policy "Users can manage own archives" on public."chat_user_archives"
  as permissive
  for all
  to public
  using ((user_id = get_employee_id()));
create policy "commission_departments_read" on public."commission_departments"
  as permissive
  for select
  to authenticated
  using (true);
create policy "commission_departments_write" on public."commission_departments"
  as permissive
  for all
  to authenticated
  using ((EXISTS ( SELECT 1
   FROM employees e
  WHERE ((e.id = get_employee_id()) AND e.is_super_admin))))
  with check ((EXISTS ( SELECT 1
   FROM employees e
  WHERE ((e.id = get_employee_id()) AND e.is_super_admin))));
create policy "commission_positions_read" on public."commission_positions"
  as permissive
  for select
  to authenticated
  using (true);
create policy "commission_positions_write" on public."commission_positions"
  as permissive
  for all
  to authenticated
  using ((EXISTS ( SELECT 1
   FROM employees e
  WHERE ((e.id = get_employee_id()) AND e.is_super_admin))))
  with check ((EXISTS ( SELECT 1
   FROM employees e
  WHERE ((e.id = get_employee_id()) AND e.is_super_admin))));
create policy "commission_rates_read" on public."commission_rates"
  as permissive
  for select
  to authenticated
  using (true);
create policy "commission_rates_write" on public."commission_rates"
  as permissive
  for all
  to authenticated
  using ((EXISTS ( SELECT 1
   FROM employees e
  WHERE ((e.id = get_employee_id()) AND e.is_super_admin))))
  with check ((EXISTS ( SELECT 1
   FROM employees e
  WHERE ((e.id = get_employee_id()) AND e.is_super_admin))));
create policy "commission_splits_read" on public."commission_splits"
  as permissive
  for select
  to authenticated
  using (true);
create policy "commission_splits_write" on public."commission_splits"
  as permissive
  for all
  to authenticated
  using (((EXISTS ( SELECT 1
   FROM employees e
  WHERE ((e.id = get_employee_id()) AND e.is_super_admin))) OR (EXISTS ( SELECT 1
   FROM sales_opportunities so
  WHERE (so.sales_director_id = get_employee_id())))))
  with check (((EXISTS ( SELECT 1
   FROM employees e
  WHERE ((e.id = get_employee_id()) AND e.is_super_admin))) OR (EXISTS ( SELECT 1
   FROM sales_opportunities so
  WHERE (so.sales_director_id = get_employee_id())))));
create policy "Allow authenticated users to delete committee roles" on public."committee_roles"
  as permissive
  for delete
  to authenticated
  using (true);
create policy "Allow authenticated users to insert committee roles" on public."committee_roles"
  as permissive
  for insert
  to authenticated
  with check (true);
create policy "Allow authenticated users to read committee roles" on public."committee_roles"
  as permissive
  for select
  to authenticated
  using (true);
create policy "Allow authenticated users to update committee roles" on public."committee_roles"
  as permissive
  for update
  to authenticated
  using (true)
  with check (true);
create policy "Authenticated users can update committee task activity" on public."committee_task_activity"
  as permissive
  for update
  to public
  using (true)
  with check (true);
create policy "Enable insert for authenticated users" on public."committee_task_activity"
  as permissive
  for insert
  to public
  with check (true);
create policy "Enable read access for all users" on public."committee_task_activity"
  as permissive
  for select
  to public
  using (true);
create policy "Allow insert on committee_task_logs" on public."committee_task_logs"
  as permissive
  for insert
  to authenticated
  with check (true);
create policy "Allow read on committee_task_logs" on public."committee_task_logs"
  as permissive
  for select
  to authenticated
  using (true);
create policy "Allow update for authenticated users" on public."committee_task_members"
  as permissive
  for update
  to authenticated
  using (true);
create policy "committee_task_members_delete" on public."committee_task_members"
  as permissive
  for delete
  to authenticated
  using ((is_super_admin() OR (EXISTS ( SELECT 1
   FROM committee_tasks ct
  WHERE ((ct.id = committee_task_members.committee_task_id) AND (ct.created_by = get_employee_id()))))));
create policy "committee_task_members_insert" on public."committee_task_members"
  as permissive
  for insert
  to authenticated
  with check ((is_super_admin() OR (EXISTS ( SELECT 1
   FROM committee_tasks ct
  WHERE ((ct.id = committee_task_members.committee_task_id) AND (ct.created_by = get_employee_id()))))));
create policy "committee_task_members_read" on public."committee_task_members"
  as permissive
  for select
  to authenticated
  using (committee_task_visible(committee_task_id));
create policy "committee_task_tags_delete_owner" on public."committee_task_tags"
  as permissive
  for delete
  to authenticated
  using ((COALESCE(is_super_admin(), false) OR (EXISTS ( SELECT 1
   FROM committee_tasks ct
  WHERE ((ct.id = committee_task_tags.committee_task_id) AND (ct.created_by = get_employee_id()))))));
create policy "committee_task_tags_insert_owner" on public."committee_task_tags"
  as permissive
  for insert
  to authenticated
  with check ((COALESCE(is_super_admin(), false) OR (EXISTS ( SELECT 1
   FROM committee_tasks ct
  WHERE ((ct.id = committee_task_tags.committee_task_id) AND (ct.created_by = get_employee_id()))))));
create policy "committee_task_tags_select_authenticated" on public."committee_task_tags"
  as permissive
  for select
  to authenticated
  using (true);
create policy "Allow update for authenticated users" on public."committee_tasks"
  as permissive
  for update
  to authenticated
  using (true);
create policy "committee_tasks_insert" on public."committee_tasks"
  as permissive
  for insert
  to authenticated
  with check ((created_by = get_employee_id()));
create policy "committee_tasks_read" on public."committee_tasks"
  as permissive
  for select
  to authenticated
  using ((is_super_admin() OR (EXISTS ( SELECT 1
   FROM committee_task_members ctm
  WHERE ((ctm.committee_task_id = committee_tasks.id) AND (ctm.employee_id = get_employee_id())))) OR ((created_by = get_employee_id()) AND ((opportunity_id IS NULL) OR ((stage_visit_id IS NOT NULL) AND (stage_visit_id IN ( SELECT sor_visible_visit_ids(committee_tasks.opportunity_id) AS sor_visible_visit_ids))) OR ((stage_visit_id IS NULL) AND (sor_access_level(opportunity_id) = ANY (ARRAY['full'::text, 'participant'::text])))))));
create policy "companies_read" on public."companies"
  as permissive
  for select
  to authenticated
  using (true);
create policy "companies_write" on public."companies"
  as permissive
  for all
  to authenticated
  using ((EXISTS ( SELECT 1
   FROM employees e
  WHERE ((e.id = get_employee_id()) AND (e.is_hr OR e.is_super_admin)))))
  with check ((EXISTS ( SELECT 1
   FROM employees e
  WHERE ((e.id = get_employee_id()) AND (e.is_hr OR e.is_super_admin)))));
create policy "costing_bid_decisions_read" on public."costing_bid_decisions"
  as permissive
  for select
  to authenticated
  using ((costing_tier(costing_matrix_opp(matrix_id)) = 'closed_book'::text));
create policy "costing_column_bands_read" on public."costing_column_bands"
  as permissive
  for select
  to authenticated
  using (true);
create policy "costing_column_tiers_read" on public."costing_column_tiers"
  as permissive
  for select
  to authenticated
  using (true);
create policy "costing_component_costs_read" on public."costing_component_costs"
  as permissive
  for select
  to authenticated
  using ((costing_row_tier('costing_component_costs'::text, jsonb_build_object('component_id', component_id)) = 'closed_book'::text));
create policy "costing_components_delete" on public."costing_components"
  as permissive
  for delete
  to authenticated
  using ((costing_row_tier('costing_components'::text, jsonb_build_object('tender_line_id', tender_line_id)) IS NOT NULL));
create policy "costing_components_insert" on public."costing_components"
  as permissive
  for insert
  to authenticated
  with check ((costing_row_tier('costing_components'::text, jsonb_build_object('tender_line_id', tender_line_id)) IS NOT NULL));
create policy "costing_components_read" on public."costing_components"
  as permissive
  for select
  to authenticated
  using ((costing_row_tier('costing_components'::text, jsonb_build_object('tender_line_id', tender_line_id)) IS NOT NULL));
create policy "costing_components_update" on public."costing_components"
  as permissive
  for update
  to authenticated
  using ((costing_row_tier('costing_components'::text, jsonb_build_object('tender_line_id', tender_line_id)) IS NOT NULL))
  with check ((costing_row_tier('costing_components'::text, jsonb_build_object('tender_line_id', tender_line_id)) IS NOT NULL));
create policy "costing_cost_rows_read" on public."costing_cost_rows"
  as permissive
  for select
  to authenticated
  using ((costing_tier(costing_matrix_opp(matrix_id)) = 'closed_book'::text));
create policy "costing_evaluation_settings_insert" on public."costing_evaluation_settings"
  as permissive
  for insert
  to authenticated
  with check (COALESCE(is_super_admin(), false));
create policy "costing_evaluation_settings_read" on public."costing_evaluation_settings"
  as permissive
  for select
  to authenticated
  using (true);
create policy "costing_evaluation_settings_update" on public."costing_evaluation_settings"
  as permissive
  for update
  to authenticated
  using (COALESCE(is_super_admin(), false))
  with check (COALESCE(is_super_admin(), false));
create policy "costing_events_read" on public."costing_events"
  as permissive
  for select
  to authenticated
  using ((costing_tier(costing_matrix_opp(matrix_id)) = 'closed_book'::text));
create policy "costing_inclusions_delete" on public."costing_inclusions"
  as permissive
  for delete
  to authenticated
  using ((costing_row_tier('costing_inclusions'::text, jsonb_build_object('component_id', component_id)) IS NOT NULL));
create policy "costing_inclusions_insert" on public."costing_inclusions"
  as permissive
  for insert
  to authenticated
  with check ((costing_row_tier('costing_inclusions'::text, jsonb_build_object('component_id', component_id)) IS NOT NULL));
create policy "costing_inclusions_read" on public."costing_inclusions"
  as permissive
  for select
  to authenticated
  using ((costing_row_tier('costing_inclusions'::text, jsonb_build_object('component_id', component_id)) IS NOT NULL));
create policy "costing_inclusions_update" on public."costing_inclusions"
  as permissive
  for update
  to authenticated
  using ((costing_row_tier('costing_inclusions'::text, jsonb_build_object('component_id', component_id)) IS NOT NULL))
  with check ((costing_row_tier('costing_inclusions'::text, jsonb_build_object('component_id', component_id)) IS NOT NULL));
create policy "costing_markup_presets_insert" on public."costing_markup_presets"
  as permissive
  for insert
  to authenticated
  with check (costing_can_manage_markup());
create policy "costing_markup_presets_read" on public."costing_markup_presets"
  as permissive
  for select
  to authenticated
  using (costing_can_manage_markup());
create policy "costing_markup_presets_update" on public."costing_markup_presets"
  as permissive
  for update
  to authenticated
  using (costing_can_manage_markup())
  with check (costing_can_manage_markup());
create policy "costing_matrices_read" on public."costing_matrices"
  as permissive
  for select
  to authenticated
  using (costing_can_read(opportunity_id));
create policy "costing_matrices_update" on public."costing_matrices"
  as permissive
  for update
  to authenticated
  using (costing_can_read(opportunity_id))
  with check (costing_can_read(opportunity_id));
create policy "costing_matrix_money_read" on public."costing_matrix_money"
  as permissive
  for select
  to authenticated
  using ((costing_tier(costing_matrix_opp(matrix_id)) = 'closed_book'::text));
create policy "costing_settings_read" on public."costing_settings"
  as permissive
  for select
  to authenticated
  using (true);
create policy "costing_settings_update" on public."costing_settings"
  as permissive
  for update
  to authenticated
  using ((has_finance_access() OR COALESCE(is_super_admin(), false)))
  with check ((has_finance_access() OR COALESCE(is_super_admin(), false)));
create policy "costing_signer_lists_delete" on public."costing_signer_lists"
  as permissive
  for delete
  to authenticated
  using (COALESCE(is_super_admin(), false));
create policy "costing_signer_lists_insert" on public."costing_signer_lists"
  as permissive
  for insert
  to authenticated
  with check (COALESCE(is_super_admin(), false));
create policy "costing_signer_lists_read" on public."costing_signer_lists"
  as permissive
  for select
  to authenticated
  using (true);
create policy "costing_signoffs_read" on public."costing_signoffs"
  as permissive
  for select
  to authenticated
  using (costing_can_read(costing_matrix_opp(matrix_id)));
create policy "costing_tables_read" on public."costing_tables"
  as permissive
  for select
  to authenticated
  using (true);
create policy "costing_tender_line_prices_read" on public."costing_tender_line_prices"
  as permissive
  for select
  to authenticated
  using ((costing_row_tier('costing_tender_line_prices'::text, jsonb_build_object('tender_line_id', tender_line_id)) = 'closed_book'::text));
create policy "costing_tender_lines_delete" on public."costing_tender_lines"
  as permissive
  for delete
  to authenticated
  using (costing_can_read(costing_matrix_opp(matrix_id)));
create policy "costing_tender_lines_insert" on public."costing_tender_lines"
  as permissive
  for insert
  to authenticated
  with check (costing_can_read(costing_matrix_opp(matrix_id)));
create policy "costing_tender_lines_read" on public."costing_tender_lines"
  as permissive
  for select
  to authenticated
  using (costing_can_read(costing_matrix_opp(matrix_id)));
create policy "costing_tender_lines_update" on public."costing_tender_lines"
  as permissive
  for update
  to authenticated
  using (costing_can_read(costing_matrix_opp(matrix_id)))
  with check (costing_can_read(costing_matrix_opp(matrix_id)));
create policy "costing_virtual_columns_read" on public."costing_virtual_columns"
  as permissive
  for select
  to authenticated
  using (true);
create policy "crm_pipeline_stages_read" on public."crm_pipeline_stages"
  as permissive
  for select
  to authenticated
  using (true);
create policy "crm_pipeline_stages_write" on public."crm_pipeline_stages"
  as permissive
  for all
  to authenticated
  using ((EXISTS ( SELECT 1
   FROM employees e
  WHERE ((e.id = get_employee_id()) AND e.is_super_admin))))
  with check ((EXISTS ( SELECT 1
   FROM employees e
  WHERE ((e.id = get_employee_id()) AND e.is_super_admin))));
create policy "currency_rate_currencies_read" on public."currency_rate_currencies"
  as permissive
  for select
  to authenticated
  using (true);
create policy "currency_rates_read" on public."currency_rates"
  as permissive
  for select
  to authenticated
  using (true);
create policy "Employees can read employee group members" on public."employee_group_members"
  as permissive
  for select
  to authenticated
  using (true);
create policy "Super Admins can delete employee group members" on public."employee_group_members"
  as permissive
  for delete
  to authenticated
  using (COALESCE(is_super_admin(), false));
create policy "Super Admins can insert employee group members" on public."employee_group_members"
  as permissive
  for insert
  to authenticated
  with check (COALESCE(is_super_admin(), false));
create policy "Super Admins can update employee group members" on public."employee_group_members"
  as permissive
  for update
  to authenticated
  using (COALESCE(is_super_admin(), false))
  with check (COALESCE(is_super_admin(), false));
create policy "Employees can read employee group teams" on public."employee_group_teams"
  as permissive
  for select
  to authenticated
  using (true);
create policy "Super Admins can delete employee group teams" on public."employee_group_teams"
  as permissive
  for delete
  to authenticated
  using (COALESCE(is_super_admin(), false));
create policy "Super Admins can insert employee group teams" on public."employee_group_teams"
  as permissive
  for insert
  to authenticated
  with check (COALESCE(is_super_admin(), false));
create policy "Super Admins can update employee group teams" on public."employee_group_teams"
  as permissive
  for update
  to authenticated
  using (COALESCE(is_super_admin(), false))
  with check (COALESCE(is_super_admin(), false));
create policy "Employees can read employee groups" on public."employee_groups"
  as permissive
  for select
  to authenticated
  using (true);
create policy "Super Admins can delete employee groups" on public."employee_groups"
  as permissive
  for delete
  to authenticated
  using (COALESCE(is_super_admin(), false));
create policy "Super Admins can insert employee groups" on public."employee_groups"
  as permissive
  for insert
  to authenticated
  with check (COALESCE(is_super_admin(), false));
create policy "Super Admins can update employee groups" on public."employee_groups"
  as permissive
  for update
  to authenticated
  using (COALESCE(is_super_admin(), false))
  with check (COALESCE(is_super_admin(), false));
create policy "Allow Super Admin and HR to insert employees" on public."employees"
  as permissive
  for insert
  to public
  with check (((is_super_admin() = true) OR (is_hr() = true)));
create policy "Allow Super Admin and HR to update employees" on public."employees"
  as permissive
  for update
  to public
  using (((is_super_admin() = true) OR (is_hr() = true) OR (is_role_simulator() = true) OR (can_manage_leaves() = true)))
  with check (((is_super_admin() = true) OR (is_hr() = true) OR (is_role_simulator() = true) OR (can_manage_leaves() = true)));
create policy "Allow public read of employees" on public."employees"
  as permissive
  for select
  to public
  using (true);
create policy "Employees can update their own profile" on public."employees"
  as permissive
  for update
  to authenticated
  using ((auth.email() = email))
  with check ((auth.email() = email));
create policy "faq_data_select" on public."faq_data"
  as permissive
  for select
  to authenticated
  using (true);
create policy "faq_data_upsert" on public."faq_data"
  as permissive
  for all
  to authenticated
  using (true)
  with check (true);
create policy "flow_access_settings_read" on public."flow_access_settings"
  as permissive
  for select
  to authenticated
  using (true);
create policy "flow_access_settings_write" on public."flow_access_settings"
  as permissive
  for all
  to authenticated
  using ((get_employee_id() IS NOT NULL))
  with check ((get_employee_id() IS NOT NULL));
create policy "flow_edges_read" on public."flow_edges"
  as permissive
  for select
  to authenticated
  using (true);
create policy "flow_edges_write" on public."flow_edges"
  as permissive
  for all
  to authenticated
  using ((get_employee_id() IS NOT NULL))
  with check ((get_employee_id() IS NOT NULL));
create policy "flow_form_fields_read" on public."flow_form_fields"
  as permissive
  for select
  to authenticated
  using (true);
create policy "flow_form_fields_write" on public."flow_form_fields"
  as permissive
  for all
  to authenticated
  using ((get_employee_id() IS NOT NULL))
  with check ((get_employee_id() IS NOT NULL));
create policy "flow_snapshots_read" on public."flow_snapshots"
  as permissive
  for select
  to authenticated
  using (true);
create policy "flow_snapshots_write" on public."flow_snapshots"
  as permissive
  for insert
  to authenticated
  with check ((created_by = get_employee_id()));
create policy "flow_stage_access_read" on public."flow_stage_access"
  as permissive
  for select
  to authenticated
  using (true);
create policy "flow_stage_access_write" on public."flow_stage_access"
  as permissive
  for all
  to authenticated
  using ((get_employee_id() IS NOT NULL))
  with check ((get_employee_id() IS NOT NULL));
create policy "flow_stage_actions_read" on public."flow_stage_actions"
  as permissive
  for select
  to authenticated
  using (true);
create policy "flow_stage_actions_write" on public."flow_stage_actions"
  as permissive
  for all
  to authenticated
  using ((get_employee_id() IS NOT NULL))
  with check ((get_employee_id() IS NOT NULL));
create policy "flow_stage_fields_read" on public."flow_stage_fields"
  as permissive
  for select
  to authenticated
  using (true);
create policy "flow_stage_fields_write" on public."flow_stage_fields"
  as permissive
  for all
  to authenticated
  using ((get_employee_id() IS NOT NULL))
  with check ((get_employee_id() IS NOT NULL));
create policy "flow_stage_follow_ups_read" on public."flow_stage_follow_ups"
  as permissive
  for select
  to authenticated
  using (true);
create policy "flow_stage_follow_ups_write" on public."flow_stage_follow_ups"
  as permissive
  for all
  to authenticated
  using ((get_employee_id() IS NOT NULL))
  with check ((get_employee_id() IS NOT NULL));
create policy "flow_stages_read" on public."flow_stages"
  as permissive
  for select
  to authenticated
  using (true);
create policy "flow_stages_write" on public."flow_stages"
  as permissive
  for all
  to authenticated
  using ((get_employee_id() IS NOT NULL))
  with check ((get_employee_id() IS NOT NULL));
create policy "group_task_template_members_delete" on public."group_task_template_members"
  as permissive
  for delete
  to authenticated
  using (group_task_template_can_edit(template_id));
create policy "group_task_template_members_insert" on public."group_task_template_members"
  as permissive
  for insert
  to authenticated
  with check (group_task_template_can_edit(template_id));
create policy "group_task_template_members_read" on public."group_task_template_members"
  as permissive
  for select
  to authenticated
  using (true);
create policy "group_task_template_members_update" on public."group_task_template_members"
  as permissive
  for update
  to authenticated
  using (group_task_template_can_edit(template_id))
  with check (group_task_template_can_edit(template_id));
create policy "group_task_templates_delete" on public."group_task_templates"
  as permissive
  for delete
  to authenticated
  using (((created_by = get_employee_id()) OR (EXISTS ( SELECT 1
   FROM employees e
  WHERE ((e.id = get_employee_id()) AND (e.is_head OR e.is_super_admin))))));
create policy "group_task_templates_insert" on public."group_task_templates"
  as permissive
  for insert
  to authenticated
  with check (((created_by = get_employee_id()) OR (EXISTS ( SELECT 1
   FROM employees e
  WHERE ((e.id = get_employee_id()) AND (e.is_head OR e.is_super_admin))))));
create policy "group_task_templates_read" on public."group_task_templates"
  as permissive
  for select
  to authenticated
  using (true);
create policy "group_task_templates_update" on public."group_task_templates"
  as permissive
  for update
  to authenticated
  using (((created_by = get_employee_id()) OR (EXISTS ( SELECT 1
   FROM employees e
  WHERE ((e.id = get_employee_id()) AND (e.is_head OR e.is_super_admin))))))
  with check (((created_by = get_employee_id()) OR (EXISTS ( SELECT 1
   FROM employees e
  WHERE ((e.id = get_employee_id()) AND (e.is_head OR e.is_super_admin))))));
create policy "hr_day_shift_config_read" on public."hr_day_shift_config"
  as permissive
  for select
  to authenticated
  using (true);
create policy "hr_day_shift_config_write" on public."hr_day_shift_config"
  as permissive
  for all
  to authenticated
  using ((EXISTS ( SELECT 1
   FROM employees e
  WHERE ((e.id = get_employee_id()) AND e.is_super_admin))))
  with check ((EXISTS ( SELECT 1
   FROM employees e
  WHERE ((e.id = get_employee_id()) AND e.is_super_admin))));
create policy "hr_leave_categories_read" on public."hr_leave_categories"
  as permissive
  for select
  to authenticated
  using (true);
create policy "hr_leave_categories_write" on public."hr_leave_categories"
  as permissive
  for all
  to authenticated
  using ((EXISTS ( SELECT 1
   FROM employees e
  WHERE ((e.id = get_employee_id()) AND (e.is_hr OR e.is_super_admin)))))
  with check ((EXISTS ( SELECT 1
   FROM employees e
  WHERE ((e.id = get_employee_id()) AND (e.is_hr OR e.is_super_admin)))));
create policy "ipas_read" on public."ipas"
  as permissive
  for select
  to authenticated
  using (ipas_can_read());
create policy "ipas_bank_details_read" on public."ipas_bank_details"
  as permissive
  for select
  to authenticated
  using (ipas_can_read_bank_details());
create policy "ipas_charges_read" on public."ipas_charges"
  as permissive
  for select
  to authenticated
  using (ipas_can_read());
create policy "ipas_documents_read" on public."ipas_documents"
  as permissive
  for select
  to authenticated
  using (ipas_can_read());
create policy "ipas_events_read" on public."ipas_events"
  as permissive
  for select
  to authenticated
  using (ipas_can_read());
create policy "ipas_options_insert" on public."ipas_options"
  as permissive
  for insert
  to authenticated
  with check ((has_purchasing_access() OR COALESCE(is_super_admin(), false)));
create policy "ipas_options_read" on public."ipas_options"
  as permissive
  for select
  to authenticated
  using ((( SELECT ipas_can_read() AS ipas_can_read) OR ((list = ANY (ARRAY['transmittal_product'::text, 'transmittal_reference'::text, 'item_location'::text])) AND ( SELECT (transmittal_on_list('transmittal_warehouse'::text) OR transmittal_on_list('transmittal_technical'::text) OR transmittal_on_list('transmittal_logistics'::text) OR transmittal_on_list('transmittal_check_by'::text))))));
create policy "ipas_options_update" on public."ipas_options"
  as permissive
  for update
  to authenticated
  using ((has_purchasing_access() OR COALESCE(is_super_admin(), false)))
  with check ((has_purchasing_access() OR COALESCE(is_super_admin(), false)));
create policy "ipas_payments_read" on public."ipas_payments"
  as permissive
  for select
  to authenticated
  using (ipas_can_read());
create policy "ipas_signer_list_log_read" on public."ipas_signer_list_log"
  as permissive
  for select
  to authenticated
  using (COALESCE(is_super_admin(), false));
create policy "ipas_signer_lists_own_read" on public."ipas_signer_lists"
  as permissive
  for select
  to authenticated
  using ((employee_id = get_employee_id()));
create policy "ipas_signer_lists_read" on public."ipas_signer_lists"
  as permissive
  for select
  to authenticated
  using (ipas_can_read());
create policy "ipas_signoffs_read" on public."ipas_signoffs"
  as permissive
  for select
  to authenticated
  using (ipas_can_read());
create policy "ipas_sors_read" on public."ipas_sors"
  as permissive
  for select
  to authenticated
  using (ipas_can_read());
create policy "Authenticated users can dispatch a notification as themselves" on public."notifications"
  as permissive
  for insert
  to authenticated
  with check (((sender_id IS NULL) OR (sender_id = get_employee_id())));
create policy "Users can delete own notifications" on public."notifications"
  as permissive
  for delete
  to public
  using ((recipient_id = get_employee_id()));
create policy "Users can update own notifications" on public."notifications"
  as permissive
  for update
  to public
  using ((recipient_id = get_employee_id()));
create policy "Users can view own notifications" on public."notifications"
  as permissive
  for select
  to public
  using ((recipient_id = get_employee_id()));
create policy "Retail handlers can dismiss queue items" on public."odoo_retail_queue"
  as permissive
  for update
  to authenticated
  using ((can_handle_retail_queue() AND (status = 'pending'::text)))
  with check (can_handle_retail_queue());
create policy "Retail handlers can view queue" on public."odoo_retail_queue"
  as permissive
  for select
  to authenticated
  using (can_handle_retail_queue());
create policy "offset_leaves_head_select" on public."offset_leaves"
  as permissive
  for select
  to authenticated
  using ((head_id = get_employee_id()));
create policy "offset_leaves_head_update" on public."offset_leaves"
  as permissive
  for update
  to authenticated
  using ((head_id = get_employee_id()));
create policy "offset_leaves_insert" on public."offset_leaves"
  as permissive
  for insert
  to authenticated
  with check (((employee_id = get_employee_id()) OR (EXISTS ( SELECT 1
   FROM employees e
  WHERE ((e.id = get_employee_id()) AND (e.is_hr OR e.is_super_admin OR e.can_manage_leaves))))));
create policy "offset_leaves_select" on public."offset_leaves"
  as permissive
  for select
  to public
  using (((employee_id = get_employee_id()) OR (EXISTS ( SELECT 1
   FROM employees e
  WHERE ((e.id = get_employee_id()) AND (e.is_hr OR e.is_super_admin OR e.can_manage_leaves))))));
create policy "offset_leaves_update" on public."offset_leaves"
  as permissive
  for update
  to authenticated
  using ((EXISTS ( SELECT 1
   FROM employees e
  WHERE ((e.id = get_employee_id()) AND (e.is_hr OR e.is_super_admin OR e.can_manage_leaves)))));
create policy "offset_leaves_withdraw" on public."offset_leaves"
  as permissive
  for update
  to authenticated
  using (((employee_id = get_employee_id()) AND (status = ANY (ARRAY['PENDING'::text, 'APPROVED'::text]))))
  with check (((employee_id = get_employee_id()) AND (status = 'CANCELLED'::text)));
create policy "order_ageing_rules_insert" on public."order_ageing_rules"
  as permissive
  for insert
  to authenticated
  with check ((has_purchasing_access() OR COALESCE(is_super_admin(), false)));
create policy "order_ageing_rules_read" on public."order_ageing_rules"
  as permissive
  for select
  to authenticated
  using ((get_employee_id() IS NOT NULL));
create policy "order_ageing_rules_update" on public."order_ageing_rules"
  as permissive
  for update
  to authenticated
  using ((has_purchasing_access() OR COALESCE(is_super_admin(), false)))
  with check ((has_purchasing_access() OR COALESCE(is_super_admin(), false)));
create policy "order_deadline_setting_insert" on public."order_deadline_setting"
  as permissive
  for insert
  to authenticated
  with check ((has_purchasing_access() OR COALESCE(is_super_admin(), false)));
create policy "order_deadline_setting_read" on public."order_deadline_setting"
  as permissive
  for select
  to authenticated
  using ((get_employee_id() IS NOT NULL));
create policy "order_deadline_setting_update" on public."order_deadline_setting"
  as permissive
  for update
  to authenticated
  using ((has_purchasing_access() OR COALESCE(is_super_admin(), false)))
  with check ((has_purchasing_access() OR COALESCE(is_super_admin(), false)));
create policy "Employees can view their own overtime" on public."overtime_requests"
  as permissive
  for select
  to public
  using ((auth.uid() = employee_id));
create policy "HR can view all overtime" on public."overtime_requests"
  as permissive
  for select
  to public
  using ((EXISTS ( SELECT 1
   FROM employees
  WHERE ((employees.id = auth.uid()) AND (employees.is_hr = true)))));
create policy "overtime_requests_head_select" on public."overtime_requests"
  as permissive
  for select
  to authenticated
  using ((head_id = get_employee_id()));
create policy "overtime_requests_head_update" on public."overtime_requests"
  as permissive
  for update
  to authenticated
  using ((head_id = get_employee_id()));
create policy "overtime_requests_insert" on public."overtime_requests"
  as permissive
  for insert
  to authenticated
  with check (((employee_id = get_employee_id()) OR (EXISTS ( SELECT 1
   FROM employees e
  WHERE ((e.id = get_employee_id()) AND (e.is_hr OR e.is_super_admin OR e.can_manage_leaves))))));
create policy "overtime_requests_select" on public."overtime_requests"
  as permissive
  for select
  to authenticated
  using (((employee_id = get_employee_id()) OR (EXISTS ( SELECT 1
   FROM employees e
  WHERE ((e.id = get_employee_id()) AND (e.is_hr OR e.is_super_admin OR e.can_manage_leaves))))));
create policy "overtime_requests_update" on public."overtime_requests"
  as permissive
  for update
  to authenticated
  using ((EXISTS ( SELECT 1
   FROM employees e
  WHERE ((e.id = get_employee_id()) AND (e.is_hr OR e.is_super_admin OR e.can_manage_leaves)))));
create policy "overtime_requests_withdraw" on public."overtime_requests"
  as permissive
  for update
  to authenticated
  using (((employee_id = get_employee_id()) AND (status = 'PENDING'::text)))
  with check (((employee_id = get_employee_id()) AND (status = 'CANCELLED'::text)));
create policy "packing_list_boxes_read" on public."packing_list_boxes"
  as permissive
  for select
  to authenticated
  using (packing_list_can_read(packing_list_id));
create policy "packing_list_contents_read" on public."packing_list_contents"
  as permissive
  for select
  to authenticated
  using (packing_list_box_can_read(box_id));
create policy "packing_lists_read" on public."packing_lists"
  as permissive
  for select
  to authenticated
  using (packing_list_can_read(id));
create policy "pms_evidence_read" on public."pms_evidence"
  as permissive
  for select
  to authenticated
  using (transmittal_can_read(transmittal_id));
create policy "pms_handoff_events_packing_list_read" on public."pms_handoff_events"
  as permissive
  for select
  to authenticated
  using (((record_type = 'packing_list'::text) AND packing_list_can_read(record_id)));
create policy "pms_handoff_events_read" on public."pms_handoff_events"
  as permissive
  for select
  to authenticated
  using (((record_type = 'transmittal'::text) AND transmittal_can_read(record_id)));
create policy "purchase_request_item_prices_read" on public."purchase_request_item_prices"
  as permissive
  for select
  to authenticated
  using (canvass_subject_can_read_money(NULL::uuid, item_id));
create policy "purchase_request_items_read" on public."purchase_request_items"
  as permissive
  for select
  to authenticated
  using (can_read_purchase_request(request_id));
create policy "purchase_request_members_read" on public."purchase_request_members"
  as permissive
  for select
  to authenticated
  using (can_read_purchase_request(request_id));
create policy "purchase_request_messages_insert" on public."purchase_request_messages"
  as permissive
  for insert
  to authenticated
  with check (((author_id = get_employee_id()) AND (NOT (metadata ? 'event'::text)) AND (is_purchase_request_member(request_id) OR COALESCE(is_super_admin(), false))));
create policy "purchase_request_messages_read" on public."purchase_request_messages"
  as permissive
  for select
  to authenticated
  using (can_read_purchase_request(request_id));
create policy "purchase_requests_read" on public."purchase_requests"
  as permissive
  for select
  to authenticated
  using (can_read_purchase_request(id));
create policy "Users can create own push subscriptions" on public."push_subscriptions"
  as permissive
  for insert
  to authenticated
  with check ((employee_id = get_employee_id()));
create policy "Users can delete own push subscriptions" on public."push_subscriptions"
  as permissive
  for delete
  to authenticated
  using ((employee_id = get_employee_id()));
create policy "Users can view own push subscriptions" on public."push_subscriptions"
  as permissive
  for select
  to authenticated
  using ((employee_id = get_employee_id()));
create policy "Retail handlers can view retail orders" on public."retail_orders"
  as permissive
  for select
  to authenticated
  using (can_handle_retail_queue());
create policy "Allow all read" on public."revenue_activity_logs"
  as permissive
  for select
  to public
  using (true);
create policy "authenticated_insert_revenue_activity_logs" on public."revenue_activity_logs"
  as permissive
  for insert
  to public
  with check ((auth.uid() IS NOT NULL));
create policy "head_read_revenue_activity_logs" on public."revenue_activity_logs"
  as permissive
  for select
  to public
  using ((EXISTS ( SELECT 1
   FROM employees
  WHERE ((employees.id = auth.uid()) AND (employees.is_head = true)))));
create policy "hr_read_revenue_activity_logs" on public."revenue_activity_logs"
  as permissive
  for select
  to public
  using ((EXISTS ( SELECT 1
   FROM employees
  WHERE ((employees.id = auth.uid()) AND (employees.is_hr = true)))));
create policy "super_admin_all_revenue_activity_logs" on public."revenue_activity_logs"
  as permissive
  for all
  to public
  using ((EXISTS ( SELECT 1
   FROM employees
  WHERE ((employees.id = auth.uid()) AND (employees.is_super_admin = true)))))
  with check ((EXISTS ( SELECT 1
   FROM employees
  WHERE ((employees.id = auth.uid()) AND (employees.is_super_admin = true)))));
create policy "sale_types_read" on public."sale_types"
  as permissive
  for select
  to authenticated
  using (true);
create policy "sale_types_write" on public."sale_types"
  as permissive
  for all
  to authenticated
  using ((get_employee_id() IS NOT NULL))
  with check ((get_employee_id() IS NOT NULL));
create policy "Users can delete their own templates" on public."sales_custom_templates"
  as permissive
  for delete
  to authenticated
  using ((employee_id IN ( SELECT employees.id
   FROM employees
  WHERE (employees.email = (auth.jwt() ->> 'email'::text)))));
create policy "Users can insert their own templates" on public."sales_custom_templates"
  as permissive
  for insert
  to authenticated
  with check ((employee_id IN ( SELECT employees.id
   FROM employees
  WHERE (employees.email = (auth.jwt() ->> 'email'::text)))));
create policy "Users can update their own templates" on public."sales_custom_templates"
  as permissive
  for update
  to authenticated
  using ((employee_id IN ( SELECT employees.id
   FROM employees
  WHERE (employees.email = (auth.jwt() ->> 'email'::text)))));
create policy "Users can view their own templates" on public."sales_custom_templates"
  as permissive
  for select
  to authenticated
  using ((employee_id IN ( SELECT employees.id
   FROM employees
  WHERE (employees.email = (auth.jwt() ->> 'email'::text)))));
create policy "sales_flows_read" on public."sales_flows"
  as permissive
  for select
  to authenticated
  using (true);
create policy "sales_flows_write" on public."sales_flows"
  as permissive
  for all
  to authenticated
  using ((get_employee_id() IS NOT NULL))
  with check ((get_employee_id() IS NOT NULL));
create policy "sor_insert" on public."sales_opportunities"
  as permissive
  for insert
  to authenticated
  with check ((registered_by = get_employee_id()));
create policy "sor_read" on public."sales_opportunities"
  as permissive
  for select
  to authenticated
  using ((is_super_admin() OR sor_is_deal_team(sales_opportunities.*, get_employee_id()) OR sor_always_sees(sales_opportunities.*, get_employee_id())));
create policy "sor_update" on public."sales_opportunities"
  as permissive
  for update
  to authenticated
  using ((sor_can_edit_opportunity(id) OR (sor_access_level(id) = 'full'::text)));
create policy "sor_items_delete" on public."sales_opportunity_items"
  as permissive
  for delete
  to authenticated
  using (sor_can_edit_opportunity(opportunity_id));
create policy "sor_items_insert" on public."sales_opportunity_items"
  as permissive
  for insert
  to authenticated
  with check (sor_can_edit_opportunity(opportunity_id));
create policy "sor_items_read" on public."sales_opportunity_items"
  as permissive
  for select
  to authenticated
  using ((is_super_admin() OR (EXISTS ( SELECT 1
   FROM sales_opportunities o
  WHERE ((o.id = sales_opportunity_items.opportunity_id) AND (sor_is_deal_team(o.*, get_employee_id()) OR sor_always_sees(o.*, get_employee_id()))))) OR is_hr()));
create policy "sor_items_update" on public."sales_opportunity_items"
  as permissive
  for update
  to authenticated
  using (sor_can_edit_opportunity(opportunity_id));
create policy "sor_log_insert" on public."sales_opportunity_logs"
  as permissive
  for insert
  to authenticated
  with check (((author_id = get_employee_id()) OR (author_id IS NULL)));
create policy "sor_log_read" on public."sales_opportunity_logs"
  as permissive
  for select
  to authenticated
  using ((is_super_admin() OR ((stage_visit_id IS NOT NULL) AND (stage_visit_id IN ( SELECT sor_visible_visit_ids(sales_opportunity_logs.opportunity_id) AS sor_visible_visit_ids))) OR ((stage_visit_id IS NULL) AND (sor_access_level(opportunity_id) = ANY (ARRAY['full'::text, 'participant'::text])))));
create policy "sales_opportunity_members_insert" on public."sales_opportunity_members"
  as permissive
  for insert
  to authenticated
  with check (true);
create policy "sales_opportunity_members_read" on public."sales_opportunity_members"
  as permissive
  for select
  to authenticated
  using ((sor_can_edit_opportunity(opportunity_id) OR is_hr()));
create policy "sil_leaves_head_select" on public."sil_leaves"
  as permissive
  for select
  to authenticated
  using ((head_id = get_employee_id()));
create policy "sil_leaves_head_update" on public."sil_leaves"
  as permissive
  for update
  to authenticated
  using ((head_id = get_employee_id()));
create policy "sil_leaves_insert" on public."sil_leaves"
  as permissive
  for insert
  to authenticated
  with check (((employee_id = get_employee_id()) OR (EXISTS ( SELECT 1
   FROM employees e
  WHERE ((e.id = get_employee_id()) AND (e.is_hr OR e.is_super_admin OR e.can_manage_leaves))))));
create policy "sil_leaves_select" on public."sil_leaves"
  as permissive
  for select
  to public
  using (((employee_id = get_employee_id()) OR (EXISTS ( SELECT 1
   FROM employees e
  WHERE ((e.id = get_employee_id()) AND (e.is_hr OR e.is_super_admin OR e.can_manage_leaves))))));
create policy "sil_leaves_update" on public."sil_leaves"
  as permissive
  for update
  to authenticated
  using ((EXISTS ( SELECT 1
   FROM employees e
  WHERE ((e.id = get_employee_id()) AND (e.is_hr OR e.is_super_admin OR e.can_manage_leaves)))));
create policy "sil_leaves_withdraw" on public."sil_leaves"
  as permissive
  for update
  to authenticated
  using (((employee_id = get_employee_id()) AND (status = ANY (ARRAY['PENDING'::text, 'APPROVED'::text]))))
  with check (((employee_id = get_employee_id()) AND (status = 'CANCELLED'::text)));
create policy "sor_action_runs_read" on public."sor_action_runs"
  as permissive
  for select
  to authenticated
  using (true);
create policy "sor_canvass_offer_prices_delete" on public."sor_canvass_offer_prices"
  as permissive
  for delete
  to authenticated
  using ((canvass_can_write() AND canvass_offer_can_read_money(offer_id)));
create policy "sor_canvass_offer_prices_insert" on public."sor_canvass_offer_prices"
  as permissive
  for insert
  to authenticated
  with check ((canvass_can_write() AND canvass_offer_can_read_money(offer_id)));
create policy "sor_canvass_offer_prices_read" on public."sor_canvass_offer_prices"
  as permissive
  for select
  to authenticated
  using (canvass_offer_can_read_money(offer_id));
create policy "sor_canvass_offer_prices_update" on public."sor_canvass_offer_prices"
  as permissive
  for update
  to authenticated
  using ((canvass_can_write() AND canvass_offer_can_read_money(offer_id)))
  with check ((canvass_can_write() AND canvass_offer_can_read_money(offer_id)));
create policy "sor_canvass_offers_delete" on public."sor_canvass_offers"
  as permissive
  for delete
  to authenticated
  using ((canvass_can_write() AND canvass_can_read(canvass_id)));
create policy "sor_canvass_offers_insert" on public."sor_canvass_offers"
  as permissive
  for insert
  to authenticated
  with check ((canvass_can_write() AND canvass_can_read(canvass_id)));
create policy "sor_canvass_offers_read" on public."sor_canvass_offers"
  as permissive
  for select
  to authenticated
  using (canvass_can_read(canvass_id));
create policy "sor_canvass_offers_update" on public."sor_canvass_offers"
  as permissive
  for update
  to authenticated
  using ((canvass_can_write() AND canvass_can_read(canvass_id)))
  with check ((canvass_can_write() AND canvass_can_read(canvass_id)));
create policy "sor_canvass_signoff_events_read" on public."sor_canvass_signoff_events"
  as permissive
  for select
  to authenticated
  using (canvass_can_read(canvass_id));
create policy "sor_canvasses_delete" on public."sor_canvasses"
  as permissive
  for delete
  to authenticated
  using ((canvass_can_write() AND canvass_subject_can_read(component_id, requested_item_id)));
create policy "sor_canvasses_insert" on public."sor_canvasses"
  as permissive
  for insert
  to authenticated
  with check ((canvass_can_write() AND canvass_subject_can_read(component_id, requested_item_id)));
create policy "sor_canvasses_read" on public."sor_canvasses"
  as permissive
  for select
  to authenticated
  using (canvass_subject_can_read(component_id, requested_item_id));
create policy "sor_canvasses_update" on public."sor_canvasses"
  as permissive
  for update
  to authenticated
  using ((canvass_can_write() AND canvass_subject_can_read(component_id, requested_item_id)))
  with check ((canvass_can_write() AND canvass_subject_can_read(component_id, requested_item_id)));
create policy "sor_condition_status_read" on public."sor_condition_status"
  as permissive
  for select
  to authenticated
  using ((is_super_admin() OR ((stage_visit_id IS NOT NULL) AND (stage_visit_id IN ( SELECT sor_visible_visit_ids(sor_condition_status.opportunity_id) AS sor_visible_visit_ids))) OR ((stage_visit_id IS NULL) AND (sor_access_level(opportunity_id) = ANY (ARRAY['full'::text, 'participant'::text])))));
create policy "sor_form_values_read" on public."sor_form_values"
  as permissive
  for select
  to authenticated
  using (true);
create policy "sor_form_values_write" on public."sor_form_values"
  as permissive
  for all
  to authenticated
  using (true)
  with check (true);
create policy "sor_inclusions_read" on public."sor_inclusions"
  as permissive
  for select
  to authenticated
  using ((sor_can_edit_opportunity(opportunity_id) OR is_hr()));
create policy "sor_mention_viewers_read" on public."sor_mention_viewers"
  as permissive
  for select
  to authenticated
  using (((employee_id = get_employee_id()) OR is_super_admin()));
create policy "sor_procurement_read" on public."sor_procurement_requests"
  as permissive
  for select
  to authenticated
  using ((sor_can_edit_opportunity(opportunity_id) OR is_hr()));
create policy "sor_purchase_order_links_read" on public."sor_purchase_order_links"
  as permissive
  for select
  to authenticated
  using ((sor_can_edit_opportunity(opportunity_id) OR is_hr()));
create policy "sor_purchase_order_links_write" on public."sor_purchase_order_links"
  as permissive
  for all
  to authenticated
  using (sor_can_edit_opportunity(opportunity_id))
  with check (sor_can_edit_opportunity(opportunity_id));
create policy "sor_stage_field_values_delete" on public."sor_stage_field_values"
  as permissive
  for delete
  to authenticated
  using (true);
create policy "sor_stage_field_values_insert" on public."sor_stage_field_values"
  as permissive
  for insert
  to authenticated
  with check (true);
create policy "sor_stage_field_values_read" on public."sor_stage_field_values"
  as permissive
  for select
  to authenticated
  using ((is_super_admin() OR (stage_visit_id IN ( SELECT sor_visible_visit_ids(sor_stage_field_values.opportunity_id) AS sor_visible_visit_ids))));
create policy "sor_stage_field_values_update" on public."sor_stage_field_values"
  as permissive
  for update
  to authenticated
  using (true)
  with check (true);
create policy "sor_stage_participants_insert" on public."sor_stage_participants"
  as permissive
  for insert
  to authenticated
  with check (true);
create policy "sor_stage_participants_read" on public."sor_stage_participants"
  as permissive
  for select
  to authenticated
  using (((sor_access_level(opportunity_id) = ANY (ARRAY['full'::text, 'participant'::text])) OR (employee_id = get_employee_id())));
create policy "sor_stage_participants_update" on public."sor_stage_participants"
  as permissive
  for update
  to authenticated
  using ((is_super_admin() OR (EXISTS ( SELECT 1
   FROM sales_opportunities o
  WHERE ((o.id = sor_stage_participants.opportunity_id) AND (o.deal_owner_id = get_employee_id()))))));
create policy "sor_stage_visits_read" on public."sor_stage_visits"
  as permissive
  for select
  to authenticated
  using (((sor_access_level(opportunity_id) = ANY (ARRAY['full'::text, 'participant'::text])) OR (id IN ( SELECT sor_visible_visit_ids(sor_stage_visits.opportunity_id) AS sor_visible_visit_ids))));
create policy "sor_stock_snapshots_insert" on public."sor_stock_snapshots"
  as permissive
  for insert
  to authenticated
  with check (sor_can_edit_opportunity(opportunity_id));
create policy "sor_stock_snapshots_read" on public."sor_stock_snapshots"
  as permissive
  for select
  to authenticated
  using ((sor_access_level(opportunity_id) = ANY (ARRAY['full'::text, 'participant'::text])));
create policy "sor_stock_snapshots_update" on public."sor_stock_snapshots"
  as permissive
  for update
  to authenticated
  using (sor_can_edit_opportunity(opportunity_id))
  with check (sor_can_edit_opportunity(opportunity_id));
create policy "stage_conditions_read" on public."stage_conditions"
  as permissive
  for select
  to authenticated
  using (true);
create policy "stage_conditions_write" on public."stage_conditions"
  as permissive
  for all
  to authenticated
  using ((get_employee_id() IS NOT NULL))
  with check ((get_employee_id() IS NOT NULL));
create policy "authenticated_insert_system_audit_logs" on public."system_audit_logs"
  as permissive
  for insert
  to public
  with check ((auth.uid() IS NOT NULL));
create policy "hr_read_system_audit_logs" on public."system_audit_logs"
  as permissive
  for select
  to authenticated
  using ((COALESCE(is_hr(), false) AND (entity_type = ANY (ARRAY['EMPLOYEE'::text, 'CATEGORY'::text, 'OVERTIME'::text, 'OFFSET_LEAVE'::text, 'SIL_LEAVE'::text, 'HR_SETTINGS'::text]))));
create policy "super_admin_all_system_audit_logs" on public."system_audit_logs"
  as permissive
  for all
  to authenticated
  using (COALESCE(is_super_admin(), false))
  with check (COALESCE(is_super_admin(), false));
create policy "Authenticated users can update task activity" on public."task_activity"
  as permissive
  for update
  to public
  using (true)
  with check (true);
create policy "Enable insert for authenticated users" on public."task_activity"
  as permissive
  for insert
  to public
  with check (true);
create policy "Enable read access for all users" on public."task_activity"
  as permissive
  for select
  to public
  using (true);
create policy "task_tags_insert_management" on public."task_tags"
  as permissive
  for insert
  to authenticated
  with check ((COALESCE(is_super_admin(), false) OR COALESCE(is_head(), false)));
create policy "task_tags_select_authenticated" on public."task_tags"
  as permissive
  for select
  to authenticated
  using (true);
create policy "task_tags_update_management" on public."task_tags"
  as permissive
  for update
  to authenticated
  using ((COALESCE(is_super_admin(), false) OR COALESCE(is_head(), false)))
  with check ((COALESCE(is_super_admin(), false) OR COALESCE(is_head(), false)));
create policy "Allow public read of tasks" on public."tasks"
  as permissive
  for select
  to authenticated
  using (((opportunity_id IS NULL) OR is_super_admin() OR (logged_by = get_employee_id()) OR (reported_to = get_employee_id()) OR is_hr() OR ((stage_visit_id IS NOT NULL) AND (stage_visit_id IN ( SELECT sor_visible_visit_ids(tasks.opportunity_id) AS sor_visible_visit_ids))) OR ((stage_visit_id IS NULL) AND (sor_access_level(opportunity_id) = ANY (ARRAY['full'::text, 'participant'::text])))));
create policy "Users and Managers can insert tasks" on public."tasks"
  as permissive
  for insert
  to public
  with check (((logged_by = get_employee_id()) OR is_head() OR is_hr() OR is_super_admin()));
create policy "Users and Managers can update tasks" on public."tasks"
  as permissive
  for update
  to public
  using (((logged_by = get_employee_id()) OR is_head() OR is_hr() OR is_super_admin()));
create policy "transmittal_cleared_signatures_read" on public."transmittal_cleared_signatures"
  as permissive
  for select
  to authenticated
  using (transmittal_can_read(transmittal_id));
create policy "transmittal_ipas_read" on public."transmittal_ipas"
  as permissive
  for select
  to authenticated
  using (transmittal_can_read(transmittal_id));
create policy "transmittal_lines_read" on public."transmittal_lines"
  as permissive
  for select
  to authenticated
  using (transmittal_can_read(transmittal_id));
create policy "transmittal_products_read" on public."transmittal_products"
  as permissive
  for select
  to authenticated
  using (transmittal_can_read(transmittal_id));
create policy "transmittal_references_read" on public."transmittal_references"
  as permissive
  for select
  to authenticated
  using (transmittal_can_read(transmittal_id));
create policy "transmittal_sors_read" on public."transmittal_sors"
  as permissive
  for select
  to authenticated
  using (transmittal_can_read(transmittal_id));
create policy "transmittal_stages_read" on public."transmittal_stages"
  as permissive
  for select
  to authenticated
  using (transmittal_can_read(transmittal_id));
create policy "transmittals_read" on public."transmittals"
  as permissive
  for select
  to authenticated
  using (transmittal_can_read(id));
create policy "undertime_requests_head_select" on public."undertime_requests"
  as permissive
  for select
  to authenticated
  using ((head_id = get_employee_id()));
create policy "undertime_requests_head_update" on public."undertime_requests"
  as permissive
  for update
  to authenticated
  using ((head_id = get_employee_id()));
create policy "undertime_requests_insert" on public."undertime_requests"
  as permissive
  for insert
  to authenticated
  with check (((employee_id = get_employee_id()) OR (EXISTS ( SELECT 1
   FROM employees e
  WHERE ((e.id = get_employee_id()) AND (e.is_hr OR e.is_super_admin OR e.can_manage_leaves))))));
create policy "undertime_requests_select" on public."undertime_requests"
  as permissive
  for select
  to authenticated
  using (((employee_id = get_employee_id()) OR (EXISTS ( SELECT 1
   FROM employees e
  WHERE ((e.id = get_employee_id()) AND (e.is_hr OR e.is_super_admin OR e.can_manage_leaves))))));
create policy "undertime_requests_update" on public."undertime_requests"
  as permissive
  for update
  to authenticated
  using (((employee_id = get_employee_id()) OR (EXISTS ( SELECT 1
   FROM employees e
  WHERE ((e.id = get_employee_id()) AND (e.is_hr OR e.is_super_admin OR e.can_manage_leaves))))));

-- ============================================================
-- Functions
-- ============================================================

CREATE OR REPLACE FUNCTION public._costing_action_open_args(p_opp sales_opportunities, p_config jsonb, p_visit uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_config jsonb := coalesce(p_config, '{}'::jsonb);
  v_sel jsonb;
  v_sales uuid;
  v_buyer uuid;
  v_until text;
  v_until_stage uuid;
  v_members jsonb;
  v_assigners jsonb;
begin
  -- Sales Incharge: the configured role or person; the Deal Owner role by default.
  v_sel := coalesce(v_config->'salesIncharge', jsonb_build_object('type', 'role', 'role', 'deal_owner'));
  v_sales := case v_sel->>'type'
    when 'employee' then nullif(v_sel->>'id', '')::uuid
    when 'role' then case v_sel->>'role'
      when 'deal_owner' then p_opp.deal_owner_id
      when 'closing_sales' then p_opp.closing_sales_id
      when 'support_sales' then coalesce(p_opp.support_sales_1_id, p_opp.support_sales_2_id)
      when 'sales_director' then p_opp.sales_director_id
      when 'registrar' then p_opp.registered_by
    end
  end;
  select e.id into v_sales from public.employees e where e.id = v_sales and not coalesce(e.is_deleted, false);

  if v_config->'purchasingIncharge'->>'type' = 'employee' then
    select e.id into v_buyer from public.employees e
     where e.id = nullif(v_config->'purchasingIncharge'->>'id', '')::uuid and not coalesce(e.is_deleted, false);
  end if;

  v_until := coalesce(nullif(v_config->'access'->>'until', ''), 'stage_left');
  if v_until in ('stage_entered', 'later_stage_left') then
    v_until_stage := nullif(v_config->'access'->>'stageId', '')::uuid;
  end if;

  select coalesce(jsonb_agg(e.id), '[]'::jsonb) into v_members
  from public.employees e
  where not coalesce(e.is_deleted, false)
    and exists (
      select 1 from jsonb_array_elements(
        case when jsonb_typeof(v_config->'extras') = 'array' then v_config->'extras' else '[]'::jsonb end
      ) s
      where public.sor_selector_covers(s, p_opp, e.id)
    );

  select coalesce(jsonb_agg(e.id), '[]'::jsonb) into v_assigners
  from public.employees e
  where not coalesce(e.is_deleted, false)
    and exists (
      select 1 from jsonb_array_elements(
        case when jsonb_typeof(v_config->'assigners') = 'array' then v_config->'assigners' else '[]'::jsonb end
      ) s
      where public.sor_selector_covers(s, p_opp, e.id)
    );

  return jsonb_build_object(
    'sales_incharge_id', v_sales,
    'purchasing_incharge_id', v_buyer,
    'default_preset_id', nullif(v_config->>'markupPresetId', ''),
    'member_ids', v_members,
    'opened_visit_id', p_visit,
    'access_until', v_until,
    'access_until_stage_id', v_until_stage,
    'assigner_ids', v_assigners
  );
end;
$function$
;
CREATE OR REPLACE FUNCTION public._costing_backfill_hits()
 RETURNS TABLE(opportunity_id uuid, flow_id uuid, action_id uuid, action_config jsonb, mounting_stage_id uuid, seq bigint, has_edges boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with recursive sor as (
    select o.id, o.flow_stage_id, fs.flow_id, fs.snapshot_data,
           coalesce(jsonb_typeof(fs.snapshot_data->'edges') = 'array', false) as has_edges
      from public.sales_opportunities o
      join public.flow_snapshots fs on fs.id = o.flow_snapshot_id
     where not coalesce(o.is_deleted, false)
       and o.flow_stage_id is not null
  ),
  acts as (
    select s.id as opp, s.flow_id, a.value as act, a.ord as ord,
           nullif(coalesce(a.value->>'stage_id', a.key), '')::uuid as stage_id
      from sor s,
      lateral (
        select e.value, e.ordinality as ord, null::text as key
          from jsonb_array_elements(
            case when jsonb_typeof(s.snapshot_data->'actions') = 'array' then s.snapshot_data->'actions' else '[]'::jsonb end
          ) with ordinality e(value, ordinality)
        union all
        select e.value, e.ordinality, g.key
          from jsonb_each(
            case when jsonb_typeof(s.snapshot_data->'actions') = 'object' then s.snapshot_data->'actions' else '{}'::jsonb end
          ) g,
          jsonb_array_elements(g.value) with ordinality e(value, ordinality)
      ) a
     where a.value->>'kind' = 'open_costing_matrix'
       and coalesce(a.value->>'archived_at', '') = ''
  ),
  edges as (
    select s.id as opp, (e.value->>'from_stage_id')::uuid as f, (e.value->>'to_stage_id')::uuid as t
      from sor s,
      lateral jsonb_array_elements(
        case when jsonb_typeof(s.snapshot_data->'edges') = 'array' then s.snapshot_data->'edges' else '[]'::jsonb end
      ) e
  ),
  reach(opp, mount, stage) as (
    select distinct a.opp, a.stage_id, a.stage_id from acts a where a.stage_id is not null
    union
    select r.opp, r.mount, e.t
      from reach r
      join edges e on e.opp = r.opp and e.f = r.stage
  )
  select a.opp, a.flow_id, (a.act->>'id')::uuid, coalesce(a.act->'config', '{}'::jsonb), a.stage_id,
         row_number() over (partition by a.opp order by a.stage_id, a.ord),
         s.has_edges
    from acts a
    join sor s on s.id = a.opp
    left join reach r on r.opp = a.opp and r.mount = a.stage_id and r.stage = s.flow_stage_id
   where a.stage_id is not null
     and (r.opp is not null or not s.has_edges);
$function$
;
CREATE OR REPLACE FUNCTION public._costing_component_labels(p_component_ids uuid[])
 RETURNS TABLE(component_id uuid, label text, name text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with lines as (
    select l.id, row_number() over (partition by l.matrix_id order by l.position, l.created_at) as n
    from public.costing_tender_lines l
    where l.matrix_id in (
      select tl.matrix_id
      from public.costing_tender_lines tl
      join public.costing_components c on c.tender_line_id = tl.id
      where c.id = any (p_component_ids)
    )
  ),
  components as (
    select c.id, c.name, lines.n,
      row_number() over (partition by c.tender_line_id order by c.position, c.created_at) as k
    from public.costing_components c
    join lines on lines.id = c.tender_line_id
  )
  select components.id, components.n || '.' || components.k, btrim(components.name)
  from components
  where components.id = any (p_component_ids)
$function$
;
CREATE OR REPLACE FUNCTION public._costing_component_link(p_component_id uuid, p_po_rfq_no text)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select case
    when exists (select 1 from public.purchase_request_items pri where pri.component_id = p_component_id)
      then 'a Requested Item'
    when nullif(btrim(p_po_rfq_no), '') is not null
      then 'P.O./RFQ No. ' || btrim(p_po_rfq_no)
  end
$function$
;
CREATE OR REPLACE FUNCTION public._employee_has_purchasing_access(p_employee_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1 from employees e
    where e.id = p_employee_id
      and e.has_purchasing_flow
      and not coalesce(e.is_deleted, false)
  );
$function$
;
CREATE OR REPLACE FUNCTION public._ipas_account_key(p_account text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select regexp_replace(coalesce(p_account, ''), '[[:space:]-]', '', 'g');
$function$
;
CREATE OR REPLACE FUNCTION public._ipas_can_sign_section(p_section integer, p_employee_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select case
    when p_section = 1 then public._ipas_on_list('s1_approved', p_employee_id)
    when p_section = 3 then public._ipas_on_list('s3_approved', p_employee_id)
    when p_section = 6 then public._ipas_on_list('s6_approved', p_employee_id)
    when p_section = 7 then
      public._ipas_on_list('s7_received', p_employee_id)
      or public._ipas_on_list('s7_noted', p_employee_id)
      or public._ipas_on_list('s7_checked', p_employee_id)
      or public._ipas_on_list('s7_approved', p_employee_id)
    else false
  end;
$function$
;
CREATE OR REPLACE FUNCTION public._ipas_change_note(p_old jsonb, p_new jsonb, p_previous_fetched_at timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
AS $function$
declare
  v_old jsonb;
  v_new jsonb;
  v_added jsonb;
  v_removed jsonb;
  v_changed jsonb;
  v_total_from numeric := public._ipas_copy_total(p_old);
  v_total_to numeric := public._ipas_copy_total(p_new);
begin
  select coalesce(jsonb_object_agg(public._ipas_line_key(l), l), '{}'::jsonb) into v_old
    from jsonb_array_elements(
      case when jsonb_typeof(p_old->'lines') = 'array' then p_old->'lines' else '[]'::jsonb end
    ) l;
  select coalesce(jsonb_object_agg(public._ipas_line_key(l), l), '{}'::jsonb) into v_new
    from jsonb_array_elements(
      case when jsonb_typeof(p_new->'lines') = 'array' then p_new->'lines' else '[]'::jsonb end
    ) l;

  select coalesce(jsonb_agg(jsonb_build_object(
           'line_id', n.value->'line_id', 'name', n.value->'name',
           'quantity', n.value->'quantity', 'price_unit', n.value->'price_unit'
         ) order by n.key), '[]'::jsonb)
    into v_added
    from jsonb_each(v_new) n
   where not jsonb_exists(v_old, n.key);

  select coalesce(jsonb_agg(jsonb_build_object(
           'line_id', o.value->'line_id', 'name', o.value->'name',
           'quantity', o.value->'quantity', 'price_unit', o.value->'price_unit'
         ) order by o.key), '[]'::jsonb)
    into v_removed
    from jsonb_each(v_old) o
   where not jsonb_exists(v_new, o.key);

  select coalesce(jsonb_agg(jsonb_build_object(
           'line_id', n.value->'line_id', 'name', n.value->'name',
           'quantity_from', o.value->'quantity', 'quantity_to', n.value->'quantity',
           'price_unit_from', o.value->'price_unit', 'price_unit_to', n.value->'price_unit'
         ) order by n.key), '[]'::jsonb)
    into v_changed
    from jsonb_each(v_new) n
    join jsonb_each(v_old) o on o.key = n.key
   where (o.value->'quantity') is distinct from (n.value->'quantity')
      or (o.value->'price_unit') is distinct from (n.value->'price_unit');

  if jsonb_array_length(v_added) = 0
     and jsonb_array_length(v_removed) = 0
     and jsonb_array_length(v_changed) = 0
     and v_total_from = v_total_to then
    return null;
  end if;

  return jsonb_build_object(
    'previous_fetched_at', p_previous_fetched_at,
    'added', v_added,
    'removed', v_removed,
    'changed', v_changed,
    'total_from', v_total_from,
    'total_to', v_total_to
  );
end;
$function$
;
CREATE OR REPLACE FUNCTION public._ipas_check_option(p_fn text, p_option_id uuid, p_list text, p_current uuid, p_what text)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_option public.ipas_options;
begin
  select * into v_option from public.ipas_options where id = p_option_id;
  if v_option.id is null or v_option.list <> p_list then
    raise exception '%: pick a %', p_fn, p_what using errcode = '22023';
  end if;
  if not v_option.active and p_option_id is distinct from p_current then
    raise exception '%: % is deactivated; pick another %', p_fn, v_option.label, p_what using errcode = '22023';
  end if;
  return v_option.label;
end;
$function$
;
CREATE OR REPLACE FUNCTION public._ipas_clean_payment(p_fn text, p_ipas ipas, p_kind text, p_paid_on date, p_amount numeric, p_php_debited numeric, p_charge_fee_php numeric, p_method_id uuid, p_current_method uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_amount numeric := round(p_amount, 2);
  v_php numeric := round(p_php_debited, 2);
  v_fee numeric := round(coalesce(p_charge_fee_php, 0), 2);
  v_label text;
begin
  if p_kind is null or p_kind not in ('down_payment', 'payment', 'full_payment', 'shipping_fee') then
    raise exception '%: % isn''t a payment kind', p_fn, coalesce(p_kind, 'null') using errcode = '22023';
  end if;
  if p_paid_on is null then
    raise exception '%: give the date of the payment', p_fn using errcode = '22023';
  end if;
  if v_amount is null or v_amount <= 0 then
    raise exception '%: the amount must be more than zero', p_fn using errcode = '22023';
  end if;
  if v_fee < 0 then
    raise exception '%: the charge fee can''t be negative', p_fn using errcode = '22023';
  end if;

  if public._ipas_is_php(p_ipas.odoo_copy) then
    -- A PHP payment's PHP is its amount: no second figure to disagree with it.
    v_php := null;
  else
    -- #604: the pesos taken from the bank may be left blank (Landed Cost is then an estimate);
    -- a figure that is given has to make sense.
    if v_php is not null and v_php <= 0 then
      raise exception '%: the pesos taken from the bank must be more than zero, or left blank until the bank statement arrives', p_fn
        using errcode = '22023';
    end if;
  end if;

  v_label := public._ipas_check_option(p_fn, p_method_id, 'payment_method', p_current_method, 'payment method');

  return jsonb_build_object(
    'amount', v_amount,
    'php_debited', v_php,
    'charge_fee_php', v_fee,
    'method_label', v_label
  );
end;
$function$
;
CREATE OR REPLACE FUNCTION public._ipas_clean_sor_ids(p_fn text, p_purpose text, p_sor_ids uuid[])
 RETURNS uuid[]
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_ids uuid[];
  v_found integer;
begin
  if p_sor_ids is not null and array_position(p_sor_ids, null) is not null then
    raise exception '%: an SOR id is missing', p_fn using errcode = '22023';
  end if;
  select coalesce(array_agg(distinct s), '{}'::uuid[]) into v_ids from unnest(coalesce(p_sor_ids, '{}'::uuid[])) s;

  if p_purpose = 'project' and cardinality(v_ids) = 0 then
    raise exception '%: a Project IPAS needs at least one SOR', p_fn using errcode = '22023';
  end if;
  if p_purpose <> 'project' and cardinality(v_ids) > 0 then
    raise exception '%: an Inventory, Supplies or Events IPAS can''t name an SOR; put the note in Remarks', p_fn
      using errcode = '22023';
  end if;

  if cardinality(v_ids) > 0 then
    select count(*) into v_found
      from public.sales_opportunities o
     where o.id = any (v_ids) and not coalesce(o.is_deleted, false);
    if v_found <> cardinality(v_ids) then
      raise exception '%: one of those SORs no longer exists', p_fn using errcode = '22023';
    end if;
  end if;
  return v_ids;
end;
$function$
;
CREATE OR REPLACE FUNCTION public._ipas_clear_approvals(p_ipas_id uuid, p_actor uuid, p_reason text, OUT sections integer[], OUT preparer_ids uuid[])
 RETURNS record
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  with cleared as (
    update public.ipas_signoffs s
       set cleared_at = now(), cleared_by = p_actor, cleared_reason = p_reason
     where s.ipas_id = p_ipas_id
       and s.section in (1, 3)
       and s.role = 'approved'
       and s.cleared_at is null
    returning s.section
  )
  select coalesce(array_agg(distinct section::integer), '{}'::integer[]) into sections from cleared;

  preparer_ids := '{}'::uuid[];
  if cardinality(sections) > 0 then
    select coalesce(array_agg(distinct s.signed_by), '{}'::uuid[])
      into preparer_ids
      from public.ipas_signoffs s
     where s.ipas_id = p_ipas_id
       and s.section = any (sections)
       and s.role = 'prepared'
       and s.cleared_at is null;

    perform public._ipas_write_event(p_ipas_id, p_actor, 'approvals_cleared', jsonb_build_object(
      'reason', p_reason,
      'sections', to_jsonb(sections)
    ));
  end if;
end;
$function$
;
CREATE OR REPLACE FUNCTION public._ipas_clear_section_3_for_lc(p_ipas_id uuid, p_reason text, p_force boolean DEFAULT false)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_ipas public.ipas;
  v_actor uuid := public.get_employee_id();
  v_fingerprint text;
  v_notify uuid[];
begin
  select * into v_ipas from public.ipas where id = p_ipas_id;
  if not found or v_ipas.state <> 'open' then
    return;
  end if;
  if not exists (
    select 1 from public.ipas_signoffs s
     where s.ipas_id = p_ipas_id and s.section = 6 and s.role in ('prepared', 'approved') and s.cleared_at is null
  ) then
    return;
  end if;

  if not p_force then
    v_fingerprint := public._ipas_lc_fingerprint(p_ipas_id);
    if not exists (
      select 1 from public.ipas_signoffs s
       where s.ipas_id = p_ipas_id and s.section = 6 and s.role in ('prepared', 'approved') and s.cleared_at is null
         and s.lc_fingerprint is distinct from v_fingerprint
    ) then
      return;
    end if;
  end if;

  with cleared as (
    update public.ipas_signoffs s
       set cleared_at = now(), cleared_by = v_actor, cleared_reason = p_reason
     where s.ipas_id = p_ipas_id
       and s.section = 6
       and s.role in ('prepared', 'approved')
       and s.cleared_at is null
    returning s.signed_by
  )
  select coalesce(array_agg(distinct signed_by) filter (where signed_by is distinct from v_actor), '{}'::uuid[])
    into v_notify
    from cleared;

  perform public._ipas_write_event(p_ipas_id, v_actor, 'approvals_cleared', jsonb_build_object(
    'reason', p_reason,
    'sections', jsonb_build_array(6)
  ));

  insert into public.notifications (recipient_id, sender_id, type, title, message, reference_id)
  select n, v_actor, 'IPAS_SECTION_3_CLEARED',
         'IPAS section ' || public._ipas_section_no(6) || ' cleared',
         format('Section %s of IPAS %s was cleared (%s). It needs to be submitted and approved again.',
                public._ipas_section_no(6), v_ipas.number, p_reason),
         p_ipas_id::text
    from unnest(v_notify) as n;
end;
$function$
;
CREATE OR REPLACE FUNCTION public._ipas_clear_section_approvals(p_ipas_id uuid, p_actor uuid, p_reason text, p_sections integer[], OUT sections integer[], OUT preparer_ids uuid[])
 RETURNS record
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  with cleared as (
    update public.ipas_signoffs s
       set cleared_at = now(), cleared_by = p_actor, cleared_reason = p_reason
     where s.ipas_id = p_ipas_id
       and s.section = any (p_sections)
       and s.role = 'approved'
       and s.cleared_at is null
    returning s.section
  )
  select coalesce(array_agg(distinct section::integer), '{}'::integer[]) into sections from cleared;

  preparer_ids := '{}'::uuid[];
  if cardinality(sections) > 0 then
    select coalesce(array_agg(distinct s.signed_by), '{}'::uuid[])
      into preparer_ids
      from public.ipas_signoffs s
     where s.ipas_id = p_ipas_id
       and s.section = any (sections)
       and s.role = 'prepared'
       and s.cleared_at is null;

    perform public._ipas_write_event(p_ipas_id, p_actor, 'approvals_cleared', jsonb_build_object(
      'reason', p_reason,
      'sections', to_jsonb(sections)
    ));
  end if;
end;
$function$
;
CREATE OR REPLACE FUNCTION public._ipas_convert_checked_by()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  r record;
  v_sub_by uuid;
  v_sub_at timestamptz;
  v_app_by uuid;
  v_app_at timestamptz;
  v_signoff public.ipas_signoffs;
  v_moved integer;
begin
  for r in
    select i.id from public.ipas i
     where i.computation_status = 'checked' and i.state <> 'cancelled'
  loop
    select ev.actor_id, ev.created_at into v_sub_by, v_sub_at
      from public.ipas_events ev
     where ev.ipas_id = r.id and ev.kind = 'header_changed'
       and ev.detail #>> '{fields,computation_status,to}' in ('lc_odoo_done', 'costs_complete')
     order by ev.created_at desc, ev.id desc
     limit 1;

    select ev.actor_id, ev.created_at into v_app_by, v_app_at
      from public.ipas_events ev
     where ev.ipas_id = r.id and ev.kind = 'header_changed'
       and ev.detail #>> '{fields,computation_status,to}' = 'checked'
     order by ev.created_at desc, ev.id desc
     limit 1;

    if v_sub_by is not null and v_app_by is not null
       and not exists (
         select 1 from public.ipas_signoffs s
          where s.ipas_id = r.id and s.section = 6 and s.cleared_at is null
       ) then
      insert into public.ipas_signoffs (ipas_id, section, role, signed_by, signed_at, signature_declined, signature_version)
      select r.id, 6, 'prepared', v_sub_by, v_sub_at, false, e.signature_path
        from public.employees e where e.id = v_sub_by
      returning * into v_signoff;
      insert into public.ipas_events (ipas_id, actor_id, kind, detail, created_at)
      values (r.id, v_sub_by, 'signed', jsonb_build_object(
        'section', 6, 'role', 'prepared', 'signoff_id', v_signoff.id,
        'signature_declined', false, 'migrated', true), v_sub_at);

      insert into public.ipas_signoffs (ipas_id, section, role, signed_by, signed_at, signature_declined, signature_version)
      select r.id, 6, 'approved', v_app_by, v_app_at, false, e.signature_path
        from public.employees e where e.id = v_app_by
      returning * into v_signoff;
      insert into public.ipas_events (ipas_id, actor_id, kind, detail, created_at)
      values (r.id, v_app_by, 'signed', jsonb_build_object(
        'section', 6, 'role', 'approved', 'signoff_id', v_signoff.id,
        'signature_declined', false, 'migrated', true), v_app_at);
    end if;
  end loop;

  perform set_config('ipas.reopening', 'on', true);
  update public.ipas set computation_status = 'lc_odoo_done' where computation_status = 'checked';
  get diagnostics v_moved = row_count;
  perform set_config('ipas.reopening', 'off', true);

  return v_moved;
end;
$function$
;
CREATE OR REPLACE FUNCTION public._ipas_copy_digest(p_copy jsonb)
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select jsonb_build_object(
    'lines', coalesce((
      select jsonb_agg(
        jsonb_build_array(public._ipas_line_key(l), l->'quantity', l->'price_unit', l->'price_subtotal')
        order by public._ipas_line_key(l)
      )
      from jsonb_array_elements(
        case when jsonb_typeof(p_copy->'lines') = 'array' then p_copy->'lines' else '[]'::jsonb end
      ) l
    ), '[]'::jsonb),
    'total', public._ipas_copy_total(p_copy),
    'company', p_copy->'po'->'company',
    'currency', p_copy->'po'->'currency',
    'origin', p_copy->'po'->'origin',
    'partner_ref', p_copy->'po'->'partner_ref',
    'supplier', p_copy->'supplier'->'id',
    'state', public._ipas_po_state_class(p_copy)
  );
$function$
;
CREATE OR REPLACE FUNCTION public._ipas_copy_total(p_copy jsonb)
 RETURNS numeric
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select coalesce(sum(
    case when jsonb_typeof(l->'price_subtotal') = 'number' then (l->>'price_subtotal')::numeric else 0 end
  ), 0)
  from jsonb_array_elements(
    case when jsonb_typeof(p_copy->'lines') = 'array' then p_copy->'lines' else '[]'::jsonb end
  ) l;
$function$
;
CREATE OR REPLACE FUNCTION public._ipas_document_label(p_document ipas_documents)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce(
    p_document.label,
    (select o.label from public.ipas_options o where o.id = p_document.kind_id)
  );
$function$
;
CREATE OR REPLACE FUNCTION public._ipas_filing_open(p_ipas_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select (
    select count(distinct s.section)
      from public.ipas_signoffs s
     where s.ipas_id = p_ipas_id
       and s.section in (1, 3, 6)
       and s.role = 'approved'
       and s.cleared_at is null
  ) = 3;
$function$
;
CREATE OR REPLACE FUNCTION public._ipas_is_php(p_copy jsonb)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select upper(btrim(coalesce(p_copy->'po'->>'currency', ''))) = 'PHP';
$function$
;
CREATE OR REPLACE FUNCTION public._ipas_landed_cost(p_ipas_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_ipas      public.ipas;
  v_currency  text;
  v_php       boolean;
  v_split     text;
  v_used      text;
  v_final     boolean;
  v_php_paid  numeric;
  v_foreign   numeric;
  v_payments  integer;
  v_rate      numeric := 1;
  v_rate_json jsonb := null;
  v_charges   numeric;
  v_fees      numeric;
  v_shipping  numeric;
  v_pool      numeric;
  v_lines     jsonb;
  v_goods     numeric;
  v_base      jsonb;
  r           record;
  v_ref       numeric;
  v_ref_date  date;
  v_est_php   numeric;
  v_est_n     integer := 0;
  v_est_php_t numeric := 0;
  v_estimates jsonb := '[]'::jsonb;
  v_ship_c    numeric := 0;
begin
  select * into v_ipas from public.ipas where id = p_ipas_id;
  if not found then
    return null;
  end if;

  v_currency := v_ipas.odoo_copy #>> '{po,currency}';
  v_php := upper(btrim(coalesce(v_currency, ''))) = 'PHP';
  v_split := case when v_ipas.landed_cost_split in ('value', 'quantity', 'equal') then v_ipas.landed_cost_split else 'value' end;
  v_final := v_ipas.state = 'filed' or v_ipas.computation_status in ('lc_odoo_done', 'checked');

  v_base := jsonb_build_object(
    'currency', v_currency,
    'isForeign', not v_php,
    'rate', null,
    'split', v_split,
    'usedSplit', v_split,
    'estimate', false,
    'estimates', '[]'::jsonb,
    'lines', '[]'::jsonb,
    'totals', null
  );

  -- Only lines that are goods being bought: a quantity above zero.
  if not exists (
    select 1
    from jsonb_array_elements(case when jsonb_typeof(v_ipas.odoo_copy -> 'lines') = 'array' then v_ipas.odoo_copy -> 'lines' else '[]'::jsonb end) as e(l)
    where public._lc_num(e.l ->> 'quantity') > 0
  ) then
    return v_base || jsonb_build_object('status', 'unavailable', 'reason', 'no_lines');
  end if;

  -- A foreign PO converts at what was actually paid: combined pesos taken from the bank / combined
  -- amount. A payment whose "Pesos taken from the bank" is still blank (#604) is taken at the
  -- Reference Rate of its payment date instead, which makes the whole figure an estimate. That
  -- estimate is only ever worked out here, on the way out; nothing is written back.
  if not v_php then
    v_php_paid := 0;
    v_foreign := 0;
    v_payments := 0;
    for r in
      select p.id, p.kind, p.paid_on, p.amount, p.php_debited
      from public.ipas_payments p
      where p.ipas_id = p_ipas_id and p.amount > 0
      order by p.paid_on, p.id
    loop
      v_payments := v_payments + 1;
      v_foreign := v_foreign + r.amount;
      if r.php_debited > 0 then
        v_est_php := r.php_debited;
        v_php_paid := v_php_paid + r.php_debited;
      else
        v_ref := null;
        select rr.php_per_unit, rr.rate_date into v_ref, v_ref_date
        from public.reference_rate(v_currency, r.paid_on) rr;
        if v_ref is null then
          return v_base || jsonb_build_object('status', 'unavailable', 'reason', 'no_reference_rate');
        end if;
        v_est_php := round(r.amount * v_ref, 2);
        v_php_paid := v_php_paid + v_est_php;
        v_est_php_t := v_est_php_t + v_est_php;
        v_est_n := v_est_n + 1;
        v_estimates := v_estimates || jsonb_build_object(
          'paymentId', r.id, 'kind', r.kind, 'paidOn', r.paid_on, 'amount', r.amount,
          'referenceRate', v_ref, 'rateDate', v_ref_date, 'php', v_est_php);
      end if;
      if r.kind = 'shipping_fee' then
        v_ship_c := v_ship_c + round(v_est_php * 100);
      end if;
    end loop;
    if v_payments = 0 or v_foreign = 0 then
      return v_base || jsonb_build_object('status', 'unavailable', 'reason', 'no_payments');
    end if;
    v_rate := v_php_paid / v_foreign;
    v_rate_json := jsonb_build_object(
      'rate', v_rate, 'phpDebited', v_php_paid, 'foreignPaid', v_foreign, 'payments', v_payments,
      'estimatedPayments', v_est_n, 'estimatedPhp', v_est_php_t);
  end if;

  -- The pool, in centavos: every charge, every charge fee and every shipping fee.
  select coalesce(sum(round(coalesce(c.amount_php, 0) * 100)), 0) into v_charges
  from public.ipas_charges c where c.ipas_id = p_ipas_id;
  select
    coalesce(sum(round(coalesce(p.charge_fee_php, 0) * 100)), 0),
    coalesce(sum(case when p.kind = 'shipping_fee'
      then round(coalesce(case when v_php then p.amount else p.php_debited end, 0) * 100) else 0 end), 0)
    into v_fees, v_shipping
  from public.ipas_payments p where p.ipas_id = p_ipas_id;
  -- A foreign payment's shipping fee is its pesos, or its estimated pesos while those are blank.
  if not v_php then
    v_shipping := v_ship_c;
  end if;
  v_pool := v_charges + v_fees + v_shipping;

  with lines as (
    select e.ord, e.l as line,
      public._lc_num(e.l ->> 'quantity') as qty,
      coalesce(public._lc_num(e.l ->> 'price_unit'), 0) as price
    from jsonb_array_elements(case when jsonb_typeof(v_ipas.odoo_copy -> 'lines') = 'array' then v_ipas.odoo_copy -> 'lines' else '[]'::jsonb end)
      with ordinality as e(l, ord)
    where public._lc_num(e.l ->> 'quantity') > 0
  ),
  goods as (
    select lines.*, round(qty * price * v_rate * 100) as goods_c from lines
  ),
  -- By value needs value to spread over; with nothing priced it falls back to equal.
  used as (
    select case when v_split = 'value' and not (coalesce(sum(goods_c), 0) > 0) then 'equal' else v_split end as split,
           coalesce(sum(goods_c), 0) as goods_total
    from goods
  ),
  weighted as (
    select goods.*, case used.split when 'value' then goods_c when 'quantity' then qty else 1 end as w
    from goods, used
  ),
  exact as (
    select weighted.*, case when sum(w) over () > 0 then v_pool * w / sum(w) over () else 0 end as x from weighted
  ),
  -- Largest remainder: floors first, then one centavo each to the largest remainders.
  ranked as (
    select exact.*, floor(x) as fl,
      row_number() over (order by x - floor(x) desc, ord) as rn,
      v_pool - sum(floor(x)) over () as left_over
    from exact
  ),
  shared as (
    select ranked.*, fl + case when rn <= left_over then 1 else 0 end as share_c from ranked
  )
  select
    coalesce(jsonb_agg(jsonb_build_object(
      'lineId', coalesce(line -> 'line_id', 'null'::jsonb),
      'name', coalesce(line -> 'name', '""'::jsonb),
      'brand', coalesce(line -> 'brand', 'null'::jsonb),
      'unit', coalesce(line -> 'unit', 'null'::jsonb),
      'quantity', qty,
      'unitPriceForeign', price,
      'unitPricePhp', round(price * v_rate * 100) / 100,
      'goodsPhp', goods_c / 100,
      'spreadPhp', share_c / 100,
      'landedPhp', (goods_c + share_c) / 100,
      'landedPerUnitPhp', round((goods_c + share_c) / qty) / 100
    ) order by ord), '[]'::jsonb),
    coalesce(sum(goods_c), 0),
    (select used.split from used)
    into v_lines, v_goods, v_used
  from shared;

  return v_base || jsonb_build_object(
    'status', case when v_final and v_est_n = 0 then 'final' else 'provisional' end,
    'estimate', v_est_n > 0,
    'estimates', v_estimates,
    'reason', null,
    'rate', v_rate_json,
    'usedSplit', v_used,
    'lines', v_lines,
    'totals', jsonb_build_object(
      'goodsPhp', v_goods / 100,
      'chargesPhp', v_charges / 100,
      'chargeFeesPhp', v_fees / 100,
      'shippingFeesPhp', v_shipping / 100,
      'spreadPhp', v_pool / 100,
      'landedPhp', (v_goods + v_pool) / 100
    )
  );
end;
$function$
;
CREATE OR REPLACE FUNCTION public._ipas_lc_fingerprint(p_ipas_id uuid)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select md5(
    coalesce((
      select string_agg(
               concat_ws('|',
                 coalesce(e.l ->> 'lineId', ''),
                 round(coalesce((e.l ->> 'quantity')::numeric, 0), 4)::text,
                 round(coalesce((e.l ->> 'goodsPhp')::numeric, 0), 2)::text,
                 round(coalesce((e.l ->> 'spreadPhp')::numeric, 0), 2)::text,
                 round(coalesce((e.l ->> 'landedPhp')::numeric, 0), 2)::text),
               ';' order by e.ord)
        from jsonb_array_elements(coalesce(x.lc -> 'lines', '[]'::jsonb)) with ordinality as e(l, ord)
    ), '')
    || '#' ||
    case
      when jsonb_typeof(x.lc -> 'totals') = 'object' then
        concat_ws('|',
          round(coalesce((x.lc #>> '{totals,goodsPhp}')::numeric, 0), 2)::text,
          round(coalesce((x.lc #>> '{totals,spreadPhp}')::numeric, 0), 2)::text,
          round(coalesce((x.lc #>> '{totals,landedPhp}')::numeric, 0), 2)::text)
      else 'none'
    end
  )
  from (select public._ipas_landed_cost(p_ipas_id) as lc) x;
$function$
;
CREATE OR REPLACE FUNCTION public._ipas_line_key(p_line jsonb)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select coalesce(
    nullif(p_line->>'line_id', ''),
    'p' || coalesce(p_line->>'product_id', '') || ':' || coalesce(p_line->>'name', '')
  );
$function$
;
CREATE OR REPLACE FUNCTION public._ipas_list_members(p_list_keys text[], p_exclude uuid)
 RETURNS uuid[]
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce(array_agg(x.employee_id order by x.first_added), '{}'::uuid[])
    from (
      select l.employee_id, min(l.created_at) as first_added
        from public.ipas_signer_lists l
        join public.employees e on e.id = l.employee_id
       where l.list_key = any (p_list_keys)
         and not coalesce(e.is_deleted, false)
         and l.employee_id is distinct from p_exclude
       group by l.employee_id
    ) x;
$function$
;
CREATE OR REPLACE FUNCTION public._ipas_lock_document(p_fn text, p_document_id uuid)
 RETURNS ipas_documents
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_row public.ipas_documents;
begin
  select * into v_row from public.ipas_documents where id = p_document_id;
  if v_row.id is null then
    raise exception '%: document % not found', p_fn, p_document_id using errcode = '22023';
  end if;
  perform public._ipas_lock_open(p_fn, v_row.ipas_id);
  select * into v_row from public.ipas_documents where id = p_document_id for update;
  if v_row.id is null then
    raise exception '%: document % not found', p_fn, p_document_id using errcode = '22023';
  end if;
  return v_row;
end;
$function$
;
CREATE OR REPLACE FUNCTION public._ipas_lock_open(p_fn text, p_ipas_id uuid)
 RETURNS ipas
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_row public.ipas;
begin
  select * into v_row from public.ipas where id = p_ipas_id for update;
  if v_row.id is null then
    raise exception '%: IPAS % not found', p_fn, p_ipas_id using errcode = '22023';
  end if;
  if v_row.state = 'filed' then
    raise exception '%: % is filed; a Super Admin reopens it first', p_fn, v_row.number using errcode = '22023';
  end if;
  if v_row.state = 'cancelled' then
    raise exception '%: % is cancelled', p_fn, v_row.number using errcode = '22023';
  end if;
  return v_row;
end;
$function$
;
CREATE OR REPLACE FUNCTION public._ipas_money_writer(p_fn text)
 RETURNS uuid
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_actor uuid := public.get_employee_id();
begin
  if v_actor is null then
    raise exception '%: not signed in', p_fn using errcode = '42501';
  end if;
  if not (public.has_purchasing_access() or public.has_finance_access()) then
    raise exception '%: only Purchasing or Finance records payments and charges', p_fn using errcode = '42501';
  end if;
  return v_actor;
end;
$function$
;
CREATE OR REPLACE FUNCTION public._ipas_odoo_analytic(p_copy jsonb)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select string_agg(x.name, ' · ' order by x.ord)
  from (
    select a.name, min(l.i * 1000 + a.o) as ord
    from jsonb_array_elements(
           case when jsonb_typeof(p_copy->'lines') = 'array' then p_copy->'lines' else '[]'::jsonb end
         ) with ordinality l(line, i)
    cross join lateral jsonb_array_elements_text(
           case when jsonb_typeof(l.line->'analytic') = 'array' then l.line->'analytic' else '[]'::jsonb end
         ) with ordinality a(name, o)
    where nullif(btrim(a.name), '') is not null
    group by a.name
  ) x;
$function$
;
CREATE OR REPLACE FUNCTION public._ipas_odoo_value(p_copy jsonb, p_field text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select case p_field
    when 'entity' then nullif(btrim(p_copy->'po'->>'company'), '')
    when 'source_doc' then nullif(btrim(p_copy->'po'->>'origin'), '')
    when 'analytic' then public._ipas_odoo_analytic(p_copy)
  end;
$function$
;
CREATE OR REPLACE FUNCTION public._ipas_on_list(p_list_key text, p_employee_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1
      from ipas_signer_lists l
      join employees e on e.id = l.employee_id
     where l.list_key = p_list_key
       and l.employee_id = p_employee_id
       and not coalesce(e.is_deleted, false)
  );
$function$
;
CREATE OR REPLACE FUNCTION public._ipas_payments_missing_pesos(p_ipas_id uuid)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select string_agg(
           upper(left(replace(p.kind, '_', ' '), 1)) || substr(replace(p.kind, '_', ' '), 2)
             || ' of ' || upper(btrim(i.odoo_copy #>> '{po,currency}')) || ' ' || to_char(p.amount, 'FM999,999,999,990.00')
             || ' on ' || to_char(p.paid_on, 'FMMon FMDD, YYYY'),
           '; ' order by p.paid_on, p.id)
  from public.ipas i
  join public.ipas_payments p on p.ipas_id = i.id
  where i.id = p_ipas_id
    and not public._ipas_is_php(i.odoo_copy)
    and p.php_debited is null
$function$
;
CREATE OR REPLACE FUNCTION public._ipas_po_line_ids(p_po_number text)
 RETURNS integer[]
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce((
    select array_agg(distinct (l.line->>'line_id')::int order by (l.line->>'line_id')::int)
    from public.ipas i
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(i.odoo_copy->'lines') = 'array' then i.odoo_copy->'lines' else '[]'::jsonb end
    ) as l(line)
    where i.po_number = upper(btrim(p_po_number))
      and i.state <> 'cancelled'
      and (l.line->>'line_id') ~ '^[0-9]+$'
  ), '{}'::int[]);
$function$
;
CREATE OR REPLACE FUNCTION public._ipas_po_state_class(p_copy jsonb)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select case p_copy->'po'->>'state'
    when 'cancel' then 'cancel'
    when 'purchase' then 'ordered'
    when 'done' then 'ordered'
    else 'rfq'
  end;
$function$
;
CREATE OR REPLACE FUNCTION public._ipas_purchasing_writer(p_fn text)
 RETURNS uuid
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_actor uuid := public.get_employee_id();
begin
  if v_actor is null then
    raise exception '%: not signed in', p_fn using errcode = '42501';
  end if;
  if not public.has_purchasing_access() then
    raise exception '%: only Purchasing changes an IPAS', p_fn using errcode = '42501';
  end if;
  return v_actor;
end;
$function$
;
CREATE OR REPLACE FUNCTION public._ipas_read_date(p_fn text, p_fields jsonb, p_key text, p_label text, p_current date)
 RETURNS date
 LANGUAGE plpgsql
 IMMUTABLE
AS $function$
declare
  v_raw jsonb;
  v_text text;
begin
  if not jsonb_exists(p_fields, p_key) then
    return p_current;
  end if;
  v_raw := p_fields->p_key;
  if jsonb_typeof(v_raw) = 'null' then
    return null;
  end if;
  if jsonb_typeof(v_raw) <> 'string' then
    raise exception '%: % must be a date', p_fn, p_label using errcode = '22023';
  end if;
  v_text := btrim(p_fields->>p_key);
  if v_text = '' then
    return null;
  end if;
  if v_text !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
    raise exception '%: % must be a date', p_fn, p_label using errcode = '22023';
  end if;
  begin
    return v_text::date;
  exception when others then
    raise exception '%: % must be a real date', p_fn, p_label using errcode = '22023';
  end;
end;
$function$
;
CREATE OR REPLACE FUNCTION public._ipas_section_no(p_section integer)
 RETURNS integer
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  select case p_section when 3 then 2 when 6 then 3 when 7 then 4 else p_section end;
$function$
;
CREATE OR REPLACE FUNCTION public._ipas_seed_s6_approved()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_added integer;
begin
  insert into public.ipas_signer_lists (list_key, employee_id)
  select 's6_approved', e.id
    from public.employees e
   where e.has_finance_flow
     and not coalesce(e.is_deleted, false)
     and not exists (
       select 1 from public.ipas_signer_lists l where l.list_key = 's6_approved' and l.employee_id = e.id
     );
  get diagnostics v_added = row_count;
  return v_added;
end;
$function$
;
CREATE OR REPLACE FUNCTION public._ipas_signoff_list_key(p_section integer, p_role text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select case
    when p_section = 1 and p_role = 'approved' then 's1_approved'
    when p_section = 3 and p_role = 'approved' then 's3_approved'
    when p_section = 6 and p_role = 'approved' then 's6_approved'
    when p_section = 7 and p_role = 'received' then 's7_received'
    when p_section = 7 and p_role = 'noted' then 's7_noted'
    when p_section = 7 and p_role = 'checked' then 's7_checked'
    when p_section = 7 and p_role = 'approved' then 's7_approved'
    else null
  end;
$function$
;
CREATE OR REPLACE FUNCTION public._ipas_signoff_pair_ok(p_section integer, p_role text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select (p_section in (1, 3, 6) and p_role in ('prepared', 'approved'))
      or (p_section = 7 and p_role in ('received', 'noted', 'checked', 'approved'));
$function$
;
CREATE OR REPLACE FUNCTION public._ipas_suggest_documents(p_ipas_id uuid, p_actor uuid)
 RETURNS text[]
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_source text;
  v_labels text[];
begin
  select source into v_source from public.ipas where id = p_ipas_id;
  if v_source is null then
    return '{}';
  end if;

  with added as (
    insert into public.ipas_documents (ipas_id, kind_id, created_by)
    select p_ipas_id, o.id, p_actor
      from public.ipas_options o
     where o.list = 'document_kind'
       and o.active
       and o.applies_to in (v_source, 'both')
       and not exists (
         select 1 from public.ipas_documents d where d.ipas_id = p_ipas_id and d.kind_id = o.id
       )
    returning kind_id
  )
  select coalesce(array_agg(o.label order by o.sort, o.label), '{}')
    into v_labels
    from added a
    join public.ipas_options o on o.id = a.kind_id;

  return v_labels;
end;
$function$
;
CREATE OR REPLACE FUNCTION public._ipas_write_event(p_ipas_id uuid, p_actor uuid, p_kind text, p_detail jsonb DEFAULT '{}'::jsonb)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  insert into public.ipas_events (ipas_id, actor_id, kind, detail)
  values (p_ipas_id, p_actor, p_kind, coalesce(p_detail, '{}'::jsonb));
$function$
;
CREATE OR REPLACE FUNCTION public._lc_ipas_for_po(p_po_number text)
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select i.id from public.ipas i
  where i.po_number = btrim(p_po_number) and i.state <> 'cancelled'
  order by i.created_at desc
  limit 1
$function$
;
CREATE OR REPLACE FUNCTION public._lc_num(p_text text)
 RETURNS numeric
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  select case when btrim(coalesce(p_text, '')) ~ '^-?[0-9]+(\.[0-9]+)?$' then btrim(p_text)::numeric end
$function$
;
CREATE OR REPLACE FUNCTION public._packing_list_editable(p_packing_list_id uuid)
 RETURNS packing_lists
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_actor uuid := public.get_employee_id();
  v_row public.packing_lists;
begin
  if v_actor is null then
    raise exception 'packing list: not signed in' using errcode = '42501';
  end if;
  select * into v_row from public.packing_lists where id = p_packing_list_id for update;
  if not found then
    raise exception 'packing list: no such Packing List' using errcode = 'P0002';
  end if;
  if not (public.packing_list_can_create() or v_row.created_by = v_actor) then
    raise exception 'packing list: only its creator, Purchasing or the Warehouse list changes a Packing List' using errcode = '42501';
  end if;
  if v_row.state <> 'draft' then
    raise exception 'packing list: % is packed and can''t be changed', v_row.number using errcode = '42501';
  end if;
  return v_row;
end;
$function$
;
CREATE OR REPLACE FUNCTION public._packing_list_event(p_packing_list_id uuid, p_actor uuid, p_kind text, p_detail jsonb DEFAULT '{}'::jsonb)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  insert into public.pms_handoff_events (record_type, record_id, actor_id, kind, detail)
  values ('packing_list', p_packing_list_id, p_actor, p_kind, coalesce(p_detail, '{}'::jsonb));
$function$
;
CREATE OR REPLACE FUNCTION public._pms_evidence_stage_open(p_name text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'storage'
AS $function$
declare
  v_stage_id uuid;
  v_row record;
begin
  begin
    v_stage_id := (storage.foldername(p_name))[2]::uuid;
  exception when others then
    return false;
  end;

  select s.stage, s.completed_at, s.transmittal_id, t.state
    into v_row
    from public.transmittal_stages s
    join public.transmittals t on t.id = s.transmittal_id
   where s.id = v_stage_id;

  if not found or v_row.completed_at is not null or v_row.state in ('closed', 'cancelled') then
    return false;
  end if;
  if v_row.transmittal_id::text is distinct from (storage.foldername(p_name))[1] then
    return false;
  end if;

  return public.transmittal_on_list(
    case when v_row.stage = 'technical_inspection' then 'transmittal_technical' else 'transmittal_warehouse' end
  );
end;
$function$
;
CREATE OR REPLACE FUNCTION public._pms_evidence_transmittal_id(p_name text)
 RETURNS uuid
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'storage'
AS $function$
begin
  return (storage.foldername(p_name))[1]::uuid;
exception when others then
  return null;
end;
$function$
;
CREATE OR REPLACE FUNCTION public._purchase_request_add_member(p_request_id uuid, p_employee_id uuid, p_actor uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_req public.purchase_requests;
  v_side text;
  v_added uuid;
begin
  select * into v_req from public.purchase_requests where id = p_request_id;
  v_side := public._purchase_request_side_on(v_req, p_employee_id);

  insert into public.purchase_request_members (request_id, employee_id, side, added_by)
  values (p_request_id, p_employee_id, v_side, p_actor)
  on conflict (request_id, employee_id) do nothing
  returning id into v_added;

  if v_added is null then
    return false;
  end if;

  if v_side = 'purchasing' then
    perform public._purchase_request_open_window(v_req, p_employee_id);
  end if;

  return true;
end;
$function$
;
CREATE OR REPLACE FUNCTION public._purchase_request_for_adding(p_request_id uuid, p_fn text)
 RETURNS purchase_requests
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_req public.purchase_requests;
begin
  if public.get_employee_id() is null then
    raise exception '%: not signed in', p_fn using errcode = '42501';
  end if;
  select * into v_req from public.purchase_requests where id = p_request_id;
  if v_req.id is null then
    raise exception '%: request % not found', p_fn, p_request_id using errcode = 'P0002';
  end if;
  if not public.purchase_request_can_add_items(p_request_id) then
    raise exception '%: only the request''s sales side or its Buyer may add items', p_fn using errcode = '42501';
  end if;
  return v_req;
end;
$function$
;
CREATE OR REPLACE FUNCTION public._purchase_request_has_open_items(p_request_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1 from purchase_request_items i
    where i.request_id = p_request_id
      and not public._purchase_request_item_is_closed(i.status)
  );
$function$
;
CREATE OR REPLACE FUNCTION public._purchase_request_is_live(p_req purchase_requests)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select not exists (
      select 1 from sales_opportunities o
      where o.id = p_req.opportunity_id and public._sor_closed_for_purchasing(o)
    )
    and (
      public._purchase_request_has_open_items(p_req.id)
      or not exists (select 1 from purchase_request_items i where i.request_id = p_req.id)
    );
$function$
;
CREATE OR REPLACE FUNCTION public._purchase_request_item_added(p_item purchase_request_items)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_amount text := trim_scale(p_item.quantity)::text || coalesce(' ' || nullif(btrim(p_item.unit), ''), '');
begin
  insert into public.purchase_request_messages (request_id, author_id, content, metadata)
  values (
    p_item.request_id,
    p_item.requested_by,
    case p_item.source
      when 'sor_line' then format('Requested %s × %s, from the SOR''s Product List.', p_item.name, v_amount)
      when 'component' then format('Requested %s × %s, from the Costing Matrix.', p_item.name, v_amount)
      else format('Requested a new product: %s × %s.', p_item.name, v_amount)
    end,
    jsonb_build_object('event', 'item_added', 'item_id', p_item.id, 'source', p_item.source)
  );

  update public.purchase_requests set updated_at = now() where id = p_item.request_id;
end;
$function$
;
CREATE OR REPLACE FUNCTION public._purchase_request_item_is_closed(p_status text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  select p_status in ('from_stock', 'received', 'substituted', 'cannot_source', 'cancelled');
$function$
;
CREATE OR REPLACE FUNCTION public._purchase_request_item_move(p_item purchase_request_items, p_to text, p_side text, p_actor uuid, p_details jsonb, p_fn text)
 RETURNS purchase_request_items
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_item public.purchase_request_items;
begin
  if p_item.status = p_to then
    raise exception '%: the item is already %', p_fn, public._purchase_request_item_status_label(p_to)
      using errcode = '22023';
  end if;
  if not public._purchase_request_item_transition_ok(p_item.status, p_to, p_side) then
    raise exception '%: % can''t move from % to %', p_fn,
      case p_side
        when 'purchasing' then 'Purchasing'
        when 'sales' then 'the sales side'
        else 'you'
      end,
      public._purchase_request_item_status_label(p_item.status),
      public._purchase_request_item_status_label(p_to)
      using errcode = '42501';
  end if;

  update public.purchase_request_items
     set status = p_to,
         status_changed_by = p_actor,
         status_changed_at = now()
   where id = p_item.id
  returning * into v_item;

  perform public._purchase_request_post_event(
    v_item.request_id,
    p_actor,
    format('%s: %s → %s.', v_item.name,
      public._purchase_request_item_status_label(p_item.status),
      public._purchase_request_item_status_label(p_to)),
    jsonb_build_object(
      'event', 'item_status_changed',
      'item_id', v_item.id,
      'from', p_item.status,
      'to', p_to,
      'changed_by', p_actor,
      'changed_at', v_item.status_changed_at
    ) || case when p_details = '{}'::jsonb then '{}'::jsonb else jsonb_build_object('details', p_details) end
  );

  return v_item;
end;
$function$
;
CREATE OR REPLACE FUNCTION public._purchase_request_item_status_label(p_status text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  select case p_status
    when 'requested'     then 'Requested'
    when 'from_stock'    then 'From stock'
    when 'to_order'      then 'To order'
    when 'canvassing'    then 'Canvassing'
    when 'ordered'       then 'Ordered'
    when 'received'      then 'Received'
    when 'substituted'   then 'Substituted'
    when 'cannot_source' then 'Cannot source'
    when 'cancelled'     then 'Cancelled'
    else p_status
  end;
$function$
;
CREATE OR REPLACE FUNCTION public._purchase_request_item_transition_ok(p_from text, p_to text, p_side text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  select case
    when public._purchase_request_item_is_closed(p_from) then false
    when p_side in ('sales', 'requester') then p_to = 'cancelled'
    when p_side = 'purchasing' then
      p_to in ('substituted', 'cannot_source', 'cancelled')
      or (p_from = 'requested'  and p_to in ('from_stock', 'to_order'))
      or (p_from = 'to_order'   and p_to in ('canvassing', 'ordered'))
      or (p_from = 'canvassing' and p_to = 'ordered')
      or (p_from = 'ordered'    and p_to = 'received')
    else false
  end;
$function$
;
CREATE OR REPLACE FUNCTION public._purchase_request_label(p_request_id uuid)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce(
    nullif(concat_ws(' — ', nullif(coalesce(o.sales_reference, o.opportunity_no), ''), nullif(o.project_title, '')), ''),
    nullif(btrim(r.title), ''),
    'a Purchase Request'
  )
  from (select 1) one
  left join purchase_requests r on r.id = p_request_id
  left join sales_opportunities o on o.id = r.opportunity_id;
$function$
;
CREATE OR REPLACE FUNCTION public._purchase_request_may_request(p_req purchase_requests, p_employee_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1
    from sales_opportunities o, jsonb_array_elements(coalesce(p_req.requesters, '[]'::jsonb)) s
    where o.id = p_req.opportunity_id
      and public.sor_selector_covers(s, o, p_employee_id)
  );
$function$
;
CREATE OR REPLACE FUNCTION public._purchase_request_member_event(p_request_id uuid, p_actor uuid, p_employee_id uuid, p_event text)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  insert into public.purchase_request_messages (request_id, author_id, content, metadata)
  values (
    p_request_id,
    p_actor,
    format(
      '%s %s.',
      case p_event when 'member_added' then 'Added' else 'Removed' end,
      coalesce((select name from public.employees where id = p_employee_id), 'a member')
    ),
    jsonb_build_object('event', p_event, 'employee_id', p_employee_id)
  );
$function$
;
CREATE OR REPLACE FUNCTION public._purchase_request_member_was_chosen(p_req purchase_requests, p_employee_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
      select 1 from purchase_request_messages m
      where m.request_id = p_req.id
        and m.metadata->>'event' = 'member_added'
        and m.metadata->>'employee_id' = p_employee_id::text
    )
    or exists (
      select 1
      from sor_action_runs run
      join sales_opportunities o on o.id = run.opportunity_id
      cross join lateral (select public._sor_action_run_saved_action(run.id) as action) saved
      cross join lateral jsonb_array_elements(
        case when jsonb_typeof(saved.action->'config'->'extras') = 'array'
          then saved.action->'config'->'extras' else '[]'::jsonb end
      ) s
      where run.opportunity_id = p_req.opportunity_id
        and saved.action->>'kind' = 'open_purchase_request'
        and public.sor_selector_covers(s, o, p_employee_id)
    );
$function$
;
CREATE OR REPLACE FUNCTION public._purchase_request_message_notify()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_req public.purchase_requests;
  v_event text := new.metadata->>'event';
  v_label text;
  v_author text;
  v_mentioned uuid[] := '{}';
  v_requesters uuid[];
  v_item public.purchase_request_items;
  v_buyer uuid;
begin
  select * into v_req from public.purchase_requests where id = new.request_id;
  if v_req.id is null then
    return null;
  end if;
  v_label := public._purchase_request_label(v_req.id);
  select name into v_author from public.employees where id = new.author_id;

  -- Mentions: only a member's own message carries them; only members count.
  if v_event is null and jsonb_typeof(new.metadata->'mentions') = 'array' then
    select coalesce(array_agg(distinct m.employee_id), '{}') into v_mentioned
    from jsonb_array_elements(new.metadata->'mentions') x
    join public.purchase_request_members m
      on m.request_id = v_req.id
     and m.employee_id::text = x->>'id'
    where jsonb_typeof(x) = 'object'
      and m.employee_id is distinct from new.author_id;

    perform public._purchase_request_notify(
      v_req.id, v_mentioned, new.author_id, 'PURCHASE_REQUEST_MENTION',
      coalesce(v_author, 'Someone') || ' mentioned you',
      v_label || ': ' || new.content
    );
  end if;

  if v_event = 'opened' then
    -- Once per request, however the event came to be posted again.
    if exists (
      select 1 from public.purchase_request_messages p
      where p.request_id = v_req.id and p.id <> new.id and p.metadata->>'event' = 'opened'
    ) then
      return null;
    end if;

    if v_req.buyer_id is null then
      perform public._purchase_request_notify(
        v_req.id,
        array(select e.id from public.employees e where public._employee_has_purchasing_access(e.id)),
        new.author_id, 'PURCHASE_REQUEST_OPENED',
        'New Purchase Request',
        v_label || ' needs a Buyer. Take it from Purchase Requests.',
        false
      );
    else
      perform public._purchase_request_notify(
        v_req.id, array[v_req.buyer_id], new.author_id, 'PURCHASE_REQUEST_BUYER',
        'You''re the Buyer',
        v_label || ': a Purchase Request opened with you as its Buyer.'
      );
    end if;

  elsif v_event = 'buyer_set' then
    v_buyer := nullif(new.metadata->>'buyer_id', '')::uuid;
    if v_buyer is not null then
      perform public._purchase_request_notify(
        v_req.id, array[v_buyer], new.author_id, 'PURCHASE_REQUEST_BUYER',
        'You''re the Buyer',
        v_label || ': ' || coalesce(v_author, 'Someone') || ' made you its Buyer.'
      );
    end if;

  elsif v_event = 'item_status_changed' then
    select * into v_item from public.purchase_request_items
    where id = nullif(new.metadata->>'item_id', '')::uuid;
    perform public._purchase_request_notify(
      v_req.id, array[v_req.buyer_id, v_item.requested_by], new.author_id,
      'PURCHASE_REQUEST_ITEM_STATUS',
      'Requested Item updated',
      v_label || ': ' || new.content
    );

  elsif v_event = 'item_added' then
    perform public._purchase_request_notify(
      v_req.id, array[v_req.buyer_id], new.author_id, 'PURCHASE_REQUEST_ITEM_ADDED',
      'Item requested',
      v_label || ': ' || new.content
    );

  elsif v_event is null then
    -- The creator counts only before a Buyer, or as a Direct request's Requester.
    select array_agg(distinct x) into v_requesters
    from (
      select v_req.created_by as x
      where v_req.buyer_id is null or v_req.opportunity_id is null
      union
      select i.requested_by from public.purchase_request_items i where i.request_id = v_req.id
    ) q
    where x is not null;

    perform public._purchase_request_notify(
      v_req.id,
      array(
        select r from unnest(array[v_req.buyer_id] || coalesce(v_requesters, '{}'::uuid[])) r
        where r is not null and not (r = any (v_mentioned))
      ),
      new.author_id, 'PURCHASE_REQUEST_MESSAGE',
      'New message from ' || coalesce(v_author, 'someone'),
      v_label || ': ' || new.content
    );
  end if;

  return null;
end;
$function$
;
CREATE OR REPLACE FUNCTION public._purchase_request_notify(p_request_id uuid, p_recipients uuid[], p_sender uuid, p_type text, p_title text, p_message text, p_members_only boolean DEFAULT true)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  insert into public.notifications (recipient_id, sender_id, type, title, message, reference_id)
  select distinct e.id, p_sender, p_type, p_title, left(p_message, 280), p_request_id::text
  from unnest(coalesce(p_recipients, '{}'::uuid[])) as r(id)
  join public.employees e on e.id = r.id
  where not coalesce(e.is_deleted, false)
    and e.id is distinct from p_sender
    and (
      not p_members_only
      or exists (
        select 1 from public.purchase_request_members m
        where m.request_id = p_request_id and m.employee_id = e.id
      )
    );
end;
$function$
;
CREATE OR REPLACE FUNCTION public._purchase_request_open_window(p_req purchase_requests, p_employee_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if p_req.opportunity_id is not null
     and not public._purchase_request_window_over(p_req)
     and not exists (
       select 1 from public.sor_stage_participants p
       where p.opportunity_id = p_req.opportunity_id
         and p.employee_id = p_employee_id
         and p.source = 'purchase_request'
         and p.source_id = p_req.id
         and p.closed_at is null
     ) then
    insert into public.sor_stage_participants
      (opportunity_id, employee_id, source, source_id, opened_visit_id, until_rule, until_stage_id)
    values
      (p_req.opportunity_id, p_employee_id, 'purchase_request', p_req.id, p_req.opened_visit_id,
       p_req.access_until, p_req.access_until_stage_id);
  end if;
end;
$function$
;
CREATE OR REPLACE FUNCTION public._purchase_request_post_event(p_request_id uuid, p_author uuid, p_content text, p_metadata jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  insert into public.purchase_request_messages (request_id, author_id, content, metadata)
  values (p_request_id, p_author, p_content, p_metadata);

  update public.purchase_requests set updated_at = now() where id = p_request_id;
end;
$function$
;
CREATE OR REPLACE FUNCTION public._purchase_request_purchasing_access_changed()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_actor uuid := public.get_employee_id();
  v_req public.purchase_requests;
begin
  -- An AFTER trigger: the row as changed is what the rule reads.
  if public._employee_has_purchasing_access(new.id) then
    for v_req in
      select r.* from public.purchase_requests r where public._purchase_request_is_live(r)
    loop
      if not public._purchase_request_add_member(v_req.id, new.id, v_actor) then
        update public.purchase_request_members
        set side = 'purchasing'
        where request_id = v_req.id and employee_id = new.id and side <> 'purchasing';
        if found then
          perform public._purchase_request_open_window(v_req, new.id);
        end if;
      end if;
    end loop;
  elsif tg_op = 'UPDATE' then
    -- A Buyer must hold Purchasing access (pr_set_buyer): their live requests go
    -- back to the queue, the way clearing the Buyer does, and Purchasing hears.
    for v_req in
      select r.* from public.purchase_requests r
      where r.buyer_id = new.id and public._purchase_request_is_live(r)
    loop
      update public.purchase_requests set buyer_id = null where id = v_req.id;
      perform public._purchase_request_post_event(
        v_req.id, v_actor,
        format('%s no longer has Purchasing access; the request is back in the queue.', new.name),
        jsonb_build_object('event', 'buyer_set', 'buyer_id', null, 'previous_buyer_id', new.id)
      );
      perform public._purchase_request_notify(
        v_req.id,
        array(select e.id from public.employees e where public._employee_has_purchasing_access(e.id)),
        v_actor, 'PURCHASE_REQUEST_REQUEUED',
        'Back in the queue',
        public._purchase_request_label(v_req.id) || ' needs a Buyer. Take it from Purchase Requests.',
        false
      );
    end loop;

    -- Where they'd now be on the other side and nobody chose them, they were
    -- only there to buy: they leave (the queue that shows those requests needs
    -- the access). The Deal Team, a Buyer of a closed request, and anyone added
    -- by hand or as an action's extra stay, on the side they'd otherwise have.
    delete from public.purchase_request_members m
    using public.purchase_requests r
    where r.id = m.request_id and m.employee_id = new.id and m.side = 'purchasing'
      and r.buyer_id is distinct from new.id
      and public._purchase_request_side_on(r, new.id) = 'other'
      and not public._purchase_request_member_was_chosen(r, new.id);

    update public.purchase_request_members m
    set side = public._purchase_request_side_on(r, new.id)
    from public.purchase_requests r
    where r.id = m.request_id and m.employee_id = new.id and m.side = 'purchasing';

    update public.sor_stage_participants
    set closed_at = now(), closed_reason = 'access_revoked', removed_by = v_actor
    where source = 'purchase_request' and employee_id = new.id and closed_at is null;
  end if;
  return null;
end;
$function$
;
CREATE OR REPLACE FUNCTION public._purchase_request_set_item_status(p_item_id uuid, p_status text, p_details jsonb, p_server boolean)
 RETURNS purchase_request_items
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_actor uuid := public.get_employee_id();
  v_details jsonb := coalesce(p_details, '{}'::jsonb);
  v_item public.purchase_request_items;
  v_side text;
  v_key text;
  v_po text;
  v_verification text;
begin
  if v_actor is null then
    raise exception 'purchase_request_set_item_status: not signed in' using errcode = '42501';
  end if;
  if p_status is null or p_status not in (
    'requested', 'from_stock', 'to_order', 'canvassing', 'ordered', 'received',
    'substituted', 'cannot_source', 'cancelled'
  ) then
    raise exception 'purchase_request_set_item_status: % is not an item status', coalesce(p_status, 'null') using errcode = '22023';
  end if;
  if jsonb_typeof(v_details) <> 'object' then
    raise exception 'purchase_request_set_item_status: details must be an object' using errcode = '22023';
  end if;
  -- #548: the Odoo check is the server's word, never the browser's.
  if v_details ? 'po_verification' and not p_server then
    raise exception 'purchase_request_set_item_status: only the server may record a PO check; send the PO number and it is checked against Odoo for you'
      using errcode = '42501';
  end if;

  -- Only Ordered takes details: its PO number and what Odoo said about it.
  if p_status <> 'ordered' and v_details <> '{}'::jsonb then
    raise exception 'purchase_request_set_item_status: % takes no details', public._purchase_request_item_status_label(p_status)
      using errcode = '22023';
  end if;
  for v_key in select jsonb_object_keys(v_details) loop
    if v_key not in ('po_number', 'po_verification') then
      raise exception 'purchase_request_set_item_status: Ordered takes a PO number and its check, not %', v_key
        using errcode = '22023';
    end if;
  end loop;

  if v_details ? 'po_number' and jsonb_typeof(v_details->'po_number') not in ('string', 'null') then
    raise exception 'purchase_request_set_item_status: the PO number must be text' using errcode = '22023';
  end if;
  v_po := nullif(upper(btrim(v_details->>'po_number')), '');
  v_verification := nullif(btrim(v_details->>'po_verification'), '');
  if v_po is not null and v_po !~ '^P[0-9]+$' then
    raise exception 'purchase_request_set_item_status: % isn''t an Odoo PO number ("P" then digits, e.g. P01234)', v_po
      using errcode = '22023';
  end if;
  -- A PO number is recorded only by the server path, after it asked Odoo; a signed-in
  -- caller sending one would store it unchecked and skip the Odoo not-found refusal.
  if v_po is not null and not p_server then
    raise exception 'purchase_request_set_item_status: a PO number is saved by the server after Odoo is asked; use the Order / Correct PO action'
      using errcode = '42501';
  end if;
  if v_verification is not null and v_po is null then
    raise exception 'purchase_request_set_item_status: a PO check needs a PO number' using errcode = '22023';
  end if;
  if v_verification is not null
     and v_verification not in ('UNVERIFIED', 'VERIFIED', 'PENDING_VERIFICATION', 'NOT_FOUND') then
    raise exception 'purchase_request_set_item_status: % is not a PO check result', v_verification using errcode = '22023';
  end if;
  if v_po is not null then
    v_verification := coalesce(v_verification, 'UNVERIFIED');
    v_details := jsonb_build_object('po_number', v_po, 'po_verification', v_verification);
  else
    v_details := '{}'::jsonb;
  end if;

  select * into v_item from public.purchase_request_items where id = p_item_id for update;
  if v_item.id is null then
    raise exception 'purchase_request_set_item_status: item % not found', p_item_id using errcode = 'P0002';
  end if;

  v_side := public.purchase_request_actor_side(v_item.request_id);
  if v_side is null then
    raise exception 'purchase_request_set_item_status: only the request''s members may change an item' using errcode = '42501';
  end if;

  v_item := public._purchase_request_item_move(v_item, p_status, v_side, v_actor, v_details, 'purchase_request_set_item_status');

  if v_po is not null then
    update public.purchase_request_items
       set po_number = v_po,
           po_verification = v_verification
     where id = v_item.id
    returning * into v_item;
  end if;

  return v_item;
end;
$function$
;
CREATE OR REPLACE FUNCTION public._purchase_request_side_on(p_req purchase_requests, p_employee_id uuid)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select case
    when public._employee_has_purchasing_access(p_employee_id) then 'purchasing'
    when p_req.opportunity_id is null and p_req.created_by = p_employee_id then 'requester'
    when public.purchase_request_member_side(p_req.opportunity_id, p_employee_id) = 'other'
      and public._purchase_request_may_request(p_req, p_employee_id) then 'requester'
    else public.purchase_request_member_side(p_req.opportunity_id, p_employee_id)
  end;
$function$
;
CREATE OR REPLACE FUNCTION public._purchase_request_sor_status_notify()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_reason text := public._sor_purchasing_closed_reason(new);
  v_closed boolean := v_reason is not null;
  v_req public.purchase_requests;
  v_recipients uuid[];
  v_happened text;
begin
  if v_closed = public._sor_closed_for_purchasing(old) then
    return null;
  end if;

  select * into v_req from public.purchase_requests where opportunity_id = new.id;
  if v_req.id is null or not public._purchase_request_has_open_items(v_req.id) then
    return null;
  end if;

  -- The Buyer, else everyone with Purchasing access (as when an unassigned
  -- request opens); and the requesters.
  select array_agg(distinct x) into v_recipients
  from (
    select v_req.buyer_id as x where v_req.buyer_id is not null
    union all
    select e.id from public.employees e
    where v_req.buyer_id is null and public._employee_has_purchasing_access(e.id)
    union all
    select v_req.created_by
    union all
    select i.requested_by from public.purchase_request_items i where i.request_id = v_req.id
  ) q;

  v_happened := case
    when v_closed then 'was ' || v_reason
    when coalesce(old.is_deleted, false) then 'was restored'
    else 'was reopened'
  end;

  perform public._purchase_request_notify(
    v_req.id,
    v_recipients,
    public.get_employee_id(),
    case when v_closed then 'PURCHASE_REQUEST_SOR_CLOSED' else 'PURCHASE_REQUEST_SOR_REOPENED' end,
    'SOR ' || v_happened,
    format('%s %s. Its Purchase Request still has open items.', public._purchase_request_label(v_req.id), v_happened),
    false
  );
  return null;
end;
$function$
;
CREATE OR REPLACE FUNCTION public._purchase_request_window_over(p_req purchase_requests)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select case
    when p_req.opened_visit_id is null then true
    when exists (
      select 1 from sales_opportunities o
      join flow_stages s on s.id = o.flow_stage_id
      where o.id = p_req.opportunity_id and s.is_terminal
    ) then true
    when p_req.access_until = 'stage_left' then exists (
      select 1 from sor_stage_visits v
      where v.id = p_req.opened_visit_id and v.left_at is not null
    )
    when p_req.access_until = 'stage_entered' then exists (
      select 1 from sor_stage_visits opened
      join sor_stage_visits v on v.opportunity_id = opened.opportunity_id and v.sequence > opened.sequence
      where opened.id = p_req.opened_visit_id and v.flow_stage_id = p_req.access_until_stage_id
    )
    when p_req.access_until = 'later_stage_left' then exists (
      select 1 from sor_stage_visits opened
      join sor_stage_visits v on v.opportunity_id = opened.opportunity_id and v.sequence >= opened.sequence
      where opened.id = p_req.opened_visit_id
        and v.flow_stage_id = p_req.access_until_stage_id
        and v.left_at is not null
    )
    else false
  end;
$function$
;
CREATE OR REPLACE FUNCTION public._sor_action_run_saved_action(p_run_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with run as (
    select r.action_id, coalesce(v.flow_snapshot_id, o.flow_snapshot_id) as snapshot_id
    from sor_action_runs r
    join sales_opportunities o on o.id = r.opportunity_id
    left join sor_stage_visits v on v.id = r.stage_visit_id
    where r.id = p_run_id
  ),
  frozen as (
    select a.value
    from run
    join flow_snapshots s on s.id = run.snapshot_id,
      lateral jsonb_array_elements(
        case jsonb_typeof(s.snapshot_data->'actions')
          when 'array' then s.snapshot_data->'actions'
          when 'object' then (
            select coalesce(jsonb_agg(e), '[]'::jsonb)
            from jsonb_each(s.snapshot_data->'actions') g, jsonb_array_elements(g.value) e
          )
          else '[]'::jsonb
        end
      ) a
    where a.value->>'id' = run.action_id::text
    limit 1
  )
  select jsonb_build_object(
    'id', fa.id,
    'kind', coalesce((select value->>'kind' from frozen), fa.kind),
    'config', coalesce((select value->'config' from frozen), fa.config, '{}'::jsonb)
  )
  from run
  join flow_stage_actions fa on fa.id = run.action_id;
$function$
;
CREATE OR REPLACE FUNCTION public._sor_closed_for_purchasing(p_opp sales_opportunities)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select public._sor_purchasing_closed_reason(p_opp) is not null;
$function$
;
CREATE OR REPLACE FUNCTION public._sor_deal_team_roles(p_opp sales_opportunities)
 RETURNS TABLE(employee_id uuid, role text)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select x.employee_id, x.role
  from (values
    (p_opp.registered_by, 'registrar'),
    (p_opp.deal_owner_id, 'deal_owner'),
    (p_opp.closing_sales_id, 'closing_sales'),
    (p_opp.support_sales_1_id, 'support_sales'),
    (p_opp.support_sales_2_id, 'support_sales'),
    (p_opp.sales_director_id, 'sales_director')
  ) as x (employee_id, role)
  where x.employee_id is not null;
$function$
;
CREATE OR REPLACE FUNCTION public._sor_purchasing_closed_reason(p_opp sales_opportunities)
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select case
    when coalesce(p_opp.is_deleted, false) then 'deleted'
    when exists (
      select 1
      from flow_stages s
      join sales_flows f on f.id = s.flow_id
      where s.id = p_opp.flow_stage_id
        and s.is_terminal
        and s.id is distinct from f.won_stage_id
        and coalesce(s.terminal_outcome, 'lost') = 'lost'
    ) then 'lost'
  end;
$function$
;
CREATE OR REPLACE FUNCTION public._sor_window_over(p_opportunity_id uuid, p_visit_id uuid, p_until text, p_until_stage_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select case
    when p_visit_id is null then true
    when exists (
      select 1 from sales_opportunities o
      join flow_stages s on s.id = o.flow_stage_id
      where o.id = p_opportunity_id and s.is_terminal
    ) then true
    when p_until = 'stage_left' then exists (
      select 1 from sor_stage_visits v
      where v.id = p_visit_id and v.left_at is not null
    )
    when p_until = 'stage_entered' then exists (
      select 1 from sor_stage_visits opened
      join sor_stage_visits v on v.opportunity_id = opened.opportunity_id and v.sequence > opened.sequence
      where opened.id = p_visit_id and v.flow_stage_id = p_until_stage_id
    )
    when p_until = 'later_stage_left' then exists (
      select 1 from sor_stage_visits opened
      join sor_stage_visits v on v.opportunity_id = opened.opportunity_id and v.sequence >= opened.sequence
      where opened.id = p_visit_id
        and v.flow_stage_id = p_until_stage_id
        and v.left_at is not null
    )
    else false
  end;
$function$
;
CREATE OR REPLACE FUNCTION public._transmittal_clean_header(p_fields jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_origin text := nullif(btrim(p_fields->>'origin'), '');
  v_origin_other text := nullif(btrim(p_fields->>'origin_other'), '');
  v_check_wh boolean := coalesce((p_fields->>'check_warehouse')::boolean, false);
  v_check_tech boolean := coalesce((p_fields->>'check_technical')::boolean, false);
  v_check_other text := nullif(btrim(p_fields->>'check_other'), '');
  v_priority text := nullif(btrim(p_fields->>'priority'), '');
  v_entity text := nullif(btrim(p_fields->>'entity'), '');
  v_product_other text := nullif(btrim(p_fields->>'product_other'), '');
  v_location uuid := nullif(p_fields->>'item_location_id', '')::uuid;
begin
  if v_origin is null or v_origin not in ('purchasing', 'logistics', 'warehouse', 'other') then
    raise exception 'transmittal: % isn''t an Origin', coalesce(v_origin, 'null') using errcode = '22023';
  end if;
  if v_origin = 'other' and v_origin_other is null then
    raise exception 'transmittal: Origin Others needs its text' using errcode = '22023';
  end if;
  if not (v_check_wh or v_check_tech) then
    raise exception 'transmittal: tick Warehouse or TCA Technical under Checking' using errcode = '22023';
  end if;
  if v_priority is null or v_priority not in ('high', 'medium', 'low') then
    raise exception 'transmittal: % isn''t a Priority', coalesce(v_priority, 'null') using errcode = '22023';
  end if;
  if v_entity is null then
    raise exception 'transmittal: a Company is needed' using errcode = '22023';
  end if;
  if v_location is not null and not exists (
    select 1 from public.ipas_options o
     where o.id = v_location and o.list = 'item_location' and o.active
  ) then
    raise exception 'transmittal: that Item Location isn''t on the list' using errcode = '22023';
  end if;

  return jsonb_build_object(
    'origin', v_origin,
    'origin_other', case when v_origin = 'other' then v_origin_other end,
    'check_warehouse', v_check_wh,
    'check_technical', v_check_tech,
    'check_other', v_check_other,
    'priority', v_priority,
    'entity', v_entity,
    'product_other', v_product_other,
    'item_location_id', v_location
  );
end;
$function$
;
CREATE OR REPLACE FUNCTION public._transmittal_event(p_transmittal_id uuid, p_actor uuid, p_kind text, p_detail jsonb DEFAULT '{}'::jsonb)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  insert into public.pms_handoff_events (record_type, record_id, actor_id, kind, detail)
  values ('transmittal', p_transmittal_id, p_actor, p_kind, coalesce(p_detail, '{}'::jsonb));
$function$
;
CREATE OR REPLACE FUNCTION public._transmittal_list_ids(p_list_key text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce(jsonb_agg(l.employee_id order by l.employee_id), '[]'::jsonb)
    from public.ipas_signer_lists l
    join public.employees e on e.id = l.employee_id
   where l.list_key = p_list_key
     and not coalesce(e.is_deleted, false);
$function$
;
CREATE OR REPLACE FUNCTION public._transmittal_sync_links(p_transmittal_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  delete from public.transmittal_ipas where transmittal_id = p_transmittal_id;
  delete from public.transmittal_sors where transmittal_id = p_transmittal_id;

  insert into public.transmittal_ipas (transmittal_id, ipas_id)
  select distinct p_transmittal_id, l.ipas_id
    from public.transmittal_lines l
   where l.transmittal_id = p_transmittal_id and l.ipas_id is not null;

  insert into public.transmittal_sors (transmittal_id, opportunity_id)
  select distinct p_transmittal_id, l.opportunity_id
    from public.transmittal_lines l
   where l.transmittal_id = p_transmittal_id and l.opportunity_id is not null;
end;
$function$
;
CREATE OR REPLACE FUNCTION public._transmittal_write_children(p_transmittal_id uuid, p_product_ids uuid[], p_reference_ids uuid[], p_lines jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_entity text;
  v_number text;
  v_line jsonb;
  v_position integer := 0;
  v_kind text;
  v_ipas public.ipas;
  v_po_line jsonb;
  v_ipas_entity text;
  v_quantity numeric;
  v_opportunity uuid;
  v_sor_count integer;
  v_warnings jsonb := '[]'::jsonb;
  v_products uuid[];
  v_references uuid[];
begin
  select t.entity, t.number into v_entity, v_number from public.transmittals t where t.id = p_transmittal_id;

  v_products := coalesce(p_product_ids, '{}'::uuid[]);
  v_references := coalesce(p_reference_ids, '{}'::uuid[]);

  if cardinality(v_products) > 0 and (
       select count(*) from public.ipas_options o
        where o.id = any (v_products) and o.list = 'transmittal_product' and o.active
     ) <> (select count(distinct x) from unnest(v_products) x) then
    raise exception 'transmittal: a Product isn''t on the list' using errcode = '22023';
  end if;
  if cardinality(v_references) > 0 and (
       select count(*) from public.ipas_options o
        where o.id = any (v_references) and o.list = 'transmittal_reference' and o.active
     ) <> (select count(distinct x) from unnest(v_references) x) then
    raise exception 'transmittal: a Reference Checklist item isn''t on the list' using errcode = '22023';
  end if;

  delete from public.transmittal_lines where transmittal_id = p_transmittal_id;
  delete from public.transmittal_products where transmittal_id = p_transmittal_id;
  delete from public.transmittal_references where transmittal_id = p_transmittal_id;

  insert into public.transmittal_products (transmittal_id, option_id)
  select p_transmittal_id, x from unnest(v_products) as x;

  insert into public.transmittal_references (transmittal_id, option_id)
  select p_transmittal_id, x from unnest(v_references) as x;

  for v_line in select value from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) as value loop
    v_position := v_position + 1;
    v_kind := nullif(btrim(v_line->>'kind'), '');
    v_quantity := nullif(v_line->>'quantity', '')::numeric;

    if v_quantity is null or v_quantity <= 0 then
      raise exception 'transmittal: line % needs a quantity above zero', v_position using errcode = '22023';
    end if;

    if v_kind = 'po_line' then
      select * into v_ipas
        from public.ipas i
       where i.id = nullif(v_line->>'ipas_id', '')::uuid;
      if not found or v_ipas.state = 'cancelled' then
        raise exception 'transmittal: line % names an IPAS that isn''t live', v_position using errcode = '22023';
      end if;

      select l into v_po_line
        from jsonb_array_elements(coalesce(v_ipas.odoo_copy -> 'lines', '[]'::jsonb)) as l
       where (l->>'line_id')::integer = (v_line->>'odoo_po_line_id')::integer
       limit 1;
      if v_po_line is null then
        raise exception 'transmittal: line % isn''t on % Odoo copy', v_position, v_ipas.po_number
          using errcode = '22023';
      end if;

      v_ipas_entity := coalesce(
        nullif(btrim(v_ipas.entity_override), ''),
        nullif(btrim(v_ipas.odoo_copy #>> '{po,company}'), '')
      );
      if v_ipas_entity is not null
         and lower(regexp_replace(btrim(v_ipas_entity), '\s+', ' ', 'g'))
             is distinct from lower(regexp_replace(btrim(coalesce(v_entity, '')), '\s+', ' ', 'g')) then
        v_warnings := v_warnings || jsonb_build_array(jsonb_build_object(
          'kind', 'entity', 'position', v_position, 'po_number', v_ipas.po_number, 'entity', v_ipas_entity
        ));
      end if;

      v_opportunity := nullif(v_line->>'opportunity_id', '')::uuid;
      if v_opportunity is null then
        select count(*) into v_sor_count from public.ipas_sors s where s.ipas_id = v_ipas.id;
        if v_sor_count = 1 then
          select s.opportunity_id into v_opportunity from public.ipas_sors s where s.ipas_id = v_ipas.id;
        end if;
      end if;
      if v_opportunity is not null and not exists (
           select 1 from public.sales_opportunities o
            where o.id = v_opportunity and not coalesce(o.is_deleted, false)
         ) then
        raise exception 'transmittal: line % names an SOR that no longer exists', v_position using errcode = '22023';
      end if;

      insert into public.transmittal_lines (
        transmittal_id, position, kind, ipas_id, odoo_po_line_id, description, quantity, unit,
        opportunity_id, serial_numbers, box_quantity
      ) values (
        p_transmittal_id, v_position, 'po_line', v_ipas.id, (v_po_line->>'line_id')::integer,
        coalesce(nullif(btrim(v_po_line->>'name'), ''), 'PO line ' || (v_po_line->>'line_id')),
        v_quantity,
        nullif(btrim(v_po_line->>'unit'), ''),
        v_opportunity,
        nullif(btrim(v_line->>'serial_numbers'), ''),
        nullif(btrim(v_line->>'box_quantity'), '')
      );

    elsif v_kind = 'typed' then
      if nullif(btrim(v_line->>'description'), '') is null then
        raise exception 'transmittal: line % needs a description', v_position using errcode = '22023';
      end if;
      if nullif(btrim(v_line->>'unit'), '') is null then
        raise exception 'transmittal: line % needs a unit', v_position using errcode = '22023';
      end if;
      v_opportunity := nullif(v_line->>'opportunity_id', '')::uuid;
      if v_opportunity is not null and not exists (
           select 1 from public.sales_opportunities o
            where o.id = v_opportunity and not coalesce(o.is_deleted, false)
         ) then
        raise exception 'transmittal: line % names an SOR that no longer exists', v_position using errcode = '22023';
      end if;

      insert into public.transmittal_lines (
        transmittal_id, position, kind, description, quantity, unit,
        opportunity_id, serial_numbers, box_quantity
      ) values (
        p_transmittal_id, v_position, 'typed', btrim(v_line->>'description'), v_quantity,
        btrim(v_line->>'unit'), v_opportunity,
        nullif(btrim(v_line->>'serial_numbers'), ''),
        nullif(btrim(v_line->>'box_quantity'), '')
      );

    else
      raise exception 'transmittal: line % has no kind (po_line or typed)', v_position using errcode = '22023';
    end if;
  end loop;

  return v_warnings;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.add_bug_report_note(p_report_id uuid, p_body text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_me uuid := get_employee_id();
  v_reporter uuid;
  v_body text := btrim(coalesce(p_body, ''));
  v_id uuid;
begin
  if v_me is null then
    raise exception 'Not signed in as a recognized employee.';
  end if;

  select reporter_id into v_reporter from bug_reports where id = p_report_id;
  if not found then
    raise exception 'Bug report not found.';
  end if;
  if v_reporter <> v_me and not can_read_bug_reports() then
    raise exception 'You cannot write on this bug report.';
  end if;

  if length(v_body) = 0 then
    raise exception 'Write something before sending.';
  end if;
  if length(v_body) > 4000 then
    raise exception 'Keep a note under 4000 characters.';
  end if;

  insert into bug_report_notes (report_id, author_id, kind, body)
  values (p_report_id, v_me, 'note', v_body)
  returning id into v_id;

  if v_me = v_reporter then
    insert into notifications (recipient_id, sender_id, type, title, message, reference_id)
    select e.id, v_me, 'BUG_REPORT_NOTE', 'Reply on a bug report',
           left(split_part(v_body, E'\n', 1), 140), p_report_id::text
    from employees e
    where (e.is_super_admin or e.has_bug_report_access)
      and not coalesce(e.is_deleted, false)
      and e.id <> v_me;
  else
    insert into notifications (recipient_id, sender_id, type, title, message, reference_id)
    select e.id, v_me, 'BUG_REPORT_NOTE', 'Note on your bug report',
           left(split_part(v_body, E'\n', 1), 140), p_report_id::text
    from employees e
    where e.id = v_reporter
      and not coalesce(e.is_deleted, false);
  end if;

  return v_id;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.add_leave_category(p_label text)
 RETURNS hr_leave_categories
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_result hr_leave_categories;
BEGIN
  -- Lock the table to prevent concurrent inserts from seeing the same max sort_order
  LOCK TABLE hr_leave_categories IN EXCLUSIVE MODE;
  
  INSERT INTO hr_leave_categories (label, sort_order, is_active)
  VALUES (
    p_label,
    (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM hr_leave_categories),
    true
  )
  RETURNING * INTO v_result;
  
  RETURN v_result;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.approve_retail_queue_item(p_queue_item_id uuid, p_client_name text DEFAULT NULL::text, p_contact_person text DEFAULT NULL::text, p_project_title text DEFAULT NULL::text, p_expected_value numeric DEFAULT NULL::numeric)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_item record;
  v_reviewer uuid;
  v_new_id uuid;
begin
  v_reviewer := get_employee_id();
  if v_reviewer is null then
    raise exception 'Not signed in as a recognized employee.';
  end if;

  if not can_handle_retail_queue() then
    raise exception 'You do not have Retail access.';
  end if;

  select * into v_item from odoo_retail_queue where id = p_queue_item_id for update;
  if not found then
    raise exception 'Queue item not found.';
  end if;
  if v_item.status <> 'pending' then
    raise exception 'Queue item is no longer pending.';
  end if;

  insert into sales_opportunities (
    sales_reference, client_name, contact_person, project_title, expected_value,
    lead_source, registered_by, registration_date, is_retail
  ) values (
    v_item.odoo_so_number,
    coalesce(p_client_name, v_item.client_name, v_item.odoo_partner_name),
    coalesce(p_contact_person, v_item.contact_person, v_item.odoo_person_name),
    coalesce(p_project_title, v_item.project_title, 'Retail: ' || v_item.odoo_partner_name),
    coalesce(p_expected_value, v_item.expected_value, v_item.odoo_amount),
    coalesce(v_item.lead_source, 'SHOPEE'),
    v_reviewer,
    coalesce(v_item.odoo_create_date::date, current_date),
    true
  ) returning id into v_new_id;

  update odoo_retail_queue set
    status = 'approved',
    reviewed_by = v_reviewer,
    reviewed_at = now(),
    opportunity_id = v_new_id,
    client_name = coalesce(p_client_name, client_name),
    contact_person = coalesce(p_contact_person, contact_person),
    project_title = coalesce(p_project_title, project_title),
    expected_value = coalesce(p_expected_value, expected_value)
  where id = p_queue_item_id;

  return v_new_id;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.can_edit_sales_flows()
 RETURNS boolean
 LANGUAGE sql
 SECURITY DEFINER
AS $function$
  SELECT can_edit_sales_flows FROM public.employees WHERE email = auth.jwt() ->> 'email';
$function$
;
CREATE OR REPLACE FUNCTION public.can_handle_retail_queue()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1 from employees e
    where e.id = get_employee_id()
      and (e.is_super_admin or e.has_retail_access)
  );
$function$
;
CREATE OR REPLACE FUNCTION public.can_manage_leaves()
 RETURNS boolean
 LANGUAGE sql
 SECURITY DEFINER
AS $function$
  SELECT can_manage_leaves FROM public.employees WHERE email = auth.jwt() ->> 'email';
$function$
;
CREATE OR REPLACE FUNCTION public.can_read_bug_reports()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1 from employees e
    where e.id = get_employee_id()
      and (e.is_super_admin or e.has_bug_report_access)
  );
$function$
;
CREATE OR REPLACE FUNCTION public.can_read_purchase_request(p_request_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce(is_super_admin(), false)
      or is_purchase_request_member(p_request_id)
      or (
        has_purchasing_access()
        and exists (
          select 1 from purchase_requests r
          where r.id = p_request_id and r.buyer_id is null
        )
      );
$function$
;
CREATE OR REPLACE FUNCTION public.cancel_sil_leave(p_leave_id uuid, p_employee_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_group_id uuid;
  v_employee_id uuid;
  v_employee_name text;
  v_employment_status text;
  v_previous_status text;
  v_total_hours numeric;
  v_dates date[];
  v_first_date date;
  v_balance numeric;
  v_refund_withheld boolean := false;
  v_now timestamptz := now();
BEGIN
  SELECT leave_group_id INTO v_group_id FROM sil_leaves WHERE id = p_leave_id;
  IF v_group_id IS NULL THEN
    RAISE EXCEPTION 'Leave application not found.';
  END IF;

  PERFORM 1 FROM sil_leaves WHERE leave_group_id = v_group_id ORDER BY id FOR UPDATE;

  SELECT employee_id, status INTO v_employee_id, v_previous_status
    FROM sil_leaves WHERE id = p_leave_id;

  IF v_employee_id <> p_employee_id THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  IF v_previous_status IN ('REJECTED', 'CANCELLED') THEN
    RAISE EXCEPTION 'Cannot withdraw this request.';
  END IF;

  SELECT COALESCE(sum(hours), 0), array_agg(date ORDER BY date), min(date)
    INTO v_total_hours, v_dates, v_first_date
    FROM sil_leaves WHERE leave_group_id = v_group_id;

  -- Issue #111 (HR-06): the identical cutoff withdraw_offset_leave applies,
  -- worded identically — an employee has no reason to learn two rules for the
  -- same act. See ADR 0015.
  IF v_previous_status = 'APPROVED' AND v_first_date < CURRENT_DATE THEN
    RAISE EXCEPTION 'This leave started on % and has already been taken, so its hours cannot be withdrawn. Ask HR to undo the approval if the leave was not actually taken.', v_first_date;
  END IF;

  UPDATE sil_leaves SET status = 'CANCELLED' WHERE leave_group_id = v_group_id;

  IF v_previous_status = 'APPROVED' THEN
    SELECT sil_hours_balance, employment_status, name
      INTO v_balance, v_employment_status, v_employee_name
      FROM employees WHERE id = v_employee_id FOR UPDATE;

    IF v_employment_status IS NOT DISTINCT FROM 'Regular' THEN
      UPDATE employees
         SET sil_hours_balance = COALESCE(v_balance, 0) + v_total_hours, updated_at = v_now
       WHERE id = v_employee_id;
    ELSE
      v_refund_withheld := true;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'rows', (SELECT jsonb_agg(to_jsonb(l) ORDER BY l.date) FROM sil_leaves l WHERE l.leave_group_id = v_group_id),
    'employee_id', v_employee_id,
    'employee_name', v_employee_name,
    'employment_status', v_employment_status,
    'refund_withheld', v_refund_withheld,
    'group_id', v_group_id,
    'total_hours', v_total_hours,
    'dates', to_jsonb(v_dates),
    'previous_status', v_previous_status
  );
END;
$function$
;
CREATE OR REPLACE FUNCTION public.canvass_add_offer(p_canvass_id uuid, p_offer jsonb, p_price jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_offer public.sor_canvass_offers;
begin
  p_offer := coalesce(p_offer, '{}'::jsonb);
  p_price := coalesce(p_price, '{}'::jsonb);

  insert into public.sor_canvass_offers (
    canvass_id, supplier_name, odoo_supplier_id, brand, description, source_link, brochure,
    remarks, lead_time, quality_note, currency, valid_until, sort_order, created_by
  ) values (
    p_canvass_id,
    p_offer ->> 'supplier_name',
    nullif(p_offer ->> 'odoo_supplier_id', '')::integer,
    p_offer ->> 'brand',
    p_offer ->> 'description',
    p_offer ->> 'source_link',
    case when jsonb_typeof(p_offer -> 'brochure') = 'array' then p_offer -> 'brochure' else '[]'::jsonb end,
    p_offer ->> 'remarks',
    p_offer ->> 'lead_time',
    p_offer ->> 'quality_note',
    coalesce(nullif(p_offer ->> 'currency', ''), 'PHP'),
    nullif(p_offer ->> 'valid_until', '')::date,
    (select count(*)::integer from public.sor_canvass_offers where canvass_id = p_canvass_id),
    nullif(p_offer ->> 'created_by', '')::uuid
  )
  returning * into v_offer;

  insert into public.sor_canvass_offer_prices (offer_id, unit_price, comparison_rate)
  values (
    v_offer.id,
    nullif(p_price ->> 'unit_price', '')::numeric,
    nullif(p_price ->> 'comparison_rate', '')::numeric
  );

  return to_jsonb(v_offer);
end;
$function$
;
CREATE OR REPLACE FUNCTION public.canvass_apply_winner(p_canvass_id uuid, p_offer_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_actor    uuid := public.get_employee_id();
  v_canvass  public.sor_canvasses;
  v_offer    public.sor_canvass_offers;
  v_price    numeric;
  v_rate     numeric;
  v_acquire  numeric;
  v_comp     public.costing_components;
  v_cost     public.costing_component_costs;
  v_filled   jsonb := jsonb_build_object('acquire', false, 'offer_specification', false, 'documents', false);
  v_kept     jsonb;
  v_docs     jsonb;
  v_spec     boolean;
begin
  if v_actor is null then
    raise exception 'canvass_apply_winner: sign in first' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtext('canvass_winner:' || p_canvass_id::text));

  select * into v_canvass from public.sor_canvasses where id = p_canvass_id;
  if not found then
    raise exception 'canvass_apply_winner: not found' using errcode = 'P0002';
  end if;
  if not (public.canvass_can_write() and public.canvass_can_read(p_canvass_id)) then
    raise exception 'canvass_apply_winner: not allowed' using errcode = '42501';
  end if;

  select * into v_offer from public.sor_canvass_offers where id = p_offer_id and canvass_id = p_canvass_id;
  if not found then
    raise exception 'canvass_apply_winner: that Offer is not on this Canvass' using errcode = 'P0002';
  end if;

  select p.unit_price, p.comparison_rate into v_price, v_rate
    from public.sor_canvass_offer_prices p where p.offer_id = p_offer_id;

  if v_offer.currency <> 'PHP' and v_rate is null then
    raise exception 'canvass_apply_winner: a % Offer needs its comparison rate before it can win', v_offer.currency
      using errcode = '22023';
  end if;

  -- One winner: the old one goes first.
  update public.sor_canvass_offers set is_winner = false
    where canvass_id = p_canvass_id and is_winner and id <> p_offer_id;
  update public.sor_canvass_offers set is_winner = true
    where id = p_offer_id and not is_winner;

  -- A Canvass on a Requested Item fills nothing: there is no matrix row.
  if v_canvass.component_id is null then
    return jsonb_build_object('offer_id', p_offer_id, 'filled', v_filled);
  end if;

  select * into v_comp from public.costing_components where id = v_canvass.component_id for update;
  if not found then
    raise exception 'canvass_apply_winner: not found' using errcode = 'P0002';
  end if;
  select * into v_cost from public.costing_component_costs where component_id = v_canvass.component_id;

  -- Writes below are the caller's own (auth.uid() is still the caller), so the band triggers judge
  -- them; the flag only tells the mark-nulling trigger this is the fill.
  perform set_config('canvass.fill', 'on', true);

  -- Acquire unit: the price as quoted, or price x comparison rate, to the centavo.
  if v_price is not null then
    v_acquire := round(case when v_offer.currency = 'PHP' then v_price else v_price * v_rate end, 2);
    if v_cost.acquire_from_offer_id is not null or v_cost.acquire_unit is null then
      perform public.costing_set_money(
        'costing_component_costs', v_canvass.component_id,
        jsonb_build_object('acquire_unit', v_acquire, 'acquire_from_offer_id', p_offer_id)
      );
      v_filled := v_filled || jsonb_build_object('acquire', true);
    end if;
  elsif v_cost.acquire_from_offer_id is not null then
    -- The figure came from an earlier winner and this one has no price: keep the figure, drop
    -- the claim that the Canvass backs it.
    perform public.costing_set_money(
      'costing_component_costs', v_canvass.component_id,
      jsonb_build_object('acquire_from_offer_id', null)
    );
  end if;

  -- Offer Specification: the Offer's description; documents: its brochure, cited.
  v_spec := nullif(btrim(coalesce(v_offer.description, '')), '') is not null
    and (v_comp.offer_specification_from_offer_id is not null
         or nullif(btrim(coalesce(v_comp.offer_specification, '')), '') is null);

  -- Citations of this Canvass's Offers are the Canvass's to replace; anything else is the user's.
  select coalesce(jsonb_agg(d), '[]'::jsonb) into v_kept
    from jsonb_array_elements(case when jsonb_typeof(v_comp.documents) = 'array' then v_comp.documents else '[]'::jsonb end) d
    where not (d ? 'offer_id' and (d ->> 'offer_id') in (
      select o.id::text from public.sor_canvass_offers o where o.canvass_id = p_canvass_id
    ));
  v_docs := v_kept || coalesce((
    select jsonb_agg(b || jsonb_build_object('offer_id', p_offer_id))
    from jsonb_array_elements(case when jsonb_typeof(v_offer.brochure) = 'array' then v_offer.brochure else '[]'::jsonb end) b
  ), '[]'::jsonb);

  if v_spec then
    update public.costing_components
       set offer_specification = btrim(v_offer.description),
           offer_specification_from_offer_id = p_offer_id
     where id = v_canvass.component_id;
    v_filled := v_filled || jsonb_build_object('offer_specification', true);
  elsif v_comp.offer_specification_from_offer_id is not null
        and nullif(btrim(coalesce(v_offer.description, '')), '') is null then
    -- Same as Acquire: the text stays, the "from Canvass" claim goes.
    update public.costing_components
       set offer_specification_from_offer_id = null
     where id = v_canvass.component_id;
  end if;

  if v_docs is distinct from v_comp.documents then
    update public.costing_components set documents = v_docs where id = v_canvass.component_id;
    v_filled := v_filled || jsonb_build_object('documents', true);
  end if;

  perform set_config('canvass.fill', 'off', true);

  return jsonb_build_object('offer_id', p_offer_id, 'filled', v_filled);
end;
$function$
;
CREATE OR REPLACE FUNCTION public.canvass_can_read(p_canvass_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce((
    select public.canvass_subject_can_read(c.component_id, c.requested_item_id)
    from public.sor_canvasses c where c.id = p_canvass_id
  ), false)
$function$
;
CREATE OR REPLACE FUNCTION public.canvass_can_write()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce(public.has_purchasing_access(), false) or coalesce(public.is_super_admin(), false)
$function$
;
CREATE OR REPLACE FUNCTION public.canvass_clear_on_offer_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_canvass uuid;
  v_reason  text;
begin
  if tg_op = 'INSERT' then
    v_canvass := new.canvass_id;
    v_reason := 'An Offer was added';
  elsif tg_op = 'DELETE' then
    v_canvass := old.canvass_id;
    v_reason := 'An Offer was removed';
  else
    v_canvass := new.canvass_id;
    -- A plain re-ordering changes nothing the approver signed.
    if (to_jsonb(new) - 'sort_order' - 'updated_at') = (to_jsonb(old) - 'sort_order' - 'updated_at') then
      return new;
    end if;
    v_reason := case when new.is_winner is distinct from old.is_winner then 'The winner changed' else 'An Offer was changed' end;
  end if;

  perform public.canvass_clear_signoff(v_canvass, v_reason);
  return coalesce(new, old);
end
$function$
;
CREATE OR REPLACE FUNCTION public.canvass_clear_on_price_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_offer   uuid;
  v_canvass uuid;
begin
  if tg_op = 'UPDATE'
     and new.unit_price is not distinct from old.unit_price
     and new.comparison_rate is not distinct from old.comparison_rate then
    return new;
  end if;

  v_offer := case when tg_op = 'DELETE' then old.offer_id else new.offer_id end;
  select canvass_id into v_canvass from public.sor_canvass_offers where id = v_offer;
  -- The Offer is gone (it was removed, or its Canvass was): the Offer's own trigger has spoken.
  if v_canvass is not null then
    perform public.canvass_clear_signoff(v_canvass, 'A price changed');
  end if;
  return coalesce(new, old);
end
$function$
;
CREATE OR REPLACE FUNCTION public.canvass_clear_on_reason_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if new.reason is distinct from old.reason then
    perform public.canvass_clear_signoff(new.id, 'The reason changed');
  end if;
  return new;
end
$function$
;
CREATE OR REPLACE FUNCTION public.canvass_clear_signoff(p_canvass_id uuid, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_signed timestamptz;
begin
  select signed_off_at into v_signed from public.sor_canvasses where id = p_canvass_id;
  -- Gone (a cascade) or not signed: nothing to clear.
  if not found or v_signed is null then
    return;
  end if;
  if nullif(btrim(coalesce(p_reason, '')), '') is null then
    raise exception 'canvass_clear_signoff: a reason is required' using errcode = '22023';
  end if;

  perform set_config('canvass.signoff', 'on', true);
  update public.sor_canvasses set signed_off_by = null, signed_off_at = null where id = p_canvass_id;
  perform set_config('canvass.signoff', 'off', true);

  insert into public.sor_canvass_signoff_events (canvass_id, kind, actor_id, reason, offer_count)
  values (
    p_canvass_id, 'cleared', public.get_employee_id(), btrim(p_reason),
    (select count(*) from public.sor_canvass_offers where canvass_id = p_canvass_id)
  );
end
$function$
;
CREATE OR REPLACE FUNCTION public.canvass_clear_winner(p_canvass_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_cleared integer;
  v_signed  timestamptz;
  v_reason  constant text := 'The winner was un-picked';
begin
  if public.get_employee_id() is null then
    raise exception 'canvass_clear_winner: sign in first' using errcode = '42501';
  end if;

  -- The same lock canvass_apply_winner takes, so a pick and an un-pick never interleave.
  perform pg_advisory_xact_lock(hashtext('canvass_winner:' || p_canvass_id::text));

  select signed_off_at into v_signed from public.sor_canvasses where id = p_canvass_id;
  if not found then
    raise exception 'canvass_clear_winner: not found' using errcode = 'P0002';
  end if;
  if not (public.canvass_can_write() and public.canvass_can_read(p_canvass_id)) then
    raise exception 'canvass_clear_winner: not allowed' using errcode = '42501';
  end if;

  if not exists (select 1 from public.sor_canvass_offers where canvass_id = p_canvass_id and is_winner) then
    return jsonb_build_object('canvass_id', p_canvass_id, 'cleared', false);
  end if;

  -- A signed Canvass is unsigned first, with this reason, which writes the history row; the
  -- winner trigger then finds it unsigned. An unsigned one gets the same row written here.
  if v_signed is not null then
    perform public.canvass_clear_signoff(p_canvass_id, v_reason);
  else
    insert into public.sor_canvass_signoff_events (canvass_id, kind, actor_id, reason, offer_count)
    values (
      p_canvass_id, 'cleared', public.get_employee_id(), v_reason,
      (select count(*) from public.sor_canvass_offers where canvass_id = p_canvass_id)
    );
  end if;

  -- The Costing Matrix keeps what the winner filled, marked, until canvass_apply_winner replaces it.
  update public.sor_canvass_offers set is_winner = false
   where canvass_id = p_canvass_id and is_winner;
  get diagnostics v_cleared = row_count;

  return jsonb_build_object('canvass_id', p_canvass_id, 'cleared', v_cleared > 0);
end;
$function$
;
CREATE OR REPLACE FUNCTION public.canvass_component_opportunity(p_component_id uuid)
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select m.opportunity_id
  from public.costing_components c
  join public.costing_tender_lines t on t.id = c.tender_line_id
  join public.costing_matrices m on m.id = t.matrix_id
  where c.id = p_component_id
$function$
;
CREATE OR REPLACE FUNCTION public.canvass_create_purchase_request(p_title text, p_items jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_actor   uuid := public.get_employee_id();
  v_entry   jsonb;
  v_id      uuid;
  v_seen    uuid[] := '{}';
  v_canvass public.sor_canvasses;
  v_winner  public.sor_canvass_offers;
  v_name    text;
  v_desc    text;
  v_qty     numeric;
  v_unit    text;
  v_req     uuid;
  v_item    uuid;
  v_made    jsonb := '[]'::jsonb;
  v_unsigned jsonb := '[]'::jsonb;
  v_price   public.sor_canvass_offer_prices;
begin
  if v_actor is null then
    raise exception 'canvass_create_purchase_request: sign in first' using errcode = '42501';
  end if;
  if not public.canvass_can_write() then
    raise exception 'canvass_create_purchase_request: only Purchasing creates a Purchase Request from Canvasses'
      using errcode = '42501';
  end if;
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'canvass_create_purchase_request: pick at least one Canvass' using errcode = '22023';
  end if;
  if jsonb_array_length(p_items) > 50 then
    raise exception 'canvass_create_purchase_request: at most 50 Canvasses at once' using errcode = '22023';
  end if;

  -- Check every Canvass first, locking it so nobody else turns it into a request meanwhile.
  for v_entry in select * from jsonb_array_elements(p_items)
  loop
    v_id := nullif(v_entry ->> 'canvass_id', '')::uuid;
    select * into v_canvass from public.sor_canvasses where id = v_id for update;
    if not found then
      raise exception 'canvass_create_purchase_request: a picked Canvass was not found' using errcode = 'P0002';
    end if;
    if v_id = any (v_seen) then
      raise exception 'canvass_create_purchase_request: % is picked twice', v_canvass.number using errcode = '22023';
    end if;
    v_seen := v_seen || v_id;
    if v_canvass.signed_off_at is null then
      v_unsigned := v_unsigned || to_jsonb(v_id);
    end if;
    if v_canvass.component_id is not null or v_canvass.requested_item_id is not null then
      raise exception 'canvass_create_purchase_request: % already belongs to a Component or a Requested Item', v_canvass.number
        using errcode = '55000';
    end if;
    if not exists (select 1 from public.sor_canvass_offers o where o.canvass_id = v_id and o.is_winner) then
      raise exception 'canvass_create_purchase_request: % has no winner yet', v_canvass.number using errcode = '22023';
    end if;
  end loop;

  for v_entry in select * from jsonb_array_elements(p_items)
  loop
    v_id := (v_entry ->> 'canvass_id')::uuid;
    select * into v_canvass from public.sor_canvasses where id = v_id;
    select * into v_winner from public.sor_canvass_offers where canvass_id = v_id and is_winner;

    v_name := coalesce(
      nullif(btrim(coalesce(v_canvass.product_name, '')), ''),
      nullif(btrim(coalesce(v_winner.brand, '')), ''),
      v_canvass.number
    );
    v_desc := nullif(concat_ws(E'\n',
      nullif(concat_ws(' · ',
        nullif(btrim(coalesce(v_winner.supplier_name, '')), ''),
        nullif(btrim(coalesce(v_winner.brand, '')), '')
      ), ''),
      nullif(btrim(coalesce(v_winner.description, '')), ''),
      'From Canvass ' || v_canvass.number
    ), '');
    v_qty := coalesce(nullif(v_entry ->> 'quantity', '')::numeric, 1);
    v_unit := nullif(btrim(coalesce(v_entry ->> 'unit', '')), '');

    if v_req is null then
      v_req := public.purchase_request_open(
        p_title,
        jsonb_build_array(jsonb_build_object('name', v_name, 'quantity', v_qty, 'unit', v_unit, 'description', v_desc))
      );
      select i.id into v_item from public.purchase_request_items i where i.request_id = v_req;
    else
      v_item := public.purchase_request_add_new_item(v_req, v_name, v_qty, v_unit, v_desc, '[]'::jsonb);
    end if;

    -- The Canvass re-points at the item it became, keeping its number, Offers and reason.
    -- The winner's price goes on the item, in the money table only Purchasing, Finance and
    -- Super Admin can read (#582). A winner with no price writes nothing.
    select * into v_price from public.sor_canvass_offer_prices where offer_id = v_winner.id;
    if found and v_price.unit_price is not null then
      insert into public.purchase_request_item_prices (item_id, unit_price, currency, comparison_rate)
      values (v_item, v_price.unit_price, v_winner.currency, v_price.comparison_rate)
      on conflict (item_id) do update
        set unit_price = excluded.unit_price, currency = excluded.currency,
            comparison_rate = excluded.comparison_rate, updated_at = now();
    end if;

    update public.sor_canvasses set requested_item_id = v_item where id = v_id;
    v_made := v_made || jsonb_build_array(jsonb_build_object('canvass_id', v_id, 'item_id', v_item));
  end loop;

  return jsonb_build_object('request_id', v_req, 'items', v_made, 'unsigned_canvass_ids', v_unsigned);
end;
$function$
;
CREATE OR REPLACE FUNCTION public.canvass_is_ready(p_canvass_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1 from public.sor_canvasses c
    where c.id = p_canvass_id
      and c.signed_off_at is null
      and nullif(btrim(coalesce(c.reason, '')), '') is not null
      and exists (select 1 from public.sor_canvass_offers o where o.canvass_id = c.id and o.is_winner)
  )
$function$
;
CREATE OR REPLACE FUNCTION public.canvass_list()
 RETURNS TABLE(id uuid, number text, kind text, product_name text, subject_name text, component_id uuid, component_number text, requested_item_id uuid, request_id uuid, request_label text, opportunity_id uuid, sales_reference text, project_title text, canvasser_id uuid, canvasser_name text, offer_count integer, winner_offer_id uuid, winner_supplier text, winner_brand text, signed_off_at timestamp with time zone, signer_name text, created_by uuid, created_at timestamp with time zone, updated_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select c.id,
         c.number,
         case when c.component_id is not null then 'component'
              when c.requested_item_id is not null then 'requested_item'
              else 'none' end,
         c.product_name,
         coalesce(comp.name, item.name, c.product_name),
         c.component_id,
         case when comp.id is not null then
           (select count(*) from public.costing_tender_lines t2
             where t2.matrix_id = t.matrix_id and t2.position <= t.position)::text
           || '.' ||
           (select count(*) from public.costing_components c2
             where c2.tender_line_id = comp.tender_line_id and c2.position <= comp.position)::text
         end,
         c.requested_item_id,
         req.id,
         case when req.id is not null then public._purchase_request_label(req.id) end,
         opp.id,
         opp.sales_reference,
         opp.project_title,
         coalesce(c.canvasser_id, comp.purchasing_incharge_id, m.purchasing_incharge_id, req.buyer_id),
         canvasser.name,
         (select count(*)::integer from public.sor_canvass_offers o where o.canvass_id = c.id),
         w.id,
         w.supplier_name,
         w.brand,
         c.signed_off_at,
         signer.name,
         c.created_by,
         c.created_at,
         c.updated_at
    from public.sor_canvasses c
    left join public.costing_components comp on comp.id = c.component_id
    left join public.costing_tender_lines t on t.id = comp.tender_line_id
    left join public.costing_matrices m on m.id = t.matrix_id
    left join public.purchase_request_items item on item.id = c.requested_item_id
    left join public.purchase_requests req on req.id = item.request_id
    left join public.sales_opportunities opp on opp.id = coalesce(m.opportunity_id, req.opportunity_id)
    left join public.sor_canvass_offers w on w.canvass_id = c.id and w.is_winner
    left join public.employees canvasser
      on canvasser.id = coalesce(c.canvasser_id, comp.purchasing_incharge_id, m.purchasing_incharge_id, req.buyer_id)
    left join public.employees signer on signer.id = c.signed_off_by
   where public.canvass_can_read(c.id)
   order by c.created_at desc, c.id
$function$
;
CREATE OR REPLACE FUNCTION public.canvass_null_fill_mark()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  if coalesce(current_setting('canvass.fill', true), '') = 'on' then
    return new;
  end if;
  if tg_table_name = 'costing_components' then
    if new.offer_specification is distinct from old.offer_specification then
      new.offer_specification_from_offer_id := null;
    end if;
  elsif new.acquire_unit is distinct from old.acquire_unit then
    new.acquire_from_offer_id := null;
  end if;
  return new;
end
$function$
;
CREATE OR REPLACE FUNCTION public.canvass_offer_can_read_money(p_offer_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce((
    select public.canvass_subject_can_read_money(c.component_id, c.requested_item_id)
    from public.sor_canvass_offers o
    join public.sor_canvasses c on c.id = o.canvass_id
    where o.id = p_offer_id
  ), false)
$function$
;
CREATE OR REPLACE FUNCTION public.canvass_offer_projection(p_canvass_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_component uuid;
  v_factor    numeric;
  v_result    jsonb;
begin
  select c.component_id into v_component from public.sor_canvasses c where c.id = p_canvass_id;
  if v_component is null then
    return null;
  end if;

  if coalesce(public.costing_tier(public.canvass_component_opportunity(v_component)), '') not in ('closed_book', 'cost') then
    return null;
  end if;

  select k.markup_factor into v_factor from public.costing_component_costs k where k.component_id = v_component;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'offer_id', o.id,
      'acquire_unit', a.acquire,
      'markup_price_unit', public.costing_component_markup_price(v_component, a.acquire, v_factor)
    ) order by o.sort_order, o.created_at
  ), '[]'::jsonb)
  into v_result
  from public.sor_canvass_offers o
  left join public.sor_canvass_offer_prices p on p.offer_id = o.id
  cross join lateral (
    select case
      when p.unit_price is null then null
      when o.currency = 'PHP' then round(p.unit_price, 2)
      when p.comparison_rate is null then null
      else round(p.unit_price * p.comparison_rate, 2)
    end as acquire
  ) a
  where o.canvass_id = p_canvass_id;

  return v_result;
end
$function$
;
CREATE OR REPLACE FUNCTION public.canvass_pending_signoffs()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce(jsonb_agg(row_to_json(q)::jsonb order by q.waiting_since, q.canvass_id), '[]'::jsonb)
  from (
    select c.id as canvass_id,
           c.number,
           c.component_id,
           c.requested_item_id,
           c.reason,
           c.created_by as creator_id,
           creator.name as creator_name,
           coalesce(comp.name, item.name, c.product_name) as subject_name,
           opp.id as opportunity_id,
           opp.project_title,
           opp.client_name,
           (select count(*) from public.sor_canvass_offers o where o.canvass_id = c.id) as offer_count,
           w.brand as winner_brand,
           w.supplier_name as winner_supplier,
           coalesce(
             greatest(c.updated_at, (select max(o.updated_at) from public.sor_canvass_offers o where o.canvass_id = c.id)),
             c.created_at
           ) as waiting_since
    from public.sor_canvasses c
    join public.sor_canvass_offers w on w.canvass_id = c.id and w.is_winner
    left join public.employees creator on creator.id = c.created_by
    left join public.costing_components comp on comp.id = c.component_id
    left join public.purchase_request_items item on item.id = c.requested_item_id
    left join public.purchase_requests req on req.id = item.request_id
    left join public.sales_opportunities opp
      on opp.id = case when c.component_id is not null then public.canvass_component_opportunity(c.component_id) else req.opportunity_id end
    where public.transmittal_on_list('transmittal_check_by')
      and c.signed_off_at is null
      and nullif(btrim(coalesce(c.reason, '')), '') is not null
      and c.created_by is distinct from public.get_employee_id()
  ) q
$function$
;
CREATE OR REPLACE FUNCTION public.canvass_po_suppliers(p_opportunity_id uuid)
 RETURNS TABLE(component_id uuid, po_number text, supplier_id text, supplier_name text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select
    c.id,
    i.po_number,
    nullif(btrim(i.odoo_copy #>> '{supplier,id}'), ''),
    nullif(btrim(i.odoo_copy #>> '{supplier,name}'), '')
  from public.costing_matrices m
  join public.costing_tender_lines l on l.matrix_id = m.id
  join public.costing_components c on c.tender_line_id = l.id
  join public.ipas i on i.po_number = upper(btrim(c.po_rfq_no)) and i.state <> 'cancelled'
  where m.opportunity_id = p_opportunity_id
    and public.costing_can_read(p_opportunity_id)
    and c.po_rfq_no is not null
$function$
;
CREATE OR REPLACE FUNCTION public.canvass_sign(p_canvass_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_actor   uuid := public.get_employee_id();
  v_canvass public.sor_canvasses;
  v_count   integer;
  v_at      timestamptz := now();
begin
  if v_actor is null then
    raise exception 'canvass_sign: sign in first' using errcode = '42501';
  end if;
  if not public.transmittal_on_list('transmittal_check_by') then
    raise exception 'canvass_sign: only the purchasing approver list can sign a Canvass' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtext('canvass_signoff:' || p_canvass_id::text));

  select * into v_canvass from public.sor_canvasses where id = p_canvass_id;
  if not found then
    raise exception 'canvass_sign: not found' using errcode = 'P0002';
  end if;
  if v_canvass.created_by is not distinct from v_actor then
    raise exception 'canvass_sign: you can''t sign a Canvass you opened' using errcode = '42501';
  end if;
  if v_canvass.signed_off_at is not null then
    raise exception 'canvass_sign: already signed' using errcode = '55000';
  end if;
  if not exists (select 1 from public.sor_canvass_offers where canvass_id = p_canvass_id and is_winner) then
    raise exception 'canvass_sign: pick a winner first' using errcode = '22023';
  end if;
  if nullif(btrim(coalesce(v_canvass.reason, '')), '') is null then
    raise exception 'canvass_sign: give the reason for the winner first' using errcode = '22023';
  end if;

  select count(*) into v_count from public.sor_canvass_offers where canvass_id = p_canvass_id;

  perform set_config('canvass.signoff', 'on', true);
  update public.sor_canvasses set signed_off_by = v_actor, signed_off_at = v_at where id = p_canvass_id;
  perform set_config('canvass.signoff', 'off', true);

  insert into public.sor_canvass_signoff_events (canvass_id, kind, actor_id, reason, offer_count, created_at)
  values (p_canvass_id, 'signed', v_actor, btrim(v_canvass.reason), v_count, v_at);

  return jsonb_build_object('canvass_id', p_canvass_id, 'number', v_canvass.number, 'signed_off_at', v_at, 'offer_count', v_count);
end
$function$
;
CREATE OR REPLACE FUNCTION public.canvass_signoff_audience(p_canvass_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_number text;
  v_creator uuid;
begin
  if not public.canvass_can_read(p_canvass_id) or not public.canvass_is_ready(p_canvass_id) then
    return jsonb_build_object('ready', false, 'number', null, 'notify_ids', '[]'::jsonb);
  end if;

  select number, created_by into v_number, v_creator from public.sor_canvasses where id = p_canvass_id;

  return jsonb_build_object(
    'ready', true,
    'number', v_number,
    'notify_ids', coalesce((
      select jsonb_agg(l.employee_id)
        from public.ipas_signer_lists l
        join public.employees e on e.id = l.employee_id
       where l.list_key = 'transmittal_check_by'
         and not coalesce(e.is_deleted, false)
         and l.employee_id is distinct from v_creator
    ), '[]'::jsonb)
  );
end
$function$
;
CREATE OR REPLACE FUNCTION public.canvass_start(p_component_id uuid, p_requested_item_id uuid, p_product_name text, p_offer jsonb, p_price jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_id    uuid;
  v_name  text := nullif(btrim(coalesce(p_product_name, '')), '');
  v_offer jsonb;
begin
  if p_component_id is not null and p_requested_item_id is not null then
    raise exception 'canvass_start: a Canvass is on one Component or one Requested Item, never both'
      using errcode = '22023';
  end if;
  if p_component_id is null and p_requested_item_id is null and v_name is null then
    raise exception 'canvass_start: say what is being bought' using errcode = '22023';
  end if;

  if p_component_id is not null or p_requested_item_id is not null then
    select c.id into v_id from public.sor_canvasses c
     where (p_component_id is not null and c.component_id = p_component_id)
        or (p_requested_item_id is not null and c.requested_item_id = p_requested_item_id);
  end if;

  if v_id is null then
    begin
      insert into public.sor_canvasses (component_id, requested_item_id, product_name, created_by)
      values (p_component_id, p_requested_item_id, v_name, public.get_employee_id())
      returning id into v_id;
    exception when unique_violation then
      select c.id into v_id from public.sor_canvasses c
       where (p_component_id is not null and c.component_id = p_component_id)
          or (p_requested_item_id is not null and c.requested_item_id = p_requested_item_id);
      if v_id is null then
        raise;
      end if;
    end;
  end if;

  v_offer := public.canvass_add_offer(v_id, p_offer, p_price);

  return jsonb_build_object(
    'canvass_id', v_id,
    'number', (select c.number from public.sor_canvasses c where c.id = v_id),
    'offer', v_offer
  );
end;
$function$
;
CREATE OR REPLACE FUNCTION public.canvass_subject_can_read(p_component_id uuid, p_requested_item_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select case
    when p_component_id is not null then
      coalesce(public.costing_can_read(public.canvass_component_opportunity(p_component_id)), false)
    when p_requested_item_id is not null then
      exists (
        select 1 from public.purchase_request_items i
        where i.id = p_requested_item_id and public.can_read_purchase_request(i.request_id)
      )
    else
      coalesce(public.has_purchasing_access(), false) or coalesce(public.is_super_admin(), false)
  end
$function$
;
CREATE OR REPLACE FUNCTION public.canvass_subject_can_read_money(p_component_id uuid, p_requested_item_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select case
    when p_component_id is not null then
      coalesce(public.costing_can_read_cost(public.canvass_component_opportunity(p_component_id)), false)
    when p_requested_item_id is not null then
      public.canvass_subject_can_read(null, p_requested_item_id)
      and (
        coalesce(public.has_purchasing_access(), false)
        or coalesce(public.has_finance_access(), false)
        or coalesce(public.is_super_admin(), false)
      )
    else
      coalesce(public.has_purchasing_access(), false) or coalesce(public.is_super_admin(), false)
  end
$function$
;
CREATE OR REPLACE FUNCTION public.clear_issued_password_flag()
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  update public.employees
  set is_issued_password = false
  where email = auth.jwt() ->> 'email';
$function$
;
CREATE OR REPLACE FUNCTION public.close_stage_participant_windows()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_is_terminal boolean;
begin
  if NEW.flow_stage_id is not distinct from OLD.flow_stage_id then
    return NEW;
  end if;

  select is_terminal into v_is_terminal from public.flow_stages where id = NEW.flow_stage_id;

  if v_is_terminal then
    update public.sor_stage_participants
      set closed_at = now(), closed_reason = 'terminal'
      where opportunity_id = NEW.id and closed_at is null;
    return NEW;
  end if;

  update public.sor_stage_participants p
    set closed_at = now(), closed_reason = 'rule_met'
    from public.sor_stage_visits v
    where p.opportunity_id = NEW.id
      and p.closed_at is null
      and p.opened_visit_id = v.id
      and (
        (p.until_rule = 'stage_left' and v.flow_stage_id = OLD.flow_stage_id)
        or (p.until_rule = 'stage_entered' and p.until_stage_id = NEW.flow_stage_id)
        or (p.until_rule = 'later_stage_left' and p.until_stage_id = OLD.flow_stage_id)
      );

  return NEW;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.committee_task_visible(p_task_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1 from public.committee_tasks ct
    where ct.id = p_task_id
      and (
        ct.created_by = public.get_employee_id()
        or public.is_super_admin()
        or exists (
          select 1 from public.committee_task_members ctm
          where ctm.committee_task_id = ct.id
            and ctm.employee_id = public.get_employee_id()
        )
      )
  )
$function$
;
CREATE OR REPLACE FUNCTION public.costing_accept_brand(p_component_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_opp   uuid;
  v_brand text;
begin
  if public.get_employee_id() is null then
    raise exception 'costing_accept_brand: sign in first' using errcode = '42501';
  end if;

  v_opp := public.canvass_component_opportunity(p_component_id);
  if v_opp is null then
    raise exception 'costing_accept_brand: not found' using errcode = '22023';
  end if;
  if not (public.costing_can_read(v_opp) and public.costing_in_band(v_opp, 'sales')) then
    raise exception 'costing_accept_brand: only the Deal Team can accept a brand' using errcode = '42501';
  end if;

  select nullif(btrim(coalesce(o.brand, '')), '') into v_brand
    from public.sor_canvasses c
    join public.sor_canvass_offers o on o.canvass_id = c.id and o.is_winner
   where c.component_id = p_component_id;
  if v_brand is null then
    raise exception 'costing_accept_brand: the Canvass has no winning brand' using errcode = '22023';
  end if;

  -- As the caller, so the Sales band trigger judges the write too.
  update public.costing_components set brand = v_brand where id = p_component_id;

  return jsonb_build_object('brand', v_brand);
end;
$function$
;
CREATE OR REPLACE FUNCTION public.costing_add_cost_row(p_matrix_id uuid, p_description text DEFAULT ''::text, p_quantity numeric DEFAULT 1)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_opp uuid := public.costing_matrix_opp(p_matrix_id);
  v_id  uuid;
begin
  if v_opp is null then
    raise exception 'costing_add_cost_row: not found' using errcode = '22023';
  end if;
  if not public.costing_can_read(v_opp) then
    raise exception 'costing_add_cost_row: not allowed' using errcode = '42501';
  end if;
  insert into public.costing_cost_rows (matrix_id, position, description, quantity)
  values (
    p_matrix_id,
    coalesce((select max(r.position) from public.costing_cost_rows r where r.matrix_id = p_matrix_id), 0) + 1,
    coalesce(p_description, ''),
    coalesce(p_quantity, 1)
  )
  returning id into v_id;
  return v_id;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.costing_bid_decisions_clear()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_reason text := tg_argv[0];
  v_column text := coalesce(tg_argv[1], '');
  v_old    jsonb := case when tg_op = 'INSERT' then null else to_jsonb(old) end;
  v_new    jsonb := case when tg_op = 'DELETE' then null else to_jsonb(new) end;
  v_row    jsonb := coalesce(v_new, v_old);
  v_matrix uuid;
begin
  if v_column <> '' then
    if tg_op = 'INSERT' and (v_new -> v_column) is null then
      return null;
    elsif tg_op = 'DELETE' and (v_old -> v_column) is null then
      return null;
    elsif tg_op = 'UPDATE' and (v_new -> v_column) is not distinct from (v_old -> v_column) then
      return null;
    end if;
    if tg_op = 'INSERT' and (v_new -> v_column) = 'null'::jsonb then
      return null;
    elsif tg_op = 'DELETE' and (v_old -> v_column) = 'null'::jsonb then
      return null;
    end if;
  end if;

  v_matrix := public.costing_matrix_of(tg_table_name, v_row);
  -- The matrix is going (an SOR cascade): nothing left to clear.
  if v_matrix is null or not exists (select 1 from public.costing_matrices where id = v_matrix) then
    return null;
  end if;

  update public.costing_bid_decisions
     set cleared_at = now(), cleared_reason = v_reason
   where matrix_id = v_matrix and cleared_at is null;
  return null;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.costing_bid_totals(p_matrix_id uuid)
 RETURNS TABLE(final_offer_total numeric, abc_total numeric, line_count integer, missing_offer integer, missing_abc integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select
    case when count(*) > 0 and count(*) filter (where p.final_offer_unit is null) = 0
         then sum(round(p.final_offer_unit * l.quantity, 2)) end,
    case when count(*) > 0 and count(*) filter (where p.abc_unit is null) = 0
         then sum(round(p.abc_unit * l.quantity, 2)) end,
    count(*)::integer,
    (count(*) filter (where p.final_offer_unit is null))::integer,
    (count(*) filter (where p.abc_unit is null))::integer
  from public.costing_tender_lines l
  left join public.costing_tender_line_prices p on p.tender_line_id = l.id
  where l.matrix_id = p_matrix_id
$function$
;
CREATE OR REPLACE FUNCTION public.costing_bundle_keeps_inclusions()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if old.is_bundle and not new.is_bundle
     and exists (select 1 from public.costing_inclusions i where i.component_id = new.id) then
    raise exception 'costing_inclusion: move or remove this Component''s Inclusions before it stops being a bundle'
      using errcode = '22023';
  end if;
  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.costing_can_manage_markup()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce(public.is_super_admin(), false) or public.costing_on_list('final_acquire')
$function$
;
CREATE OR REPLACE FUNCTION public.costing_can_read(p_opportunity_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select public.costing_tier(p_opportunity_id) is not null
$function$
;
CREATE OR REPLACE FUNCTION public.costing_can_read_cost(p_opportunity_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce(public.costing_tier(p_opportunity_id) in ('closed_book', 'cost'), false)
$function$
;
CREATE OR REPLACE FUNCTION public.costing_can_read_money(p_opportunity_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce(public.costing_tier(p_opportunity_id) in ('closed_book', 'cost', 'price'), false)
$function$
;
CREATE OR REPLACE FUNCTION public.costing_check_incharge()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_opp uuid;
  v_sor public.sales_opportunities;
begin
  -- A new matrix is not there to look up yet; it names its SOR itself.
  v_opp := case
    when tg_table_name = 'costing_matrices' then (to_jsonb(new) ->> 'opportunity_id')::uuid
    else public.costing_matrix_opp(public.costing_matrix_of(tg_table_name, to_jsonb(new)))
  end;
  if v_opp is null then
    return new;
  end if;
  -- costing_open_matrix inserts "on conflict do nothing": a row that is about to be
  -- dropped for the matrix the SOR already has is not judged.
  if tg_op = 'INSERT' and tg_table_name = 'costing_matrices'
     and exists (select 1 from public.costing_matrices m where m.opportunity_id = v_opp) then
    return new;
  end if;
  select * into v_sor from public.sales_opportunities where id = v_opp;

  if new.sales_incharge_id is not null
     and (tg_op = 'INSERT' or new.sales_incharge_id is distinct from old.sales_incharge_id)
     and not coalesce(public.sor_is_deal_team(v_sor, new.sales_incharge_id), false) then
    raise exception 'costing_incharge: the Sales incharge must be on the SOR''s Deal Team'
      using errcode = '22023';
  end if;

  if new.purchasing_incharge_id is not null
     and (tg_op = 'INSERT' or new.purchasing_incharge_id is distinct from old.purchasing_incharge_id)
     and not public._employee_has_purchasing_access(new.purchasing_incharge_id) then
    raise exception 'costing_incharge: the Purchasing incharge must have Purchasing access'
      using errcode = '22023';
  end if;
  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.costing_clear_evaluation_approval()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_old    jsonb := case when tg_op = 'INSERT' then null else to_jsonb(old) end;
  v_new    jsonb := case when tg_op = 'DELETE' then null else to_jsonb(new) end;
  v_matrix uuid;
  v_reason text;
begin
  if tg_op = 'UPDATE' then
    if tg_table_name = 'costing_tender_lines' then
      if (v_new -> 'tender_specification') is not distinct from (v_old -> 'tender_specification') then
        return null;
      end if;
      v_reason := 'A Tender Specification changed';
    elsif (v_new -> 'offer_specification') is distinct from (v_old -> 'offer_specification') then
      v_reason := 'An Offer Specification changed';
    elsif (v_new -> 'compliance') is distinct from (v_old -> 'compliance') then
      v_reason := 'A Compliance verdict changed';
    elsif (v_new -> 'compliance_note') is distinct from (v_old -> 'compliance_note') then
      v_reason := 'A Compliance note changed';
    else
      return null;
    end if;
  elsif tg_table_name = 'costing_tender_lines' then
    v_reason := case tg_op when 'INSERT' then 'A Tender Line was added' else 'A Tender Line was removed' end;
  else
    v_reason := case tg_op when 'INSERT' then 'A Component was added' else 'A Component was removed' end;
  end if;

  v_matrix := public.costing_matrix_of(tg_table_name, coalesce(v_new, v_old));
  if v_matrix is not null then
    perform public.costing_clear_signoffs(v_matrix, array['evaluation_approved'], v_reason);
  end if;
  return null;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.costing_clear_print_signoffs()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_roles  text[] := string_to_array(tg_argv[0], ',');
  v_reason text := tg_argv[1];
  v_column text := coalesce(tg_argv[2], '');
  v_old    jsonb := case when tg_op = 'INSERT' then null else to_jsonb(old) end;
  v_new    jsonb := case when tg_op = 'DELETE' then null else to_jsonb(new) end;
  v_matrix uuid;
begin
  if v_column <> '' then
    if tg_op = 'INSERT' and coalesce(v_new -> v_column, 'null'::jsonb) = 'null'::jsonb then
      return null;
    elsif tg_op = 'DELETE' and coalesce(v_old -> v_column, 'null'::jsonb) = 'null'::jsonb then
      return null;
    elsif tg_op = 'UPDATE' and (v_new -> v_column) is not distinct from (v_old -> v_column) then
      return null;
    end if;
  end if;

  v_matrix := public.costing_matrix_of(tg_table_name, coalesce(v_new, v_old));
  -- The matrix is going (an SOR cascade): nothing left to clear.
  if v_matrix is null or not exists (select 1 from public.costing_matrices where id = v_matrix) then
    return null;
  end if;

  perform public.costing_clear_signoffs(v_matrix, v_roles, v_reason);
  return null;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.costing_clear_signoffs(p_matrix_id uuid, p_roles text[], p_reason text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_count integer;
begin
  if nullif(btrim(coalesce(p_reason, '')), '') is null then
    raise exception 'costing_clear_signoffs: a reason is needed' using errcode = '22023';
  end if;
  -- The matrix is going (an SOR cascade): nothing left to clear.
  if not exists (select 1 from public.costing_matrices where id = p_matrix_id) then
    return 0;
  end if;
  update public.costing_signoffs
     set cleared_at = now(), cleared_reason = btrim(p_reason)
   where matrix_id = p_matrix_id
     and role = any (p_roles)
     and cleared_at is null;
  get diagnostics v_count = row_count;
  return v_count;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.costing_column_default(p_table regclass, p_column text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_expr text;
  v_val  jsonb;
begin
  select pg_get_expr(d.adbin, d.adrelid) into v_expr
  from pg_attrdef d
  join pg_attribute a on a.attrelid = d.adrelid and a.attnum = d.adnum
  where d.adrelid = p_table and a.attname = p_column;
  if v_expr is null then
    return null;
  end if;
  execute format('select to_jsonb(%s)', v_expr) into v_val;
  return v_val;
exception when others then
  return null;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.costing_component_delete_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_link text;
begin
  if pg_trigger_depth() > 1 then
    return old;
  end if;
  v_link := public._costing_component_link(old.id, old.po_rfq_no);
  if v_link is not null then
    raise exception 'This Component is linked to %. Unlink it before deleting.', v_link
      using errcode = '22023', hint = 'costing_component_linked';
  end if;
  return old;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.costing_component_markup_price(p_component_id uuid, p_acquire numeric, p_factor numeric)
 RETURNS numeric
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select public.costing_markup_price(
    p_acquire,
    coalesce(p_factor, public.costing_default_factor(
      public.costing_matrix_of('costing_component_costs', jsonb_build_object('component_id', p_component_id))
    ))
  )
$function$
;
CREATE OR REPLACE FUNCTION public.costing_component_purchases(p_opportunity_id uuid)
 RETURNS TABLE(component_id uuid, po_rfq_no text, ordered_quantity numeric, requests jsonb, ipas jsonb)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with comps as (
    select c.id, nullif(btrim(c.po_rfq_no), '') as po_rfq_no
    from public.costing_components c
    join public.costing_tender_lines t on t.id = c.tender_line_id
    join public.costing_matrices m on m.id = t.matrix_id
    where m.opportunity_id = p_opportunity_id
      and public.costing_can_read(p_opportunity_id)
  )
  select
    comps.id,
    comps.po_rfq_no,
    (select coalesce(sum(pri.quantity), 0) from public.purchase_request_items pri
      where pri.component_id = comps.id and pri.status in ('ordered', 'received')),
    coalesce((
      select jsonb_agg(jsonb_build_object('item_id', pri.id, 'request_id', pri.request_id, 'name', pri.name, 'po_number', nullif(btrim(pri.po_number), ''), 'status', pri.status, 'odoo_po_line_ids', coalesce(to_jsonb(pri.odoo_po_line_ids), '[]'::jsonb))
        order by pri.created_at)
      from public.purchase_request_items pri
      where pri.component_id = comps.id
    ), '[]'::jsonb),
    coalesce((
      select jsonb_agg(jsonb_build_object('po_number', po.po_number, 'ipas_id', ip.id, 'number', ip.number, 'state', ip.state)
        order by po.po_number)
      from (
        select distinct p.po_number from (
          select nullif(btrim(pri.po_number), '') as po_number
          from public.purchase_request_items pri
          where pri.component_id = comps.id and pri.status <> 'cancelled'
          union select comps.po_rfq_no
        ) p
        where p.po_number is not null
      ) po
      left join public.ipas ip on ip.id = public._lc_ipas_for_po(po.po_number)
    ), '[]'::jsonb)
  from comps
$function$
;
CREATE OR REPLACE FUNCTION public.costing_component_requests(p_opportunity_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_matrix uuid;
begin
  if not public.costing_can_read(p_opportunity_id) then
    return null;
  end if;
  select id into v_matrix from public.costing_matrices where opportunity_id = p_opportunity_id;
  if v_matrix is null then
    return '[]'::jsonb;
  end if;

  return (
    select coalesce(
      jsonb_agg(
        jsonb_build_object('id', i.id, 'component_id', i.component_id, 'status', i.status, 'request_id', i.request_id)
        order by i.created_at, i.id
      ),
      '[]'::jsonb
    )
    from public.purchase_request_items i
    where i.component_id in (
      select c.id
      from public.costing_components c
      join public.costing_tender_lines l on l.id = c.tender_line_id
      where l.matrix_id = v_matrix
    )
  );
end;
$function$
;
CREATE OR REPLACE FUNCTION public.costing_components_cleanup()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  delete from public.costing_inclusions where component_id = old.id;
  delete from public.costing_component_costs where component_id = old.id;
  return old;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.costing_condition_inputs(p_opportunity_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_matrix      uuid;
  v_incharge    uuid;
  v_totals      record;
  v_costed      integer;
  v_missing     integer;
  v_components  integer;
  v_no_acquire  integer;
  v_tier        text;
  v_priced      jsonb;
  v_settled     boolean;
begin
  if public.get_employee_id() is null then
    raise exception 'costing_condition_inputs: sign in first' using errcode = '42501';
  end if;
  if public.sor_access_level(p_opportunity_id) = 'none' then
    raise exception 'costing_condition_inputs: you can''t see this SOR' using errcode = '42501';
  end if;

  select m.id, m.purchasing_incharge_id into v_matrix, v_incharge
    from public.costing_matrices m where m.opportunity_id = p_opportunity_id;
  if v_matrix is null then
    return jsonb_build_object('has_matrix', false);
  end if;

  select * into v_totals from public.costing_bid_totals(v_matrix);

  select count(*),
         count(*) filter (where cc.final_acquire_unit is null),
         count(*) filter (where cc.acquire_unit is null)
    into v_components, v_missing, v_no_acquire
    from public.costing_components c
    join public.costing_tender_lines l on l.id = c.tender_line_id
    left join public.costing_component_costs cc on cc.component_id = c.id
   where l.matrix_id = v_matrix;

  v_costed := v_components + (select count(*) from public.costing_cost_rows r where r.matrix_id = v_matrix);
  v_missing := v_missing + (select count(*) from public.costing_cost_rows r
                             where r.matrix_id = v_matrix and r.final_acquire_unit is null);
  v_no_acquire := v_no_acquire + (select count(*) from public.costing_cost_rows r
                                   where r.matrix_id = v_matrix and r.acquire_unit is null);

  v_settled := public.costing_settled_met(v_matrix);
  v_priced := jsonb_build_object(
    'component_count', v_components,
    'missing_acquire', v_no_acquire,
    'has_purchasing_incharge', v_incharge is not null
  );

  v_tier := public.costing_tier(p_opportunity_id);
  if v_tier in ('price', 'closed_book') then
    return jsonb_build_object(
      'has_matrix', true,
      'settled_met', v_settled,
      'line_count', v_totals.line_count,
      'missing_offer', v_totals.missing_offer,
      'over_abc', coalesce(v_totals.final_offer_total > v_totals.abc_total, false),
      'costed_rows', v_costed,
      'missing_cost', v_missing,
      'evaluation_approved', exists (
        select 1 from public.costing_signoffs s
         where s.matrix_id = v_matrix and s.role = 'evaluation_approved' and s.cleared_at is null),
      'bid_verdict', (select d.verdict from public.costing_bid_decisions d
                       where d.matrix_id = v_matrix and d.cleared_at is null)
    ) || v_priced;
  end if;

  return jsonb_build_object('has_matrix', true, 'settled_met', v_settled) || v_priced;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.costing_decide_bid(p_matrix_id uuid, p_verdict text, p_reason text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_actor  uuid := public.get_employee_id();
  v_opp    uuid := public.costing_matrix_opp(p_matrix_id);
  v_totals record;
  v_id     uuid;
  v_title  text;
  v_label  text;
  v_member record;
begin
  if v_actor is null then
    raise exception 'costing_bid: sign in first' using errcode = '42501';
  end if;
  if v_opp is null then
    raise exception 'costing_bid: matrix not found' using errcode = '22023';
  end if;
  if public.costing_tier(v_opp) is distinct from 'closed_book' then
    raise exception 'costing_bid: only a Super Admin or the Final Acquire list can decide a bid' using errcode = '42501';
  end if;
  if p_verdict is null or p_verdict not in ('go', 'no_go', 'revise') then
    raise exception 'costing_bid: the verdict must be Go, No-go or Revise' using errcode = '22023';
  end if;
  if p_reason is null or length(btrim(p_reason)) = 0 then
    raise exception 'costing_bid: write the reason for the decision' using errcode = '22023';
  end if;

  -- One decision at a time per matrix (ADR 0013).
  perform 1 from public.costing_matrices where id = p_matrix_id for update;

  select * into v_totals from public.costing_bid_totals(p_matrix_id);
  if v_totals.line_count = 0 or v_totals.missing_offer > 0 then
    raise exception 'costing_bid: every Tender Line needs a Final Offer before the bid can be decided' using errcode = '22023';
  end if;

  update public.costing_bid_decisions
     set cleared_at = now(), cleared_reason = 'Decided again'
   where matrix_id = p_matrix_id and cleared_at is null;

  insert into public.costing_bid_decisions (matrix_id, verdict, reason, decided_by, final_offer_total, abc_total)
  values (p_matrix_id, p_verdict, btrim(p_reason), v_actor, v_totals.final_offer_total, v_totals.abc_total)
  returning id into v_id;

  if p_verdict in ('no_go', 'revise') then
    select o.project_title into v_title from public.sales_opportunities o where o.id = v_opp;
    v_label := case p_verdict when 'no_go' then 'No-go' else 'Revise' end;
    -- The Deal Team, once each, never the decider. The message carries the verdict and the
    -- reason, and no figure: Sales never reads the numbers a decision was taken against.
    for v_member in
      select distinct t.employee_id
      from public.sales_opportunities o
      cross join lateral public._sor_deal_team_roles(o) t
      join public.employees e on e.id = t.employee_id
      where o.id = v_opp
        and t.employee_id <> v_actor
        and not coalesce(e.is_deleted, false)
    loop
      insert into public.notifications (recipient_id, sender_id, type, title, message, reference_id)
      values (
        v_member.employee_id,
        v_actor,
        'SOR_BID_DECISION',
        format('Bid decision: %s', v_label),
        format('The bid on "%s" is %s: %s', coalesce(v_title, 'this deal'), v_label, btrim(p_reason)),
        v_opp::text
      );
    end loop;
  end if;

  return v_id;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.costing_default_factor(p_matrix_id uuid)
 RETURNS numeric
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select m.default_factor from public.costing_matrix_money m where m.matrix_id = p_matrix_id
$function$
;
CREATE OR REPLACE FUNCTION public.costing_enforce_bands()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_old    jsonb := case when tg_op = 'INSERT' then null else to_jsonb(old) end;
  v_new    jsonb := case when tg_op = 'DELETE' then null else to_jsonb(new) end;
  v_matrix uuid;
  v_opp    uuid;
  v_band   record;
  v_needed boolean;
  v_ok     boolean;
  b        text;
begin
  if auth.uid() is null
     or coalesce(auth.role(), '') = 'service_role'
     or coalesce(current_setting('costing.bypass', true), '') = 'on' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  v_matrix := public.costing_matrix_of(tg_table_name, coalesce(v_new, v_old));
  v_opp := public.costing_matrix_opp(v_matrix);
  if v_opp is null then
    -- The matrix is going (an SOR cascade): nothing left to judge.
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  for v_band in select * from public.costing_column_bands where table_name = tg_table_name loop
    v_needed := case
      when v_band.column_name = '*' then tg_op in ('INSERT', 'DELETE')
      when tg_op = 'INSERT' then
        (v_new -> v_band.column_name) is not null
        and (v_new -> v_band.column_name) <> 'null'::jsonb
        and (v_new -> v_band.column_name) is distinct from public.costing_column_default(tg_relid, v_band.column_name)
      when tg_op = 'UPDATE' then (v_new -> v_band.column_name) is distinct from (v_old -> v_band.column_name)
      else false
    end;
    if not v_needed then
      continue;
    end if;
    v_ok := false;
    foreach b in array v_band.bands loop
      if public.costing_in_band(v_opp, b) then
        v_ok := true;
        exit;
      end if;
    end loop;
    if not v_ok then
      raise exception using
        errcode = '42501',
        message = format('costing_band:%s.%s:%s', tg_table_name, v_band.column_name, array_to_string(v_band.bands, ','));
    end if;
  end loop;

  return case when tg_op = 'DELETE' then old else new end;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.costing_events_append_only()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  raise exception 'costing_events is append-only: history can''t be changed (% refused)', tg_op
    using errcode = '42501';
end;
$function$
;
CREATE OR REPLACE FUNCTION public.costing_history(p_opportunity_id uuid, p_table text DEFAULT NULL::text, p_row uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 100)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_tier   text := public.costing_tier(p_opportunity_id);
  v_matrix uuid;
  v_result jsonb;
begin
  if v_tier is null then
    return null;
  end if;
  select id into v_matrix from public.costing_matrices where opportunity_id = p_opportunity_id;
  if v_matrix is null then
    return null;
  end if;

  select coalesce(jsonb_agg(x.item order by x.created_at desc, x.id), '[]'::jsonb) into v_result
  from (
    select e.id, e.created_at,
      jsonb_build_object(
        'id', e.id,
        'at', e.created_at,
        'actor_id', e.actor_id,
        'kind', e.kind,
        'detail', case
          when e.detail ? 'column' then e.detail
          else jsonb_build_object('table', e.detail -> 'table', 'row', e.detail -> 'row')
            || jsonb_build_object('values', public.costing_pick(
              e.detail -> 'values',
              (select coalesce(array_agg(c.column_name), '{}') from public.costing_column_tiers c
                where c.table_name = e.detail ->> 'table' and c.column_name <> '*' and v_tier = any (c.tiers))
            ))
        end
      ) as item
    from public.costing_events e
    where e.matrix_id = v_matrix
      and (p_table is null or e.detail ->> 'table' = p_table)
      and (p_row is null or e.detail ->> 'row' = p_row::text)
      and (
        case
          when e.detail ? 'column' then exists (
            select 1 from public.costing_column_tiers c
            where c.table_name = e.detail ->> 'table' and c.column_name = e.detail ->> 'column' and v_tier = any (c.tiers)
          )
          else exists (
            select 1 from public.costing_column_tiers c
            where c.table_name = e.detail ->> 'table' and c.column_name <> '*' and v_tier = any (c.tiers)
          )
        end
      )
    order by e.created_at desc, e.id
    limit greatest(coalesce(p_limit, 100), 1)
  ) x;

  return v_result;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.costing_in_band(p_opportunity_id uuid, p_band text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select case p_band
    when 'sales' then
      coalesce(public.is_super_admin(), false)
      or exists (
        select 1 from public.sales_opportunities o
        where o.id = p_opportunity_id and public.sor_is_deal_team(o, public.get_employee_id())
      )
    when 'purchasing' then coalesce(public.is_super_admin(), false) or public.has_purchasing_access()
    when 'management' then public.costing_on_list('final_acquire')
    when 'technical' then coalesce(public.is_super_admin(), false) or public.costing_is_technical(p_opportunity_id)
    when 'finance' then public.has_finance_access() or public.costing_on_list('final_acquire')
    when 'super_admin_only' then coalesce(public.is_super_admin(), false)
    else false
  end
$function$
;
CREATE OR REPLACE FUNCTION public.costing_inclusion_needs_bundle()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not exists (select 1 from public.costing_components c where c.id = new.component_id and c.is_bundle) then
    raise exception 'costing_inclusion: an Inclusion can only sit under a bundle Component'
      using errcode = '22023';
  end if;
  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.costing_is_technical(p_opportunity_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select public.has_purchasing_access()
    or exists (
      select 1
      from public.committee_tasks t
      join public.committee_task_members m on m.committee_task_id = t.id
      where t.opportunity_id = p_opportunity_id
        and t.template_id is not null
        and t.template_id = (select s.evaluation_template_id from public.costing_evaluation_settings s limit 1)
        and t.status <> 'CANCELLED'
        and m.employee_id = public.get_employee_id()
    )
$function$
;
CREATE OR REPLACE FUNCTION public.costing_landed_costs(p_opportunity_id uuid)
 RETURNS TABLE(component_id uuid, total_php numeric, unit_php numeric, mark text, blank_reason text, ordered_quantity numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with comps as (
    select c.id, c.quantity
    from public.costing_components c
    join public.costing_tender_lines t on t.id = c.tender_line_id
    join public.costing_matrices m on m.id = t.matrix_id
    where m.opportunity_id = p_opportunity_id
      and public.costing_can_read_cost(p_opportunity_id)
  ),
  -- Ordered and Received claim; Cancelled, Substituted and Cannot source claim nothing.
  live as (
    select pri.id, pri.component_id, pri.quantity, pri.po_number, coalesce(pri.odoo_po_line_ids, '{}') as picked
    from public.purchase_request_items pri
    where pri.status in ('ordered', 'received')
  ),
  items as (
    select live.*, public._lc_ipas_for_po(live.po_number) as ipas_id
    from live
    join comps on comps.id = live.component_id
  ),
  claims as (
    select items.id as item_id, items.component_id, items.quantity, items.ipas_id, pick.lid
    from items
    cross join lateral (select distinct u.lid from unnest(items.picked) as u(lid)) as pick
    where items.ipas_id is not null
  ),
  lc as (
    select s.ipas_id, l.odoo_line_id, l.total_php, l.mark
    from (select distinct claims.ipas_id from claims) s
    cross join lateral public.ipas_line_landed_costs(s.ipas_id) l
  ),
  -- Every live Requested Item, on any SOR, that picked the same line.
  claimants as (
    select k.ipas_id, k.lid, count(*) as n, sum(live.quantity) as q
    from (select distinct claims.ipas_id, claims.lid from claims) k
    join public.ipas ip on ip.id = k.ipas_id
    join live on btrim(live.po_number) = ip.po_number and k.lid = any (live.picked)
    group by k.ipas_id, k.lid
  ),
  shares as (
    select
      claims.component_id,
      lc.odoo_line_id is null as missing,
      lc.mark,
      case when coalesce(cm.n, 1) <= 1 then lc.total_php
           else lc.total_php * claims.quantity / nullif(cm.q, 0) end as share
    from claims
    left join lc on lc.ipas_id = claims.ipas_id and lc.odoo_line_id = claims.lid
    left join claimants cm on cm.ipas_id = claims.ipas_id and cm.lid = claims.lid
  ),
  per as (
    select
      comps.id,
      comps.quantity,
      (select count(*) from items where items.component_id = comps.id) as n_items,
      (select coalesce(sum(items.quantity), 0) from items where items.component_id = comps.id) as ordered,
      exists (
        select 1 from items
        where items.component_id = comps.id and (items.ipas_id is null or cardinality(items.picked) = 0)
      ) as not_picked,
      exists (select 1 from shares where shares.component_id = comps.id and shares.missing) as removed,
      exists (select 1 from shares where shares.component_id = comps.id and shares.mark = 'unavailable') as unavailable,
      (select sum(shares.share) from shares where shares.component_id = comps.id) as total,
      (select coalesce(bool_and(shares.mark = 'final'), false) from shares where shares.component_id = comps.id) as final
    from comps
  )
  select
    per.id,
    case when r.reason is null then round(per.total, 2) end,
    case when r.reason is null then round(per.total / nullif(per.quantity, 0), 2) end,
    case when r.reason is null then case when per.final then 'final' else 'provisional' end end,
    r.reason,
    per.ordered
  from per
  cross join lateral (
    select case
      when per.n_items = 0 then 'not_ordered'
      when per.not_picked then 'po_line_not_picked'
      when per.removed then 'line_removed'
      when per.unavailable or per.total is null then 'landed_cost_unavailable'
    end as reason
  ) r
$function$
;
CREATE OR REPLACE FUNCTION public.costing_log_final_offer_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_opp      uuid;
  v_submit   timestamptz;
  v_position integer;
begin
  if tg_op = 'INSERT' and new.final_offer_unit is null then
    return null;
  end if;
  if tg_op = 'UPDATE' and new.final_offer_unit is not distinct from old.final_offer_unit then
    return null;
  end if;

  select m.opportunity_id, m.bid_submitted_at, l.position
    into v_opp, v_submit, v_position
    from public.costing_tender_lines l
    join public.costing_matrices m on m.id = l.matrix_id
   where l.id = new.tender_line_id;
  if v_opp is null or v_submit is null then
    return null;
  end if;

  insert into public.sales_opportunity_logs (opportunity_id, author_id, type, content, metadata)
  values (
    v_opp,
    public.get_employee_id(),
    'SYSTEM',
    format('Final Offer changed on Tender Line %s after the bid was submitted.', v_position),
    jsonb_build_object('event', 'COSTING_FINAL_OFFER_CHANGED', 'tender_line_id', new.tender_line_id)
  );
  return null;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.costing_mark_bid_submitted(p_opportunity_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_actor  uuid := public.get_employee_id();
  v_visit  record;
  v_gated  boolean := false;
  v_seen   boolean := false;
  v_matrix uuid;
  v_done   integer;
begin
  if v_actor is null then
    raise exception 'costing_mark_bid_submitted: sign in first' using errcode = '42501';
  end if;

  for v_visit in
    select v.flow_stage_id, v.flow_snapshot_id
      from public.sor_stage_visits v
     where v.opportunity_id = p_opportunity_id
       and v.left_by = v_actor
       and v.left_at > now() - interval '2 minutes'
       and v.undone_at is null
  loop
    v_seen := true;
    if v_visit.flow_snapshot_id is not null
       and exists (select 1 from public.flow_snapshots fs where fs.id = v_visit.flow_snapshot_id) then
      select exists (
        select 1
          from public.flow_snapshots fs
         cross join lateral (
           select case jsonb_typeof(fs.snapshot_data->'conditions')
                    when 'array' then fs.snapshot_data->'conditions'
                    when 'object' then (select coalesce(jsonb_agg(x.value), '[]'::jsonb)
                                          from jsonb_each(fs.snapshot_data->'conditions') j
                                         cross join lateral jsonb_array_elements(j.value) x)
                    else '[]'::jsonb
                  end as rows
         ) r
         cross join lateral jsonb_array_elements(r.rows) c
         where fs.id = v_visit.flow_snapshot_id
           and c->>'stage_id' = v_visit.flow_stage_id::text
           and c->>'kind' = 'costing_settled'
           and coalesce(c->>'archived_at', '') = ''
      ) into v_gated;
    else
      select exists (
        select 1 from public.stage_conditions sc
         where sc.stage_id = v_visit.flow_stage_id
           and sc.kind = 'costing_settled'
           and sc.archived_at is null
      ) into v_gated;
    end if;
    exit when v_gated;
  end loop;

  if not v_seen then
    raise exception 'costing_mark_bid_submitted: only the person who just moved the SOR can do this' using errcode = '42501';
  end if;
  if not v_gated then
    return false;
  end if;

  select m.id into v_matrix from public.costing_matrices m where m.opportunity_id = p_opportunity_id;
  if not public.costing_settled_met(v_matrix) then
    return false;
  end if;

  perform set_config('costing.bypass', 'on', true);
  update public.costing_matrices
     set bid_submitted_at = now()
   where opportunity_id = p_opportunity_id and bid_submitted_at is null;
  get diagnostics v_done = row_count;
  perform set_config('costing.bypass', 'off', true);
  return v_done > 0;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.costing_markup_presets_touch()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  new.updated_at = now();
  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.costing_markup_price(p_acquire numeric, p_factor numeric)
 RETURNS numeric
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select case when p_acquire is null or p_factor is null then null else round(p_acquire * p_factor, 2) end
$function$
;
CREATE OR REPLACE FUNCTION public.costing_matching_sor_line(p_tender_line_id uuid)
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select sl.id
  from public.costing_tender_lines l
  join public.costing_matrices m on m.id = l.matrix_id
  join public.sales_opportunity_items sl on sl.opportunity_id = m.opportunity_id
  where l.id = p_tender_line_id
    and l.source = 'sor_line'
    and case
      when l.odoo_product_id is not null then sl.odoo_product_id = l.odoo_product_id
      else lower(btrim(sl.product_name)) = lower(btrim(l.sor_line_snapshot ->> 'name'))
    end
  order by (sl.quantity = (l.sor_line_snapshot ->> 'quantity')::numeric) desc, sl.sort_order, sl.created_at
  limit 1
$function$
;
CREATE OR REPLACE FUNCTION public.costing_matrix_backfill(p_dry_run boolean DEFAULT true)
 RETURNS TABLE(flow_id uuid, flow_name text, opportunity_id uuid, sales_reference text, current_stage text, mounting_stage text, reason text, outcome text, matrix_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_sor record;
  v_opp public.sales_opportunities;
  v_visit uuid;
  v_hit record;
  v_matrix uuid;
  v_existing uuid;
  v_outcome text;
  v_mount_names text;
  v_reason text;
  v_at_stage boolean;
  v_has_edges boolean;
begin
  if not (coalesce(auth.role(), '') = 'service_role' or public.is_super_admin()) then
    raise exception 'costing_matrix_backfill: service role or Super Admin only' using errcode = '42501';
  end if;

  for v_sor in
    select h.opportunity_id as opp_id, h.flow_id as fid
      from public._costing_backfill_hits() h
     group by h.opportunity_id, h.flow_id
     order by h.flow_id, h.opportunity_id
  loop
    select * into v_opp from public.sales_opportunities where id = v_sor.opp_id;
    select id into v_existing from public.costing_matrices m where m.opportunity_id = v_sor.opp_id;

    select string_agg(distinct format('"%s"', coalesce(st.name, h.mounting_stage_id::text)), ', '),
           bool_or(h.mounting_stage_id = v_opp.flow_stage_id),
           bool_and(h.has_edges)
      into v_mount_names, v_at_stage, v_has_edges
      from public._costing_backfill_hits() h
      left join public.flow_stages st on st.id = h.mounting_stage_id
     where h.opportunity_id = v_sor.opp_id;

    v_reason := case
      when v_at_stage then format('At the stage that mounts Open Costing Matrix (%s)', v_mount_names)
      else format('Downstream of the stage that mounts Open Costing Matrix (%s)', v_mount_names)
    end;

    if not v_has_edges then
      v_outcome := 'skipped_no_snapshot_edges';
      v_matrix := null;
      v_reason := format('Flow Snapshot has no edges, so the SOR''s position cannot be told (mounts Open Costing Matrix at %s)', v_mount_names);
    elsif v_existing is not null then
      v_outcome := 'already_has_matrix';
      v_matrix := v_existing;
    elsif p_dry_run then
      v_outcome := 'would_open';
      v_matrix := null;
    else
      select v.id into v_visit from public.sor_stage_visits v
       where v.opportunity_id = v_sor.opp_id and v.left_at is null and v.undone_at is null
       order by v.sequence desc limit 1;

      v_matrix := null;
      -- One SOR failing (say, a configured Incharge who has since lost Purchasing
      -- access) rolls back that SOR alone and is reported, so the rest still run;
      -- a later run retries it.
      begin
        -- The first action creates the matrix; any further one tops it up,
        -- exactly as it would have on entering its stage.
        for v_hit in
          select * from public._costing_backfill_hits() h
           where h.opportunity_id = v_sor.opp_id
           order by h.seq
        loop
          v_matrix := public.costing_open_matrix(
            v_sor.opp_id,
            public._costing_action_open_args(v_opp, v_hit.action_config, v_visit)
          );
        end loop;
        v_outcome := 'opened';
      exception when others then
        v_matrix := null;
        v_outcome := 'failed';
        v_reason := v_reason || ' - not opened: ' || sqlerrm;
      end;
    end if;

    flow_id := v_sor.fid;
    flow_name := (select st.name from public.sale_types st where st.id = v_opp.sale_type_id);
    opportunity_id := v_sor.opp_id;
    sales_reference := v_opp.sales_reference;
    current_stage := (select fs.name from public.flow_stages fs where fs.id = v_opp.flow_stage_id);
    mounting_stage := v_mount_names;
    reason := v_reason;
    outcome := v_outcome;
    matrix_id := v_matrix;
    return next;
  end loop;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.costing_matrix_filter(p_table text, p_alias text DEFAULT 't'::text, p_depth integer DEFAULT 0)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_def public.costing_tables;
  v_inner text;
begin
  if p_table = 'costing_matrices' then
    return format('%s.id = $1', p_alias);
  end if;
  select * into v_def from public.costing_tables where table_name = p_table;
  if not found then
    raise exception 'costing_matrix_filter: % is not a costing table', p_table using errcode = '22023';
  end if;
  if v_def.parent_table is null then
    return format('%s.matrix_id = $1', p_alias);
  end if;
  v_inner := public.costing_matrix_filter(v_def.parent_table, 'p' || (p_depth + 1), p_depth + 1);
  return format(
    '%s.%I in (select %s.%I from public.%I %s where %s)',
    p_alias, v_def.parent_column, 'p' || (p_depth + 1), v_def.parent_key, v_def.parent_table, 'p' || (p_depth + 1), v_inner
  );
end;
$function$
;
CREATE OR REPLACE FUNCTION public.costing_matrix_of(p_table text, p_row jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_table  text := p_table;
  v_row    jsonb := p_row;
  v_def    public.costing_tables;
  v_parent jsonb;
  v_depth  integer := 0;
begin
  loop
    v_depth := v_depth + 1;
    if v_depth > 8 then
      raise exception 'costing_matrix_of: % nests too deep', p_table using errcode = '22023';
    end if;
    if v_table = 'costing_matrices' then
      return (v_row ->> 'id')::uuid;
    end if;
    select * into v_def from public.costing_tables where table_name = v_table;
    if not found then
      return null;
    end if;
    if v_def.parent_table is null then
      return (v_row ->> 'matrix_id')::uuid;
    end if;
    execute format('select to_jsonb(p) from public.%I p where p.%I = $1', v_def.parent_table, v_def.parent_key)
      into v_parent
      using (v_row ->> v_def.parent_column)::uuid;
    if v_parent is null then
      return null;
    end if;
    v_table := v_def.parent_table;
    v_row := v_parent;
  end loop;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.costing_matrix_opp(p_matrix_id uuid)
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select opportunity_id from public.costing_matrices where id = p_matrix_id
$function$
;
CREATE OR REPLACE FUNCTION public.costing_matrix_page()
 RETURNS TABLE(opportunity_id uuid, sor_code text, sales_reference text, project_title text, stage text, entities text[], final_offer_total numeric, final_acquire_total numeric, landed_cost_total numeric, bought_final_acquire_total numeric, items_bought integer, items_total integer, ipas_short boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if public.get_employee_id() is null then
    raise exception 'costing_matrix_page: not signed in' using errcode = '42501';
  end if;
  if not (coalesce(public.is_super_admin(), false) or public.costing_on_list('final_acquire')) then
    raise exception 'costing_matrix_page: only Super Admins and the Final Acquire list read the Costing Matrix page'
      using errcode = '42501';
  end if;

  return query
  select
    o.id,
    o.sor_code,
    o.sales_reference,
    o.project_title,
    fs.name,
    coalesce(ent.names, '{}'::text[]),
    offer.total,
    acquire.total,
    lc.landed,
    lc.bought_acquire,
    lc.bought,
    lc.total_items,
    (shortage.open_short or lc.provisional)
  from public.costing_matrices m
  join public.sales_opportunities o on o.id = m.opportunity_id
  left join public.flow_stages fs on fs.id = o.flow_stage_id
  cross join lateral (
    select case when count(*) > 0 and bool_and(p.final_offer_unit is not null)
                then sum(round(p.final_offer_unit * t.quantity, 2)) end as total
    from public.costing_tender_lines t
    left join public.costing_tender_line_prices p on p.tender_line_id = t.id
    where t.matrix_id = m.id
  ) offer
  cross join lateral (
    select case when count(*) > 0 and bool_and(x.fa is not null)
                then sum(round(x.fa * x.q, 2)) end as total
    from (
      select cc.final_acquire_unit as fa, c.quantity as q
      from public.costing_components c
      join public.costing_tender_lines t on t.id = c.tender_line_id
      left join public.costing_component_costs cc on cc.component_id = c.id
      where t.matrix_id = m.id
      union all
      select r.final_acquire_unit, r.quantity
      from public.costing_cost_rows r
      where r.matrix_id = m.id
    ) x
  ) acquire
  cross join lateral (
    select
      count(*)::integer as total_items,
      (count(*) filter (where l.total_php is not null))::integer as bought,
      -- Each Component's Landed Cost is rounded to the centavo before it is added, as the SOR summary does.
      coalesce(sum(round(l.total_php, 2)) filter (where l.total_php is not null), 0) as landed,
      case when coalesce(bool_and(l.total_php is null or cc.final_acquire_unit is not null), true)
           then coalesce(sum(round(cc.final_acquire_unit * c.quantity, 2)) filter (where l.total_php is not null), 0)
      end as bought_acquire,
      coalesce(bool_or(l.total_php is not null and l.mark is distinct from 'final'), false) as provisional
    from public.costing_components c
    join public.costing_tender_lines t on t.id = c.tender_line_id
    left join public.costing_component_costs cc on cc.component_id = c.id
    left join public.costing_landed_costs(o.id) l on l.component_id = c.id
    where t.matrix_id = m.id
  ) lc
  cross join lateral (
    select exists (
      select 1
      from public.ipas i
      join public.ipas_sors s on s.ipas_id = i.id
      where s.opportunity_id = o.id
        and i.purpose = 'project'
        and i.state = 'open'
        and coalesce(i.computation_status, '') not in ('lc_odoo_done', 'costs_complete', 'checked')
    ) as open_short
  ) shortage
  cross join lateral (
    select array_agg(distinct e.name order by e.name) as names
    from (
      select nullif(btrim(coalesce(nullif(btrim(i.entity_override), ''), i.odoo_copy #>> '{po,company}')), '') as name
      from public.ipas i
      join public.ipas_sors s on s.ipas_id = i.id
      where s.opportunity_id = o.id
        and i.purpose = 'project'
        and i.state <> 'cancelled'
    ) e
    where e.name is not null
  ) ent
  where not coalesce(o.is_deleted, false)
    and not coalesce(o.is_scratch, false)
  order by o.serial_no desc;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.costing_matrix_read(p_opportunity_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_tier   text := public.costing_tier(p_opportunity_id);
  v_matrix uuid;
  v_def    public.costing_tables;
  v_cols   text[];
  v_virtual text;
  v_rows   jsonb;
  v_tables jsonb := '{}'::jsonb;
  v_bands  text[];
begin
  if v_tier is null then
    return null;
  end if;
  select id into v_matrix from public.costing_matrices where opportunity_id = p_opportunity_id;
  if v_matrix is null then
    return null;
  end if;

  for v_def in select * from public.costing_tables order by table_name loop
    select coalesce(array_agg(c.column_name), '{}') into v_cols
    from public.costing_column_tiers c
    where c.table_name = v_def.table_name and c.column_name <> '*' and v_tier = any (c.tiers);
    if cardinality(v_cols) = 0 then
      continue;
    end if;

    -- Computed columns, only those this tier may read.
    select coalesce(string_agg(format('%L, %s', vc.column_name, vc.expression), ', '), '') into v_virtual
    from public.costing_virtual_columns vc
    where vc.table_name = v_def.table_name and vc.column_name = any (v_cols);

    execute format(
      'select coalesce(jsonb_agg(public.costing_pick(to_jsonb(t) %s, $2) order by %s), ''[]''::jsonb) from public.%I t where %s',
      case when v_virtual = '' then '' else '|| jsonb_build_object(' || v_virtual || ')' end,
      v_def.order_by,
      v_def.table_name,
      public.costing_matrix_filter(v_def.table_name)
    ) into v_rows using v_matrix, v_cols;

    v_tables := v_tables || jsonb_build_object(v_def.table_name, v_rows);
  end loop;

  -- The write bands the caller is in, so the screen can show a cell read-only.
  select coalesce(array_agg(b), '{}') into v_bands
    from unnest(array['sales', 'purchasing', 'management', 'technical', 'finance', 'super_admin_only']) b
   where public.costing_in_band(p_opportunity_id, b);

  return jsonb_build_object('tier', v_tier, 'matrix_id', v_matrix, 'bands', to_jsonb(v_bands), 'tables', v_tables);
end;
$function$
;
CREATE OR REPLACE FUNCTION public.costing_move_inclusion(p_inclusion_id uuid, p_component_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_inc    public.costing_inclusions;
  v_target public.costing_components;
  v_from   uuid;
  v_to     uuid;
  v_opp    uuid;
begin
  select * into v_inc from public.costing_inclusions where id = p_inclusion_id;
  if not found then
    raise exception 'costing_move_inclusion: Inclusion not found' using errcode = '22023';
  end if;
  select * into v_target from public.costing_components where id = p_component_id;
  if not found then
    raise exception 'costing_move_inclusion: Component not found' using errcode = '22023';
  end if;

  v_from := public.costing_matrix_of('costing_inclusions', to_jsonb(v_inc));
  v_to := public.costing_matrix_of('costing_components', to_jsonb(v_target));
  v_opp := public.costing_matrix_opp(v_from);
  if v_opp is null or not public.costing_can_read(v_opp) then
    raise exception 'costing_move_inclusion: not allowed' using errcode = '42501';
  end if;
  if v_from is distinct from v_to then
    raise exception 'costing_move_inclusion: the Component is on another SOR''s matrix' using errcode = '22023';
  end if;
  if not v_target.is_bundle then
    raise exception 'costing_move_inclusion: an Inclusion can only sit under a bundle Component' using errcode = '22023';
  end if;
  if v_inc.component_id = p_component_id then
    return;
  end if;

  update public.costing_inclusions
     set component_id = p_component_id,
         position = coalesce((select max(i.position) from public.costing_inclusions i where i.component_id = p_component_id), 0) + 1
   where id = p_inclusion_id;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.costing_on_list(p_list_key text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1
    from public.costing_signer_lists l
    join public.employees e on e.id = l.employee_id
    where l.list_key = p_list_key
      and l.employee_id = public.get_employee_id()
      and not coalesce(e.is_deleted, false)
  )
$function$
;
CREATE OR REPLACE FUNCTION public.costing_open_matrix(p_opportunity_id uuid, p_config jsonb DEFAULT '{}'::jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_id          uuid;
  v_created     boolean;
  v_sales       uuid := nullif(p_config ->> 'sales_incharge_id', '')::uuid;
  v_buyer       uuid := nullif(p_config ->> 'purchasing_incharge_id', '')::uuid;
  v_preset      public.costing_markup_presets;
  v_visit       uuid := nullif(p_config ->> 'opened_visit_id', '')::uuid;
  v_until       text := coalesce(nullif(p_config ->> 'access_until', ''), 'stage_left');
  v_until_stage uuid := nullif(p_config ->> 'access_until_stage_id', '')::uuid;
  v_actor       uuid := public.get_employee_id();
  v_label       text;
  v_emp         uuid;
begin
  if not exists (select 1 from public.sales_opportunities where id = p_opportunity_id) then
    raise exception 'costing_open_matrix: SOR not found' using errcode = '22023';
  end if;

  perform set_config('costing.bypass', 'on', true);

  insert into public.costing_matrices (opportunity_id, sales_incharge_id, purchasing_incharge_id)
  values (p_opportunity_id, v_sales, v_buyer)
  on conflict (opportunity_id) do nothing
  returning id into v_id;
  v_created := v_id is not null;

  if not v_created then
    select id into v_id from public.costing_matrices where opportunity_id = p_opportunity_id;
    update public.costing_matrices
       set sales_incharge_id = coalesce(sales_incharge_id, v_sales),
           purchasing_incharge_id = coalesce(purchasing_incharge_id, v_buyer)
     where id = v_id
       and ((sales_incharge_id is null and v_sales is not null)
         or (purchasing_incharge_id is null and v_buyer is not null));
  end if;

  insert into public.costing_matrix_money (matrix_id) values (v_id) on conflict (matrix_id) do nothing;

  -- The markup default: a typed factor, or one already chosen, stays.
  if nullif(p_config ->> 'default_preset_id', '') is not null then
    select * into v_preset from public.costing_markup_presets
     where id = (p_config ->> 'default_preset_id')::uuid and active;
    if found then
      update public.costing_matrix_money
         set default_preset_id = v_preset.id, default_factor = v_preset.factor
       where matrix_id = v_id and default_factor is null;
    end if;
  end if;

  select nullif(concat_ws(' · ', o.sales_reference, o.project_title), '') into v_label
    from public.sales_opportunities o where o.id = p_opportunity_id;

  -- Members: a window each, for whoever has no open one on this matrix.
  if v_visit is not null
     and jsonb_typeof(p_config -> 'member_ids') = 'array'
     and not public._sor_window_over(p_opportunity_id, v_visit, v_until, v_until_stage) then
    for v_emp in
      select distinct e.id
        from jsonb_array_elements_text(p_config -> 'member_ids') m
        join public.employees e on e.id = m::uuid and not coalesce(e.is_deleted, false)
    loop
      if not exists (
        select 1 from public.sor_stage_participants p
         where p.opportunity_id = p_opportunity_id
           and p.employee_id = v_emp
           and p.source = 'costing_matrix'
           and p.source_id = v_id
           and p.closed_at is null
      ) then
        insert into public.sor_stage_participants
          (opportunity_id, employee_id, source, source_id, opened_visit_id, until_rule, until_stage_id)
        values
          (p_opportunity_id, v_emp, 'costing_matrix', v_id, v_visit, v_until,
           case when v_until in ('stage_entered', 'later_stage_left') then v_until_stage end);

        if v_emp is distinct from v_actor then
          insert into public.notifications (recipient_id, sender_id, type, title, message, reference_id)
          values (v_emp, v_actor, 'SOR_STAGE_PARTICIPANT_ADDED', 'Added to a deal',
                  format('You were added to %s to see its Costing Matrix.', coalesce(v_label, 'a deal')),
                  p_opportunity_id::text);
        end if;
      end if;
    end loop;
  end if;

  -- Opened with nobody to buy: tell whoever assigns one.
  if v_created
     and jsonb_typeof(p_config -> 'assigner_ids') = 'array'
     and exists (select 1 from public.costing_matrices where id = v_id and purchasing_incharge_id is null) then
    for v_emp in
      select distinct e.id
        from jsonb_array_elements_text(p_config -> 'assigner_ids') a
        join public.employees e on e.id = a::uuid and not coalesce(e.is_deleted, false)
    loop
      insert into public.notifications (recipient_id, sender_id, type, title, message, reference_id)
      values (v_emp, v_actor, 'OPPORTUNITY_COSTING_INCHARGE_NEEDED', 'Costing Matrix needs a Purchasing Incharge',
              format('The Costing Matrix for %s opened with no Purchasing Incharge. Please name one.', coalesce(v_label, 'a deal')),
              p_opportunity_id::text);
    end loop;
  end if;

  perform set_config('costing.bypass', 'off', true);
  return v_id;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.costing_pending_bid_decisions()
 RETURNS TABLE(matrix_id uuid, opportunity_id uuid, project_title text, client_name text, deal_owner_id uuid, deal_owner_name text, final_offer_total numeric, abc_total numeric, waiting_since timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select m.id, m.opportunity_id, o.project_title, o.client_name, o.deal_owner_id, own.name,
         t.final_offer_total, t.abc_total,
         coalesce(
           (select max(e.created_at) from public.costing_events e
             where e.matrix_id = m.id and e.detail ->> 'table' = 'costing_tender_line_prices'),
           m.created_at
         )
  from public.costing_matrices m
  join public.sales_opportunities o on o.id = m.opportunity_id
  left join public.employees own on own.id = o.deal_owner_id
  cross join lateral public.costing_bid_totals(m.id) t
  where (coalesce(public.is_super_admin(), false) or public.costing_on_list('final_acquire'))
    and not coalesce(o.is_deleted, false)
    and not coalesce(o.is_scratch, false)
    and t.line_count > 0
    and t.missing_offer = 0
    and not exists (
      select 1 from public.costing_bid_decisions d where d.matrix_id = m.id and d.cleared_at is null
    )
  order by 9, m.id
$function$
;
CREATE OR REPLACE FUNCTION public.costing_pick(p_row jsonb, p_cols text[])
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select coalesce(jsonb_object_agg(e.key, e.value), '{}'::jsonb)
  from jsonb_each(coalesce(p_row, '{}'::jsonb)) e
  where e.key = any (p_cols)
$function$
;
CREATE OR REPLACE FUNCTION public.costing_quotation_price_unit(p_tender_line_id uuid)
 RETURNS numeric
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select sl.unit_price
  from public.sales_opportunity_items sl
  where sl.id = public.costing_matching_sor_line(p_tender_line_id)
$function$
;
CREATE OR REPLACE FUNCTION public.costing_remove_cost_row(p_row_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_matrix uuid;
  v_opp    uuid;
begin
  select matrix_id into v_matrix from public.costing_cost_rows where id = p_row_id;
  v_opp := public.costing_matrix_opp(v_matrix);
  if v_opp is null then
    raise exception 'costing_remove_cost_row: not found' using errcode = '22023';
  end if;
  if not public.costing_can_read(v_opp) then
    raise exception 'costing_remove_cost_row: not allowed' using errcode = '42501';
  end if;
  delete from public.costing_cost_rows where id = p_row_id;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.costing_reorder_tender_lines(p_matrix_id uuid, p_ids uuid[])
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_opp uuid := public.costing_matrix_opp(p_matrix_id);
  i     integer;
begin
  if v_opp is null then
    raise exception 'costing_reorder_tender_lines: not found' using errcode = '22023';
  end if;
  if not public.costing_can_read(v_opp) then
    raise exception 'costing_reorder_tender_lines: not allowed' using errcode = '42501';
  end if;
  if (select count(*) from public.costing_tender_lines where matrix_id = p_matrix_id) <> coalesce(cardinality(p_ids), 0)
     or exists (
       select 1 from unnest(p_ids) u(id)
       where not exists (select 1 from public.costing_tender_lines l where l.id = u.id and l.matrix_id = p_matrix_id)
     )
     or (select count(distinct id) from unnest(p_ids) u(id)) <> coalesce(cardinality(p_ids), 0) then
    raise exception 'costing_reorder_tender_lines: the list must name each Tender Line once' using errcode = '22023';
  end if;
  for i in 1 .. coalesce(cardinality(p_ids), 0) loop
    update public.costing_tender_lines set position = i
     where id = p_ids[i] and matrix_id = p_matrix_id and position is distinct from i;
  end loop;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.costing_row_tier(p_table text, p_row jsonb)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select public.costing_tier(public.costing_matrix_opp(public.costing_matrix_of(p_table, p_row)))
$function$
;
CREATE OR REPLACE FUNCTION public.costing_set_money(p_table text, p_row uuid, p_patch jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_def    public.costing_tables;
  v_matrix uuid;
  v_opp    uuid;
  v_key    text;
  v_sets   text;
  v_cols   text;
  v_count  integer;
  v_found  jsonb;
begin
  if public.get_employee_id() is null then
    raise exception 'costing_set_money: sign in first' using errcode = '42501';
  end if;
  select * into v_def from public.costing_tables where table_name = p_table and money;
  if not found then
    raise exception 'costing_set_money: % is not a money table', p_table using errcode = '22023';
  end if;
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' or p_patch = '{}'::jsonb then
    raise exception 'costing_set_money: nothing to change' using errcode = '22023';
  end if;
  for v_key in select jsonb_object_keys(p_patch) loop
    if v_key = '*' or not exists (
      select 1 from public.costing_column_bands where table_name = p_table and column_name = v_key
    ) then
      raise exception 'costing_set_money: % is not a column of %', v_key, p_table using errcode = '22023';
    end if;
  end loop;

  if v_def.parent_table is null and v_def.key_column <> 'matrix_id' then
    execute format('select to_jsonb(t) from public.%I t where t.%I = $1', p_table, v_def.key_column)
      into v_found using p_row;
    v_matrix := public.costing_matrix_of(p_table, v_found);
  else
    v_matrix := public.costing_matrix_of(p_table, jsonb_build_object(v_def.key_column, p_row));
  end if;
  v_opp := public.costing_matrix_opp(v_matrix);
  if v_opp is null then
    raise exception 'costing_set_money: not found' using errcode = '22023';
  end if;
  -- A read tier is needed, with one exception (#270): Finance access alone has no tier on
  -- the SOR, yet Finance types Marketing and OPEX. That passes only when every column in the
  -- patch is one a Finance-band caller may write; the band trigger still judges each of them.
  if not public.costing_can_read(v_opp) then
    if not (
      public.has_finance_access()
      and not exists (
        select 1
        from jsonb_object_keys(p_patch) k
        where not exists (
          select 1 from public.costing_column_bands b
          where b.table_name = p_table and b.column_name = k and 'finance' = any (b.bands)
        )
      )
    ) then
      raise exception 'costing_set_money: not allowed' using errcode = '42501';
    end if;
  end if;

  select string_agg(format('%I = r.%I', k, k), ', '), string_agg(format('%I', k), ', ')
    into v_sets, v_cols
    from jsonb_object_keys(p_patch) k;

  execute format(
    'update public.%I t set %s from jsonb_populate_record(null::public.%I, $1) r where t.%I = $2',
    p_table, v_sets, p_table, v_def.key_column
  ) using p_patch, p_row;
  get diagnostics v_count = row_count;

  if v_count = 0 and (v_def.parent_table is not null or v_def.key_column = 'matrix_id') then
    execute format(
      'insert into public.%I (%I, %s) select $2, %s from jsonb_populate_record(null::public.%I, $1) r',
      p_table, v_def.key_column, v_cols,
      (select string_agg(format('r.%I', k), ', ') from jsonb_object_keys(p_patch) k),
      p_table
    ) using p_patch, p_row;
  end if;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.costing_settings_stamp()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  new.id = 1;
  new.updated_at = now();
  new.updated_by = public.get_employee_id();
  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.costing_settled_met(p_matrix_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_totals  record;
  v_costed  integer;
  v_missing integer;
begin
  if p_matrix_id is null then
    return false;
  end if;

  select * into v_totals from public.costing_bid_totals(p_matrix_id);
  if coalesce(v_totals.line_count, 0) = 0 or coalesce(v_totals.missing_offer, 1) <> 0 then
    return false;
  end if;
  if coalesce(v_totals.final_offer_total > v_totals.abc_total, false) then
    return false;
  end if;

  select count(*), count(*) filter (where cc.final_acquire_unit is null)
    into v_costed, v_missing
    from public.costing_components c
    join public.costing_tender_lines l on l.id = c.tender_line_id
    left join public.costing_component_costs cc on cc.component_id = c.id
   where l.matrix_id = p_matrix_id;
  v_costed := v_costed + (select count(*) from public.costing_cost_rows r where r.matrix_id = p_matrix_id);
  v_missing := v_missing + (select count(*) from public.costing_cost_rows r
                             where r.matrix_id = p_matrix_id and r.final_acquire_unit is null);
  if v_costed = 0 or v_missing <> 0 then
    return false;
  end if;

  return exists (
           select 1 from public.costing_signoffs s
            where s.matrix_id = p_matrix_id and s.role = 'evaluation_approved' and s.cleared_at is null)
     and coalesce((select d.verdict from public.costing_bid_decisions d
                    where d.matrix_id = p_matrix_id and d.cleared_at is null), '') = 'go';
end;
$function$
;
CREATE OR REPLACE FUNCTION public.costing_sign(p_matrix_id uuid, p_role text, p_decline_signature boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_actor     uuid := public.get_employee_id();
  v_opp       uuid;
  v_incharge  uuid;
  v_missing   integer;
  v_signature text;
  v_row       public.costing_signoffs;
begin
  if v_actor is null then
    raise exception 'costing_sign: sign in first' using errcode = '42501';
  end if;
  if p_role is null or p_role not in ('prepared', 'costed', 'evaluation_approved', 'final_approved') then
    raise exception 'costing_sign: % is not a sign-off', coalesce(p_role, 'that') using errcode = '22023';
  end if;

  v_opp := public.costing_matrix_opp(p_matrix_id);
  if v_opp is null then
    raise exception 'costing_sign: not found' using errcode = '22023';
  end if;
  if not public.costing_can_read(v_opp) then
    raise exception 'costing_sign: not allowed' using errcode = '42501';
  end if;

  if p_role = 'evaluation_approved' then
    if not public.costing_on_list('evaluation') then
      raise exception 'costing_sign: only someone on the evaluation list can approve the evaluation' using errcode = '42501';
    end if;
  elsif p_role = 'prepared' then
    select m.sales_incharge_id into v_incharge from public.costing_matrices m where m.id = p_matrix_id;
    if v_incharge is distinct from v_actor then
      raise exception 'costing_sign: only the Sales incharge can sign Prepared by' using errcode = '42501';
    end if;
  elsif p_role = 'costed' then
    select m.purchasing_incharge_id into v_incharge from public.costing_matrices m where m.id = p_matrix_id;
    if v_incharge is distinct from v_actor then
      raise exception 'costing_sign: only the Purchasing incharge can sign Costed by' using errcode = '42501';
    end if;
  elsif not public.costing_on_list('final_acquire') then
    raise exception 'costing_sign: only someone on the Final Acquire list can approve the Final Acquire and offer' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtext('costing_sign:' || p_matrix_id::text));

  if exists (
    select 1 from public.costing_signoffs s
    where s.matrix_id = p_matrix_id and s.role = p_role and s.cleared_at is null
  ) then
    if p_role = 'evaluation_approved' then
      raise exception 'costing_sign: the evaluation is already approved' using errcode = '22023';
    end if;
    raise exception 'costing_sign: that sign-off is already signed' using errcode = '22023';
  end if;

  if p_role = 'evaluation_approved' then
    select count(*) into v_missing
    from public.costing_components c
    join public.costing_tender_lines l on l.id = c.tender_line_id
    where l.matrix_id = p_matrix_id and c.compliance is null;
    if v_missing > 0 then
      raise exception 'costing_sign: % Component% no verdict yet',
        v_missing, case when v_missing = 1 then ' has' else 's have' end
        using errcode = '22023';
    end if;
  end if;

  if not coalesce(p_decline_signature, false) then
    select nullif(btrim(e.signature_path), '') into v_signature from public.employees e where e.id = v_actor;
  end if;

  insert into public.costing_signoffs (matrix_id, role, signed_by, signature_declined, signature_version)
  values (p_matrix_id, p_role, v_actor, coalesce(p_decline_signature, false), v_signature)
  returning * into v_row;

  return jsonb_build_object('signoff', to_jsonb(v_row));
end;
$function$
;
CREATE OR REPLACE FUNCTION public.costing_signoffs_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  if old.cleared_at is not null then
    raise exception 'costing_signoffs: a cleared sign-off can''t change' using errcode = '42501';
  end if;
  if (to_jsonb(new) - 'cleared_at' - 'cleared_reason') is distinct from (to_jsonb(old) - 'cleared_at' - 'cleared_reason') then
    raise exception 'costing_signoffs: only the clearing can change on a sign-off' using errcode = '42501';
  end if;
  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.costing_sor_line_now(p_tender_line_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select case
    when l.source <> 'sor_line' then null
    when sl.id is null then jsonb_build_object('found', false)
    else jsonb_build_object(
      'found', true,
      'name', sl.product_name,
      'quantity', sl.quantity,
      'unit', nullif(btrim(sl.unit), ''),
      'odoo_product_id', sl.odoo_product_id
    )
  end
  from public.costing_tender_lines l
  left join public.sales_opportunity_items sl on sl.id = public.costing_matching_sor_line(l.id)
  where l.id = p_tender_line_id
$function$
;
CREATE OR REPLACE FUNCTION public.costing_tender_line_delete_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_link text;
begin
  if pg_trigger_depth() > 1 then
    return old;
  end if;
  select public._costing_component_link(c.id, c.po_rfq_no) into v_link
  from public.costing_components c
  where c.tender_line_id = old.id and public._costing_component_link(c.id, c.po_rfq_no) is not null
  limit 1;
  if v_link is not null then
    raise exception 'A Component on this Tender Line is linked to %. Unlink it before deleting.', v_link
      using errcode = '22023', hint = 'costing_component_linked';
  end if;
  return old;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.costing_tender_lines_cleanup()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  delete from public.costing_components where tender_line_id = old.id;
  delete from public.costing_tender_line_prices where tender_line_id = old.id;
  return old;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.costing_tier(p_opportunity_id uuid)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select case
    when not exists (select 1 from public.sales_opportunities o where o.id = p_opportunity_id) then null
    when coalesce(public.is_super_admin(), false) or public.costing_on_list('final_acquire') then 'closed_book'
    when public.has_purchasing_access() then 'cost'
    when exists (
      select 1 from public.sales_opportunities o
      where o.id = p_opportunity_id
        and (
          public.sor_is_deal_team(o, public.get_employee_id())
          or public.sor_always_sees(o, public.get_employee_id())
        )
    ) then 'price'
    when exists (
      select 1 from public.sor_stage_participants p
      where p.opportunity_id = p_opportunity_id
        and p.employee_id = public.get_employee_id()
        and p.closed_at is null
    ) then 'participant'
    -- #545: the Evaluation list reads the matrix with no money, whatever the stage.
    when public.costing_on_list('evaluation')
      and exists (select 1 from public.costing_matrices m where m.opportunity_id = p_opportunity_id)
    then 'participant'
    else null
  end
$function$
;
CREATE OR REPLACE FUNCTION public.costing_touch_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  new.updated_at = now();
  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.costing_write_events()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_old    jsonb := case when tg_op = 'INSERT' then null else to_jsonb(old) end;
  v_new    jsonb := case when tg_op = 'DELETE' then null else to_jsonb(new) end;
  v_row    jsonb := coalesce(v_new, v_old);
  v_def    public.costing_tables;
  v_matrix uuid;
  v_key    text;
  k        text;
begin
  select * into v_def from public.costing_tables where table_name = tg_table_name;
  if not found then
    return null;
  end if;
  v_matrix := public.costing_matrix_of(tg_table_name, v_row);
  if v_matrix is null or not exists (select 1 from public.costing_matrices where id = v_matrix) then
    return null;
  end if;
  v_key := v_row ->> v_def.key_column;

  if tg_op = 'UPDATE' then
    for k in select e.key from jsonb_each(v_new) e where e.key not in ('updated_at') loop
      if (v_new -> k) is distinct from (v_old -> k) then
        insert into public.costing_events (matrix_id, actor_id, kind, detail)
        values (v_matrix, public.get_employee_id(), 'changed', jsonb_build_object(
          'table', tg_table_name, 'row', v_key, 'column', k, 'old', v_old -> k, 'new', v_new -> k
        ));
      end if;
    end loop;
  else
    insert into public.costing_events (matrix_id, actor_id, kind, detail)
    values (
      v_matrix,
      public.get_employee_id(),
      case when tg_op = 'INSERT' then 'added' else 'removed' end,
      jsonb_build_object(
        'table', tg_table_name,
        'row', v_key,
        'values', (select coalesce(jsonb_object_agg(e.key, e.value), '{}'::jsonb)
                   from jsonb_each(v_row) e
                   where e.value <> 'null'::jsonb and e.key not in ('created_at', 'updated_at'))
      )
    );
  end if;
  return null;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.decide_offset_leave_decision(p_group_id uuid, p_status text, p_hr_notes text, p_hr_id uuid, p_approved_hours numeric DEFAULT NULL::numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_employee_id uuid;
  v_application_hash text;
  v_row_count integer;
  v_pending_count integer;
  v_total_hours numeric;
  v_approved_hours numeric := NULL;
  v_head_status text;
  v_hr_override boolean;
  v_dates date[];
  v_balance numeric;
  v_new_balance numeric := NULL;
  v_credits_snapshot numeric := NULL;
  v_canon_credits text;
  v_approval_hash text;
  v_hr_signature_version text;
  v_hr_signature_timestamp timestamptz;
  v_now timestamptz := now();
BEGIN
  IF p_status NOT IN ('APPROVED', 'REJECTED') THEN
    RAISE EXCEPTION 'Unsupported offset leave decision: %.', p_status;
  END IF;

  -- Lock the whole group first, in a stable order, so everything read below
  -- describes a group no concurrent decision can be halfway through changing.
  PERFORM 1 FROM offset_leaves WHERE leave_group_id = p_group_id ORDER BY id FOR UPDATE;

  SELECT count(*), count(*) FILTER (WHERE status = 'PENDING'), COALESCE(sum(hours), 0), array_agg(date ORDER BY date)
    INTO v_row_count, v_pending_count, v_total_hours, v_dates
    FROM offset_leaves WHERE leave_group_id = p_group_id;

  IF v_row_count = 0 THEN
    RAISE EXCEPTION 'Leave application not found.';
  END IF;

  -- Every row in the group must still be pending. A decided group is not
  -- re-decidable: without this, two officers approving the same leave at once
  -- would each deduct its hours.
  IF v_pending_count <> v_row_count THEN
    RAISE EXCEPTION 'This leave application has already been decided.';
  END IF;

  SELECT employee_id, application_hash, head_status, hr_override
    INTO v_employee_id, v_application_hash, v_head_status, v_hr_override
    FROM offset_leaves WHERE leave_group_id = p_group_id ORDER BY id LIMIT 1;

  -- #328: the head-status gate, under the group lock (overtime's shape,
  -- 20260908130000). Head decisions stamp every day-row alike, so the first
  -- row speaks for the group.
  IF p_status = 'APPROVED' AND v_head_status <> 'APPROVED' AND NOT v_hr_override THEN
    RAISE EXCEPTION 'Cannot approve this offset leave: the department head has not approved this request yet (head_status=%). Use the HR override if this needs to proceed anyway.', v_head_status;
  END IF;

  IF p_status = 'APPROVED' THEN
    v_approved_hours := COALESCE(p_approved_hours, v_total_hours);
    IF NOT (v_approved_hours > 0) THEN
      RAISE EXCEPTION 'Approved hours must be greater than zero.';
    END IF;
    IF v_approved_hours > v_total_hours THEN
      RAISE EXCEPTION 'Approved hours cannot exceed the requested hours.';
    END IF;
  END IF;

  IF p_status = 'APPROVED' THEN
    SELECT offset_hours_balance INTO v_balance FROM employees WHERE id = v_employee_id FOR UPDATE;
    v_balance := COALESCE(v_balance, 0);

    IF v_balance < v_approved_hours THEN
      RAISE EXCEPTION 'Cannot approve leave. Employee currently only has % hrs balance.', trim_scale(round(v_balance, 2));
    END IF;

    -- The snapshot is the balance the employee will have AFTER this
    -- deduction, not the balance at the moment of approval.
    v_new_balance := v_balance - v_approved_hours;
    v_credits_snapshot := v_new_balance;
  END IF;

  SELECT signature_path INTO v_hr_signature_version FROM employees WHERE id = p_hr_id;
  IF v_hr_signature_version IS NOT NULL THEN
    v_hr_signature_timestamp := v_now;
  END IF;

  v_canon_credits := CASE WHEN v_credits_snapshot IS NULL THEN '' ELSE trim_scale(round(v_credits_snapshot, 2))::text END;
  v_approval_hash := encode(digest(
    format('%s|%s|%s|%s', v_application_hash, p_status, COALESCE(p_hr_id::text, ''), v_canon_credits),
    'sha256'), 'hex');

  UPDATE offset_leaves SET
    status = p_status,
    hr_notes = p_hr_notes,
    updated_at = v_now,
    approval_hash = v_approval_hash,
    hr_signature_version = v_hr_signature_version,
    hr_signature_timestamp = v_hr_signature_timestamp,
    approval_credits_snapshot = v_credits_snapshot,
    hr_processed_by = p_hr_id,
    -- The group total is split across its day-rows in proportion to each
    -- day's requested hours; approved = requested leaves every row as asked.
    approved_hours = CASE
      WHEN v_approved_hours IS NULL THEN NULL
      WHEN v_total_hours = 0 THEN 0
      ELSE round(hours * v_approved_hours / v_total_hours, 2)
    END
  WHERE leave_group_id = p_group_id;

  -- Rounding each day can leave the rows a cent off the total that was
  -- debited; the last day absorbs it, so undo/withdraw refund exactly that.
  IF v_approved_hours IS NOT NULL THEN
    UPDATE offset_leaves SET approved_hours = approved_hours + (
      v_approved_hours - (SELECT sum(approved_hours) FROM offset_leaves WHERE leave_group_id = p_group_id)
    )
    WHERE id = (SELECT id FROM offset_leaves WHERE leave_group_id = p_group_id ORDER BY date DESC, id DESC LIMIT 1);
  END IF;

  IF v_new_balance IS NOT NULL THEN
    UPDATE employees SET offset_hours_balance = v_new_balance, updated_at = v_now WHERE id = v_employee_id;
  END IF;

  RETURN jsonb_build_object(
    'rows', (SELECT jsonb_agg(to_jsonb(l) ORDER BY l.date) FROM offset_leaves l WHERE l.leave_group_id = p_group_id),
    'employee_id', v_employee_id,
    'total_hours', v_total_hours,
    'approved_hours', v_approved_hours,
    'dates', to_jsonb(v_dates)
  );
END;
$function$
;
CREATE OR REPLACE FUNCTION public.decide_overtime_request(p_request_id uuid, p_status text, p_approved_hours numeric, p_hr_notes text, p_hr_id uuid)
 RETURNS overtime_requests
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_request overtime_requests;
  v_is_decision boolean;
  v_approved_hours numeric;
  v_balance numeric;
  v_new_balance numeric;
  v_credits_snapshot numeric;
  v_canon_credits text;
  v_approval_hash text;
  v_hr_signature_version text;
  v_hr_signature_timestamp timestamptz;
  v_now timestamptz := now();
BEGIN
  SELECT * INTO v_request FROM overtime_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Overtime request not found.';
  END IF;

  -- Same lock this function already holds on the row — the gate and the
  -- decision it guards can no longer be split across two round-trips.
  IF p_status LIKE 'APPROVED%' AND v_request.head_status <> 'APPROVED' AND NOT v_request.hr_override THEN
    RAISE EXCEPTION 'Cannot approve this overtime request: the department head has not approved this request yet (head_status=%). Use the HR override if this needs to proceed anyway.', v_request.head_status;
  END IF;

  v_is_decision := p_status LIKE 'APPROVED%' OR p_status = 'REJECTED';

  IF p_status LIKE 'APPROVED%' THEN
    v_approved_hours := COALESCE(p_approved_hours, v_request.hours);
    IF NOT (v_approved_hours > 0) THEN
      RAISE EXCEPTION 'Approved hours must be greater than zero.';
    END IF;
  END IF;

  -- Lock the employee row before reading the balance: this is what
  -- serializes two officers deciding two different requests for the same
  -- employee instead of letting them race.
  IF p_status = 'APPROVED_OFFSET' THEN
    SELECT offset_hours_balance INTO v_balance FROM employees WHERE id = v_request.employee_id FOR UPDATE;
    v_new_balance := COALESCE(v_balance, 0) + v_approved_hours;
    v_credits_snapshot := v_new_balance;
  END IF;

  SELECT signature_path INTO v_hr_signature_version FROM employees WHERE id = p_hr_id;
  IF v_hr_signature_version IS NOT NULL THEN
    v_hr_signature_timestamp := v_now;
  END IF;

  -- Mirrors verify_form_token's approval-hash formula byte-for-byte (see
  -- src/utils/formHashes.js's canonicalNumber, which trim_scale(round(_,2))
  -- is designed to match) so a printed form generated from this decision
  -- verifies the same way every other record type's does.
  IF v_is_decision THEN
    v_canon_credits := CASE WHEN v_credits_snapshot IS NULL THEN '' ELSE trim_scale(round(v_credits_snapshot, 2))::text END;
    v_approval_hash := encode(digest(
      format('%s|%s|%s|%s', v_request.application_hash, p_status, COALESCE(p_hr_id::text, ''), v_canon_credits),
      'sha256'), 'hex');
  END IF;

  UPDATE overtime_requests SET
    status = p_status,
    approved_hours = v_approved_hours,
    hr_notes = p_hr_notes,
    updated_at = v_now,
    approval_hash = v_approval_hash,
    hr_signature_version = v_hr_signature_version,
    hr_signature_timestamp = v_hr_signature_timestamp,
    approval_credits_snapshot = v_credits_snapshot,
    hr_processed_by = p_hr_id
  WHERE id = p_request_id
  RETURNING * INTO v_request;

  IF p_status = 'APPROVED_OFFSET' THEN
    UPDATE employees SET offset_hours_balance = v_new_balance, updated_at = v_now WHERE id = v_request.employee_id;
  END IF;

  RETURN v_request;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.decide_sil_leave_decision(p_group_id uuid, p_status text, p_hr_notes text, p_hr_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_employee_id uuid;
  v_application_hash text;
  v_employment_status text;
  v_row_count integer;
  v_pending_count integer;
  v_total_hours numeric;
  v_dates date[];
  v_balance numeric;
  v_new_balance numeric := NULL;
  v_credits_snapshot numeric := NULL;
  v_canon_credits text;
  v_approval_hash text;
  v_hr_signature_version text;
  v_hr_signature_timestamp timestamptz;
  v_now timestamptz := now();
BEGIN
  IF p_status NOT IN ('APPROVED', 'REJECTED') THEN
    RAISE EXCEPTION 'Unsupported SIL leave decision: %.', p_status;
  END IF;

  PERFORM 1 FROM sil_leaves WHERE leave_group_id = p_group_id ORDER BY id FOR UPDATE;

  SELECT count(*), count(*) FILTER (WHERE status = 'PENDING'), COALESCE(sum(hours), 0), array_agg(date ORDER BY date)
    INTO v_row_count, v_pending_count, v_total_hours, v_dates
    FROM sil_leaves WHERE leave_group_id = p_group_id;

  IF v_row_count = 0 THEN
    RAISE EXCEPTION 'Leave application not found.';
  END IF;

  IF v_pending_count <> v_row_count THEN
    RAISE EXCEPTION 'This leave application has already been decided.';
  END IF;

  SELECT employee_id, application_hash
    INTO v_employee_id, v_application_hash
    FROM sil_leaves WHERE leave_group_id = p_group_id ORDER BY id LIMIT 1;

  IF p_status = 'APPROVED' THEN
    SELECT sil_hours_balance, employment_status
      INTO v_balance, v_employment_status
      FROM employees WHERE id = v_employee_id FOR UPDATE;

    -- No caller may read the SIL balance without also checking eligibility —
    -- the rule fetchEligibleSilEmployee enforced on the JavaScript side.
    IF v_employment_status IS DISTINCT FROM 'Regular' THEN
      RAISE EXCEPTION 'Only Regular employees are eligible for SIL leave.';
    END IF;

    v_balance := COALESCE(v_balance, 0);
    IF v_balance < v_total_hours THEN
      RAISE EXCEPTION 'Cannot approve leave. Employee currently only has % hrs balance.', trim_scale(round(v_balance, 2));
    END IF;

    v_new_balance := v_balance - v_total_hours;
    v_credits_snapshot := v_new_balance;
  END IF;

  SELECT signature_path INTO v_hr_signature_version FROM employees WHERE id = p_hr_id;
  IF v_hr_signature_version IS NOT NULL THEN
    v_hr_signature_timestamp := v_now;
  END IF;

  v_canon_credits := CASE WHEN v_credits_snapshot IS NULL THEN '' ELSE trim_scale(round(v_credits_snapshot, 2))::text END;
  v_approval_hash := encode(digest(
    format('%s|%s|%s|%s', v_application_hash, p_status, COALESCE(p_hr_id::text, ''), v_canon_credits),
    'sha256'), 'hex');

  UPDATE sil_leaves SET
    status = p_status,
    hr_notes = p_hr_notes,
    hr_processed_by = p_hr_id,
    hr_processed_at = v_now,
    approval_hash = v_approval_hash,
    hr_signature_version = v_hr_signature_version,
    hr_signature_timestamp = v_hr_signature_timestamp,
    approval_credits_snapshot = v_credits_snapshot
  WHERE leave_group_id = p_group_id;

  IF v_new_balance IS NOT NULL THEN
    UPDATE employees SET sil_hours_balance = v_new_balance, updated_at = v_now WHERE id = v_employee_id;
  END IF;

  RETURN jsonb_build_object(
    'rows', (SELECT jsonb_agg(to_jsonb(l) ORDER BY l.date) FROM sil_leaves l WHERE l.leave_group_id = p_group_id),
    'employee_id', v_employee_id,
    'total_hours', v_total_hours,
    'dates', to_jsonb(v_dates)
  );
END;
$function$
;
CREATE OR REPLACE FUNCTION public.decide_undertime_request(p_request_id uuid, p_status text, p_approved_hours numeric, p_hr_notes text, p_hr_id uuid)
 RETURNS undertime_requests
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_request undertime_requests;
  v_is_decision boolean;
  v_approved_hours numeric;
  v_approval_hash text;
  v_hr_signature_version text;
  v_hr_signature_timestamp timestamptz;
  v_hr_processed_at timestamptz;
  v_now timestamptz := now();
BEGIN
  SELECT * INTO v_request FROM undertime_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Undertime request not found.';
  END IF;

  IF p_status = 'APPROVED' AND v_request.head_status <> 'APPROVED' AND NOT v_request.hr_override THEN
    RAISE EXCEPTION 'Cannot approve this undertime request: the department head has not approved this request yet (head_status=%). Use the HR override if this needs to proceed anyway.', v_request.head_status;
  END IF;

  v_is_decision := p_status = 'APPROVED' OR p_status = 'REJECTED';

  IF p_status = 'APPROVED' THEN
    v_approved_hours := COALESCE(p_approved_hours, v_request.hours);
    IF NOT (v_approved_hours > 0) THEN
      RAISE EXCEPTION 'Approved hours must be greater than zero.';
    END IF;
  END IF;

  SELECT signature_path INTO v_hr_signature_version FROM employees WHERE id = p_hr_id;
  IF v_hr_signature_version IS NOT NULL THEN
    v_hr_signature_timestamp := v_now;
  END IF;

  IF v_is_decision THEN
    v_hr_processed_at := v_now;
    -- Undertime moves no balance, so canon_credits is always '' — the hash
    -- formula still matches every other record type's shape byte-for-byte.
    v_approval_hash := encode(digest(
      format('%s|%s|%s|%s', v_request.application_hash, p_status, COALESCE(p_hr_id::text, ''), ''),
      'sha256'), 'hex');
  END IF;

  UPDATE undertime_requests SET
    status = p_status,
    approved_hours = COALESCE(v_approved_hours, v_request.approved_hours),
    hr_notes = p_hr_notes,
    updated_at = v_now,
    approval_hash = COALESCE(v_approval_hash, v_request.approval_hash),
    hr_signature_version = COALESCE(v_hr_signature_version, v_request.hr_signature_version),
    hr_signature_timestamp = COALESCE(v_hr_signature_timestamp, v_request.hr_signature_timestamp),
    hr_processed_by = p_hr_id,
    hr_processed_at = COALESCE(v_hr_processed_at, v_request.hr_processed_at)
  WHERE id = p_request_id
  RETURNING * INTO v_request;

  RETURN v_request;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.employee_group_member_ids(p_group_id uuid)
 RETURNS SETOF uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select e.id
  from public.employees e
  where coalesce(e.is_deleted, false) = false
    and (
      exists (
        select 1 from public.employee_group_members m
        where m.group_id = p_group_id and m.employee_id = e.id
      )
      or exists (
        select 1 from public.employee_group_teams t
        where t.group_id = p_group_id
          and upper(trim(t.team)) = upper(trim(e.sub_department))
      )
    );
$function$
;
CREATE OR REPLACE FUNCTION public.flow_snapshot_next_version(p_flow_id uuid, p_snapshot_data jsonb)
 RETURNS TABLE(version_major integer, version_minor integer)
 LANGUAGE plpgsql
 STABLE
AS $function$
declare
  v_latest record;
  v_new_stage_ids text[];
  v_stage_removed boolean;
  v_won_changed boolean;
begin
  select fs.version, fs.version_minor, fs.snapshot_data
    into v_latest
  from flow_snapshots fs
  where fs.flow_id = p_flow_id
  order by fs.version desc, fs.version_minor desc
  limit 1;

  if not found then
    version_major := 1;
    version_minor := 0;
    return next;
    return;
  end if;

  select coalesce(array_agg(elem->>'id'), array[]::text[])
    into v_new_stage_ids
  from jsonb_array_elements(coalesce(p_snapshot_data->'stages', '[]'::jsonb)) as elem;

  v_stage_removed := exists (
    select 1
    from jsonb_array_elements(coalesce(v_latest.snapshot_data->'stages', '[]'::jsonb)) as old_elem
    where (old_elem->>'id') is not null
      and not ((old_elem->>'id') = any (v_new_stage_ids))
  );

  v_won_changed :=
    coalesce(nullif(v_latest.snapshot_data->>'wonStageId', ''), '')
    is distinct from
    coalesce(nullif(p_snapshot_data->>'wonStageId', ''), '');

  if v_stage_removed or v_won_changed then
    version_major := v_latest.version + 1;
    version_minor := 0;
  else
    version_major := v_latest.version;
    version_minor := v_latest.version_minor + 1;
  end if;
  return next;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.get_calendar_offset_leaves(p_start date DEFAULT NULL::date, p_end date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce(jsonb_agg(row order by created_at desc), '[]'::jsonb)
  from (
    select l.created_at,
      jsonb_build_object(
        'id', l.id, 'employee_id', l.employee_id, 'date', l.date,
        'start_time', l.start_time, 'end_time', l.end_time, 'hours', l.hours,
        'status', l.status, 'leave_group_id', l.leave_group_id,
        'employee', jsonb_build_object('id', e.id, 'name', e.name, 'department', e.department, 'avatar_path', e.avatar_path),
        'category', case when c.id is null then null else jsonb_build_object('label', c.label) end
      ) as row
    from public.offset_leaves l
    left join public.employees e on e.id = l.employee_id
    left join public.hr_leave_categories c on c.id = l.category_id
    where (l.status = 'APPROVED' or l.employee_id = public.get_employee_id())
      and (p_start is null or l.date >= p_start)
      and (p_end is null or l.date < p_end)
  ) s;
$function$
;
CREATE OR REPLACE FUNCTION public.get_calendar_sil_leaves(p_start date DEFAULT NULL::date, p_end date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce(jsonb_agg(row order by created_at desc), '[]'::jsonb)
  from (
    select l.created_at,
      jsonb_build_object(
        'id', l.id, 'employee_id', l.employee_id, 'date', l.date,
        'start_time', l.start_time, 'end_time', l.end_time, 'hours', l.hours,
        'status', l.status, 'leave_group_id', l.leave_group_id,
        'employee', jsonb_build_object('id', e.id, 'name', e.name, 'department', e.department, 'avatar_path', e.avatar_path),
        'category', case when c.id is null then null else jsonb_build_object('label', c.label) end
      ) as row
    from public.sil_leaves l
    left join public.employees e on e.id = l.employee_id
    left join public.hr_leave_categories c on c.id = l.category_id
    where (l.status = 'APPROVED' or l.employee_id = public.get_employee_id())
      and (p_start is null or l.date >= p_start)
      and (p_end is null or l.date < p_end)
  ) s;
$function$
;
CREATE OR REPLACE FUNCTION public.get_employee_id()
 RETURNS uuid
 LANGUAGE sql
 SECURITY DEFINER
AS $function$
  SELECT id FROM public.employees WHERE email = auth.jwt() ->> 'email';
$function$
;
CREATE OR REPLACE FUNCTION public.get_user_active_chats(p_user_id uuid, p_limit integer DEFAULT 30)
 RETURNS TABLE(entity_id text, entity_type text, title text, subtitle text, status text, latest_message text, latest_author text, latest_created_at timestamp with time zone, last_read_at timestamp with time zone, is_unread boolean, is_deleted boolean, is_archived boolean)
 LANGUAGE plpgsql
AS $function$BEGIN
    RETURN QUERY
    WITH task_chats AS (
        SELECT
            t.id::TEXT AS entity_id,
            'TASK'::TEXT AS entity_type,
            COALESCE(t.project_title, LEFT(t.task_description, 40)) AS title,
            (SELECT emp.name FROM public.employees emp WHERE emp.id = t.logged_by) AS subtitle,
            t.status AS status,
            ta.content AS latest_message,
            (SELECT emp.name FROM public.employees emp WHERE emp.id = ta.author_id) AS latest_author,
            ta.created_at AS latest_created_at,
            (t.status = 'DELETED') AS is_deleted
        FROM public.tasks t
        JOIN public.task_activity ta ON ta.id = (
            SELECT id FROM public.task_activity
            WHERE task_id = t.id AND type = 'COMMENT'
            ORDER BY created_at DESC LIMIT 1
        )
        WHERE (
            t.logged_by = p_user_id OR
            t.reported_to = p_user_id OR
            EXISTS (
                SELECT 1 FROM public.task_activity
                WHERE task_id = t.id AND author_id = p_user_id
            )
        )
    ),
    committee_chats AS (
        SELECT
            ct.id::text AS entity_id,
            'COMMITTEE_TASK' AS entity_type,
            ct.title AS title,
            'Committee Task' AS subtitle,
            ct.status AS status,
            cta.content AS latest_message,
            COALESCE(e.name, 'System') AS latest_author,
            cta.created_at AS latest_created_at,
            false AS is_deleted
        FROM public.committee_tasks ct
        JOIN public.committee_task_activity cta ON cta.task_id = ct.id
        JOIN (
            SELECT task_id, MAX(created_at) as max_created_at
            FROM public.committee_task_activity
            GROUP BY task_id
        ) latest_act
            ON latest_act.task_id = ct.id
            AND latest_act.max_created_at = cta.created_at
        LEFT JOIN public.employees e ON e.id = cta.author_id
        WHERE (
            ct.created_by = p_user_id OR
            EXISTS (
                SELECT 1
                FROM public.committee_task_members ctm
                WHERE ctm.committee_task_id = ct.id
                AND ctm.employee_id = p_user_id
            )
        )
    ),
    combined_chats AS (
        SELECT * FROM task_chats
        UNION ALL
        SELECT * FROM committee_chats
    )
    SELECT
        c.entity_id,
        c.entity_type,
        c.title,
        c.subtitle,
        c.status,
        c.latest_message,
        c.latest_author,
        c.latest_created_at,
        r.last_read_at,
        (r.last_read_at IS NULL OR c.latest_created_at > r.last_read_at) AS is_unread,
        c.is_deleted,
        (a.archived_at IS NOT NULL) AS is_archived
    FROM combined_chats c
    LEFT JOIN public.chat_read_receipts r
        ON c.entity_id = r.entity_id
        AND c.entity_type = r.entity_type
        AND r.user_id = p_user_id
    LEFT JOIN public.chat_user_archives a
        ON c.entity_id = a.entity_id
        AND c.entity_type = a.entity_type
        AND a.user_id = p_user_id
    ORDER BY c.latest_created_at DESC
    LIMIT p_limit;
END;$function$
;
CREATE OR REPLACE FUNCTION public.group_task_template_can_edit(p_template_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1 from public.group_task_templates t
    where t.id = p_template_id
      and (
        t.created_by = public.get_employee_id()
        or exists (
          select 1 from public.employees e
          where e.id = public.get_employee_id()
            and (e.is_head or e.is_super_admin)
        )
      )
  )
$function$
;
CREATE OR REPLACE FUNCTION public.group_task_templates_touch()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  new.updated_at := now();
  return new;
end $function$
;
CREATE OR REPLACE FUNCTION public.guard_head_status_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
  IF (
       NEW.head_status IS DISTINCT FROM OLD.head_status
       OR NEW.head_note IS DISTINCT FROM OLD.head_note
       OR NEW.head_decided_at IS DISTINCT FROM OLD.head_decided_at
       OR NEW.head_signature_version IS DISTINCT FROM OLD.head_signature_version
     )
     AND NOT (
       public.is_hr() OR public.is_super_admin()
       OR (public.is_head() AND OLD.head_id = public.get_employee_id())
     )
  THEN
    RAISE EXCEPTION 'Only the routed department head, HR, or a super admin may record a head decision on this request.';
  END IF;
  RETURN NEW;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.handoffs_for_sor(p_opportunity_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_actor uuid := public.get_employee_id();
  v_sor public.sales_opportunities;
  v_transmittals jsonb := '[]'::jsonb;
  v_packing_lists jsonb := '[]'::jsonb;
begin
  select * into v_sor from public.sales_opportunities o where o.id = p_opportunity_id;
  -- coalesce: an SOR with an empty deal-team column makes sor_is_deal_team NULL,
  -- and `not NULL` would skip this refusal and leak the handoffs to a non-reader.
  if not found or not coalesce(
    public.is_super_admin()
    or public.sor_is_deal_team(v_sor, v_actor)
    or public.sor_always_sees(v_sor, v_actor),
    false
  ) then
    return jsonb_build_object('transmittals', v_transmittals, 'packing_lists', v_packing_lists);
  end if;

  select coalesce(jsonb_agg(to_jsonb(t) order by t.prepared_on desc, t.number desc), '[]'::jsonb)
    into v_transmittals
    from (
      select tr.id,
             tr.number,
             tr.prepared_on,
             tr.priority,
             tr.state,
             (select count(*)::int
                from public.transmittal_lines l
               where l.transmittal_id = tr.id
                 and (l.wh_rating = 'na' or l.tech_rating = 'na')) as na_count,
             public.transmittal_can_read(tr.id) as can_open
        from public.transmittals tr
       where tr.state <> 'draft'
         and exists (
         select 1 from public.transmittal_lines l
          where l.transmittal_id = tr.id and l.opportunity_id = p_opportunity_id
       )
    ) t;

  select coalesce(jsonb_agg(to_jsonb(p) order by p.number desc), '[]'::jsonb)
    into v_packing_lists
    from (
      select pl.id,
             pl.number,
             pl.state,
             (select count(*)::int from public.packing_list_boxes b where b.packing_list_id = pl.id) as box_count,
             pl.odoo_delivery_ref,
             public.packing_list_can_read(pl.id) as can_open
        from public.packing_lists pl
       where pl.opportunity_id = p_opportunity_id
    ) p;

  return jsonb_build_object('transmittals', v_transmittals, 'packing_lists', v_packing_lists);
end;
$function$
;
CREATE OR REPLACE FUNCTION public.has_finance_access()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1 from employees e
    where e.id = get_employee_id()
      and e.has_finance_flow
      and not coalesce(e.is_deleted, false)
  );
$function$
;
CREATE OR REPLACE FUNCTION public.has_purchasing_access()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select public._employee_has_purchasing_access(get_employee_id());
$function$
;
CREATE OR REPLACE FUNCTION public.invoke_cron_edge_function(p_function text, p_query text DEFAULT ''::text, p_timeout_ms integer DEFAULT 120000)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_url text;
  v_secret text;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'project_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'cron_secret';
  if v_url is null or v_secret is null then
    raise exception 'invoke_cron_edge_function: Vault secrets project_url and cron_secret must both exist';
  end if;

  return net.http_post(
    url := rtrim(v_url, '/') || '/functions/v1/' || p_function || p_query,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_secret
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := p_timeout_ms
  );
end;
$function$
;
CREATE OR REPLACE FUNCTION public.invoke_currency_rates_fetch()
 RETURNS bigint
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select public.invoke_cron_edge_function('currency-rates-fetch');
$function$
;
CREATE OR REPLACE FUNCTION public.invoke_retail_sync(p_mode text DEFAULT NULL::text)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if p_mode is not null and p_mode <> 'full' then
    raise exception 'invoke_retail_sync: mode must be null or ''full'', got %', p_mode;
  end if;

  return public.invoke_cron_edge_function(
    'odoo-sor-sync',
    case when p_mode is null then '' else '?mode=' || p_mode end,
    -- the nightly run re-reads more orders' notes than a 5-minute run; give it room
    case when p_mode = 'full' then 300000 else 120000 end
  );
end;
$function$
;
CREATE OR REPLACE FUNCTION public.invoke_sor_follow_up_reminders()
 RETURNS bigint
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select public.invoke_cron_edge_function('sor-follow-up-reminders');
$function$
;
CREATE OR REPLACE FUNCTION public.ipas_actual_checking_hand_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  if new.actual_checking_by is not null
     and (new.actual_checking_by is distinct from old.actual_checking_by
          or new.actual_checking_at is distinct from old.actual_checking_at)
     and exists (
       select 1
         from public.transmittal_lines l
         join public.transmittals t on t.id = l.transmittal_id
        where l.ipas_id = new.id
          and t.state not in ('draft', 'cancelled')
     ) then
    raise exception 'Actual Checking is stamped by the Transmittals once one is submitted for this IPAS'
      using errcode = '42501';
  end if;
  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.ipas_add_charge(p_ipas_id uuid, p_kind_id uuid, p_charged_on date, p_amount_php numeric)
 RETURNS ipas_charges
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_actor uuid := public._ipas_money_writer('ipas_add_charge');
  v_ipas public.ipas;
  v_amount numeric := round(p_amount_php, 2);
  v_label text;
  v_row public.ipas_charges;
begin
  v_ipas := public._ipas_lock_open('ipas_add_charge', p_ipas_id);
  if p_charged_on is null then
    raise exception 'ipas_add_charge: give the date of the charge' using errcode = '22023';
  end if;
  if v_amount is null or v_amount <= 0 then
    raise exception 'ipas_add_charge: the amount must be more than zero' using errcode = '22023';
  end if;
  v_label := public._ipas_check_option('ipas_add_charge', p_kind_id, 'charge_kind', null, 'charge kind');

  insert into public.ipas_charges (ipas_id, kind_id, charged_on, amount_php, created_by)
  values (v_ipas.id, p_kind_id, p_charged_on, v_amount, v_actor)
  returning * into v_row;

  perform public._ipas_write_event(v_ipas.id, v_actor, 'charge_added', jsonb_build_object(
    'charge_id', v_row.id,
    'kind_id', v_row.kind_id,
    'kind', v_label,
    'charged_on', v_row.charged_on,
    'amount_php', v_row.amount_php
  ));

  return v_row;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.ipas_add_document(p_ipas_id uuid, p_kind_id uuid, p_label text, p_attachment_url text)
 RETURNS ipas_documents
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_actor uuid := public._ipas_purchasing_writer('ipas_add_document');
  v_ipas public.ipas;
  v_label text := nullif(btrim(p_label), '');
  v_url text := nullif(btrim(p_attachment_url), '');
  v_kind_label text;
  v_row public.ipas_documents;
begin
  v_ipas := public._ipas_lock_open('ipas_add_document', p_ipas_id);

  if p_kind_id is not null and v_label is not null then
    raise exception 'ipas_add_document: pick a document kind or type a name, not both' using errcode = '22023';
  end if;
  if p_kind_id is null and v_label is null then
    raise exception 'ipas_add_document: pick a document kind or type the document''s name' using errcode = '22023';
  end if;
  if v_label is not null and length(v_label) > 200 then
    raise exception 'ipas_add_document: a document''s name is 200 characters at most' using errcode = '22023';
  end if;
  if v_url is not null and v_url !~* '^https?://' then
    raise exception 'ipas_add_document: the attachment must be a link to the uploaded file' using errcode = '22023';
  end if;
  if p_kind_id is not null then
    v_kind_label := public._ipas_check_option('ipas_add_document', p_kind_id, 'document_kind', null, 'document kind');
  end if;

  begin
    insert into public.ipas_documents (ipas_id, kind_id, label, attachment_url, created_by)
    values (v_ipas.id, p_kind_id, v_label, v_url, v_actor)
    returning * into v_row;
  exception when unique_violation then
    raise exception 'ipas_add_document: % is already on %', coalesce(v_kind_label, v_label), v_ipas.number
      using errcode = '23505';
  end;

  perform public._ipas_write_event(v_ipas.id, v_actor, 'document_added', jsonb_build_object(
    'document_id', v_row.id,
    'kind_id', v_row.kind_id,
    'label', coalesce(v_kind_label, v_label),
    'by_hand', v_row.kind_id is null,
    'has_attachment', v_row.attachment_url is not null
  ));

  return v_row;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.ipas_add_payment(p_ipas_id uuid, p_kind text, p_paid_on date, p_amount numeric, p_php_debited numeric, p_charge_fee_php numeric, p_method_id uuid, p_check_no text, p_proof_url text)
 RETURNS ipas_payments
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_actor uuid := public._ipas_money_writer('ipas_add_payment');
  v_ipas public.ipas;
  v_clean jsonb;
  v_check text := nullif(btrim(p_check_no), '');
  v_proof text := nullif(btrim(p_proof_url), '');
  v_row public.ipas_payments;
begin
  v_ipas := public._ipas_lock_open('ipas_add_payment', p_ipas_id);
  v_clean := public._ipas_clean_payment(
    'ipas_add_payment', v_ipas, p_kind, p_paid_on, p_amount, p_php_debited, p_charge_fee_php, p_method_id, null
  );
  if v_proof is not null and v_proof !~* '^https?://' then
    raise exception 'ipas_add_payment: the proof of payment must be a link to the uploaded file' using errcode = '22023';
  end if;

  insert into public.ipas_payments (
    ipas_id, kind, paid_on, amount, php_debited, charge_fee_php, method_id, check_no, proof_url, created_by
  ) values (
    v_ipas.id, p_kind, p_paid_on,
    (v_clean->>'amount')::numeric,
    (v_clean->>'php_debited')::numeric,
    (v_clean->>'charge_fee_php')::numeric,
    p_method_id, v_check, v_proof, v_actor
  )
  returning * into v_row;

  perform public._ipas_write_event(v_ipas.id, v_actor, 'payment_added', jsonb_build_object(
    'payment_id', v_row.id,
    'kind', v_row.kind,
    'paid_on', v_row.paid_on,
    'amount', v_row.amount,
    'php_debited', v_row.php_debited,
    'charge_fee_php', v_row.charge_fee_php,
    'method_id', v_row.method_id,
    'method', v_clean->>'method_label',
    'check_no', v_row.check_no,
    'has_proof', v_row.proof_url is not null,
    'currency', v_ipas.odoo_copy->'po'->>'currency'
  ));

  return v_row;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.ipas_assert_unchanged(p_ipas_id uuid, p_since timestamp with time zone)
 RETURNS void
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if auth.uid() is null then
    raise exception 'ipas_assert_unchanged: not signed in' using errcode = '42501';
  end if;
  if p_since is null then
    return;
  end if;
  if exists (
    select 1 from public.ipas_events e
     where e.ipas_id = p_ipas_id
       and e.created_at > p_since
       and e.kind not in ('odoo_copy_changed', 'filled_from_odoo', 'odoo_changed_since_filing')
       and not (e.kind = 'approvals_cleared' and e.detail ->> 'reason' = 'PO changed in Odoo')
  ) then
    raise exception 'ipas_assert_unchanged: someone else saved this IPAS after you opened it. Nothing was saved. Reload to see their changes; what you typed is still here.'
      using errcode = '40001';
  end if;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.ipas_can_read()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1 from employees e
    where e.id = get_employee_id()
      and not coalesce(e.is_deleted, false)
      and (
        coalesce(e.has_purchasing_flow, false)
        or coalesce(e.has_finance_flow, false)
        or coalesce(e.is_super_admin, false)
        or exists (
          select 1 from ipas_signer_lists l
           where l.employee_id = e.id
             and l.list_key not like 'transmittal\_%' escape '\'
        )
      )
  );
$function$
;
CREATE OR REPLACE FUNCTION public.ipas_can_read_bank_details()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1 from employees e
    where e.id = get_employee_id()
      and not coalesce(e.is_deleted, false)
      and (
        coalesce(e.has_purchasing_flow, false)
        or coalesce(e.has_finance_flow, false)
        or coalesce(e.is_super_admin, false)
        or exists (
          select 1 from ipas_signer_lists l
          where l.employee_id = e.id
            and l.list_key in ('s1_approved', 's3_approved')
        )
      )
  );
$function$
;
CREATE OR REPLACE FUNCTION public.ipas_cancel(p_ipas_id uuid, p_reason text)
 RETURNS ipas
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_actor uuid := public.get_employee_id();
  v_reason text := nullif(btrim(p_reason), '');
  v_row public.ipas;
begin
  if v_actor is null then
    raise exception 'ipas_cancel: not signed in' using errcode = '42501';
  end if;
  if not public.has_purchasing_access() then
    raise exception 'ipas_cancel: only Purchasing cancels an IPAS' using errcode = '42501';
  end if;
  if v_reason is null then
    raise exception 'ipas_cancel: a cancelled IPAS needs a reason' using errcode = '22023';
  end if;

  select * into v_row from public.ipas where id = p_ipas_id for update;
  if v_row.id is null then
    raise exception 'ipas_cancel: IPAS % not found', p_ipas_id using errcode = '22023';
  end if;
  if v_row.state = 'filed' then
    raise exception 'ipas_cancel: % is filed; a Super Admin reopens it before it can be cancelled', v_row.number
      using errcode = '22023';
  end if;
  if v_row.state = 'cancelled' then
    raise exception 'ipas_cancel: % is already cancelled', v_row.number using errcode = '22023';
  end if;

  update public.ipas
     set state = 'cancelled',
         cancel_reason = v_reason,
         cancelled_by = v_actor,
         cancelled_at = now()
   where id = v_row.id
  returning * into v_row;

  perform public._ipas_write_event(v_row.id, v_actor, 'cancelled', jsonb_build_object('reason', v_reason));

  return v_row;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.ipas_children_freeze_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_ids uuid[];
  v_number text;
begin
  if tg_op = 'INSERT' then
    v_ids := array[new.ipas_id];
  elsif tg_op = 'DELETE' then
    v_ids := array[old.ipas_id];
  else
    v_ids := array[old.ipas_id, new.ipas_id];
  end if;

  select i.number into v_number
    from public.ipas i
   where i.id = any (v_ids) and i.state = 'filed'
   limit 1
     for share;

  if v_number is not null then
    raise exception '%: % is filed and frozen; a Super Admin reopens it first', tg_table_name, v_number
      using errcode = '22023';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.ipas_create(p_po_number text, p_priority text, p_source text, p_purpose text, p_sor_ids uuid[], p_remarks text, p_odoo_copy jsonb)
 RETURNS ipas
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if public.get_employee_id() is null then
    raise exception 'ipas_create: not signed in' using errcode = '42501';
  end if;
  raise exception 'ipas_create: an IPAS is raised through the server, which reads the PO from Odoo itself; reload the page and try again'
    using errcode = '42501';
end;
$function$
;
CREATE OR REPLACE FUNCTION public.ipas_enforce_sor_rule()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
declare
  v_ids uuid[];
  v_id uuid;
  v_purpose text;
  v_number text;
  v_count integer;
begin
  if tg_table_name = 'ipas' then
    v_ids := array[new.id];
  elsif tg_op = 'DELETE' then
    v_ids := array[old.ipas_id];
  elsif tg_op = 'UPDATE' and new.ipas_id is distinct from old.ipas_id then
    v_ids := array[new.ipas_id, old.ipas_id];
  else
    v_ids := array[new.ipas_id];
  end if;

  foreach v_id in array v_ids loop
    select i.purpose, i.number into v_purpose, v_number from public.ipas i where i.id = v_id;
    -- The IPAS itself is gone (a cascade): nothing left to hold to the rule.
    if v_purpose is null then
      continue;
    end if;
    select count(*) into v_count from public.ipas_sors s where s.ipas_id = v_id;
    if v_purpose = 'project' and v_count = 0 then
      raise exception '% is a Project IPAS and needs at least one SOR', v_number using errcode = '22023';
    end if;
    if v_purpose <> 'project' and v_count > 0 then
      raise exception '% is not a Project IPAS and can''t name an SOR', v_number using errcode = '22023';
    end if;
  end loop;
  return null;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.ipas_events_append_only()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  raise exception 'ipas_events is append-only: history can''t be changed (% refused)', tg_op
    using errcode = '42501';
end;
$function$
;
CREATE OR REPLACE FUNCTION public.ipas_filed_option_ids()
 RETURNS uuid[]
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select case when public.ipas_can_read() then
    coalesce((select array_agg(o.id) from ipas_options o where public.ipas_option_on_filed(o.id)), '{}'::uuid[])
  else '{}'::uuid[] end;
$function$
;
CREATE OR REPLACE FUNCTION public.ipas_filing_clears_hold()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if new.state = 'filed' and old.state is distinct from 'filed' and new.on_hold then
    new.on_hold := false;
    new.on_hold_note := null;
    perform public._ipas_write_event(
      new.id,
      public.get_employee_id(),
      'on_hold_cleared',
      jsonb_build_object('note', null, 'previous_note', old.on_hold_note, 'reason', 'filed')
    );
  end if;
  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.ipas_fill_from_odoo_copy()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  if nullif(btrim(new.supplier_contact), '') is null then
    new.supplier_contact := nullif(btrim(new.odoo_copy->'supplier'->>'contact'), '');
  end if;
  if nullif(btrim(new.pi_number), '') is null then
    new.pi_number := nullif(btrim(new.odoo_copy->'po'->>'partner_ref'), '');
  end if;
  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.ipas_find_sors(p_refs text[] DEFAULT NULL::text[], p_search text DEFAULT NULL::text)
 RETURNS TABLE(opportunity_id uuid, sor_code text, sales_reference text, project_title text, current_stage_name text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_refs text[];
  v_term text := lower(nullif(btrim(p_search), ''));
  -- "SOR-198", "sor 198" and "sor198" are the same thing to a person.
  v_squash text := nullif(regexp_replace(lower(coalesce(p_search, '')), '[\s-]', '', 'g'), '');
begin
  if public.get_employee_id() is null then
    raise exception 'ipas_find_sors: not signed in' using errcode = '42501';
  end if;
  if not (coalesce(public.has_purchasing_access(), false) or public.transmittal_on_list('transmittal_warehouse')) then
    raise exception 'ipas_find_sors: only Purchasing or the Warehouse list looks up SORs' using errcode = '42501';
  end if;

  select coalesce(array_agg(distinct upper(btrim(r))), '{}'::text[]) into v_refs
    from unnest(coalesce(p_refs, '{}'::text[])) r;

  return query
    select o.id, o.sor_code, o.sales_reference, o.project_title, fs.name
      from public.sales_opportunities o
      left join public.flow_stages fs on fs.id = o.flow_stage_id
     where not coalesce(o.is_deleted, false)
       and not coalesce(o.is_scratch, false)
       and (
         o.sales_reference = any (v_refs)
         or (
           v_term is not null
           and (
             position(v_term in lower(coalesce(o.sales_reference, ''))) > 0
             or position(v_term in lower(coalesce(o.opportunity_no, ''))) > 0
             or position(v_term in lower(coalesce(o.project_title, ''))) > 0
             or (
               v_squash is not null
               and position(v_squash in regexp_replace(lower(coalesce(o.sor_code, '')), '[\s-]', '', 'g')) > 0
             )
           )
         )
       )
     order by o.serial_no desc
     limit 25;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.ipas_format_number(p_value bigint)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  select 'TGIPAS_' || lpad(p_value::text, greatest(3, length(p_value::text)), '0');
$function$
;
CREATE OR REPLACE FUNCTION public.ipas_freeze_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  if old.state is distinct from 'filed' then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    raise exception 'ipas: % is filed and frozen; it can''t be deleted', old.number using errcode = '22023';
  end if;

  if coalesce(current_setting('ipas.reopening', true), '') = 'on' then
    return new;
  end if;

  -- "Odoo has changed since filing" moves both ways; updated_at moves with it.
  if (to_jsonb(new) - 'odoo_changed_since_filing' - 'updated_at')
     = (to_jsonb(old) - 'odoo_changed_since_filing' - 'updated_at') then
    return new;
  end if;

  raise exception 'ipas: % is filed and frozen; a Super Admin reopens it first', old.number using errcode = '22023';
end;
$function$
;
CREATE OR REPLACE FUNCTION public.ipas_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  if new.number is distinct from old.number then
    raise exception 'ipas: the number of % can''t change', old.number using errcode = '42501';
  end if;
  if new.po_number is distinct from old.po_number then
    raise exception 'ipas: the PO of % can''t change; cancel it and raise a new IPAS', old.number
      using errcode = '42501';
  end if;
  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.ipas_highest_number_given()
 RETURNS bigint
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce(max((substring(number from '^TGIPAS_(\d+)$'))::bigint), 0)
  from public.ipas;
$function$
;
CREATE OR REPLACE FUNCTION public.ipas_landed_cost(p_ipas_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select case when coalesce(public.ipas_can_read(), false) then public._ipas_landed_cost(p_ipas_id) end
$function$
;
CREATE OR REPLACE FUNCTION public.ipas_lc_header_changed()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if new.computation_status is distinct from old.computation_status
     and new.computation_status in ('encoding', 'encoded', 'lc_gs_done') then
    perform public._ipas_clear_section_3_for_lc(new.id, 'Status moved below LC Odoo Done', true);
  elsif new.odoo_copy is distinct from old.odoo_copy then
    perform public._ipas_clear_section_3_for_lc(new.id, 'PO changed in Odoo');
  elsif new.landed_cost_split is distinct from old.landed_cost_split then
    perform public._ipas_clear_section_3_for_lc(new.id, 'Spread changed');
  end if;
  return null;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.ipas_lc_money_changed()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_what text := case when tg_table_name = 'ipas_payments' then 'Payment' else 'Charge' end;
  v_verb text := case tg_op when 'INSERT' then 'added' when 'DELETE' then 'removed' else 'changed' end;
begin
  perform public._ipas_clear_section_3_for_lc(
    case when tg_op = 'DELETE' then old.ipas_id else new.ipas_id end,
    v_what || ' ' || v_verb
  );
  return null;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.ipas_line_landed_costs(p_ipas_id uuid)
 RETURNS TABLE(odoo_line_id integer, quantity numeric, unit_php numeric, total_php numeric, mark text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with lc as (select public._ipas_landed_cost(p_ipas_id) as r),
  copy as (
    select public._lc_num(e.l ->> 'line_id')::integer as lid, public._lc_num(e.l ->> 'quantity') as qty, e.ord
    from public.ipas i
    cross join lateral jsonb_array_elements(case when jsonb_typeof(i.odoo_copy -> 'lines') = 'array' then i.odoo_copy -> 'lines' else '[]'::jsonb end)
      with ordinality as e(l, ord)
    where i.id = p_ipas_id and public._lc_num(e.l ->> 'quantity') > 0
  )
  -- Unavailable: every line, no figures.
  select copy.lid, copy.qty, null::numeric, null::numeric, 'unavailable'
  from copy, lc
  where lc.r ->> 'status' = 'unavailable'
  union all
  select public._lc_num(l ->> 'lineId')::integer, (l ->> 'quantity')::numeric,
         (l ->> 'landedPerUnitPhp')::numeric, (l ->> 'landedPhp')::numeric, lc.r ->> 'status'
  from lc
  cross join lateral jsonb_array_elements(lc.r -> 'lines') as l
  where lc.r ->> 'status' <> 'unavailable'
$function$
;
CREATE OR REPLACE FUNCTION public.ipas_next_number()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_last bigint;
  v_called boolean;
  v_next bigint;
begin
  if public.get_employee_id() is null then
    raise exception 'ipas_next_number: sign in first' using errcode = '42501';
  end if;

  select last_value, is_called into v_last, v_called from public.ipas_number_seq;
  v_next := case when v_called then v_last + 1 else v_last end;

  return jsonb_build_object(
    'next_value', v_next,
    'number_format', public.ipas_format_number(v_next),
    'highest_given', public.ipas_highest_number_given()
  );
end;
$function$
;
CREATE OR REPLACE FUNCTION public.ipas_option_on_filed(p_option_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1 from ipas i
     where i.state = 'filed'
       and (i.freight_service_id = p_option_id or i.item_location_id = p_option_id)
  ) or exists (
    select 1 from ipas_payments p join ipas i on i.id = p.ipas_id
     where i.state = 'filed' and p.method_id = p_option_id
  ) or exists (
    select 1 from ipas_charges c join ipas i on i.id = c.ipas_id
     where i.state = 'filed' and c.kind_id = p_option_id
  ) or exists (
    select 1 from ipas_documents d join ipas i on i.id = d.ipas_id
     where i.state = 'filed' and d.kind_id = p_option_id
  );
$function$
;
CREATE OR REPLACE FUNCTION public.ipas_options_filed_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if (
    new.label is distinct from old.label
    or new.applies_to is distinct from old.applies_to
    or new.used_for is distinct from old.used_for
  ) and public.ipas_option_on_filed(old.id) then
    raise exception 'ipas_options: "%" is used on a filed IPAS. Deactivate it and add a new one instead.', old.label
      using errcode = '22023';
  end if;
  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.ipas_options_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  if new.list is distinct from old.list then
    raise exception 'ipas_options: an option can''t move to another list' using errcode = '42501';
  end if;
  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.ipas_override_field(p_ipas_id uuid, p_field text, p_value text)
 RETURNS ipas
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_actor uuid := public.get_employee_id();
  v_value text := nullif(btrim(p_value), '');
  v_row public.ipas;
  v_from text;
begin
  if v_actor is null then
    raise exception 'ipas_override_field: not signed in' using errcode = '42501';
  end if;
  if not public.has_purchasing_access() then
    raise exception 'ipas_override_field: only Purchasing overrides an Odoo field' using errcode = '42501';
  end if;
  if p_field is null or p_field not in ('entity', 'source_doc', 'analytic') then
    raise exception 'ipas_override_field: % can''t be overridden; only Entity, Source Doc. and Analytic Dist. can (Currency, Supplier, item lines and Brand are fixed on the PO in Odoo)',
      coalesce(p_field, 'null')
      using errcode = '22023';
  end if;
  if v_value is null then
    raise exception 'ipas_override_field: type a value, or reset the field to Odoo' using errcode = '22023';
  end if;

  select * into v_row from public.ipas where id = p_ipas_id for update;
  if v_row.id is null then
    raise exception 'ipas_override_field: IPAS % not found', p_ipas_id using errcode = '22023';
  end if;
  if v_row.state = 'filed' then
    raise exception 'ipas_override_field: % is filed; a Super Admin reopens it first', v_row.number using errcode = '22023';
  end if;
  if v_row.state = 'cancelled' then
    raise exception 'ipas_override_field: % is cancelled', v_row.number using errcode = '22023';
  end if;

  v_from := case p_field
    when 'entity' then v_row.entity_override
    when 'source_doc' then v_row.source_doc_override
    else v_row.analytic_override
  end;
  if v_from is not distinct from v_value then
    return v_row;
  end if;

  update public.ipas
     set entity_override     = case when p_field = 'entity' then v_value else entity_override end,
         source_doc_override = case when p_field = 'source_doc' then v_value else source_doc_override end,
         analytic_override   = case when p_field = 'analytic' then v_value else analytic_override end
   where id = v_row.id
  returning * into v_row;

  perform public._ipas_write_event(v_row.id, v_actor, 'override_set', jsonb_build_object(
    'field', p_field,
    'from', v_from,
    'to', v_value,
    'odoo', public._ipas_odoo_value(v_row.odoo_copy, p_field)
  ));

  return v_row;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.ipas_payments_paid_before_approval()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if tg_op = 'INSERT' then
    new.paid_before_approval := not exists (
      select 1 from public.ipas_signoffs s
       where s.ipas_id = new.ipas_id
         and s.section = 1
         and s.role = 'approved'
         and s.cleared_at is null
    );
  else
    new.paid_before_approval := old.paid_before_approval;
  end if;
  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.ipas_raise_from_odoo(p_actor uuid, p_po_number text, p_priority text, p_source text, p_purpose text, p_sor_ids uuid[], p_remarks text, p_verdict text, p_odoo_copy jsonb)
 RETURNS ipas
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_po text := upper(btrim(p_po_number));
  v_sors uuid[];
  v_existing text;
  v_row public.ipas;
begin
  if p_actor is null or not public._employee_has_purchasing_access(p_actor) then
    raise exception 'ipas_create: only Purchasing raises an IPAS' using errcode = '42501';
  end if;

  if v_po is null or v_po !~ '^P[0-9]+$' then
    raise exception 'ipas_create: % isn''t an Odoo PO number ("P" then digits, e.g. P01234)', coalesce(p_po_number, 'null')
      using errcode = '22023';
  end if;
  if p_priority is null or p_priority not in ('very_high', 'high', 'medium') then
    raise exception 'ipas_create: % isn''t a Priority', coalesce(p_priority, 'null') using errcode = '22023';
  end if;
  if p_source is null or p_source not in ('import', 'local') then
    raise exception 'ipas_create: % isn''t a Source', coalesce(p_source, 'null') using errcode = '22023';
  end if;
  if p_purpose is null or p_purpose not in ('project', 'inventory', 'supplies', 'events') then
    raise exception 'ipas_create: % isn''t a Purpose', coalesce(p_purpose, 'null') using errcode = '22023';
  end if;

  -- What Odoo said, as the server heard it.
  if p_verdict is distinct from 'found' then
    if p_verdict = 'not_found' then
      raise exception 'ipas_create: Odoo has no purchase order named %', v_po using errcode = '22023', hint = 'odoo_not_found';
    elsif p_verdict = 'unavailable' then
      raise exception 'ipas_create: Odoo couldn''t be asked about %; try again shortly', v_po using errcode = '22023', hint = 'odoo_unavailable';
    end if;
    raise exception 'ipas_create: % isn''t an Odoo verdict', coalesce(p_verdict, 'null') using errcode = '22023';
  end if;

  if p_odoo_copy is null
     or jsonb_typeof(p_odoo_copy) <> 'object'
     or jsonb_typeof(p_odoo_copy->'po') is distinct from 'object'
     or jsonb_typeof(p_odoo_copy->'lines') is distinct from 'array' then
    raise exception 'ipas_create: the Odoo copy is missing' using errcode = '22023';
  end if;
  if upper(btrim(p_odoo_copy->'po'->>'name')) is distinct from v_po then
    raise exception 'ipas_create: the Odoo copy is for %, not %', coalesce(p_odoo_copy->'po'->>'name', 'no PO'), v_po
      using errcode = '22023';
  end if;

  v_sors := public._ipas_clean_sor_ids('ipas_create', p_purpose, p_sor_ids);

  select i.number into v_existing
    from public.ipas i
   where i.po_number = v_po and i.state <> 'cancelled';
  if v_existing is not null then
    raise exception 'ipas_create: % already has a live IPAS (%); cancel it to raise a new one', v_po, v_existing
      using errcode = '23505';
  end if;

  insert into public.ipas (
    po_number, odoo_po_id, priority, source, purpose, remarks, odoo_copy, created_by
  ) values (
    v_po,
    case when (p_odoo_copy->'po'->>'id') ~ '^[0-9]+$' then (p_odoo_copy->'po'->>'id')::integer end,
    p_priority,
    p_source,
    p_purpose,
    nullif(btrim(p_remarks), ''),
    p_odoo_copy,
    p_actor
  )
  returning * into v_row;

  insert into public.ipas_sors (ipas_id, opportunity_id)
  select v_row.id, s from unnest(v_sors) s;

  perform public._ipas_write_event(v_row.id, p_actor, 'created', jsonb_build_object(
    'number', v_row.number,
    'po_number', v_row.po_number,
    'priority', v_row.priority,
    'source', v_row.source,
    'purpose', v_row.purpose,
    'sor_ids', to_jsonb(v_sors)
  ));

  return v_row;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.ipas_recent_sors()
 RETURNS TABLE(opportunity_id uuid, sor_code text, sales_reference text, project_title text, current_stage_name text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_me uuid := public.get_employee_id();
begin
  if v_me is null then
    raise exception 'ipas_recent_sors: not signed in' using errcode = '42501';
  end if;
  if not coalesce(public.has_purchasing_access(), false) then
    raise exception 'ipas_recent_sors: only Purchasing picks an IPAS''s SORs' using errcode = '42501';
  end if;

  return query
    select o.id, o.sor_code, o.sales_reference, o.project_title, fs.name
      from (
        select s.opportunity_id as opp_id, max(s.created_at) as last_named
          from public.ipas_sors s
          join public.ipas i on i.id = s.ipas_id
         where i.created_by = v_me
         group by s.opportunity_id
      ) r
      join public.sales_opportunities o on o.id = r.opp_id
      left join public.flow_stages fs on fs.id = o.flow_stage_id
     where not coalesce(o.is_deleted, false)
       and not coalesce(o.is_scratch, false)
     order by r.last_named desc, o.serial_no desc
     limit 5;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.ipas_record_odoo_copy(p_ipas_id uuid, p_odoo_copy jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_actor uuid := public.get_employee_id();
  v_row public.ipas;
  v_before public.ipas;
  v_note jsonb;
  v_lines_changed boolean;
  v_digest_changed boolean;
  v_state_from text;
  v_state_to text;
  v_filled text[] := '{}';
  v_sections integer[] := '{}';
  v_preparers uuid[] := '{}';
begin
  if v_actor is null then
    raise exception 'ipas_record_odoo_copy: not signed in' using errcode = '42501';
  end if;
  if not public.ipas_can_read() then
    raise exception 'ipas_record_odoo_copy: you can''t read IPAS' using errcode = '42501';
  end if;

  if p_odoo_copy is null
     or jsonb_typeof(p_odoo_copy) <> 'object'
     or jsonb_typeof(p_odoo_copy->'po') is distinct from 'object'
     or jsonb_typeof(p_odoo_copy->'lines') is distinct from 'array' then
    raise exception 'ipas_record_odoo_copy: the Odoo copy is missing' using errcode = '22023';
  end if;

  select * into v_row from public.ipas where id = p_ipas_id for update;
  if v_row.id is null then
    raise exception 'ipas_record_odoo_copy: IPAS % not found', p_ipas_id using errcode = '22023';
  end if;
  if upper(btrim(p_odoo_copy->'po'->>'name')) is distinct from v_row.po_number then
    raise exception 'ipas_record_odoo_copy: the Odoo copy is for %, not %',
      coalesce(p_odoo_copy->'po'->>'name', 'no PO'), v_row.po_number
      using errcode = '22023';
  end if;
  if v_row.state = 'cancelled' then
    raise exception 'ipas_record_odoo_copy: % is cancelled and keeps the copy it had', v_row.number
      using errcode = '22023';
  end if;

  v_before := v_row;
  v_digest_changed := public._ipas_copy_digest(v_row.odoo_copy) is distinct from public._ipas_copy_digest(p_odoo_copy);

  -- A filed IPAS keeps its frozen copy. All that moves is the flag, in step with
  -- whether the PO still matches what was filed.
  if v_row.state = 'filed' then
    if v_digest_changed is distinct from v_row.odoo_changed_since_filing then
      update public.ipas set odoo_changed_since_filing = v_digest_changed where id = v_row.id returning * into v_row;
      if v_digest_changed then
        perform public._ipas_write_event(v_row.id, v_actor, 'odoo_changed_since_filing', jsonb_build_object(
          'note', public._ipas_change_note(v_before.odoo_copy, p_odoo_copy, v_before.odoo_fetched_at)
        ));
      end if;
    end if;
    return jsonb_build_object(
      'ipas', to_jsonb(v_row),
      'changed', false,
      'filed', true,
      'approvals_cleared', '[]'::jsonb,
      'preparer_ids', '[]'::jsonb
    );
  end if;

  v_note := public._ipas_change_note(v_row.odoo_copy, p_odoo_copy, v_row.odoo_fetched_at);
  v_lines_changed := v_note is not null;
  v_state_from := public._ipas_po_state_class(v_row.odoo_copy);
  v_state_to := public._ipas_po_state_class(p_odoo_copy);

  -- The trigger fills a blank contact and P.I # from the new copy.
  update public.ipas
     set odoo_copy = p_odoo_copy,
         odoo_fetched_at = now(),
         odoo_po_id = case when (p_odoo_copy->'po'->>'id') ~ '^[0-9]+$' then (p_odoo_copy->'po'->>'id')::integer else odoo_po_id end,
         odoo_change_note = case
           when v_note is null then odoo_change_note
           else v_note || jsonb_build_object('at', now())
         end
   where id = v_row.id
  returning * into v_row;

  if v_row.supplier_contact is distinct from v_before.supplier_contact then
    v_filled := array_append(v_filled, 'supplier_contact');
  end if;
  if v_row.pi_number is distinct from v_before.pi_number then
    v_filled := array_append(v_filled, 'pi_number');
  end if;
  if cardinality(v_filled) > 0 then
    perform public._ipas_write_event(v_row.id, v_actor, 'filled_from_odoo', jsonb_build_object(
      'fields', to_jsonb(v_filled),
      'supplier_contact', case when 'supplier_contact' = any (v_filled) then v_row.supplier_contact end,
      'pi_number', case when 'pi_number' = any (v_filled) then v_row.pi_number end
    ));
  end if;

  if v_lines_changed or v_state_from is distinct from v_state_to then
    perform public._ipas_write_event(v_row.id, v_actor, 'odoo_copy_changed', jsonb_build_object(
      'note', v_note,
      'po_state_from', v_before.odoo_copy->'po'->>'state',
      'po_state_to', p_odoo_copy->'po'->>'state'
    ));
  end if;

  -- Lines or the total changed: the live section 1 and 3 approvals no longer
  -- approve what is being bought. Prepared stays, so the section goes back to
  -- awaiting approval.
  if v_lines_changed then
    select c.sections, c.preparer_ids
      into v_sections, v_preparers
      from public._ipas_clear_approvals(v_row.id, v_actor, 'PO changed in Odoo') c;
  end if;

  return jsonb_build_object(
    'ipas', to_jsonb(v_row),
    'changed', v_lines_changed,
    'filed', false,
    'approvals_cleared', to_jsonb(v_sections),
    'preparer_ids', to_jsonb(v_preparers)
  );
end;
$function$
;
CREATE OR REPLACE FUNCTION public.ipas_refresh_from_odoo(p_actor_email text, p_ipas_id uuid, p_odoo_copy jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if p_actor_email is null or btrim(p_actor_email) = '' then
    raise exception 'ipas_record_odoo_copy: not signed in' using errcode = '42501';
  end if;

  -- Act as the caller the edge function authenticated: identity is the JWT email claim.
  perform set_config('request.jwt.claims',
    jsonb_build_object('email', p_actor_email, 'role', 'authenticated')::text, true);

  return public.ipas_record_odoo_copy(p_ipas_id, p_odoo_copy);
end;
$function$
;
CREATE OR REPLACE FUNCTION public.ipas_remove_charge(p_charge_id uuid)
 RETURNS ipas_charges
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_actor uuid := public._ipas_money_writer('ipas_remove_charge');
  v_ipas_id uuid;
  v_ipas public.ipas;
  v_row public.ipas_charges;
begin
  select ipas_id into v_ipas_id from public.ipas_charges where id = p_charge_id;
  if v_ipas_id is null then
    raise exception 'ipas_remove_charge: charge % not found', p_charge_id using errcode = '22023';
  end if;

  v_ipas := public._ipas_lock_open('ipas_remove_charge', v_ipas_id);
  delete from public.ipas_charges where id = p_charge_id returning * into v_row;
  if v_row.id is null then
    raise exception 'ipas_remove_charge: charge % not found', p_charge_id using errcode = '22023';
  end if;

  perform public._ipas_write_event(v_ipas.id, v_actor, 'charge_removed', jsonb_build_object(
    'charge_id', v_row.id,
    'kind', (select o.label from public.ipas_options o where o.id = v_row.kind_id),
    'charged_on', v_row.charged_on,
    'amount_php', v_row.amount_php
  ));

  return v_row;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.ipas_remove_document(p_document_id uuid)
 RETURNS ipas_documents
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_actor uuid := public._ipas_purchasing_writer('ipas_remove_document');
  v_row public.ipas_documents;
  v_label text;
begin
  v_row := public._ipas_lock_document('ipas_remove_document', p_document_id);
  if v_row.kind_id is not null then
    raise exception 'ipas_remove_document: % is a listed document kind; only a document added by hand can be removed', public._ipas_document_label(v_row)
      using errcode = '22023';
  end if;
  if v_row.finance_has then
    raise exception 'ipas_remove_document: Finance has ticked this document; ask Finance to untick it first'
      using errcode = '22023';
  end if;
  v_label := public._ipas_document_label(v_row);

  delete from public.ipas_documents where id = v_row.id;

  perform public._ipas_write_event(v_row.ipas_id, v_actor, 'document_removed', jsonb_build_object(
    'document_id', v_row.id,
    'label', v_label,
    'purchasing_has', v_row.purchasing_has,
    'had_attachment', v_row.attachment_url is not null
  ));

  return v_row;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.ipas_remove_payment(p_payment_id uuid)
 RETURNS ipas_payments
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_actor uuid := public._ipas_money_writer('ipas_remove_payment');
  v_ipas_id uuid;
  v_ipas public.ipas;
  v_row public.ipas_payments;
begin
  select ipas_id into v_ipas_id from public.ipas_payments where id = p_payment_id;
  if v_ipas_id is null then
    raise exception 'ipas_remove_payment: payment % not found', p_payment_id using errcode = '22023';
  end if;

  v_ipas := public._ipas_lock_open('ipas_remove_payment', v_ipas_id);
  delete from public.ipas_payments where id = p_payment_id returning * into v_row;
  if v_row.id is null then
    raise exception 'ipas_remove_payment: payment % not found', p_payment_id using errcode = '22023';
  end if;

  perform public._ipas_write_event(v_ipas.id, v_actor, 'payment_removed', jsonb_build_object(
    'payment_id', v_row.id,
    'kind', v_row.kind,
    'paid_on', v_row.paid_on,
    'amount', v_row.amount,
    'php_debited', v_row.php_debited,
    'charge_fee_php', v_row.charge_fee_php,
    'method', (select o.label from public.ipas_options o where o.id = v_row.method_id),
    'check_no', v_row.check_no,
    'had_proof', v_row.proof_url is not null,
    'currency', v_ipas.odoo_copy->'po'->>'currency'
  ));

  return v_row;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.ipas_reopen(p_ipas_id uuid, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_actor uuid := public.get_employee_id();
  v_reason text := nullif(btrim(p_reason), '');
  v_row public.ipas;
  v_roles text[];
begin
  if v_actor is null then
    raise exception 'ipas_reopen: not signed in' using errcode = '42501';
  end if;
  if not coalesce(public.is_super_admin(), false) then
    raise exception 'ipas_reopen: only a Super Admin reopens a filed IPAS' using errcode = '42501';
  end if;
  if v_reason is null then
    raise exception 'ipas_reopen: give the reason this IPAS is being reopened' using errcode = '22023';
  end if;
  if length(v_reason) > 500 then
    raise exception 'ipas_reopen: the reason is 500 characters at most' using errcode = '22023';
  end if;

  select * into v_row from public.ipas where id = p_ipas_id for update;
  if v_row.id is null then
    raise exception 'ipas_reopen: IPAS % not found', p_ipas_id using errcode = '22023';
  end if;
  if v_row.state <> 'filed' then
    raise exception 'ipas_reopen: % isn''t filed', v_row.number using errcode = '22023';
  end if;

  -- The freeze lets this one update through; the setting lasts for this
  -- transaction and is switched off again straight after.
  perform set_config('ipas.reopening', 'on', true);
  update public.ipas
     set state = 'open', filed_at = null, odoo_changed_since_filing = false
   where id = v_row.id
  returning * into v_row;
  perform set_config('ipas.reopening', 'off', true);

  with cleared as (
    update public.ipas_signoffs s
       set cleared_at = now(), cleared_by = v_actor, cleared_reason = 'Reopened: ' || v_reason
     where s.ipas_id = v_row.id
       and s.section = 7
       and s.cleared_at is null
    returning s.role
  )
  select coalesce(array_agg(role order by role), '{}'::text[]) into v_roles from cleared;

  perform public._ipas_write_event(v_row.id, v_actor, 'reopened', jsonb_build_object(
    'reason', v_reason,
    'cleared', to_jsonb(v_roles)
  ));

  return jsonb_build_object(
    'ipas', to_jsonb(v_row),
    'actor_id', v_actor,
    'cleared_roles', to_jsonb(v_roles)
  );
end;
$function$
;
CREATE OR REPLACE FUNCTION public.ipas_reset_override(p_ipas_id uuid, p_field text)
 RETURNS ipas
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_actor uuid := public.get_employee_id();
  v_row public.ipas;
  v_from text;
begin
  if v_actor is null then
    raise exception 'ipas_reset_override: not signed in' using errcode = '42501';
  end if;
  if not public.has_purchasing_access() then
    raise exception 'ipas_reset_override: only Purchasing resets an Odoo field' using errcode = '42501';
  end if;
  if p_field is null or p_field not in ('entity', 'source_doc', 'analytic') then
    raise exception 'ipas_reset_override: % isn''t an overridable field', coalesce(p_field, 'null') using errcode = '22023';
  end if;

  select * into v_row from public.ipas where id = p_ipas_id for update;
  if v_row.id is null then
    raise exception 'ipas_reset_override: IPAS % not found', p_ipas_id using errcode = '22023';
  end if;
  if v_row.state = 'filed' then
    raise exception 'ipas_reset_override: % is filed; a Super Admin reopens it first', v_row.number using errcode = '22023';
  end if;
  if v_row.state = 'cancelled' then
    raise exception 'ipas_reset_override: % is cancelled', v_row.number using errcode = '22023';
  end if;

  v_from := case p_field
    when 'entity' then v_row.entity_override
    when 'source_doc' then v_row.source_doc_override
    else v_row.analytic_override
  end;
  if v_from is null then
    return v_row;
  end if;

  update public.ipas
     set entity_override     = case when p_field = 'entity' then null else entity_override end,
         source_doc_override = case when p_field = 'source_doc' then null else source_doc_override end,
         analytic_override   = case when p_field = 'analytic' then null else analytic_override end
   where id = v_row.id
  returning * into v_row;

  perform public._ipas_write_event(v_row.id, v_actor, 'override_reset', jsonb_build_object(
    'field', p_field,
    'from', v_from,
    'odoo', public._ipas_odoo_value(v_row.odoo_copy, p_field)
  ));

  return v_row;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.ipas_send_back(p_ipas_id uuid, p_section integer, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_actor uuid := public.get_employee_id();
  v_reason text := nullif(btrim(p_reason), '');
  v_ipas public.ipas;
  v_roles text[];
  v_preparers uuid[];
  v_notify uuid[];
  v_cascade text[] := '{}'::text[];
  v_cascade_ids uuid[] := '{}'::uuid[];
begin
  if v_actor is null then
    raise exception 'ipas_send_back: not signed in' using errcode = '42501';
  end if;
  if v_reason is null then
    raise exception 'ipas_send_back: give a reason, so the people who signed know what to fix' using errcode = '22023';
  end if;
  if length(v_reason) > 500 then
    raise exception 'ipas_send_back: the reason is 500 characters at most' using errcode = '22023';
  end if;
  if p_section is null or p_section not in (1, 3, 6, 7) then
    raise exception 'ipas_send_back: only sections 1, 2, 3 and 4 can be returned' using errcode = '22023';
  end if;

  -- Refuses a filed or cancelled IPAS (55000): a filed one is reopened, not returned.
  v_ipas := public._ipas_lock_open('ipas_send_back', p_ipas_id);

  if p_section = 7 then
    -- Anyone on a section 7 list, whichever sign-off they give.
    if not public._ipas_can_sign_section(7, v_actor) then
      raise exception 'ipas_send_back: only a signer of section % returns it', public._ipas_section_no(7) using errcode = '42501';
    end if;

    -- Section 7 is open once sections 1, 2 and 3 are approved (#590: the Filing gate
    -- now includes section 3, stored 6).
    if not public._ipas_filing_open(v_ipas.id) then
      raise exception 'ipas_send_back: section % isn''t open yet; sections %, % and % must be approved first', public._ipas_section_no(7), public._ipas_section_no(1), public._ipas_section_no(3), public._ipas_section_no(6) using errcode = '22023';
    end if;

    with cleared as (
      update public.ipas_signoffs s
         set cleared_at = now(), cleared_by = v_actor, cleared_reason = 'Returned: ' || v_reason
       where s.ipas_id = v_ipas.id
         and s.section = 7
         and s.role in ('received', 'noted', 'checked')
         and s.cleared_at is null
      returning s.role, s.signed_by
    )
    select coalesce(array_agg(role order by role), '{}'::text[]),
           coalesce(array_agg(distinct signed_by) filter (where signed_by is distinct from v_actor), '{}'::uuid[])
      into v_roles, v_notify
      from cleared;

    v_preparers := '{}'::uuid[];
  else
    if not public._ipas_can_sign_section(p_section, v_actor) then
      raise exception 'ipas_send_back: only a signer of section % returns it', public._ipas_section_no(p_section) using errcode = '42501';
    end if;

    with cleared as (
      update public.ipas_signoffs s
         set cleared_at = now(), cleared_by = v_actor, cleared_reason = 'Returned: ' || v_reason
       where s.ipas_id = v_ipas.id
         and s.section = p_section
         and s.role in ('prepared', 'approved')
         and s.cleared_at is null
      returning s.role, s.signed_by
    )
    select coalesce(array_agg(role order by role), '{}'::text[]),
           coalesce(array_agg(distinct signed_by) filter (where role = 'prepared'), '{}'::uuid[])
      into v_roles, v_preparers
      from cleared;

    v_notify := v_preparers;

    -- Section 4 no longer has two approved sections behind it: its open sign-offs go too.
    if cardinality(v_roles) > 0 then
      with cleared as (
        update public.ipas_signoffs s
           set cleared_at = now(), cleared_by = v_actor,
               cleared_reason = 'Section ' || public._ipas_section_no(p_section) || ' returned: ' || v_reason
         where s.ipas_id = v_ipas.id
           and s.section = 7
           and s.role in ('received', 'noted', 'checked')
           and s.cleared_at is null
        returning s.role, s.signed_by
      )
      select coalesce(array_agg(role order by role), '{}'::text[]),
             coalesce(array_agg(distinct signed_by) filter (where signed_by is distinct from v_actor), '{}'::uuid[])
        into v_cascade, v_cascade_ids
        from cleared;
      v_notify := (select coalesce(array_agg(distinct x), '{}'::uuid[]) from unnest(v_notify || v_cascade_ids) as x);
    end if;
  end if;

  if cardinality(v_roles) = 0 then
    raise exception 'ipas_send_back: section % has nothing to return', public._ipas_section_no(p_section) using errcode = '22023';
  end if;

  perform public._ipas_write_event(v_ipas.id, v_actor, 'sent_back', jsonb_build_object(
    'section', p_section,
    'reason', v_reason,
    'cleared', to_jsonb(v_roles),
    'cleared_section_7', to_jsonb(v_cascade)
  ));

  return jsonb_build_object(
    'ipas', to_jsonb(v_ipas),
    'section', p_section,
    'actor_id', v_actor,
    'cleared_roles', to_jsonb(v_roles),
    'cleared_section_7', to_jsonb(v_cascade),
    'preparer_ids', to_jsonb(v_preparers),
    'notify_ids', to_jsonb(v_notify)
  );
end;
$function$
;
CREATE OR REPLACE FUNCTION public.ipas_set_bank_details(p_ipas_id uuid, p_bank_name text, p_account_name text, p_account_number text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_actor uuid := public.get_employee_id();
  v_ipas public.ipas;
  v_before public.ipas_bank_details;
  v_row public.ipas_bank_details;
  v_bank text := nullif(btrim(p_bank_name), '');
  v_name text := nullif(btrim(p_account_name), '');
  v_number text := nullif(btrim(p_account_number), '');
  v_new boolean;
  v_key text;
  v_partner text;
  v_prev_id uuid;
  v_prev_number text;
  v_prev_key text;
  v_flagged boolean := false;
  v_account_changed boolean;
  v_fields text[] := '{}';
  v_sections integer[] := '{}';
  v_preparers uuid[] := '{}';
begin
  if v_actor is null then
    raise exception 'ipas_set_bank_details: not signed in' using errcode = '42501';
  end if;
  if not public.has_purchasing_access() then
    raise exception 'ipas_set_bank_details: only Purchasing types bank details' using errcode = '42501';
  end if;

  v_ipas := public._ipas_lock_open('ipas_set_bank_details', p_ipas_id);

  select * into v_before from public.ipas_bank_details where ipas_id = v_ipas.id for update;
  v_new := v_before.ipas_id is null;

  if length(coalesce(v_bank, '')) > 200 or length(coalesce(v_name, '')) > 200 then
    raise exception 'ipas_set_bank_details: Bank Name and Account Name are 200 characters at most' using errcode = '22023';
  end if;
  if length(coalesce(v_number, '')) > 100 then
    raise exception 'ipas_set_bank_details: Account # is 100 characters at most' using errcode = '22023';
  end if;

  v_key := public._ipas_account_key(v_number);

  -- Against the same supplier's most recent other IPAS that has an Account #.
  -- Security definer: the caller reads no other IPAS's bank details, only the
  -- answer. No Odoo partner id means nothing to match on.
  v_partner := nullif(v_ipas.odoo_copy->'supplier'->>'id', '');
  if v_key <> '' and v_partner is not null then
    select b.ipas_id, i.number, b.account_number
      into v_prev_id, v_prev_number, v_prev_key
      from public.ipas_bank_details b
      join public.ipas i on i.id = b.ipas_id
     where i.id <> v_ipas.id
       and i.state <> 'cancelled'
       and i.odoo_copy->'supplier'->>'id' = v_partner
       and public._ipas_account_key(b.account_number) <> ''
     order by i.created_at desc, i.id desc
     limit 1;
    if v_prev_id is not null then
      v_flagged := public._ipas_account_key(v_prev_key) <> v_key;
    end if;
  end if;

  v_account_changed := public._ipas_account_key(v_before.account_number) <> v_key;

  if not v_new then
    if v_bank is distinct from v_before.bank_name then v_fields := array_append(v_fields, 'bank_name'); end if;
    if v_name is distinct from v_before.account_name then v_fields := array_append(v_fields, 'account_name'); end if;
    if v_number is distinct from v_before.account_number then v_fields := array_append(v_fields, 'account_number'); end if;
    -- Nothing typed differently and the flag stands: nothing to record.
    if cardinality(v_fields) = 0 and v_flagged = v_before.account_flagged then
      return jsonb_build_object(
        'bank_details', to_jsonb(v_before),
        'flagged', v_before.account_flagged,
        'account_changed', false,
        'approvals_cleared', '[]'::jsonb,
        'preparer_ids', '[]'::jsonb
      );
    end if;
  else
    if v_bank is not null then v_fields := array_append(v_fields, 'bank_name'); end if;
    if v_name is not null then v_fields := array_append(v_fields, 'account_name'); end if;
    if v_number is not null then v_fields := array_append(v_fields, 'account_number'); end if;
  end if;

  insert into public.ipas_bank_details (ipas_id, bank_name, account_name, account_number, account_flagged, updated_by)
  values (v_ipas.id, v_bank, v_name, v_number, v_flagged, v_actor)
  on conflict (ipas_id) do update
     set bank_name = excluded.bank_name,
         account_name = excluded.account_name,
         account_number = excluded.account_number,
         account_flagged = excluded.account_flagged,
         updated_by = excluded.updated_by
  returning * into v_row;

  -- What changed, never the values: ipas_events is readable by people who may
  -- not read bank details.
  perform public._ipas_write_event(
    v_ipas.id, v_actor,
    case when v_new then 'bank_details_set' else 'bank_details_changed' end,
    jsonb_build_object(
      'fields', to_jsonb(v_fields),
      'account_changed', v_account_changed,
      'flagged', v_flagged,
      'was_flagged', case when v_new then false else v_before.account_flagged end
    )
  );

  if v_flagged and v_account_changed then
    perform public._ipas_write_event(v_ipas.id, v_actor, 'account_flagged', jsonb_build_object(
      'previous_ipas_id', v_prev_id,
      'previous_number', v_prev_number
    ));

    -- The bank details belong to screen section 2 (stored 3): only its live
    -- approval no longer approves this account. Section 1 is left alone.
    select c.sections, c.preparer_ids
      into v_sections, v_preparers
      from public._ipas_clear_section_approvals(v_ipas.id, v_actor, 'Account # flagged', array[3]) c;
  end if;

  return jsonb_build_object(
    'bank_details', to_jsonb(v_row),
    'flagged', v_flagged,
    'account_changed', v_account_changed,
    'approvals_cleared', to_jsonb(v_sections),
    'preparer_ids', to_jsonb(v_preparers)
  );
end;
$function$
;
CREATE OR REPLACE FUNCTION public.ipas_set_document_attachment(p_document_id uuid, p_attachment_url text)
 RETURNS ipas_documents
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_actor uuid := public._ipas_purchasing_writer('ipas_set_document_attachment');
  v_row public.ipas_documents;
  v_url text := nullif(btrim(p_attachment_url), '');
begin
  v_row := public._ipas_lock_document('ipas_set_document_attachment', p_document_id);

  if v_url is not null and v_url !~* '^https?://' then
    raise exception 'ipas_set_document_attachment: the attachment must be a link to the uploaded file'
      using errcode = '22023';
  end if;
  if v_url is not distinct from v_row.attachment_url then
    return v_row;
  end if;

  update public.ipas_documents set attachment_url = v_url where id = v_row.id returning * into v_row;

  perform public._ipas_write_event(v_row.ipas_id, v_actor,
    case when v_url is null then 'document_attachment_removed' else 'document_attachment_set' end,
    jsonb_build_object('document_id', v_row.id, 'label', public._ipas_document_label(v_row)));

  return v_row;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.ipas_set_header(p_ipas_id uuid, p_fields jsonb)
 RETURNS ipas
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_actor uuid := public.get_employee_id();
  v_row public.ipas;
  v_key text;
  v_raw jsonb;
  v_text text;
  v_contact text;
  v_pi text;
  v_amount numeric;
  v_freight uuid;
  v_split text;
  v_status text;
  v_sheet boolean;
  v_gantt boolean;
  v_label text;
  v_remarks text;
  v_changes jsonb := '{}'::jsonb;
begin
  if v_actor is null then
    raise exception 'ipas_set_header: not signed in' using errcode = '42501';
  end if;
  -- Only Purchasing changes an IPAS (#586: Checked by is gone, so there is no Finance
  -- or Super Admin exception any more; section 3's sign-off is the check).
  if not public.has_purchasing_access() then
    raise exception 'ipas_set_header: only Purchasing changes an IPAS' using errcode = '42501';
  end if;
  if p_fields is null or jsonb_typeof(p_fields) <> 'object' then
    raise exception 'ipas_set_header: the fields must be an object' using errcode = '22023';
  end if;
  for v_key in select jsonb_object_keys(p_fields) loop
    if v_key not in (
      'supplier_contact', 'pi_number', 'pi_qt_amount', 'freight_service_id', 'landed_cost_split', 'computation_status',
      'google_sheet', 'gantt_chart', 'remarks'
    ) then
      raise exception 'ipas_set_header: % isn''t a header field you can type here', v_key using errcode = '22023';
    end if;
  end loop;

  select * into v_row from public.ipas where id = p_ipas_id for update;
  if v_row.id is null then
    raise exception 'ipas_set_header: IPAS % not found', p_ipas_id using errcode = '22023';
  end if;
  if v_row.state = 'filed' then
    raise exception 'ipas_set_header: % is filed; a Super Admin reopens it first', v_row.number using errcode = '22023';
  end if;
  if v_row.state = 'cancelled' then
    raise exception 'ipas_set_header: % is cancelled', v_row.number using errcode = '22023';
  end if;

  -- Remarks: free text, blank clears. A non-text value is refused with a sentence.
  v_remarks := v_row.remarks;
  if jsonb_exists(p_fields, 'remarks') then
    if jsonb_typeof(p_fields->'remarks') not in ('string', 'null') then
      raise exception 'ipas_set_header: Remarks must be text' using errcode = '22023';
    end if;
    v_remarks := nullif(btrim(p_fields->>'remarks'), '');
  end if;

  v_contact := case when jsonb_exists(p_fields, 'supplier_contact') then nullif(btrim(p_fields->>'supplier_contact'), '') else v_row.supplier_contact end;
  v_pi := case when jsonb_exists(p_fields, 'pi_number') then nullif(btrim(p_fields->>'pi_number'), '') else v_row.pi_number end;

  -- P.I/QT Amount: a number, or blank to clear. Anything half-typed is refused
  -- with a sentence, never a cast error.
  v_amount := v_row.pi_qt_amount;
  if jsonb_exists(p_fields, 'pi_qt_amount') then
    v_raw := p_fields->'pi_qt_amount';
    if jsonb_typeof(v_raw) = 'null' then
      v_amount := null;
    elsif jsonb_typeof(v_raw) = 'number' then
      v_amount := round((p_fields->>'pi_qt_amount')::numeric, 2);
    elsif jsonb_typeof(v_raw) = 'string' then
      v_text := btrim(replace(p_fields->>'pi_qt_amount', ',', ''));
      if v_text = '' then
        v_amount := null;
      elsif v_text ~ '^[0-9]+(\.[0-9]+)?$' then
        v_amount := round(v_text::numeric, 2);
      else
        raise exception 'ipas_set_header: P.I/QT Amount must be a number' using errcode = '22023';
      end if;
    else
      raise exception 'ipas_set_header: P.I/QT Amount must be a number' using errcode = '22023';
    end if;
    if v_amount is not null and v_amount < 0 then
      raise exception 'ipas_set_header: P.I/QT Amount can''t be negative' using errcode = '22023';
    end if;
  end if;

  v_freight := v_row.freight_service_id;
  if jsonb_exists(p_fields, 'freight_service_id') then
    v_raw := p_fields->'freight_service_id';
    if jsonb_typeof(v_raw) = 'null' or nullif(btrim(p_fields->>'freight_service_id'), '') is null then
      v_freight := null;
    else
      begin
        v_freight := (p_fields->>'freight_service_id')::uuid;
      exception when invalid_text_representation then
        raise exception 'ipas_set_header: pick a freight service' using errcode = '22023';
      end;
      perform public._ipas_check_option(
        'ipas_set_header', v_freight, 'freight_service', v_row.freight_service_id, 'freight service'
      );
    end if;
  end if;

  v_split := v_row.landed_cost_split;
  if jsonb_exists(p_fields, 'landed_cost_split') then
    v_split := p_fields->>'landed_cost_split';
    if v_split is null or v_split not in ('value', 'quantity', 'equal') then
      raise exception 'ipas_set_header: Landed Cost is spread by value, by quantity or equally' using errcode = '22023';
    end if;
  end if;

  v_status := v_row.computation_status;
  if jsonb_exists(p_fields, 'computation_status') then
    v_status := p_fields->>'computation_status';
    if v_status is null or v_status not in ('encoding', 'encoded', 'lc_gs_done', 'lc_odoo_done') then
      raise exception 'ipas_set_header: the computation status is Encoding, Encoded, LC GS Done or LC Odoo Done'
        using errcode = '22023';
    end if;
  end if;

  if v_contact is distinct from v_row.supplier_contact then
    v_changes := v_changes || jsonb_build_object('supplier_contact', jsonb_build_object('from', v_row.supplier_contact, 'to', v_contact));
  end if;
  if v_pi is distinct from v_row.pi_number then
    v_changes := v_changes || jsonb_build_object('pi_number', jsonb_build_object('from', v_row.pi_number, 'to', v_pi));
  end if;
  if v_amount is distinct from v_row.pi_qt_amount then
    v_changes := v_changes || jsonb_build_object('pi_qt_amount', jsonb_build_object('from', v_row.pi_qt_amount, 'to', v_amount));
  end if;
  if v_freight is distinct from v_row.freight_service_id then
    v_changes := v_changes || jsonb_build_object('freight_service_id', jsonb_build_object(
      'from', (select o.label from public.ipas_options o where o.id = v_row.freight_service_id),
      'to', (select o.label from public.ipas_options o where o.id = v_freight)));
  end if;
  if v_split is distinct from v_row.landed_cost_split then
    v_changes := v_changes || jsonb_build_object('landed_cost_split', jsonb_build_object('from', v_row.landed_cost_split, 'to', v_split));
  end if;
  if v_status is distinct from v_row.computation_status then
    v_changes := v_changes || jsonb_build_object('computation_status', jsonb_build_object('from', v_row.computation_status, 'to', v_status));
  end if;
  -- The section 2 ticks: plain yes or no. JSON null and any other type are refused.
  v_sheet := v_row.google_sheet;
  if jsonb_exists(p_fields, 'google_sheet') then
    if jsonb_typeof(p_fields->'google_sheet') <> 'boolean' then
      raise exception 'ipas_set_header: Googlesheet must be ticked or not ticked' using errcode = '22023';
    end if;
    v_sheet := (p_fields->>'google_sheet')::boolean;
  end if;

  v_gantt := v_row.gantt_chart;
  if jsonb_exists(p_fields, 'gantt_chart') then
    if jsonb_typeof(p_fields->'gantt_chart') <> 'boolean' then
      raise exception 'ipas_set_header: Gantt Chart must be ticked or not ticked' using errcode = '22023';
    end if;
    v_gantt := (p_fields->>'gantt_chart')::boolean;
  end if;

  if v_sheet is distinct from v_row.google_sheet then
    v_changes := v_changes || jsonb_build_object('google_sheet', jsonb_build_object('from', v_row.google_sheet, 'to', v_sheet));
  end if;
  if v_gantt is distinct from v_row.gantt_chart then
    v_changes := v_changes || jsonb_build_object('gantt_chart', jsonb_build_object('from', v_row.gantt_chart, 'to', v_gantt));
  end if;
  if v_remarks is distinct from v_row.remarks then
    v_changes := v_changes || jsonb_build_object('remarks', jsonb_build_object('from', v_row.remarks, 'to', v_remarks));
  end if;
  if v_changes = '{}'::jsonb then
    return v_row;
  end if;

  update public.ipas
     set supplier_contact = v_contact,
         pi_number = v_pi,
         pi_qt_amount = v_amount,
         freight_service_id = v_freight,
         landed_cost_split = v_split,
         computation_status = v_status,
         google_sheet = v_sheet,
         gantt_chart = v_gantt,
         remarks = v_remarks
   where id = v_row.id
  returning * into v_row;

  perform public._ipas_write_event(v_row.id, v_actor, 'header_changed', jsonb_build_object('fields', v_changes));

  return v_row;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.ipas_set_item_location(p_ipas_id uuid, p_option_id uuid)
 RETURNS ipas
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_actor uuid := public._ipas_purchasing_writer('ipas_set_item_location');
  v_row public.ipas;
  v_from_label text;
  v_to_label text;
begin
  v_row := public._ipas_lock_open('ipas_set_item_location', p_ipas_id);

  if p_option_id is not null then
    v_to_label := public._ipas_check_option(
      'ipas_set_item_location', p_option_id, 'item_location', v_row.item_location_id, 'item location'
    );
  end if;
  if p_option_id is not distinct from v_row.item_location_id then
    return v_row;
  end if;
  select o.label into v_from_label from public.ipas_options o where o.id = v_row.item_location_id;

  update public.ipas set item_location_id = p_option_id where id = v_row.id returning * into v_row;

  perform public._ipas_write_event(v_row.id, v_actor, 'item_location_changed', jsonb_build_object(
    'from', v_from_label,
    'to', v_to_label
  ));

  return v_row;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.ipas_set_next_number(p_number bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_actor uuid := public.get_employee_id();
  v_before jsonb;
  v_highest bigint;
begin
  if not coalesce(public.is_super_admin(), false) then
    raise exception 'ipas_set_next_number: only a Super Admin sets the next IPAS number' using errcode = '42501';
  end if;
  if p_number is null or p_number < 1 then
    raise exception 'ipas_set_next_number: the next number must be 1 or more' using errcode = '22023';
  end if;

  -- Wait for any IPAS being raised right now, and hold new ones back, so the
  -- highest number given cannot move between the check and the change.
  lock table public.ipas in share row exclusive mode;

  v_highest := public.ipas_highest_number_given();
  if p_number <= v_highest then
    raise exception 'ipas_set_next_number: % is already used or below it; the next number must be above %',
      public.ipas_format_number(p_number), public.ipas_format_number(v_highest)
      using errcode = '22023';
  end if;

  v_before := public.ipas_next_number();
  perform setval('public.ipas_number_seq', p_number, false);

  insert into public.system_audit_logs (author_id, entity_type, entity_id, content, type, metadata)
  values (
    v_actor,
    'IPAS_NUMBER',
    'ipas_number_seq',
    'Next IPAS number set to ' || public.ipas_format_number(p_number)
      || ' (was ' || (v_before ->> 'number_format') || ')',
    'SYSTEM',
    jsonb_build_object(
      'from', (v_before ->> 'next_value')::bigint,
      'to', p_number,
      'highest_given', v_highest
    )
  );

  return jsonb_build_object(
    'next_value', p_number,
    'number_format', public.ipas_format_number(p_number),
    'highest_given', v_highest
  );
end;
$function$
;
CREATE OR REPLACE FUNCTION public.ipas_set_on_hold(p_ipas_id uuid, p_on_hold boolean, p_note text DEFAULT NULL::text)
 RETURNS ipas
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_actor uuid := public.get_employee_id();
  v_before public.ipas;
  v_row public.ipas;
  v_note text := nullif(btrim(p_note), '');
begin
  if v_actor is null then
    raise exception 'ipas_set_on_hold: not signed in' using errcode = '42501';
  end if;
  if not (public.has_purchasing_access() or public.has_finance_access()) then
    raise exception 'ipas_set_on_hold: only Purchasing or Finance puts an IPAS On-Hold' using errcode = '42501';
  end if;
  if p_on_hold is null then
    raise exception 'ipas_set_on_hold: say whether the IPAS is on hold' using errcode = '22023';
  end if;

  -- Open IPAS only: _ipas_lock_open refuses a filed or cancelled one.
  v_before := public._ipas_lock_open('ipas_set_on_hold', p_ipas_id);

  -- A note only goes with a hold.
  if not p_on_hold then
    v_note := null;
  end if;

  if v_before.on_hold = p_on_hold and v_before.on_hold_note is not distinct from v_note then
    return v_before;
  end if;

  update public.ipas
     set on_hold = p_on_hold, on_hold_note = v_note
   where id = v_before.id
  returning * into v_row;

  perform public._ipas_write_event(
    v_row.id,
    v_actor,
    case
      when not p_on_hold then 'on_hold_cleared'
      when v_before.on_hold then 'on_hold_changed'
      else 'on_hold_set'
    end,
    jsonb_build_object(
      'note', v_note,
      'previous_note', v_before.on_hold_note
    )
  );

  return v_row;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.ipas_set_purpose_and_sors(p_ipas_id uuid, p_purpose text, p_sor_ids uuid[])
 RETURNS ipas
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_actor uuid := public.get_employee_id();
  v_row public.ipas;
  v_before uuid[];
  v_after uuid[];
  v_from text;
begin
  if v_actor is null then
    raise exception 'ipas_set_purpose_and_sors: not signed in' using errcode = '42501';
  end if;
  if not public.has_purchasing_access() then
    raise exception 'ipas_set_purpose_and_sors: only Purchasing changes an IPAS' using errcode = '42501';
  end if;
  if p_purpose is null or p_purpose not in ('project', 'inventory', 'supplies', 'events') then
    raise exception 'ipas_set_purpose_and_sors: % isn''t a Purpose', coalesce(p_purpose, 'null') using errcode = '22023';
  end if;

  select * into v_row from public.ipas where id = p_ipas_id for update;
  if v_row.id is null then
    raise exception 'ipas_set_purpose_and_sors: IPAS % not found', p_ipas_id using errcode = '22023';
  end if;
  if v_row.state = 'filed' then
    raise exception 'ipas_set_purpose_and_sors: % is filed; a Super Admin reopens it first', v_row.number
      using errcode = '22023';
  end if;
  if v_row.state = 'cancelled' then
    raise exception 'ipas_set_purpose_and_sors: % is cancelled', v_row.number using errcode = '22023';
  end if;

  select coalesce(array_agg(s.opportunity_id order by s.opportunity_id), '{}'::uuid[]) into v_before
    from public.ipas_sors s where s.ipas_id = v_row.id;

  -- #551: the SOR list is fixed when the IPAS is raised. A list may be sent (older
  -- callers do) only if it is the list already there; null means "leave it".
  if p_sor_ids is not null then
    if array_position(p_sor_ids, null) is not null then
      raise exception 'ipas_set_purpose_and_sors: an SOR id is missing' using errcode = '22023';
    end if;
    select coalesce(array_agg(distinct x order by x), '{}'::uuid[]) into v_after from unnest(p_sor_ids) x;
    if v_after is distinct from v_before then
      raise exception 'ipas_set_purpose_and_sors: the SORs of % can''t be changed after it is raised; cancel it and raise a new one', v_row.number
        using errcode = '22023';
    end if;
  end if;

  -- The Purpose still has to fit the SORs it already has.
  if p_purpose = 'project' and cardinality(v_before) = 0 then
    raise exception 'ipas_set_purpose_and_sors: a Project IPAS needs at least one SOR, and the SORs can''t be changed after it is raised' using errcode = '22023';
  end if;
  if p_purpose <> 'project' and cardinality(v_before) > 0 then
    raise exception 'ipas_set_purpose_and_sors: % names SORs, so it can only be a Project; the SORs can''t be changed after it is raised', v_row.number
      using errcode = '22023';
  end if;

  if v_row.purpose = p_purpose then
    return v_row;
  end if;

  v_from := v_row.purpose;
  update public.ipas set purpose = p_purpose where id = v_row.id returning * into v_row;

  perform public._ipas_write_event(v_row.id, v_actor, 'purpose_sors_changed', jsonb_build_object(
    'purpose_from', v_from,
    'purpose_to', v_row.purpose,
    'sor_ids_from', to_jsonb(v_before),
    'sor_ids_to', to_jsonb(v_before)
  ));

  return v_row;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.ipas_set_signer_list(p_list_key text, p_employee_ids uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_actor uuid := public.get_employee_id();
  v_wanted uuid[];
  v_have uuid[];
  v_added uuid[];
  v_removed uuid[];
  v_missing uuid;
begin
  if v_actor is null then
    raise exception 'ipas_set_signer_list: not signed in' using errcode = '42501';
  end if;
  if not coalesce(public.is_super_admin(), false) then
    raise exception 'ipas_set_signer_list: only a Super Admin changes who is on a sign-off list' using errcode = '42501';
  end if;
  if p_list_key is null or p_list_key not in (
    's1_approved', 's3_approved', 's6_approved', 's7_received', 's7_noted', 's7_checked', 's7_approved',
    'transmittal_warehouse', 'transmittal_technical', 'transmittal_logistics', 'transmittal_check_by'
  ) then
    raise exception 'ipas_set_signer_list: % isn''t a sign-off list', coalesce(p_list_key, 'null') using errcode = '22023';
  end if;

  select coalesce(array_agg(distinct x), '{}'::uuid[])
    into v_wanted
    from unnest(coalesce(p_employee_ids, '{}'::uuid[])) as x
   where x is not null;

  -- One change to a list at a time.
  perform pg_advisory_xact_lock(hashtext('ipas_signer_list:' || p_list_key));

  select coalesce(array_agg(l.employee_id), '{}'::uuid[])
    into v_have
    from public.ipas_signer_lists l
   where l.list_key = p_list_key;

  select x into v_missing
    from unnest(v_wanted) as x
   where x <> all (v_have)
     and not exists (
       select 1 from public.employees e where e.id = x and not coalesce(e.is_deleted, false)
     )
   limit 1;
  if v_missing is not null then
    raise exception 'ipas_set_signer_list: employee % isn''t an active employee', v_missing using errcode = '22023';
  end if;

  select coalesce(array_agg(x), '{}'::uuid[]) into v_added from unnest(v_wanted) as x where x <> all (v_have);
  select coalesce(array_agg(x), '{}'::uuid[]) into v_removed from unnest(v_have) as x where x <> all (v_wanted);

  if cardinality(v_removed) > 0 then
    delete from public.ipas_signer_lists
     where list_key = p_list_key and employee_id = any (v_removed);
  end if;
  if cardinality(v_added) > 0 then
    insert into public.ipas_signer_lists (list_key, employee_id)
    select p_list_key, x from unnest(v_added) as x;
  end if;

  insert into public.ipas_signer_list_log (list_key, employee_id, action, actor_id)
  select p_list_key, x, 'removed', v_actor from unnest(v_removed) as x
  union all
  select p_list_key, x, 'added', v_actor from unnest(v_added) as x;

  return jsonb_build_object(
    'list_key', p_list_key,
    'added', to_jsonb(v_added),
    'removed', to_jsonb(v_removed)
  );
end;
$function$
;
CREATE OR REPLACE FUNCTION public.ipas_set_supplier_origin(p_ipas_id uuid, p_fields jsonb)
 RETURNS ipas
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_actor uuid := public._ipas_purchasing_writer('ipas_set_supplier_origin');
  v_row public.ipas;
  v_key text;
  v_shipped date;
  v_onboard date;
  v_ph date;
  v_whs date;
  v_changes jsonb := '{}'::jsonb;
begin
  if p_fields is null or jsonb_typeof(p_fields) <> 'object' then
    raise exception 'ipas_set_supplier_origin: the fields must be an object' using errcode = '22023';
  end if;
  for v_key in select jsonb_object_keys(p_fields) loop
    if v_key not in ('shipped_out_on', 'onboard_on', 'arrived_in_ph_on', 'arrived_in_whs_on') then
      raise exception 'ipas_set_supplier_origin: % isn''t a Supplier Origin date', v_key using errcode = '22023';
    end if;
  end loop;

  v_row := public._ipas_lock_open('ipas_set_supplier_origin', p_ipas_id);
  if v_row.source <> 'import' then
    raise exception 'ipas_set_supplier_origin: % is a Local IPAS; Supplier Origin is for Import only', v_row.number
      using errcode = '22023';
  end if;

  v_shipped := public._ipas_read_date('ipas_set_supplier_origin', p_fields, 'shipped_out_on', 'Shipped Out', v_row.shipped_out_on);
  v_onboard := public._ipas_read_date('ipas_set_supplier_origin', p_fields, 'onboard_on', 'Onboard', v_row.onboard_on);
  v_ph := public._ipas_read_date('ipas_set_supplier_origin', p_fields, 'arrived_in_ph_on', 'Arrived in PH', v_row.arrived_in_ph_on);
  v_whs := public._ipas_read_date('ipas_set_supplier_origin', p_fields, 'arrived_in_whs_on', 'Arrived in Whs.', v_row.arrived_in_whs_on);

  if v_shipped is distinct from v_row.shipped_out_on then
    v_changes := v_changes || jsonb_build_object('shipped_out_on', jsonb_build_object('from', v_row.shipped_out_on, 'to', v_shipped));
  end if;
  if v_onboard is distinct from v_row.onboard_on then
    v_changes := v_changes || jsonb_build_object('onboard_on', jsonb_build_object('from', v_row.onboard_on, 'to', v_onboard));
  end if;
  if v_ph is distinct from v_row.arrived_in_ph_on then
    v_changes := v_changes || jsonb_build_object('arrived_in_ph_on', jsonb_build_object('from', v_row.arrived_in_ph_on, 'to', v_ph));
  end if;
  if v_whs is distinct from v_row.arrived_in_whs_on then
    v_changes := v_changes || jsonb_build_object('arrived_in_whs_on', jsonb_build_object('from', v_row.arrived_in_whs_on, 'to', v_whs));
  end if;
  if v_changes = '{}'::jsonb then
    return v_row;
  end if;

  update public.ipas
     set shipped_out_on = v_shipped,
         onboard_on = v_onboard,
         arrived_in_ph_on = v_ph,
         arrived_in_whs_on = v_whs
   where id = v_row.id
  returning * into v_row;

  perform public._ipas_write_event(v_row.id, v_actor, 'supplier_origin_changed', jsonb_build_object('fields', v_changes));

  return v_row;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.ipas_set_typed_status(p_ipas_id uuid, p_status text, p_date date)
 RETURNS ipas
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_actor uuid := public._ipas_purchasing_writer('ipas_set_typed_status');
  v_row public.ipas;
  v_from date;
begin
  if p_status is null or p_status not in ('import_clearance', 'delivered') then
    raise exception 'ipas_set_typed_status: Import Clearance and Delivered are the typed statuses' using errcode = '22023';
  end if;

  v_row := public._ipas_lock_open('ipas_set_typed_status', p_ipas_id);
  if p_status = 'import_clearance' and v_row.source <> 'import' then
    raise exception 'ipas_set_typed_status: % is a Local IPAS; Import Clearance is for Import only', v_row.number
      using errcode = '22023';
  end if;

  v_from := case p_status when 'import_clearance' then v_row.import_clearance_on else v_row.delivered_on end;
  if v_from is not distinct from p_date then
    return v_row;
  end if;

  if p_status = 'import_clearance' then
    update public.ipas
       set import_clearance_on = p_date,
           import_clearance_typed_by = case when p_date is null then null else v_actor end,
           import_clearance_typed_at = case when p_date is null then null else now() end
     where id = v_row.id
    returning * into v_row;
  else
    update public.ipas
       set delivered_on = p_date,
           delivered_typed_by = case when p_date is null then null else v_actor end,
           delivered_typed_at = case when p_date is null then null else now() end
     where id = v_row.id
    returning * into v_row;
  end if;

  perform public._ipas_write_event(v_row.id, v_actor,
    case when p_date is null then 'status_cleared' else 'status_typed' end,
    jsonb_build_object('status', p_status, 'from', v_from, 'to', p_date));

  return v_row;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.ipas_sign(p_ipas_id uuid, p_section integer, p_role text, p_decline_signature boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_actor uuid := public.get_employee_id();
  v_ipas public.ipas;
  v_prepared public.ipas_signoffs;
  v_row public.ipas_signoffs;
  v_list_key text;
  v_signature text;
  v_notify uuid[] := '{}';
  v_stage text;
  v_filed boolean := false;
begin
  if v_actor is null then
    raise exception 'ipas_sign: not signed in' using errcode = '42501';
  end if;
  if p_section is null or p_role is null or not public._ipas_signoff_pair_ok(p_section, p_role) then
    raise exception 'ipas_sign: section % has no % sign-off', coalesce(public._ipas_section_no(p_section)::text, 'null'), coalesce(p_role, 'null')
      using errcode = '22023';
  end if;

  v_ipas := public._ipas_lock_open('ipas_sign', p_ipas_id);
  v_list_key := public._ipas_signoff_list_key(p_section, p_role);

  if p_role = 'prepared' then
    if not public.has_purchasing_access() then
      raise exception 'ipas_sign: only Purchasing prepares a section' using errcode = '42501';
    end if;
  elsif not public._ipas_on_list(v_list_key, v_actor) then
    -- Every other sign-off belongs to its list, and a Super Admin is no
    -- exception: they sign when they are on it.
    raise exception 'ipas_sign: you are not on the list that may give this sign-off' using errcode = '42501';
  end if;

  -- Section 3 (stored 6) is the Landed Cost check: Purchasing submits it once the
  -- Computation status is LC Odoo Done, and not before.
  if p_section = 6 and p_role = 'prepared'
     and v_ipas.computation_status is distinct from 'lc_odoo_done' then
    raise exception 'ipas_sign: section % can be submitted once the Computation status is LC Odoo Done', public._ipas_section_no(6)
      using errcode = '22023';
  end if;

  if exists (
    select 1 from public.ipas_signoffs s
     where s.ipas_id = v_ipas.id and s.section = p_section and s.role = p_role and s.cleared_at is null
  ) then
    raise exception 'ipas_sign: section % is already % on %', public._ipas_section_no(p_section), p_role, v_ipas.number using errcode = '22023';
  end if;

  if p_role = 'approved' and p_section in (1, 3, 6) then
    select * into v_prepared
      from public.ipas_signoffs s
     where s.ipas_id = v_ipas.id and s.section = p_section and s.role = 'prepared' and s.cleared_at is null;
    if v_prepared.id is null then
      raise exception 'ipas_sign: section % hasn''t been prepared yet', public._ipas_section_no(p_section) using errcode = '22023';
    end if;
    if v_prepared.signed_by = v_actor then
      raise exception 'ipas_sign: you prepared section %, so someone else approves it', public._ipas_section_no(p_section) using errcode = '42501';
    end if;
  end if;

  if p_section = 7 then
    -- Section 7 (Filing, screen section 4) opens once sections 1, 2 and 3 are
    -- approved (stored 1, 3 and 6). Checked at every step: an approval undone by an
    -- Odoo change closes it again. The gate runs for every section 7 role, so
    -- Approved waits for section 3 too, and so does a Noted or Checked not yet given
    -- (#590); the ones already given stay.
    if not public._ipas_filing_open(v_ipas.id) then
      raise exception 'ipas_sign: section % opens once sections %, % and % are approved', public._ipas_section_no(7), public._ipas_section_no(1), public._ipas_section_no(3), public._ipas_section_no(6) using errcode = '22023';
    end if;

    -- Received first; Noted and Checked after it, in any order.
    if p_role in ('noted', 'checked') and not exists (
      select 1 from public.ipas_signoffs s
       where s.ipas_id = v_ipas.id and s.section = 7 and s.role = 'received' and s.cleared_at is null
    ) then
      raise exception 'ipas_sign: Received comes first; % can only be given after it', initcap(p_role) using errcode = '22023';
    end if;

    if p_role = 'approved' then
      if (
        select count(*) from public.ipas_signoffs s
         where s.ipas_id = v_ipas.id and s.section = 7 and s.role in ('received', 'noted', 'checked') and s.cleared_at is null
      ) < 3 then
        raise exception 'ipas_sign: Approved needs Received, Noted and Checked first' using errcode = '22023';
      end if;
      if v_ipas.computation_status not in ('lc_odoo_done', 'checked') then
        raise exception 'ipas_sign: % can''t be filed until LC Odoo Done: Landed Cost is still provisional, and Filing freezes it as final', v_ipas.number
          using errcode = '22023';
      end if;
    end if;
  end if;

  if p_decline_signature then
    v_signature := null;
  else
    select e.signature_path into v_signature from public.employees e where e.id = v_actor;
  end if;

  insert into public.ipas_signoffs (ipas_id, section, role, signed_by, signature_declined, signature_version)
  values (v_ipas.id, p_section, p_role, v_actor, coalesce(p_decline_signature, false), v_signature)
  returning * into v_row;

  perform public._ipas_write_event(v_ipas.id, v_actor, 'signed', jsonb_build_object(
    'section', p_section,
    'role', p_role,
    'signoff_id', v_row.id,
    'signature_declined', v_row.signature_declined
  ));

  if p_section = 7 and p_role = 'approved' then
    -- The one point that locks the IPAS. The freeze lets this update through:
    -- the row is still open until it is made.
    update public.ipas
       set state = 'filed', filed_at = now()
     where id = v_ipas.id
    returning * into v_ipas;
    v_filed := true;
    v_stage := 'filed';

    perform public._ipas_write_event(v_ipas.id, v_actor, 'filed', jsonb_build_object(
      'computation_status', v_ipas.computation_status,
      'signoff_id', v_row.id
    ));
  elsif p_role = 'prepared' then
    -- Prepared is ready for approval: tell that section's approval list (never
    -- the person who just prepared it).
    v_stage := 'section_prepared';
    v_notify := public._ipas_list_members(array[public._ipas_signoff_list_key(p_section, 'approved')], v_actor);
  elsif p_section in (1, 3, 6) then
    -- This section is approved. When it was the last of sections 1, 2 and 3 and
    -- section 7 hasn't started, section 7 is ready for Received (#590).
    if public._ipas_filing_open(v_ipas.id)
       and not exists (
         select 1 from public.ipas_signoffs s
          where s.ipas_id = v_ipas.id and s.section = 7 and s.cleared_at is null
       ) then
      v_stage := 'received_ready';
      v_notify := public._ipas_list_members(array['s7_received'], v_actor);
    end if;
  elsif p_role = 'received' then
    v_stage := 'noted_checked_ready';
    v_notify := public._ipas_list_members(array['s7_noted', 's7_checked'], v_actor);
  elsif p_role in ('noted', 'checked') then
    -- Noted and Checked both given: Approved is ready.
    if exists (
      select 1 from public.ipas_signoffs s
       where s.ipas_id = v_ipas.id and s.section = 7
         and s.role = case p_role when 'noted' then 'checked' else 'noted' end
         and s.cleared_at is null
    ) then
      v_stage := 'approve_ready';
      v_notify := public._ipas_list_members(array['s7_approved'], v_actor);
    end if;
  end if;

  return jsonb_build_object(
    'signoff', to_jsonb(v_row),
    'ipas', to_jsonb(v_ipas),
    'section', p_section,
    'role', p_role,
    'stage', v_stage,
    'filed', v_filed,
    'notify_ids', to_jsonb(v_notify)
  );
end;
$function$
;
CREATE OR REPLACE FUNCTION public.ipas_signature_readable(p_name text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select p_name is not null
     and public.ipas_can_read()
     and exists (
       select 1
         from public.ipas_signoffs s
        where s.signature_version = p_name
          and not s.signature_declined
     );
$function$
;
CREATE OR REPLACE FUNCTION public.ipas_signer_list_log_append_only()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  raise exception 'ipas_signer_list_log is append-only: history can''t be changed (% refused)', tg_op
    using errcode = '42501';
end;
$function$
;
CREATE OR REPLACE FUNCTION public.ipas_signoffs_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  if old.cleared_at is not null then
    raise exception 'ipas_signoffs: a cleared sign-off is history and doesn''t change' using errcode = '42501';
  end if;
  if new.ipas_id is distinct from old.ipas_id
     or new.section is distinct from old.section
     or new.role is distinct from old.role
     or new.signed_by is distinct from old.signed_by
     or new.signed_at is distinct from old.signed_at
     or new.signature_declined is distinct from old.signature_declined
     or new.signature_version is distinct from old.signature_version then
    raise exception 'ipas_signoffs: a signature can only be cleared, never changed' using errcode = '42501';
  end if;
  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.ipas_signoffs_lc_fingerprint()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if new.section = 6 and new.role in ('prepared', 'approved') and new.lc_fingerprint is null then
    new.lc_fingerprint := public._ipas_lc_fingerprint(new.ipas_id);
  end if;
  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.ipas_sor_headers(p_ipas_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS TABLE(ipas_id uuid, opportunity_id uuid, sales_reference text, project_title text, current_stage_name text, sor_code text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if public.get_employee_id() is null then
    raise exception 'ipas_sor_headers: not signed in' using errcode = '42501';
  end if;
  if not public.ipas_can_read() then
    return;
  end if;
  -- Ask for the IPAS you mean: no ids, no rows.
  if p_ipas_ids is null or cardinality(p_ipas_ids) = 0 then
    return;
  end if;

  return query
    select s.ipas_id, s.opportunity_id, o.sales_reference, o.project_title, fs.name, o.sor_code
      from public.ipas_sors s
      join public.sales_opportunities o on o.id = s.opportunity_id
      left join public.flow_stages fs on fs.id = o.flow_stage_id
     where s.ipas_id = any (p_ipas_ids)
     order by o.sales_reference nulls last, o.sor_code;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.ipas_stamp_actual_checking(p_ipas_id uuid, p_stamped boolean DEFAULT true)
 RETURNS ipas
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_actor uuid := public._ipas_purchasing_writer('ipas_stamp_actual_checking');
  v_row public.ipas;
  v_was_by uuid;
  v_was_at timestamptz;
begin
  if p_stamped is null then
    raise exception 'ipas_stamp_actual_checking: stamp it or clear it' using errcode = '22023';
  end if;

  v_row := public._ipas_lock_open('ipas_stamp_actual_checking', p_ipas_id);
  v_was_by := v_row.actual_checking_by;
  v_was_at := v_row.actual_checking_at;

  if p_stamped then
    if v_was_by is not null then
      return v_row;
    end if;
    update public.ipas
       set actual_checking_by = v_actor, actual_checking_at = now()
     where id = v_row.id
    returning * into v_row;
    perform public._ipas_write_event(v_row.id, v_actor, 'actual_checking_stamped', jsonb_build_object(
      'by', v_actor, 'at', v_row.actual_checking_at
    ));
  else
    if v_was_by is null then
      return v_row;
    end if;
    update public.ipas
       set actual_checking_by = null, actual_checking_at = null
     where id = v_row.id
    returning * into v_row;
    perform public._ipas_write_event(v_row.id, v_actor, 'actual_checking_cleared', jsonb_build_object(
      'was_by', v_was_by, 'was_at', v_was_at
    ));
  end if;

  return v_row;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.ipas_standing_for_sor(p_opportunity_id uuid)
 RETURNS TABLE(ipas_id uuid, source text, created_at timestamp with time zone, updated_at timestamp with time zone, costs_completed_at timestamp with time zone, proof_paid_on date, shipped_out_on date, onboard_on date, arrived_in_ph_on date, arrived_in_whs_on date, import_clearance_on date, delivered_on date, actual_checking_stamped boolean, actual_checking_at timestamp with time zone, slips jsonb, on_hold boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select
    i.id,
    i.source,
    i.created_at,
    i.updated_at,
    (
      select max(e.created_at)
        from public.ipas_events e
       where e.ipas_id = i.id
         and e.kind = 'header_changed'
         and e.detail #>> '{fields,computation_status,to}' in ('lc_odoo_done', 'checked')
    ),
    (
      select max(p.paid_on)
        from public.ipas_payments p
       where p.ipas_id = i.id and coalesce(p.proof_url, '') <> ''
    ),
    i.shipped_out_on,
    i.onboard_on,
    i.arrived_in_ph_on,
    i.arrived_in_whs_on,
    i.import_clearance_on,
    i.delivered_on,
    i.actual_checking_by is not null,
    i.actual_checking_at,
    coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', t.id,
          'number', t.number,
          'prepared_on', t.prepared_on,
          'created_at', t.created_at,
          'submitted_at', t.submitted_at,
          'state', t.state,
          'check_warehouse', t.check_warehouse,
          'check_technical', t.check_technical,
          'stages', coalesce((
            select jsonb_agg(jsonb_build_object('stage', st.stage, 'completed_at', st.completed_at))
              from public.transmittal_stages st
             where st.transmittal_id = t.id
          ), '[]'::jsonb),
          'lines', coalesce((
            select jsonb_agg(jsonb_build_object(
              'ipas_id', l.ipas_id,
              'odoo_po_line_id', l.odoo_po_line_id,
              'wh_rating', l.wh_rating,
              'tech_rating', l.tech_rating
            ))
              from public.transmittal_lines l
             where l.transmittal_id = t.id and l.ipas_id = i.id
          ), '[]'::jsonb)
        )
        order by t.prepared_on, t.created_at, t.number
      )
        from public.transmittals t
       where t.state <> 'cancelled'
         and exists (
           select 1 from public.transmittal_lines l
            where l.transmittal_id = t.id and l.ipas_id = i.id
         )
    ), '[]'::jsonb),
    i.on_hold
  from public.ipas i
  where (select public.sor_access_level(p_opportunity_id)) = 'full'
    and i.purpose = 'project'
    and exists (
      select 1 from public.ipas_sors s
      where s.ipas_id = i.id and s.opportunity_id = p_opportunity_id
    )
  order by i.number;
$function$
;
CREATE OR REPLACE FUNCTION public.ipas_suggest_documents(p_ipas_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_actor uuid := public._ipas_purchasing_writer('ipas_suggest_documents');
  v_ipas public.ipas;
  v_labels text[];
begin
  v_ipas := public._ipas_lock_open('ipas_suggest_documents', p_ipas_id);
  v_labels := public._ipas_suggest_documents(v_ipas.id, v_actor);

  if cardinality(v_labels) > 0 then
    perform public._ipas_write_event(v_ipas.id, v_actor, 'documents_suggested', jsonb_build_object(
      'source', v_ipas.source,
      'labels', to_jsonb(v_labels)
    ));
  end if;

  return jsonb_build_object('added', to_jsonb(v_labels));
end;
$function$
;
CREATE OR REPLACE FUNCTION public.ipas_suggest_documents_on_insert()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  perform public._ipas_suggest_documents(new.id, new.created_by);
  return null;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.ipas_summaries_for_sor(p_opportunity_id uuid)
 RETURNS TABLE(ipas_id uuid, number text, po_number text, supplier text, purpose text, state text, buyer_track jsonb, computation_status text, signoffs jsonb, landed_cost_total_php numeric, landed_cost_mark text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select
    i.id,
    i.number,
    i.po_number,
    nullif(btrim(i.odoo_copy #>> '{supplier,name}'), ''),
    i.purpose,
    i.state,
    case when i.source = 'import'
      then jsonb_build_array(
        jsonb_build_object('key', 'purchase_order', 'ticked', coalesce(o.po_state in ('purchase', 'done'), false), 'partial', false),
        jsonb_build_object('key', 'with_pop', 'ticked', pop.has_proof, 'partial', false),
        jsonb_build_object('key', 'import_clearance', 'ticked', i.import_clearance_on is not null, 'partial', false),
        jsonb_build_object('key', 'delivered', 'ticked', i.delivered_on is not null or tg.delivered, 'partial', false),
        jsonb_build_object('key', 'received_in_odoo', 'ticked', rs.received_state = 'received', 'partial', rs.received_state = 'partial'),
        jsonb_build_object('key', 'create_bill', 'ticked', o.bill_count > 0, 'partial', false),
        jsonb_build_object('key', 'actual_checking', 'ticked', i.actual_checking_by is not null or tg.checked, 'partial', false)
      )
      else jsonb_build_array(
        jsonb_build_object('key', 'purchase_order', 'ticked', coalesce(o.po_state in ('purchase', 'done'), false), 'partial', false),
        jsonb_build_object('key', 'with_pop', 'ticked', pop.has_proof, 'partial', false),
        jsonb_build_object('key', 'delivered', 'ticked', i.delivered_on is not null or tg.delivered, 'partial', false),
        jsonb_build_object('key', 'received_in_odoo', 'ticked', rs.received_state = 'received', 'partial', rs.received_state = 'partial'),
        jsonb_build_object('key', 'create_bill', 'ticked', o.bill_count > 0, 'partial', false),
        jsonb_build_object('key', 'actual_checking', 'ticked', i.actual_checking_by is not null or tg.checked, 'partial', false)
      )
    end,
    i.computation_status,
    jsonb_build_object(
      '1', jsonb_build_object(
        'prepared', '1:prepared' = any (lv.live),
        'approved', '1:approved' = any (lv.live)
      ),
      '3', jsonb_build_object(
        'prepared', '3:prepared' = any (lv.live),
        'approved', '3:approved' = any (lv.live)
      ),
      '6', jsonb_build_object(
        'prepared', '6:prepared' = any (lv.live),
        'approved', '6:approved' = any (lv.live)
      ),
      '7', jsonb_build_object(
        'received', '7:received' = any (lv.live),
        'noted', '7:noted' = any (lv.live),
        'checked', '7:checked' = any (lv.live),
        'approved', '7:approved' = any (lv.live)
      )
    ),
    lcost.total,
    lcost.mark
  from public.ipas i
  cross join lateral (
    select
      i.odoo_copy #>> '{po,state}' as po_state,
      i.odoo_copy #>> '{receipts,status}' as receipts_status,
      case when (i.odoo_copy #>> '{receipts,total}') ~ '^[0-9]+(\.[0-9]+)?$'
        then (i.odoo_copy #>> '{receipts,total}')::numeric else 0 end as receipts_total,
      case when (i.odoo_copy #>> '{receipts,done}') ~ '^[0-9]+(\.[0-9]+)?$'
        then (i.odoo_copy #>> '{receipts,done}')::numeric else 0 end as receipts_done,
      case when (i.odoo_copy #>> '{bills,count}') ~ '^[0-9]+(\.[0-9]+)?$'
        then (i.odoo_copy #>> '{bills,count}')::numeric else 0 end as bill_count
  ) o
  cross join lateral (
    select case
      when o.receipts_status = 'partial' then 'partial'
      when o.receipts_status = 'full' or (o.receipts_total > 0 and o.receipts_done >= o.receipts_total) then 'received'
      when o.receipts_done > 0 then 'partial'
      else 'none'
    end as received_state
  ) rs
  cross join lateral (
    select exists (
      select 1 from public.ipas_payments p
      where p.ipas_id = i.id and coalesce(p.proof_url, '') <> ''
    ) as has_proof
  ) pop
  cross join lateral (
    select coalesce(array_agg(so.section::text || ':' || so.role), '{}'::text[]) as live
    from public.ipas_signoffs so
    where so.ipas_id = i.id and so.cleared_at is null
  ) lv
  cross join lateral (
    select
      coalesce(bool_or(first_done), false) as delivered,
      coalesce(count(*) > 0 and bool_and(check_done), false) as checked
    from (
      select
        exists (
          select 1 from public.transmittal_stages st
           where st.transmittal_id = t.id and st.completed_at is not null
             and st.stage = case when t.check_warehouse then 'warehouse_checking' else 'technical_inspection' end
        ) as first_done,
        exists (
          select 1 from public.transmittal_stages st
           where st.transmittal_id = t.id and st.completed_at is not null
             and st.stage = case when t.check_technical then 'technical_inspection' else 'warehouse_checking' end
        ) as check_done
      from public.transmittals t
      where t.state not in ('draft', 'cancelled')
        and exists (select 1 from public.transmittal_lines l where l.transmittal_id = t.id and l.ipas_id = i.id)
    ) slips
  ) tg
  -- #283: the IPAS's Landed Cost total and mark, for cost-tier readers only.
  cross join lateral (
    select
      case when bool_or(l.mark = 'unavailable') then null else sum(l.total_php) end as total,
      case when count(*) = 0 then null
           when bool_or(l.mark = 'unavailable') then 'unavailable'
           when bool_and(l.mark = 'final') then 'final'
           else 'provisional' end as mark
    from public.ipas_line_landed_costs(i.id) l
    where public.costing_can_read_cost(p_opportunity_id)
  ) lcost
  where (select public.sor_access_level(p_opportunity_id)) = 'full'
    and i.purpose = 'project'
    and exists (
      select 1 from public.ipas_sors s
      where s.ipas_id = i.id and s.opportunity_id = p_opportunity_id
    )
  order by
    case i.state when 'open' then 0 when 'filed' then 1 else 2 end,
    i.number;
$function$
;
CREATE OR REPLACE FUNCTION public.ipas_tick_document(p_document_id uuid, p_side text, p_value boolean)
 RETURNS ipas_documents
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_actor uuid := public.get_employee_id();
  v_row public.ipas_documents;
  v_before boolean;
begin
  if v_actor is null then
    raise exception 'ipas_tick_document: not signed in' using errcode = '42501';
  end if;
  if p_side is null or p_side not in ('purchasing', 'finance') then
    raise exception 'ipas_tick_document: tick Purchasing has it or Finance has it' using errcode = '22023';
  end if;
  if p_value is null then
    raise exception 'ipas_tick_document: tick it or untick it' using errcode = '22023';
  end if;

  -- Each tick belongs to its own department. One flag never ticks for the other.
  if p_side = 'purchasing' and not public.has_purchasing_access() then
    raise exception 'ipas_tick_document: only Purchasing ticks Purchasing has it' using errcode = '42501';
  end if;
  if p_side = 'finance' and not public.has_finance_access() then
    raise exception 'ipas_tick_document: only Finance ticks Finance has it' using errcode = '42501';
  end if;

  v_row := public._ipas_lock_document('ipas_tick_document', p_document_id);
  v_before := case p_side when 'purchasing' then v_row.purchasing_has else v_row.finance_has end;
  if v_before = p_value then
    return v_row;
  end if;

  if p_side = 'purchasing' then
    update public.ipas_documents set purchasing_has = p_value where id = v_row.id returning * into v_row;
  else
    update public.ipas_documents set finance_has = p_value where id = v_row.id returning * into v_row;
  end if;

  perform public._ipas_write_event(v_row.ipas_id, v_actor, 'document_ticked', jsonb_build_object(
    'document_id', v_row.id,
    'label', public._ipas_document_label(v_row),
    'side', p_side,
    'value', p_value
  ));

  return v_row;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.ipas_undo_approval(p_ipas_id uuid, p_section integer, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_actor uuid := public.get_employee_id();
  v_reason text := nullif(btrim(p_reason), '');
  v_ipas public.ipas;
  v_approver uuid;
  v_cascade text[] := '{}'::text[];
  v_cascade_ids uuid[] := '{}'::uuid[];
  v_notify uuid[] := '{}'::uuid[];
begin
  if v_actor is null then
    raise exception 'ipas_undo_approval: not signed in' using errcode = '42501';
  end if;
  if v_reason is null then
    raise exception 'ipas_undo_approval: give a reason, so the approver knows why' using errcode = '22023';
  end if;
  if length(v_reason) > 500 then
    raise exception 'ipas_undo_approval: the reason is 500 characters at most' using errcode = '22023';
  end if;
  if p_section is null or p_section not in (1, 3, 6) then
    raise exception 'ipas_undo_approval: only sections 1, 2 and 3 have an approval to undo' using errcode = '22023';
  end if;

  v_ipas := public._ipas_lock_open('ipas_undo_approval', p_ipas_id);

  if not public._ipas_can_sign_section(p_section, v_actor) then
    raise exception 'ipas_undo_approval: only a signer of section % undoes its approval', public._ipas_section_no(p_section) using errcode = '42501';
  end if;

  update public.ipas_signoffs s
     set cleared_at = now(), cleared_by = v_actor, cleared_reason = 'Approval undone: ' || v_reason
   where s.ipas_id = v_ipas.id and s.section = p_section and s.role = 'approved' and s.cleared_at is null
  returning s.signed_by into v_approver;

  if not found then
    raise exception 'ipas_undo_approval: section % has no approval to undo', public._ipas_section_no(p_section) using errcode = '22023';
  end if;

  -- Section 4 stood on both approvals: its open sign-offs go too.
  with cleared as (
    update public.ipas_signoffs s
       set cleared_at = now(), cleared_by = v_actor,
           cleared_reason = 'Section ' || public._ipas_section_no(p_section) || ' approval undone: ' || v_reason
     where s.ipas_id = v_ipas.id
       and s.section = 7
       and s.role in ('received', 'noted', 'checked')
       and s.cleared_at is null
    returning s.role, s.signed_by
  )
  select coalesce(array_agg(role order by role), '{}'::text[]),
         coalesce(array_agg(distinct signed_by) filter (where signed_by is distinct from v_actor), '{}'::uuid[])
    into v_cascade, v_cascade_ids
    from cleared;

  v_notify := v_cascade_ids;
  if v_approver is not null and v_approver is distinct from v_actor then
    v_notify := v_notify || v_approver;
  end if;
  v_notify := (select coalesce(array_agg(distinct x), '{}'::uuid[]) from unnest(v_notify) as x);

  perform public._ipas_write_event(v_ipas.id, v_actor, 'approval_undone', jsonb_build_object(
    'section', p_section,
    'reason', v_reason,
    'approver_id', v_approver,
    'cleared_section_7', to_jsonb(v_cascade)
  ));

  return jsonb_build_object(
    'ipas', to_jsonb(v_ipas),
    'section', p_section,
    'actor_id', v_actor,
    'approver_id', v_approver,
    'cleared_section_7', to_jsonb(v_cascade),
    'notify_ids', to_jsonb(v_notify)
  );
end;
$function$
;
CREATE OR REPLACE FUNCTION public.ipas_update_charge(p_charge_id uuid, p_kind_id uuid, p_charged_on date, p_amount_php numeric)
 RETURNS ipas_charges
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_actor uuid := public._ipas_money_writer('ipas_update_charge');
  v_ipas_id uuid;
  v_ipas public.ipas;
  v_before public.ipas_charges;
  v_row public.ipas_charges;
  v_amount numeric := round(p_amount_php, 2);
  v_label text;
  v_changes jsonb := '{}'::jsonb;
begin
  select ipas_id into v_ipas_id from public.ipas_charges where id = p_charge_id;
  if v_ipas_id is null then
    raise exception 'ipas_update_charge: charge % not found', p_charge_id using errcode = '22023';
  end if;

  v_ipas := public._ipas_lock_open('ipas_update_charge', v_ipas_id);
  select * into v_before from public.ipas_charges where id = p_charge_id for update;
  if v_before.id is null then
    raise exception 'ipas_update_charge: charge % not found', p_charge_id using errcode = '22023';
  end if;

  if p_charged_on is null then
    raise exception 'ipas_update_charge: give the date of the charge' using errcode = '22023';
  end if;
  if v_amount is null or v_amount <= 0 then
    raise exception 'ipas_update_charge: the amount must be more than zero' using errcode = '22023';
  end if;
  v_label := public._ipas_check_option('ipas_update_charge', p_kind_id, 'charge_kind', v_before.kind_id, 'charge kind');

  if v_before.kind_id is distinct from p_kind_id then
    v_changes := v_changes || jsonb_build_object('kind', jsonb_build_object(
      'from', (select o.label from public.ipas_options o where o.id = v_before.kind_id),
      'to', v_label));
  end if;
  if v_before.charged_on is distinct from p_charged_on then
    v_changes := v_changes || jsonb_build_object('charged_on',
      jsonb_build_object('from', v_before.charged_on, 'to', p_charged_on));
  end if;
  if v_before.amount_php is distinct from v_amount then
    v_changes := v_changes || jsonb_build_object('amount_php',
      jsonb_build_object('from', v_before.amount_php, 'to', v_amount));
  end if;
  if v_changes = '{}'::jsonb then
    return v_before;
  end if;

  update public.ipas_charges
     set kind_id = p_kind_id, charged_on = p_charged_on, amount_php = v_amount
   where id = v_before.id
  returning * into v_row;

  perform public._ipas_write_event(v_ipas.id, v_actor, 'charge_changed', jsonb_build_object(
    'charge_id', v_row.id,
    'kind', v_label,
    'changes', v_changes
  ));

  return v_row;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.ipas_update_payment(p_payment_id uuid, p_kind text, p_paid_on date, p_amount numeric, p_php_debited numeric, p_charge_fee_php numeric, p_method_id uuid, p_check_no text, p_proof_url text)
 RETURNS ipas_payments
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_actor uuid := public._ipas_money_writer('ipas_update_payment');
  v_ipas_id uuid;
  v_ipas public.ipas;
  v_before public.ipas_payments;
  v_row public.ipas_payments;
  v_clean jsonb;
  v_check text := nullif(btrim(p_check_no), '');
  v_proof text := nullif(btrim(p_proof_url), '');
  v_changes jsonb := '{}'::jsonb;
begin
  select ipas_id into v_ipas_id from public.ipas_payments where id = p_payment_id;
  if v_ipas_id is null then
    raise exception 'ipas_update_payment: payment % not found', p_payment_id using errcode = '22023';
  end if;

  v_ipas := public._ipas_lock_open('ipas_update_payment', v_ipas_id);
  select * into v_before from public.ipas_payments where id = p_payment_id for update;
  if v_before.id is null then
    raise exception 'ipas_update_payment: payment % not found', p_payment_id using errcode = '22023';
  end if;

  v_clean := public._ipas_clean_payment(
    'ipas_update_payment', v_ipas, p_kind, p_paid_on, p_amount, p_php_debited, p_charge_fee_php, p_method_id,
    v_before.method_id
  );
  if v_proof is not null and v_proof !~* '^https?://' then
    raise exception 'ipas_update_payment: the proof of payment must be a link to the uploaded file' using errcode = '22023';
  end if;

  if v_before.kind is distinct from p_kind then
    v_changes := v_changes || jsonb_build_object('kind', jsonb_build_object('from', v_before.kind, 'to', p_kind));
  end if;
  if v_before.paid_on is distinct from p_paid_on then
    v_changes := v_changes || jsonb_build_object('paid_on', jsonb_build_object('from', v_before.paid_on, 'to', p_paid_on));
  end if;
  if v_before.amount is distinct from (v_clean->>'amount')::numeric then
    v_changes := v_changes || jsonb_build_object('amount',
      jsonb_build_object('from', v_before.amount, 'to', (v_clean->>'amount')::numeric));
  end if;
  if v_before.php_debited is distinct from (v_clean->>'php_debited')::numeric then
    v_changes := v_changes || jsonb_build_object('php_debited',
      jsonb_build_object('from', v_before.php_debited, 'to', (v_clean->>'php_debited')::numeric));
  end if;
  if v_before.charge_fee_php is distinct from (v_clean->>'charge_fee_php')::numeric then
    v_changes := v_changes || jsonb_build_object('charge_fee_php',
      jsonb_build_object('from', v_before.charge_fee_php, 'to', (v_clean->>'charge_fee_php')::numeric));
  end if;
  if v_before.method_id is distinct from p_method_id then
    v_changes := v_changes || jsonb_build_object('method', jsonb_build_object(
      'from', (select o.label from public.ipas_options o where o.id = v_before.method_id),
      'to', v_clean->>'method_label'));
  end if;
  if v_before.check_no is distinct from v_check then
    v_changes := v_changes || jsonb_build_object('check_no', jsonb_build_object('from', v_before.check_no, 'to', v_check));
  end if;
  if v_before.proof_url is distinct from v_proof then
    v_changes := v_changes || jsonb_build_object('proof', jsonb_build_object(
      'from', v_before.proof_url is not null, 'to', v_proof is not null));
  end if;

  if v_changes = '{}'::jsonb then
    return v_before;
  end if;

  update public.ipas_payments
     set kind = p_kind,
         paid_on = p_paid_on,
         amount = (v_clean->>'amount')::numeric,
         php_debited = (v_clean->>'php_debited')::numeric,
         charge_fee_php = (v_clean->>'charge_fee_php')::numeric,
         method_id = p_method_id,
         check_no = v_check,
         proof_url = v_proof
   where id = v_before.id
  returning * into v_row;

  perform public._ipas_write_event(v_ipas.id, v_actor, 'payment_changed', jsonb_build_object(
    'payment_id', v_row.id,
    'kind', v_row.kind,
    'changes', v_changes
  ));

  return v_row;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.ipas_worked_on(p_ipas_ids uuid[])
 RETURNS SETOF uuid
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select distinct e.ipas_id
    from public.ipas_events e
   where e.ipas_id = any (coalesce(p_ipas_ids, '{}'::uuid[]))
     and e.kind not in (
       'created',
       'odoo_copy_changed', 'filled_from_odoo', 'odoo_changed_since_filing',
       'on_hold_set', 'on_hold_changed', 'on_hold_cleared'
     )
     and not (e.kind = 'approvals_cleared' and e.detail ->> 'reason' = 'PO changed in Odoo');
$function$
;
CREATE OR REPLACE FUNCTION public.is_head()
 RETURNS boolean
 LANGUAGE sql
 SECURITY DEFINER
AS $function$
  SELECT is_head FROM public.employees WHERE email = auth.jwt() ->> 'email';
$function$
;
CREATE OR REPLACE FUNCTION public.is_hr()
 RETURNS boolean
 LANGUAGE sql
 SECURITY DEFINER
AS $function$
  SELECT is_hr FROM public.employees WHERE email = auth.jwt() ->> 'email';
$function$
;
CREATE OR REPLACE FUNCTION public.is_purchase_request_member(p_request_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1 from purchase_request_members m
    where m.request_id = p_request_id
      and m.employee_id = get_employee_id()
  );
$function$
;
CREATE OR REPLACE FUNCTION public.is_role_simulator()
 RETURNS boolean
 LANGUAGE sql
 SECURITY DEFINER
AS $function$
  select is_role_simulator from public.employees where email = auth.jwt() ->> 'email';
$function$
;
CREATE OR REPLACE FUNCTION public.is_super_admin()
 RETURNS boolean
 LANGUAGE sql
 SECURITY DEFINER
AS $function$
  SELECT is_super_admin FROM public.employees WHERE email = auth.jwt() ->> 'email';
$function$
;
CREATE OR REPLACE FUNCTION public.lock_sales_flow(p_flow_id uuid, p_actor_id uuid, p_snapshot_data jsonb, p_note text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
AS $function$
declare
  v_flow record;
  v_major integer;
  v_minor integer;
  v_snapshot record;
  v_latest_data jsonb;
begin
  select * into v_flow from sales_flows where id = p_flow_id for update;
  if not found then
    raise exception 'Sales Flow not found.';
  end if;
  if v_flow.state <> 'draft' then
    raise exception 'This Sales Flow is locked. Unlock it first, with a reason, to make changes.';
  end if;

  select fs.snapshot_data
    into v_latest_data
  from flow_snapshots fs
  where fs.flow_id = p_flow_id
  order by fs.version desc, fs.version_minor desc
  limit 1;

  if v_latest_data is not null and v_latest_data = p_snapshot_data then
    raise exception 'This draft is identical to the latest version. There is nothing to publish.';
  end if;

  select version_major, version_minor
    into v_major, v_minor
  from public.flow_snapshot_next_version(p_flow_id, p_snapshot_data);

  update sales_flows set
    state = 'locked',
    locked_at = now(),
    locked_by = p_actor_id,
    updated_at = now()
  where id = p_flow_id
  returning * into v_flow;

  insert into flow_snapshots (flow_id, version, version_minor, snapshot_data, created_by, note)
  values (p_flow_id, v_major, v_minor, p_snapshot_data, p_actor_id, nullif(trim(p_note), ''))
  returning * into v_snapshot;

  return json_build_object('flow', row_to_json(v_flow), 'snapshot', row_to_json(v_snapshot));
end;
$function$
;
CREATE OR REPLACE FUNCTION public.mark_bug_report_files_purged(p_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not can_read_bug_reports() then
    raise exception 'You do not have Bug Reports access.';
  end if;

  update bug_reports set
    attachments = '[]'::jsonb,
    attachments_purged_at = now()
  where id = p_id
    and created_at < now() - interval '1 year';

  if not found then
    raise exception 'Bug report not found, or not a year old yet.';
  end if;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.move_opportunities_to_flow_snapshot(p_opportunity_ids uuid[], p_target_snapshot_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_target flow_snapshots%rowtype;
  v_target_label text;
  v_actor uuid := public.get_employee_id();
  v_id uuid;
  v_opp sales_opportunities%rowtype;
  v_source flow_snapshots%rowtype;
  v_source_label text;
  v_label text;
  v_event jsonb;
  v_rows integer;
  v_moved jsonb := '[]'::jsonb;
  v_failed jsonb := '[]'::jsonb;
begin
  select * into v_target from flow_snapshots where id = p_target_snapshot_id;
  if not found then
    raise exception 'Flow Snapshot not found.';
  end if;
  v_target_label := 'v' || v_target.version || '.' || coalesce(v_target.version_minor, 0);

  foreach v_id in array coalesce(p_opportunity_ids, '{}'::uuid[]) loop
    begin
      select * into v_opp from sales_opportunities where id = v_id;
      if not found or v_opp.is_deleted is true then
        v_failed := v_failed || jsonb_build_object('id', v_id, 'reason', 'This deal no longer exists or you cannot see it.');
        continue;
      end if;

      if v_opp.sale_type_id is null then
        v_failed := v_failed || jsonb_build_object('id', v_id, 'reason', 'This deal does not run a Sales Flow, so it has no Flow Snapshot to move.');
        continue;
      end if;

      if not exists (
        select 1 from sales_flows
         where sale_type_id = v_opp.sale_type_id and id = v_target.flow_id
      ) then
        v_failed := v_failed || jsonb_build_object('id', v_id, 'reason', 'That Flow Snapshot belongs to a different flow.');
        continue;
      end if;

      if not exists (
        select 1
          from jsonb_array_elements(coalesce(v_target.snapshot_data -> 'stages', '[]'::jsonb)) st
         where st ->> 'id' = v_opp.flow_stage_id::text
      ) then
        v_failed := v_failed || jsonb_build_object(
          'id', v_id,
          'reason', 'This deal''s current Stage does not exist in Flow Snapshot ' || v_target_label
            || ', so moving it would strand it. Move it to a different Stage first, or choose a different snapshot.'
        );
        continue;
      end if;

      v_source_label := 'no Flow Snapshot';
      if v_opp.flow_snapshot_id is not null then
        select * into v_source from flow_snapshots where id = v_opp.flow_snapshot_id;
        v_source_label := case
          when found then 'v' || v_source.version || '.' || coalesce(v_source.version_minor, 0)
          else 'an unknown Flow Snapshot'
        end;
      end if;

      update sales_opportunities
         set flow_snapshot_id = v_target.id
       where id = v_id;
      get diagnostics v_rows = row_count;
      if v_rows = 0 then
        v_failed := v_failed || jsonb_build_object('id', v_id, 'reason', 'You do not have permission to move this deal.');
        continue;
      end if;

      v_event := jsonb_build_object(
        'event', 'FLOW_SNAPSHOT_MOVED',
        'from', v_opp.flow_snapshot_id,
        'to', v_target.id,
        'employeeId', v_actor
      );
      v_label := case
        when coalesce(v_opp.sales_reference, '') <> '' then 'Sales opportunity ' || v_opp.sales_reference
        else 'Sales opportunity for ' || v_opp.client_name
      end;

      insert into sales_opportunity_logs (opportunity_id, author_id, type, content, metadata)
      values (
        v_id, v_actor, 'SYSTEM',
        'Flow Snapshot changed: ' || v_source_label || ' → ' || v_target_label || '.',
        v_event
      );
      insert into system_audit_logs (author_id, type, entity_type, entity_id, content, metadata)
      values (
        v_actor, 'SYSTEM', 'OPPORTUNITY', v_id,
        v_label || ': Flow Snapshot changed ' || v_source_label || ' → ' || v_target_label || '.',
        v_event
      );

      v_moved := v_moved || jsonb_build_object('id', v_id);
    exception when others then
      -- The sub-transaction rolls this one SOR back; the batch carries on.
      v_failed := v_failed || jsonb_build_object('id', v_id, 'reason', sqlerrm);
    end;
  end loop;

  return jsonb_build_object('moved', v_moved, 'failed', v_failed);
end;
$function$
;
CREATE OR REPLACE FUNCTION public.order_ageing_rules_stamp()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  new.updated_at = now();
  new.updated_by = coalesce(public.get_employee_id(), new.updated_by);
  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.order_condition_inputs(p_opportunity_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if public.get_employee_id() is null then
    raise exception 'order_condition_inputs: sign in first' using errcode = '42501';
  end if;
  if public.sor_access_level(p_opportunity_id) = 'none' then
    raise exception 'order_condition_inputs: you can''t see this SOR' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'unclosed_slips',
      (select count(distinct t.id)
         from public.transmittals t
         join public.transmittal_lines l on l.transmittal_id = t.id
        where l.opportunity_id = p_opportunity_id
          and t.state in ('warehouse_checking', 'warehouse_releasing', 'technical_inspection', 'awaiting_check')),
    'unfiled_orders',
      (select count(distinct i.id)
         from public.ipas i
         join public.ipas_sors s on s.ipas_id = i.id
        where s.opportunity_id = p_opportunity_id
          and i.state = 'open')
  );
end;
$function$
;
CREATE OR REPLACE FUNCTION public.order_deadline_setting_stamp()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  new.updated_at = now();
  new.updated_by = coalesce(public.get_employee_id(), new.updated_by);
  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.override_currency_rate(p_currency text, p_rate_date date, p_php_per_unit numeric)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not coalesce(public.is_super_admin(), false) then
    raise exception 'Only a Super Admin can override a Reference Rate.' using errcode = '42501';
  end if;
  if p_php_per_unit is null or p_php_per_unit <= 0 then
    raise exception 'A Reference Rate must be more than zero.' using errcode = '22023';
  end if;

  -- Currencies are added on demand: overriding one starts fetching it too.
  insert into public.currency_rate_currencies (currency) values (upper(p_currency))
  on conflict (currency) do nothing;

  insert into public.currency_rates
    (currency, rate_date, php_per_unit, source, overridden_by, overridden_at, replaced_php_per_unit)
  values
    (upper(p_currency), p_rate_date, p_php_per_unit, 'override', public.get_employee_id(), now(), null)
  on conflict (currency, rate_date) do update
    set replaced_php_per_unit = case
          when public.currency_rates.overridden_at is null then public.currency_rates.php_per_unit
          else public.currency_rates.replaced_php_per_unit
        end,
        php_per_unit = excluded.php_per_unit,
        source = 'override',
        overridden_by = excluded.overridden_by,
        overridden_at = excluded.overridden_at;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.packing_list_add_box(p_packing_list_id uuid, p_marks text DEFAULT NULL::text, p_seal_no text DEFAULT NULL::text, p_gross_weight_kg numeric DEFAULT NULL::numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_row public.packing_lists := public._packing_list_editable(p_packing_list_id);
  v_box public.packing_list_boxes;
begin
  insert into public.packing_list_boxes (packing_list_id, box_no, marks, seal_no, gross_weight_kg)
  values (
    v_row.id,
    (select coalesce(max(b.box_no), 0) + 1 from public.packing_list_boxes b where b.packing_list_id = v_row.id),
    nullif(btrim(coalesce(p_marks, '')), ''),
    nullif(btrim(coalesce(p_seal_no, '')), ''),
    p_gross_weight_kg
  )
  returning * into v_box;

  perform public._packing_list_event(v_row.id, public.get_employee_id(), 'box_added', jsonb_build_object('box_no', v_box.box_no));
  return jsonb_build_object('id', v_box.id, 'box_no', v_box.box_no);
end;
$function$
;
CREATE OR REPLACE FUNCTION public.packing_list_box_can_read(p_box_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select public.packing_list_can_read(b.packing_list_id)
    from public.packing_list_boxes b
   where b.id = p_box_id;
$function$
;
CREATE OR REPLACE FUNCTION public.packing_list_boxes_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_list uuid := coalesce(new.packing_list_id, old.packing_list_id);
begin
  if exists (select 1 from public.packing_lists p where p.id = v_list and p.state = 'packed') then
    raise exception 'packing_list_boxes: a packed Packing List''s boxes can''t be changed' using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.packing_list_can_create()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce(public.has_purchasing_access(), false)
    or public.transmittal_on_list('transmittal_warehouse');
$function$
;
CREATE OR REPLACE FUNCTION public.packing_list_can_read(p_packing_list_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select public.ipas_can_read()
    or public.transmittal_on_list('transmittal_warehouse')
    or exists (
      select 1 from public.packing_lists p
       where p.id = p_packing_list_id
         and (p.created_by = public.get_employee_id() or p.packed_by = public.get_employee_id())
    )
    or exists (
      select 1 from public.packing_lists p
        join public.sales_opportunities o on o.id = p.opportunity_id
       where p.id = p_packing_list_id
         and (
           public.is_super_admin()
           or public.sor_is_deal_team(o, public.get_employee_id())
           or public.sor_always_sees(o, public.get_employee_id())
         )
    );
$function$
;
CREATE OR REPLACE FUNCTION public.packing_list_contents_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_box uuid := coalesce(new.box_id, old.box_id);
begin
  if exists (
    select 1
      from public.packing_list_boxes b
      join public.packing_lists p on p.id = b.packing_list_id
     where b.id = v_box and p.state = 'packed'
  ) then
    raise exception 'packing_list_contents: a packed Packing List''s contents can''t be changed' using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.packing_list_create(p_opportunity_id uuid, p_odoo_delivery_ref text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_actor uuid := public.get_employee_id();
  v_row public.packing_lists;
begin
  if v_actor is null then
    raise exception 'packing_list_create: not signed in' using errcode = '42501';
  end if;
  if not public.packing_list_can_create() then
    raise exception 'packing_list_create: only Purchasing, or the Warehouse list, makes a Packing List'
      using errcode = '42501';
  end if;
  if p_opportunity_id is null or not exists (
    select 1 from public.sales_opportunities o where o.id = p_opportunity_id and not coalesce(o.is_deleted, false)
  ) then
    raise exception 'packing_list_create: a Packing List is for one SOR' using errcode = '22023';
  end if;

  insert into public.packing_lists (opportunity_id, odoo_delivery_ref, created_by)
  values (p_opportunity_id, nullif(btrim(coalesce(p_odoo_delivery_ref, '')), ''), v_actor)
  returning * into v_row;

  perform public._packing_list_event(v_row.id, v_actor, 'created', jsonb_build_object('number', v_row.number));

  return jsonb_build_object('id', v_row.id, 'number', v_row.number);
end;
$function$
;
CREATE OR REPLACE FUNCTION public.packing_list_pack(p_packing_list_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_actor uuid := public.get_employee_id();
  v_row public.packing_lists := public._packing_list_editable(p_packing_list_id);
  v_boxes integer;
  v_empty integer;
begin
  select count(*), count(*) filter (where not exists (
           select 1 from public.packing_list_contents c where c.box_id = b.id))
    into v_boxes, v_empty
    from public.packing_list_boxes b
   where b.packing_list_id = v_row.id;

  if v_boxes = 0 then
    raise exception 'packing list: % has no boxes, so it can''t be packed', v_row.number using errcode = '22023';
  end if;
  if v_empty > 0 then
    raise exception 'packing list: % has % box(es) with no contents', v_row.number, v_empty using errcode = '22023';
  end if;

  update public.packing_lists
     set state = 'packed', packed_by = v_actor, packed_at = now()
   where id = v_row.id;

  perform public._packing_list_event(v_row.id, v_actor, 'packed', jsonb_build_object(
    'number', v_row.number,
    'boxes', v_boxes
  ));

  return jsonb_build_object('id', v_row.id, 'number', v_row.number, 'boxes', v_boxes);
end;
$function$
;
CREATE OR REPLACE FUNCTION public.packing_list_remove_box(p_box_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_box public.packing_list_boxes;
  v_row public.packing_lists;
begin
  select * into v_box from public.packing_list_boxes where id = p_box_id;
  if not found then
    raise exception 'packing list: no such box' using errcode = 'P0002';
  end if;
  v_row := public._packing_list_editable(v_box.packing_list_id);
  delete from public.packing_list_boxes where id = v_box.id;
  perform public._packing_list_event(v_row.id, public.get_employee_id(), 'box_removed', jsonb_build_object('box_no', v_box.box_no));
end;
$function$
;
CREATE OR REPLACE FUNCTION public.packing_list_set_contents(p_box_id uuid, p_contents jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_box public.packing_list_boxes;
  v_row public.packing_lists;
  v_item jsonb;
  v_pos integer := 0;
begin
  select * into v_box from public.packing_list_boxes where id = p_box_id;
  if not found then
    raise exception 'packing list: no such box' using errcode = 'P0002';
  end if;
  v_row := public._packing_list_editable(v_box.packing_list_id);

  delete from public.packing_list_contents where box_id = v_box.id;

  for v_item in select * from jsonb_array_elements(coalesce(p_contents, '[]'::jsonb)) loop
    v_pos := v_pos + 1;
    insert into public.packing_list_contents (box_id, position, description, quantity, unit, sor_line_snapshot)
    values (
      v_box.id,
      v_pos,
      btrim(coalesce(v_item->>'description', '')),
      (v_item->>'quantity')::numeric,
      nullif(btrim(coalesce(v_item->>'unit', '')), ''),
      case when jsonb_typeof(v_item->'snapshot') = 'object' then v_item->'snapshot' else null end
    );
  end loop;

  perform public._packing_list_event(v_row.id, public.get_employee_id(), 'contents_set', jsonb_build_object(
    'box_no', v_box.box_no,
    'lines', v_pos
  ));
end;
$function$
;
CREATE OR REPLACE FUNCTION public.packing_list_sor_products(p_opportunity_id uuid)
 RETURNS TABLE(id uuid, product_name text, quantity numeric, unit text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if public.get_employee_id() is null then
    raise exception 'packing_list_sor_products: not signed in' using errcode = '42501';
  end if;
  if not (coalesce(public.has_purchasing_access(), false) or public.transmittal_on_list('transmittal_warehouse')) then
    raise exception 'packing_list_sor_products: only Purchasing or the Warehouse list packs an SOR' using errcode = '42501';
  end if;
  return query
    select i.id, i.product_name, i.quantity, i.unit
      from public.sales_opportunity_items i
     where i.opportunity_id = p_opportunity_id
     order by i.sort_order, i.created_at;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.packing_list_sor_refs(p_packing_list_ids uuid[])
 RETURNS TABLE(packing_list_id uuid, sor_id uuid, sor_reference text, sor_project text, client_name text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if auth.uid() is null then
    raise exception 'packing_list_sor_refs: not signed in' using errcode = '42501';
  end if;

  return query
    select p.id, o.id, o.sales_reference, o.project_title, o.client_name
      from public.packing_lists p
      join public.sales_opportunities o on o.id = p.opportunity_id
     where p.id = any (coalesce(p_packing_list_ids, '{}'::uuid[]))
       and public.packing_list_can_read(p.id);
end;
$function$
;
CREATE OR REPLACE FUNCTION public.packing_list_update_box(p_box_id uuid, p_marks text DEFAULT NULL::text, p_seal_no text DEFAULT NULL::text, p_gross_weight_kg numeric DEFAULT NULL::numeric)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_box public.packing_list_boxes;
  v_row public.packing_lists;
begin
  select * into v_box from public.packing_list_boxes where id = p_box_id;
  if not found then
    raise exception 'packing list: no such box' using errcode = 'P0002';
  end if;
  v_row := public._packing_list_editable(v_box.packing_list_id);
  update public.packing_list_boxes
     set marks = nullif(btrim(coalesce(p_marks, '')), ''),
         seal_no = nullif(btrim(coalesce(p_seal_no, '')), ''),
         gross_weight_kg = p_gross_weight_kg
   where id = v_box.id;
  perform public._packing_list_event(v_row.id, public.get_employee_id(), 'box_updated', jsonb_build_object('box_no', v_box.box_no));
end;
$function$
;
CREATE OR REPLACE FUNCTION public.packing_list_update_header(p_packing_list_id uuid, p_odoo_delivery_ref text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_row public.packing_lists := public._packing_list_editable(p_packing_list_id);
begin
  update public.packing_lists
     set odoo_delivery_ref = nullif(btrim(coalesce(p_odoo_delivery_ref, '')), '')
   where id = v_row.id;
  perform public._packing_list_event(v_row.id, public.get_employee_id(), 'header_updated', jsonb_build_object(
    'odoo_delivery_ref', nullif(btrim(coalesce(p_odoo_delivery_ref, '')), '')
  ));
end;
$function$
;
CREATE OR REPLACE FUNCTION public.packing_lists_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if tg_op = 'DELETE' then
    raise exception 'packing_lists: a Packing List is never deleted' using errcode = '42501';
  end if;
  if old.state = 'packed' then
    raise exception 'packing_lists: % is packed and can''t be changed', old.number using errcode = '42501';
  end if;
  if new.state = 'packed' and (new.packed_by is null or new.packed_at is null) then
    raise exception 'packing_lists: packing signs Packed by' using errcode = '42501';
  end if;
  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.pms_evidence_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_stage_id uuid := coalesce(new.record_id, old.record_id);
  v_stage_tx uuid;
  v_done timestamptz;
  v_state text;
  v_number text;
begin
  if tg_op = 'UPDATE' then
    raise exception 'pms_evidence: a file is added or removed, never changed' using errcode = '42501';
  end if;

  select s.transmittal_id, s.completed_at, t.state, t.number
    into v_stage_tx, v_done, v_state, v_number
    from public.transmittal_stages s
    join public.transmittals t on t.id = s.transmittal_id
   where s.id = v_stage_id;

  if not found then
    raise exception 'pms_evidence: that stage doesn''t exist' using errcode = 'P0002';
  end if;
  if v_done is not null or v_state in ('closed', 'cancelled') then
    raise exception 'transmittal: the stage of % is signed or ended; its files can''t change', v_number
      using errcode = '42501';
  end if;
  if tg_op = 'INSERT' and new.transmittal_id is distinct from v_stage_tx then
    raise exception 'pms_evidence: the file must belong to its stage''s Transmittal' using errcode = '22023';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.pms_handoff_events_append_only()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  raise exception 'pms_handoff_events is append-only: history can''t be changed (% refused)', tg_op
    using errcode = '42501';
end;
$function$
;
CREATE OR REPLACE FUNCTION public.pr_actor_side(p_request_id uuid)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select public.purchase_request_actor_side(p_request_id);
$function$
;
CREATE OR REPLACE FUNCTION public.pr_add_substitute(p_item_id uuid, p_name text, p_quantity numeric, p_unit text DEFAULT NULL::text, p_description text DEFAULT NULL::text, p_images jsonb DEFAULT '[]'::jsonb)
 RETURNS uuid
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select public.purchase_request_add_substitute(p_item_id, p_name, p_quantity, p_unit, p_description, p_images);
$function$
;
CREATE OR REPLACE FUNCTION public.pr_can_add_substitute(p_request_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select public.purchase_request_can_add_substitute(p_request_id);
$function$
;
CREATE OR REPLACE FUNCTION public.pr_item_po_lines(p_item_id uuid)
 RETURNS integer[]
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select public.purchase_request_item_po_lines(p_item_id);
$function$
;
CREATE OR REPLACE FUNCTION public.pr_pick_po_lines(p_item_id uuid, p_line_ids integer[])
 RETURNS purchase_request_items
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select * from public.purchase_request_pick_po_lines(p_item_id, p_line_ids);
$function$
;
CREATE OR REPLACE FUNCTION public.pr_queue(p_request_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(id uuid, opportunity_id uuid, sales_reference text, project_title text, stage_name text, sor_closed text, buyer_id uuid, buyer_name text, buyer_avatar_path text, created_at timestamp with time zone, updated_at timestamp with time zone, item_count integer, open_count integer, last_activity_at timestamp with time zone, sor_status text, title text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select * from public.purchase_request_queue(p_request_id);
$function$
;
CREATE OR REPLACE FUNCTION public.pr_set_buyer(p_request_id uuid, p_employee_id uuid)
 RETURNS purchase_requests
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select * from public.purchase_request_set_buyer(p_request_id, p_employee_id);
$function$
;
CREATE OR REPLACE FUNCTION public.pr_set_item_status(p_item_id uuid, p_status text, p_details jsonb DEFAULT '{}'::jsonb)
 RETURNS purchase_request_items
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select * from public.purchase_request_set_item_status(p_item_id, p_status, p_details);
$function$
;
CREATE OR REPLACE FUNCTION public.pr_take(p_request_id uuid)
 RETURNS purchase_requests
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select * from public.purchase_request_take(p_request_id);
$function$
;
CREATE OR REPLACE FUNCTION public.prevent_role_escalation()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_caller_id                UUID;
  v_caller_is_super_admin    BOOLEAN;
  v_caller_is_hr             BOOLEAN;
  v_caller_can_manage_leaves BOOLEAN;
  v_caller_is_role_simulator BOOLEAN;
BEGIN
  v_caller_id := public.get_employee_id();

  SELECT is_super_admin, is_hr, can_manage_leaves, is_role_simulator
  INTO   v_caller_is_super_admin, v_caller_is_hr, v_caller_can_manage_leaves, v_caller_is_role_simulator
  FROM   public.employees
  WHERE  id = v_caller_id;

  IF v_caller_is_role_simulator IS TRUE THEN
    RETURN NEW;
  END IF;

  IF NOT (v_caller_is_super_admin IS TRUE OR v_caller_is_hr IS TRUE) THEN
    IF NEW.is_super_admin IS DISTINCT FROM OLD.is_super_admin THEN
      NEW.is_super_admin := OLD.is_super_admin;
    END IF;
    IF NEW.is_hr IS DISTINCT FROM OLD.is_hr THEN
      NEW.is_hr := OLD.is_hr;
    END IF;
    IF NEW.is_head IS DISTINCT FROM OLD.is_head THEN
      NEW.is_head := OLD.is_head;
    END IF;
  END IF;

  IF NEW.is_super_admin = TRUE
     AND OLD.is_super_admin = FALSE
     AND NOT (v_caller_is_super_admin IS TRUE)
  THEN
    RAISE EXCEPTION
      'Insufficient privileges: only a super-admin can grant super-admin status.'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.can_manage_leaves IS DISTINCT FROM OLD.can_manage_leaves
     AND NOT (v_caller_is_super_admin IS TRUE)
  THEN
    RAISE EXCEPTION
      'Insufficient privileges: only a super-admin can change leave-management access.'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.can_edit_sales_flows IS DISTINCT FROM OLD.can_edit_sales_flows
     AND NOT (v_caller_is_super_admin IS TRUE)
  THEN
    RAISE EXCEPTION
      'Insufficient privileges: only a super-admin can change Flow editor access.'
      USING ERRCODE = '42501';
  END IF;

  -- Purchasing and Finance access (#242). Only a Super Admin or HR grants
  -- them, and HR cannot grant themselves (a Super Admin may). A caller with no
  -- employee row is the service role or a migration, and is trusted.
  IF v_caller_id IS NOT NULL
     AND (
       NOT (v_caller_is_super_admin IS TRUE OR v_caller_is_hr IS TRUE)
       OR (OLD.id = v_caller_id AND NOT (v_caller_is_super_admin IS TRUE))
     )
  THEN
    IF NEW.has_purchasing_flow IS DISTINCT FROM OLD.has_purchasing_flow THEN
      NEW.has_purchasing_flow := OLD.has_purchasing_flow;
    END IF;
    IF NEW.has_finance_flow IS DISTINCT FROM OLD.has_finance_flow THEN
      NEW.has_finance_flow := OLD.has_finance_flow;
    END IF;
  END IF;

  -- Call sign (#247). Only HR and Super Admins set one, their own included.
  IF v_caller_id IS NOT NULL
     AND NOT (v_caller_is_super_admin IS TRUE OR v_caller_is_hr IS TRUE)
     AND NEW.call_sign IS DISTINCT FROM OLD.call_sign
  THEN
    NEW.call_sign := OLD.call_sign;
  END IF;

  -- Nobody edits their own hidden-navigation override — server-side, not by
  -- hiding the control — and only HR/Super Admin may edit anyone else's.
  IF NEW.hidden_nav_keys IS DISTINCT FROM OLD.hidden_nav_keys THEN
    IF OLD.id = v_caller_id OR NOT (v_caller_is_super_admin IS TRUE OR v_caller_is_hr IS TRUE) THEN
      NEW.hidden_nav_keys := OLD.hidden_nav_keys;
    END IF;
  END IF;

  IF v_caller_can_manage_leaves IS TRUE
     AND NOT (v_caller_is_super_admin IS TRUE OR v_caller_is_hr IS TRUE)
     AND OLD.id IS DISTINCT FROM v_caller_id
  THEN
    NEW := jsonb_populate_record(OLD, jsonb_build_object(
      'offset_hours_balance', NEW.offset_hours_balance,
      'sil_hours_balance', NEW.sil_hours_balance,
      'updated_at', NEW.updated_at
    ));
  END IF;

  RETURN NEW;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.protect_task_verification()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$BEGIN
  IF OLD.hr_verified IS DISTINCT FROM NEW.hr_verified THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.employees
      WHERE email = (auth.jwt() ->> 'email') AND (is_hr = true OR is_super_admin = true)
    ) THEN
      RAISE EXCEPTION 'UNAUTHORIZED: Only HR or Super Administrators can modify the verification status of a task.';
    END IF;
  END IF;
  RETURN NEW;
END;$function$
;
CREATE OR REPLACE FUNCTION public.purchase_request_actor_side(p_request_id uuid)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select case
    when get_employee_id() is null or r.id is null then null
    when coalesce(is_super_admin(), false) then 'purchasing'
    when m.employee_id is not null and has_purchasing_access() then 'purchasing'
    when m.side = 'requester' then 'requester'
    when m.side = 'sales' or r.buyer_id = get_employee_id() then 'sales'
    when m.employee_id is not null then 'other'
    else null
  end
  from (select 1) one
  left join purchase_requests r on r.id = p_request_id
  left join purchase_request_members m
    on m.request_id = r.id and m.employee_id = get_employee_id();
$function$
;
CREATE OR REPLACE FUNCTION public.purchase_request_add_item_from_line(p_request_id uuid, p_line_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_req public.purchase_requests := public._purchase_request_for_adding(p_request_id, 'purchase_request_add_item_from_line');
  v_line public.sales_opportunity_items;
  v_name text;
  v_unit text;
  v_item public.purchase_request_items;
begin
  select * into v_line from public.sales_opportunity_items where id = p_line_id;
  if v_line.id is null or v_line.opportunity_id is distinct from v_req.opportunity_id then
    raise exception 'purchase_request_add_item_from_line: that line is no longer on this SOR''s Product List'
      using errcode = 'P0002';
  end if;
  if coalesce(v_line.quantity, 0) <= 0 then
    raise exception 'purchase_request_add_item_from_line: that line has no quantity' using errcode = '22023';
  end if;

  v_name := btrim(v_line.product_name);
  v_unit := nullif(btrim(v_line.unit), '');

  insert into public.purchase_request_items
    (request_id, source, odoo_product_id, name, unit, quantity, sor_line_snapshot, requested_by)
  values
    (p_request_id, 'sor_line', v_line.odoo_product_id, v_name, v_unit, v_line.quantity,
     jsonb_build_object('name', v_name, 'quantity', v_line.quantity, 'unit', v_unit),
     public.get_employee_id())
  returning * into v_item;

  perform public._purchase_request_item_added(v_item);
  return v_item.id;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.purchase_request_add_items_from_components(p_request_id uuid, p_component_ids uuid[])
 RETURNS uuid[]
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_req   public.purchase_requests;
  v_id    uuid;
  v_comp  public.costing_components;
  v_opp   uuid;
  v_item  public.purchase_request_items;
  v_added uuid[] := '{}';
begin
  if public.get_employee_id() is null then
    raise exception 'purchase_request_add_items_from_components: not signed in' using errcode = '42501';
  end if;
  if not public.has_purchasing_access() then
    raise exception 'purchase_request_add_items_from_components: only people with Purchasing access may add from the Costing Matrix'
      using errcode = '42501';
  end if;

  select * into v_req from public.purchase_requests where id = p_request_id;
  if v_req.id is null then
    raise exception 'purchase_request_add_items_from_components: request % not found', p_request_id using errcode = 'P0002';
  end if;
  if v_req.opportunity_id is null then
    raise exception 'purchase_request_add_items_from_components: this request has no SOR, so no Costing Matrix' using errcode = 'P0002';
  end if;
  if p_component_ids is null or cardinality(p_component_ids) = 0 then
    raise exception 'purchase_request_add_items_from_components: pick at least one Component' using errcode = '22023';
  end if;

  foreach v_id in array p_component_ids loop
    select * into v_comp from public.costing_components where id = v_id;
    select m.opportunity_id into v_opp
    from public.costing_tender_lines l
    join public.costing_matrices m on m.id = l.matrix_id
    where l.id = v_comp.tender_line_id;

    if v_comp.id is null or v_opp is distinct from v_req.opportunity_id then
      raise exception 'purchase_request_add_items_from_components: that Component is not on this SOR''s Costing Matrix'
        using errcode = 'P0002';
    end if;
    if nullif(btrim(v_comp.name), '') is null then
      raise exception 'purchase_request_add_items_from_components: a Component needs a name before it can be requested'
        using errcode = '22023';
    end if;

    insert into public.purchase_request_items
      (request_id, source, component_id, odoo_product_id, name, unit, quantity, requested_by)
    values
      (p_request_id, 'component', v_comp.id, v_comp.odoo_product_id, btrim(v_comp.name), nullif(btrim(v_comp.unit), ''),
       v_comp.quantity, public.get_employee_id())
    returning * into v_item;

    perform public._purchase_request_item_added(v_item);
    v_added := v_added || v_item.id;
  end loop;

  return v_added;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.purchase_request_add_member(p_request_id uuid, p_employee_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_actor uuid := public.get_employee_id();
begin
  if v_actor is null or not public.purchase_request_can_manage_members(p_request_id) then
    raise exception 'purchase_request_add_member: not allowed' using errcode = '42501';
  end if;

  if public._purchase_request_add_member(p_request_id, p_employee_id, v_actor) then
    perform public._purchase_request_member_event(p_request_id, v_actor, p_employee_id, 'member_added');
  end if;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.purchase_request_add_new_item(p_request_id uuid, p_name text, p_quantity numeric, p_unit text DEFAULT NULL::text, p_description text DEFAULT NULL::text, p_images jsonb DEFAULT '[]'::jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_req public.purchase_requests := public._purchase_request_for_adding(p_request_id, 'purchase_request_add_new_item');
  v_images jsonb := coalesce(p_images, '[]'::jsonb);
  v_item public.purchase_request_items;
begin
  if nullif(btrim(p_name), '') is null then
    raise exception 'purchase_request_add_new_item: a new product needs a name' using errcode = '22023';
  end if;
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'purchase_request_add_new_item: the quantity must be more than zero' using errcode = '22023';
  end if;
  if jsonb_typeof(v_images) <> 'array'
     or jsonb_array_length(v_images) > 5
     or exists (
       select 1 from jsonb_array_elements(v_images) img
       where jsonb_typeof(img) <> 'object' or nullif(img->>'url', '') is null
     ) then
    raise exception 'purchase_request_add_new_item: images must be up to 5 uploaded files' using errcode = '22023';
  end if;

  insert into public.purchase_request_items
    (request_id, source, name, unit, quantity, description, images, requested_by)
  values
    (v_req.id, 'new', btrim(p_name), nullif(btrim(p_unit), ''), p_quantity,
     nullif(btrim(p_description), ''), v_images, public.get_employee_id())
  returning * into v_item;

  perform public._purchase_request_item_added(v_item);
  return v_item.id;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.purchase_request_add_substitute(p_item_id uuid, p_name text, p_quantity numeric, p_unit text DEFAULT NULL::text, p_description text DEFAULT NULL::text, p_images jsonb DEFAULT '[]'::jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_actor uuid := public.get_employee_id();
  v_images jsonb := coalesce(p_images, '[]'::jsonb);
  v_original public.purchase_request_items;
  v_req public.purchase_requests;
  v_side text;
  v_item public.purchase_request_items;
  v_amount text;
begin
  if v_actor is null then
    raise exception 'purchase_request_add_substitute: not signed in' using errcode = '42501';
  end if;

  select * into v_original from public.purchase_request_items where id = p_item_id for update;
  if v_original.id is null then
    raise exception 'purchase_request_add_substitute: item % not found', p_item_id using errcode = 'P0002';
  end if;
  select * into v_req from public.purchase_requests where id = v_original.request_id;

  v_side := public.purchase_request_actor_side(v_req.id);
  if not public.purchase_request_can_add_substitute(v_req.id) then
    raise exception 'purchase_request_add_substitute: only the request''s Buyer may add a substitute' using errcode = '42501';
  end if;
  if not public._purchase_request_item_transition_ok(v_original.status, 'substituted', v_side) then
    raise exception 'purchase_request_add_substitute: % is already closed', v_original.name using errcode = '22023';
  end if;

  if nullif(btrim(p_name), '') is null then
    raise exception 'purchase_request_add_substitute: a substitute needs a name' using errcode = '22023';
  end if;
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'purchase_request_add_substitute: the quantity must be more than zero' using errcode = '22023';
  end if;
  if jsonb_typeof(v_images) <> 'array'
     or jsonb_array_length(v_images) > 5
     or exists (
       select 1 from jsonb_array_elements(v_images) img
       where jsonb_typeof(img) <> 'object' or nullif(img->>'url', '') is null
     ) then
    raise exception 'purchase_request_add_substitute: images must be up to 5 uploaded files' using errcode = '22023';
  end if;

  insert into public.purchase_request_items
    (request_id, source, name, unit, quantity, description, images, substitute_for_item_id, requested_by)
  values
    (v_req.id, 'new', btrim(p_name), nullif(btrim(p_unit), ''), p_quantity,
     nullif(btrim(p_description), ''), v_images, v_original.id, v_actor)
  returning * into v_item;

  v_amount := trim_scale(v_item.quantity)::text || coalesce(' ' || v_item.unit, '');
  perform public._purchase_request_post_event(
    v_req.id,
    v_actor,
    format('Offered %s × %s as a substitute for %s.', v_item.name, v_amount, v_original.name),
    jsonb_build_object('event', 'item_added', 'item_id', v_item.id, 'source', v_item.source,
                       'substitute_for_item_id', v_original.id)
  );

  perform public._purchase_request_item_move(
    v_original, 'substituted', v_side, v_actor,
    jsonb_build_object('substitute_item_id', v_item.id), 'purchase_request_add_substitute'
  );

  return v_item.id;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.purchase_request_can_add_items(p_request_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1 from purchase_requests r
    where r.id = p_request_id
      and get_employee_id() is not null
      and (
        r.buyer_id = get_employee_id()
        or (r.opportunity_id is null and r.created_by = get_employee_id())
        or exists (
          select 1 from purchase_request_members m
          where m.request_id = r.id
            and m.employee_id = get_employee_id()
            and (
              m.side in ('sales', 'requester')
              or exists (
                select 1 from sales_opportunities o, public._sor_deal_team_roles(o) t
                where o.id = r.opportunity_id and t.employee_id = m.employee_id
              )
              or public._purchase_request_may_request(r, m.employee_id)
            )
        )
      )
  );
$function$
;
CREATE OR REPLACE FUNCTION public.purchase_request_can_add_substitute(p_request_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce(is_super_admin(), false)
      or exists (select 1 from purchase_requests r where r.id = p_request_id and r.buyer_id = get_employee_id());
$function$
;
CREATE OR REPLACE FUNCTION public.purchase_request_can_manage_members(p_request_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce(is_super_admin(), false)
      or (
        has_purchasing_access()
        and exists (
          select 1 from purchase_request_members m
          where m.request_id = p_request_id
            and m.employee_id = get_employee_id()
        )
      );
$function$
;
CREATE OR REPLACE FUNCTION public.purchase_request_component_labels(p_request_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public.can_read_purchase_request(p_request_id) then
    return '[]'::jsonb;
  end if;
  return (
    select coalesce(
      jsonb_agg(
        jsonb_build_object('item_id', i.id, 'component_id', i.component_id, 'number', x.label, 'name', x.name)
        order by i.created_at, i.id
      ),
      '[]'::jsonb
    )
    from public.purchase_request_items i
    join public._costing_component_labels(
      (select coalesce(array_agg(distinct it.component_id), '{}') from public.purchase_request_items it
        where it.request_id = p_request_id and it.component_id is not null)
    ) x on x.component_id = i.component_id
    where i.request_id = p_request_id
  );
end;
$function$
;
CREATE OR REPLACE FUNCTION public.purchase_request_item_apply_po_check(p_actor_email text, p_item_id uuid, p_action text, p_po_number text, p_odoo text)
 RETURNS purchase_request_items
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_po text := nullif(upper(btrim(p_po_number)), '');
  v_verification text;
  v_actor uuid;
  v_item public.purchase_request_items;
  v_old text;
begin
  if p_action is null or p_action not in ('order', 'correct') then
    raise exception 'purchase_request_item_apply_po_check: % is not a PO action', coalesce(p_action, 'null') using errcode = '22023';
  end if;
  if p_odoo is null or p_odoo not in ('found', 'not_found', 'unreachable') then
    raise exception 'purchase_request_item_apply_po_check: % is not an Odoo answer', coalesce(p_odoo, 'null') using errcode = '22023';
  end if;
  if v_po is null or v_po !~ '^P[0-9]+$' then
    raise exception 'purchase_request_set_item_status: % isn''t an Odoo PO number ("P" then digits, e.g. P01234)', coalesce(p_po_number, '') using errcode = '22023';
  end if;
  if p_actor_email is null or btrim(p_actor_email) = '' then
    raise exception 'purchase_request_set_item_status: not signed in' using errcode = '42501';
  end if;

  -- Act as the caller the edge function authenticated: identity is the JWT email claim.
  perform set_config('request.jwt.claims',
    jsonb_build_object('email', p_actor_email, 'role', 'authenticated')::text, true);

  if p_action = 'correct' then
    v_actor := public.get_employee_id();
    if v_actor is null then
      raise exception 'purchase_request_correct_po: not signed in' using errcode = '42501';
    end if;
    select * into v_item from public.purchase_request_items where id = p_item_id for update;
    if v_item.id is null then
      raise exception 'purchase_request_correct_po: item % not found', p_item_id using errcode = 'P0002';
    end if;
    if coalesce(public.purchase_request_actor_side(v_item.request_id), '') <> 'purchasing' then
      raise exception 'purchase_request_correct_po: only Purchasing corrects an item''s PO' using errcode = '42501';
    end if;
    if v_item.status <> 'ordered' then
      raise exception 'purchase_request_correct_po: % is %, not Ordered; a PO can only be corrected while the item is Ordered',
        v_item.name, public._purchase_request_item_status_label(v_item.status)
        using errcode = '22023';
    end if;
    if v_item.po_number is not distinct from v_po then
      raise exception 'purchase_request_correct_po: % is already on PO %', v_item.name, v_po using errcode = '22023';
    end if;
  end if;

  v_verification := case p_odoo
    when 'found' then 'VERIFIED'
    when 'unreachable' then 'PENDING_VERIFICATION'
    else null
  end;
  if v_verification is null then
    raise exception 'purchase_request_set_item_status: Odoo has no purchase order %; check the number and try again', v_po
      using errcode = '22023';
  end if;

  if p_action = 'order' then
    return public._purchase_request_set_item_status(
      p_item_id, 'ordered',
      jsonb_build_object('po_number', v_po, 'po_verification', v_verification),
      true);
  end if;

  -- 'correct': swap the PO, drop lines picked on the old one, and say so in the request.
  v_old := v_item.po_number;
  update public.purchase_request_items
     set po_number = v_po,
         po_verification = v_verification,
         odoo_po_line_ids = '{}'
   where id = v_item.id
  returning * into v_item;

  perform public._purchase_request_post_event(
    v_item.request_id,
    v_actor,
    format('%s: PO %s → %s.', v_item.name, coalesce(v_old, 'none'), v_po),
    jsonb_build_object(
      'event', 'item_po_corrected',
      'item_id', v_item.id,
      'from_po', v_old,
      'to_po', v_po,
      'po_verification', v_verification
    )
  );

  return v_item;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.purchase_request_item_detach_component(p_item_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_item   public.purchase_request_items;
  v_matrix uuid;
begin
  if auth.uid() is null then
    raise exception 'purchase_request_item_detach_component: sign in first' using errcode = '42501';
  end if;
  if not (coalesce(public.has_purchasing_access(), false) or coalesce(public.is_super_admin(), false)) then
    raise exception 'purchase_request_item_detach_component: Purchasing access only' using errcode = '42501';
  end if;

  select * into v_item from public.purchase_request_items where id = p_item_id for update;
  if not found then
    raise exception 'purchase_request_item_detach_component: not found' using errcode = 'P0002';
  end if;
  if v_item.component_id is null then
    return;
  end if;

  select t.matrix_id into v_matrix
  from public.costing_components c
  join public.costing_tender_lines t on t.id = c.tender_line_id
  where c.id = v_item.component_id;

  update public.purchase_request_items set component_id = null where id = p_item_id;

  if v_matrix is not null then
    insert into public.costing_events (matrix_id, actor_id, kind, detail)
    values (v_matrix, auth.uid(), 'changed', jsonb_build_object(
      'table', 'purchase_request_items',
      'row', p_item_id,
      'column', 'component_id',
      'old', v_item.component_id,
      'new', null
    ));
  end if;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.purchase_request_item_lines(p_request_id uuid)
 RETURNS TABLE(item_id uuid, line_found boolean, line_quantity numeric, line_unit text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select i.id, l.id is not null, l.quantity, nullif(btrim(l.unit), '')
  from purchase_request_items i
  join purchase_requests r on r.id = i.request_id
  left join lateral (
    select sl.id, sl.quantity, sl.unit
    from sales_opportunity_items sl
    where sl.opportunity_id = r.opportunity_id
      and case
        when i.odoo_product_id is not null then sl.odoo_product_id = i.odoo_product_id
        else lower(btrim(sl.product_name)) = lower(btrim(i.sor_line_snapshot->>'name'))
      end
    order by (sl.quantity = (i.sor_line_snapshot->>'quantity')::numeric) desc, sl.sort_order, sl.created_at
    limit 1
  ) l on true
  where i.request_id = p_request_id
    and i.source = 'sor_line'
    and can_read_purchase_request(p_request_id);
$function$
;
CREATE OR REPLACE FUNCTION public.purchase_request_item_po_lines(p_item_id uuid)
 RETURNS integer[]
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_item public.purchase_request_items;
begin
  if public.get_employee_id() is null then
    raise exception 'purchase_request_item_po_lines: not signed in' using errcode = '42501';
  end if;
  select * into v_item from public.purchase_request_items where id = p_item_id;
  if v_item.id is null or not public.can_read_purchase_request(v_item.request_id) then
    raise exception 'purchase_request_item_po_lines: item % not found', p_item_id using errcode = 'P0002';
  end if;
  if v_item.po_number is null then
    return '{}'::int[];
  end if;
  return coalesce(public._ipas_po_line_ids(v_item.po_number), '{}'::int[]);
end;
$function$
;
CREATE OR REPLACE FUNCTION public.purchase_request_member_side(p_opportunity_id uuid, p_employee_id uuid)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select case
    when public._employee_has_purchasing_access(p_employee_id) then 'purchasing'
    when exists (
      select 1 from sales_opportunities o, public._sor_deal_team_roles(o) t
      where o.id = p_opportunity_id and t.employee_id = p_employee_id
    ) then 'sales'
    else 'other'
  end;
$function$
;
CREATE OR REPLACE FUNCTION public.purchase_request_messages_broadcast_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  begin
    perform realtime.send(
      jsonb_build_object('id', new.id, 'request_id', new.request_id),
      tg_op,
      'purchase_request_messages-changes',
      true -- private: gated by the realtime.messages policy, not public
    );
  exception when others then
    null;
  end;
  return null;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.purchase_request_open(p_title text, p_items jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_actor uuid := public.get_employee_id();
  v_title text := btrim(p_title);
  v_req public.purchase_requests;
  v_item jsonb;
  v_emp uuid;
begin
  if v_actor is null then
    raise exception 'purchase_request_open: not signed in' using errcode = '42501';
  end if;
  if nullif(v_title, '') is null then
    raise exception 'purchase_request_open: a Purchase Request needs a title' using errcode = '22023';
  end if;
  if char_length(v_title) > 120 then
    raise exception 'purchase_request_open: the title must be 120 characters or fewer' using errcode = '22023';
  end if;
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'purchase_request_open: ask for at least one item' using errcode = '22023';
  end if;
  if jsonb_array_length(p_items) > 50 then
    raise exception 'purchase_request_open: at most 50 items at once' using errcode = '22023';
  end if;

  insert into public.purchase_requests (title, created_by)
  values (v_title, v_actor)
  returning * into v_req;

  -- The Requester, then everyone with Purchasing access (a live request).
  perform public._purchase_request_add_member(v_req.id, v_actor, v_actor);
  for v_emp in
    select e.id from public.employees e where public._employee_has_purchasing_access(e.id)
  loop
    perform public._purchase_request_add_member(v_req.id, v_emp, v_actor);
  end loop;

  -- No Buyer yet: the `opened` event tells everyone with Purchasing access.
  insert into public.purchase_request_messages (request_id, author_id, content, metadata)
  values (v_req.id, v_actor, 'Purchase Request opened.', jsonb_build_object('event', 'opened'));

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    if jsonb_typeof(v_item) <> 'object' then
      raise exception 'purchase_request_open: each item must be an object' using errcode = '22023';
    end if;
    perform public.purchase_request_add_new_item(
      v_req.id,
      v_item->>'name',
      nullif(v_item->>'quantity', '')::numeric,
      v_item->>'unit',
      v_item->>'description',
      coalesce(v_item->'images', '[]'::jsonb)
    );
  end loop;

  return v_req.id;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.purchase_request_pick_po_lines(p_item_id uuid, p_line_ids integer[])
 RETURNS purchase_request_items
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_actor uuid := public.get_employee_id();
  v_item public.purchase_request_items;
  v_lines int[];
  v_ipas int[];
  v_stray int[];
begin
  if v_actor is null then
    raise exception 'purchase_request_pick_po_lines: not signed in' using errcode = '42501';
  end if;

  select * into v_item from public.purchase_request_items where id = p_item_id for update;
  if v_item.id is null then
    raise exception 'purchase_request_pick_po_lines: item % not found', p_item_id using errcode = 'P0002';
  end if;
  if coalesce(public.purchase_request_actor_side(v_item.request_id), '') <> 'purchasing' then
    raise exception 'purchase_request_pick_po_lines: only Purchasing picks an item''s PO line' using errcode = '42501';
  end if;
  if v_item.status not in ('ordered', 'received') then
    raise exception 'purchase_request_pick_po_lines: % is %, not Ordered', v_item.name,
      public._purchase_request_item_status_label(v_item.status)
      using errcode = '22023';
  end if;
  if v_item.po_number is null then
    raise exception 'purchase_request_pick_po_lines: % has no PO number', v_item.name using errcode = '22023';
  end if;

  if p_line_ids is null or cardinality(p_line_ids) = 0 or array_position(p_line_ids, null) is not null then
    raise exception 'purchase_request_pick_po_lines: pick at least one PO line' using errcode = '22023';
  end if;
  select array_agg(distinct l order by l) into v_lines from unnest(p_line_ids) l;

  v_ipas := coalesce(public._ipas_po_line_ids(v_item.po_number), '{}'::int[]);
  if cardinality(v_ipas) = 0 then
    raise exception 'purchase_request_pick_po_lines: PO % has no IPAS yet; pick its line once it does', v_item.po_number
      using errcode = '22023';
  end if;
  select array_agg(l order by l) into v_stray from unnest(v_lines) l where not (l = any (v_ipas));
  if v_stray is not null then
    raise exception 'purchase_request_pick_po_lines: line % isn''t on PO %''s IPAS copy', array_to_string(v_stray, ', '), v_item.po_number
      using errcode = '22023';
  end if;

  update public.purchase_request_items
     set odoo_po_line_ids = v_lines
   where id = v_item.id
  returning * into v_item;

  perform public._purchase_request_post_event(
    v_item.request_id,
    v_actor,
    format('%s: PO line picked on %s.', v_item.name, v_item.po_number),
    jsonb_build_object(
      'event', 'item_po_lines_picked',
      'item_id', v_item.id,
      'po_number', v_item.po_number,
      'line_ids', to_jsonb(v_lines)
    )
  );

  return v_item;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.purchase_request_pickable_lines(p_request_id uuid)
 RETURNS TABLE(id uuid, product_name text, quantity numeric, unit text, odoo_product_id integer, sort_order integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_req public.purchase_requests := public._purchase_request_for_adding(p_request_id, 'purchase_request_pickable_lines');
begin
  return query
    select l.id, l.product_name, l.quantity, l.unit, l.odoo_product_id, l.sort_order
    from public.sales_opportunity_items l
    where l.opportunity_id = v_req.opportunity_id
    order by l.sort_order, l.created_at;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.purchase_request_queue(p_request_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(id uuid, opportunity_id uuid, sales_reference text, project_title text, stage_name text, sor_closed text, buyer_id uuid, buyer_name text, buyer_avatar_path text, created_at timestamp with time zone, updated_at timestamp with time zone, item_count integer, open_count integer, last_activity_at timestamp with time zone, sor_status text, title text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select
    r.id,
    r.opportunity_id,
    coalesce(nullif(o.sales_reference, ''), o.sor_code, o.opportunity_no),
    o.project_title,
    fs.name,
    case when o.id is not null then public._sor_purchasing_closed_reason(o) end,
    r.buyer_id,
    b.name,
    b.avatar_path,
    r.created_at,
    r.updated_at,
    coalesce(i.item_count, 0)::integer,
    coalesce(i.open_count, 0)::integer,
    greatest(r.updated_at, m.last_message_at),
    o.status,
    r.title
  from public.purchase_requests r
  left join public.sales_opportunities o on o.id = r.opportunity_id
  left join public.flow_stages fs on fs.id = o.flow_stage_id
  left join public.employees b on b.id = r.buyer_id
  left join lateral (
    select
      count(*) as item_count,
      count(*) filter (where not public._purchase_request_item_is_closed(it.status)) as open_count
    from public.purchase_request_items it
    where it.request_id = r.id
  ) i on true
  left join lateral (
    select max(msg.created_at) as last_message_at
    from public.purchase_request_messages msg
    where msg.request_id = r.id
  ) m on true
  where (p_request_id is null or r.id = p_request_id)
    and public.can_read_purchase_request(r.id)
  order by greatest(r.updated_at, m.last_message_at) desc nulls last, r.created_at desc;
$function$
;
CREATE OR REPLACE FUNCTION public.purchase_request_remove_member(p_request_id uuid, p_employee_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_actor uuid := public.get_employee_id();
  v_req public.purchase_requests;
  v_removed uuid;
begin
  if v_actor is null or not public.purchase_request_can_manage_members(p_request_id) then
    raise exception 'purchase_request_remove_member: not allowed' using errcode = '42501';
  end if;

  select * into v_req from public.purchase_requests where id = p_request_id;
  if v_req.buyer_id = p_employee_id then
    raise exception 'purchase_request_remove_member: the Buyer cannot be removed' using errcode = '42501';
  end if;

  delete from public.purchase_request_members
  where request_id = p_request_id and employee_id = p_employee_id
  returning id into v_removed;

  if v_removed is null then
    return;
  end if;

  update public.sor_stage_participants
  set closed_at = now(), closed_reason = 'removed', removed_by = v_actor
  where source = 'purchase_request' and source_id = p_request_id
    and employee_id = p_employee_id and closed_at is null;

  perform public._purchase_request_member_event(p_request_id, v_actor, p_employee_id, 'member_removed');
end;
$function$
;
CREATE OR REPLACE FUNCTION public.purchase_request_set_buyer(p_request_id uuid, p_employee_id uuid)
 RETURNS purchase_requests
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_actor uuid := public.get_employee_id();
  v_req public.purchase_requests;
  v_previous uuid;
  v_name text;
begin
  if v_actor is null then
    raise exception 'purchase_request_set_buyer: not signed in' using errcode = '42501';
  end if;
  if not public.purchase_request_can_manage_members(p_request_id) then
    raise exception 'purchase_request_set_buyer: only a purchasing member or a Super Admin may name the Buyer' using errcode = '42501';
  end if;

  select * into v_req from public.purchase_requests where id = p_request_id for update;
  if v_req.id is null then
    raise exception 'purchase_request_set_buyer: request % not found', p_request_id using errcode = 'P0002';
  end if;
  if v_req.buyer_id is not distinct from p_employee_id then
    raise exception 'purchase_request_set_buyer: nothing to change' using errcode = '22023';
  end if;
  if p_employee_id is not null and not public._employee_has_purchasing_access(p_employee_id) then
    raise exception 'purchase_request_set_buyer: the Buyer must have Purchasing access' using errcode = '22023';
  end if;

  v_previous := v_req.buyer_id;
  update public.purchase_requests set buyer_id = p_employee_id where id = p_request_id
  returning * into v_req;

  if p_employee_id is not null then
    perform public._purchase_request_add_member(p_request_id, p_employee_id, v_actor);
    select name into v_name from public.employees where id = p_employee_id;
  end if;

  perform public._purchase_request_post_event(
    p_request_id, v_actor,
    case when p_employee_id is null
      then 'The request has no Buyer now; it is back in the queue.'
      else format('%s is the Buyer.', coalesce(v_name, 'Someone'))
    end,
    jsonb_build_object('event', 'buyer_set', 'buyer_id', p_employee_id, 'previous_buyer_id', v_previous)
  );

  return v_req;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.purchase_request_set_item_status(p_item_id uuid, p_status text, p_details jsonb DEFAULT '{}'::jsonb)
 RETURNS purchase_request_items
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  return public._purchase_request_set_item_status(p_item_id, p_status, p_details, false);
end;
$function$
;
CREATE OR REPLACE FUNCTION public.purchase_request_stock_snapshot(p_request_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select jsonb_build_object('fetched_at', s.fetched_at, 'data', s.data)
  from purchase_requests r
  join sor_stock_snapshots s on s.opportunity_id = r.opportunity_id
  where r.id = p_request_id
    and can_read_purchase_request(p_request_id);
$function$
;
CREATE OR REPLACE FUNCTION public.purchase_request_take(p_request_id uuid)
 RETURNS purchase_requests
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_actor uuid := public.get_employee_id();
  v_req public.purchase_requests;
  v_name text;
begin
  if v_actor is null then
    raise exception 'purchase_request_take: not signed in' using errcode = '42501';
  end if;
  if not public.has_purchasing_access() then
    raise exception 'purchase_request_take: only someone with Purchasing access may take a request' using errcode = '42501';
  end if;

  select * into v_req from public.purchase_requests where id = p_request_id for update;
  if v_req.id is null then
    raise exception 'purchase_request_take: request % not found', p_request_id using errcode = 'P0002';
  end if;
  if v_req.buyer_id is not null then
    select name into v_name from public.employees where id = v_req.buyer_id;
    raise exception 'purchase_request_take: % is already the Buyer', coalesce(v_name, 'someone else') using errcode = '55000';
  end if;

  update public.purchase_requests set buyer_id = v_actor where id = p_request_id
  returning * into v_req;

  perform public._purchase_request_add_member(p_request_id, v_actor, v_actor);

  select name into v_name from public.employees where id = v_actor;
  perform public._purchase_request_post_event(
    p_request_id, v_actor,
    format('%s took the request as Buyer.', coalesce(v_name, 'Someone')),
    jsonb_build_object('event', 'buyer_set', 'buyer_id', v_actor, 'previous_buyer_id', null, 'taken', true)
  );

  return v_req;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.purchase_request_undo_item_status(p_item_id uuid, p_changed_at timestamp with time zone)
 RETURNS purchase_request_items
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_actor uuid := public.get_employee_id();
  v_item public.purchase_request_items;
  v_event public.purchase_request_messages;
  v_from text;
  v_to text;
  v_side text;
  v_prev_by uuid;
  v_prev_at timestamptz;
  v_label text;
  v_content text;
  v_read uuid[];
begin
  if v_actor is null then
    raise exception 'purchase_request_undo_item_status: not signed in' using errcode = '42501';
  end if;

  select * into v_item from public.purchase_request_items where id = p_item_id for update;
  if v_item.id is null then
    raise exception 'purchase_request_undo_item_status: item % not found', p_item_id using errcode = 'P0002';
  end if;

  if p_changed_at is null or v_item.status_changed_at is distinct from p_changed_at then
    raise exception 'purchase_request_undo_item_status: % has changed since, so there is nothing to undo', v_item.name
      using errcode = '22023';
  end if;
  if v_item.status_changed_by is distinct from v_actor then
    raise exception 'purchase_request_undo_item_status: only whoever made the change can undo it' using errcode = '42501';
  end if;
  if now() - v_item.status_changed_at > interval '15 seconds' then
    raise exception 'purchase_request_undo_item_status: it''s too late to undo that change' using errcode = '22023';
  end if;

  select * into v_event
  from public.purchase_request_messages m
  where m.request_id = v_item.request_id
    and m.metadata->>'event' = 'item_status_changed'
    and m.metadata->>'item_id' = v_item.id::text
    and (m.metadata->>'changed_at')::timestamptz = v_item.status_changed_at
  order by m.created_at desc
  limit 1;
  if v_event.id is null then
    raise exception 'purchase_request_undo_item_status: % has no change to undo', v_item.name using errcode = '22023';
  end if;

  v_from := v_event.metadata->>'from';
  v_to := v_event.metadata->>'to';
  if v_to is distinct from v_item.status then
    raise exception 'purchase_request_undo_item_status: % has changed since, so there is nothing to undo', v_item.name
      using errcode = '22023';
  end if;

  -- Only someone who may still make the change may take it back.
  v_side := public.purchase_request_actor_side(v_item.request_id);
  if v_side is null or not public._purchase_request_item_transition_ok(v_from, v_to, v_side) then
    raise exception 'purchase_request_undo_item_status: you can no longer change this item' using errcode = '42501';
  end if;

  if v_to = 'canvassing' and exists (
    select 1 from public.sor_canvasses c
    where c.requested_item_id = v_item.id
       or (v_item.component_id is not null and c.component_id = v_item.component_id)
  ) then
    raise exception 'purchase_request_undo_item_status: % has a Canvass, so it stays Canvassing', v_item.name
      using errcode = '22023';
  end if;

  -- Who moved the item to the status it goes back to, and when: the latest
  -- change into it that wasn't itself undone.
  select (m.metadata->>'changed_by')::uuid, (m.metadata->>'changed_at')::timestamptz
    into v_prev_by, v_prev_at
  from public.purchase_request_messages m
  where m.request_id = v_item.request_id
    and m.metadata->>'event' = 'item_status_changed'
    and m.metadata->>'item_id' = v_item.id::text
    and m.metadata->>'to' = v_from
    and m.created_at <= v_event.created_at
    and m.id <> v_event.id
    and not exists (
      select 1 from public.purchase_request_messages u
      where u.request_id = m.request_id
        and u.metadata->>'event' = 'item_status_undone'
        and u.metadata->>'item_id' = m.metadata->>'item_id'
        and u.metadata->>'undone_changed_at' = m.metadata->>'changed_at'
    )
  order by m.created_at desc
  limit 1;

  update public.purchase_request_items
     set status = v_from,
         status_changed_by = v_prev_by,
         status_changed_at = v_prev_at,
         po_number = case when v_to = 'ordered' then null else po_number end,
         po_verification = case when v_to = 'ordered' then 'UNVERIFIED' else po_verification end,
         odoo_po_line_ids = case when v_to = 'ordered' then '{}'::int4[] else odoo_po_line_ids end
   where id = v_item.id
  returning * into v_item;

  v_content := format('%s: %s → %s (undone).', v_item.name,
    public._purchase_request_item_status_label(v_to),
    public._purchase_request_item_status_label(v_from));

  perform public._purchase_request_post_event(
    v_item.request_id,
    v_actor,
    v_content,
    jsonb_build_object(
      'event', 'item_status_undone',
      'item_id', v_item.id,
      'from', v_to,
      'to', v_from,
      'undone_changed_at', v_event.metadata->'changed_at',
      'changed_by', v_actor
    )
  );

  -- The change's notifications (_purchase_request_message_notify): withdraw the
  -- unread ones, tell whoever already read theirs.
  v_label := public._purchase_request_label(v_item.request_id);
  with sent as (
    select n.id, n.recipient_id, coalesce(n.is_read, false) as is_read
    from public.notifications n
    where n.type = 'PURCHASE_REQUEST_ITEM_STATUS'
      and n.reference_id = v_item.request_id::text
      and n.sender_id = v_actor
      and n.message = left(v_label || ': ' || v_event.content, 280)
  ),
  withdrawn as (
    delete from public.notifications n
    using sent
    where n.id = sent.id and not sent.is_read
    returning n.id
  )
  select coalesce(array_agg(distinct sent.recipient_id) filter (where sent.is_read), '{}')
    into v_read
  from sent;

  perform public._purchase_request_notify(
    v_item.request_id, v_read, v_actor,
    'PURCHASE_REQUEST_ITEM_STATUS',
    'Requested Item change undone',
    v_label || ': ' || v_content
  );

  return v_item;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.purchasing_dashboard_rows()
 RETURNS TABLE(opportunity_id uuid, sales_reference text, project_title text, grp text, target_kind text, target_id uuid, target_label text, item_count integer, no_canvass_count integer, buyer_id uuid, canvasser_id uuid, since timestamp with time zone, request_id uuid)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with gate as (
    select (
      coalesce(public.has_purchasing_access(), false)
      or coalesce(public.has_finance_access(), false)
      or coalesce(public.is_super_admin(), false)
    ) as ok
  ),
  sors as (
    select o.id, o.sales_reference, o.project_title
      from public.sales_opportunities o, gate
     where gate.ok and not o.is_deleted and not o.is_scratch
  ),
  items as (
    select i.*, r.opportunity_id, r.buyer_id, r.title as request_title,
           coalesce(c.purchasing_incharge_id, cm.purchasing_incharge_id, r.buyer_id) as canvasser_id,
           case when nullif(btrim(i.po_number), '') is not null then public._lc_ipas_for_po(i.po_number) end as ipas_id
      from public.purchase_request_items i
      join public.purchase_requests r on r.id = i.request_id
      cross join gate
      left join public.costing_components c on c.id = i.component_id
      left join public.costing_tender_lines ct on ct.id = c.tender_line_id
      left join public.costing_matrices cm on cm.id = ct.matrix_id
     where gate.ok
       and (r.opportunity_id is null or r.opportunity_id in (select id from sors))
  ),
  matrices as (
    select m.id, m.opportunity_id, m.created_at, m.purchasing_incharge_id, d.verdict, d.decided_at
      from public.costing_matrices m
      join sors s on s.id = m.opportunity_id
      left join lateral (
        select bd.verdict, bd.decided_at from public.costing_bid_decisions bd
         where bd.matrix_id = m.id and bd.cleared_at is null
         order by bd.decided_at desc limit 1
      ) d on true
  ),
  comps as (
    select c.id, c.name, c.created_at, nullif(btrim(c.po_rfq_no), '') as po_rfq_no,
           coalesce(c.purchasing_incharge_id, m.purchasing_incharge_id) as purchasing_incharge_id,
           m.id as matrix_id, m.opportunity_id, m.verdict, m.decided_at,
           cc.acquire_unit,
           (nullif(btrim(c.po_rfq_no), '') is not null
             or exists (select 1 from public.purchase_request_items pi where pi.component_id = c.id and pi.status in ('ordered', 'received'))) as is_ordered
      from public.costing_components c
      join public.costing_tender_lines t on t.id = c.tender_line_id
      join matrices m on m.id = t.matrix_id
      left join public.costing_component_costs cc on cc.component_id = c.id
  ),
  canvasses as (
    select cv.id, cv.number, cv.created_at,
           coalesce(comp_sor.opportunity_id, item_sor.opportunity_id) as opportunity_id,
           coalesce(comp_sor.purchasing_incharge_id, item_sor.buyer_id) as canvasser_id,
           item_sor.buyer_id, item_sor.request_id
      from public.sor_canvasses cv
      left join comps comp_sor on comp_sor.id = cv.component_id
      left join items item_sor on item_sor.id = cv.requested_item_id
     where (comp_sor.id is not null or item_sor.id is not null)
       and not exists (select 1 from public.sor_canvass_offers o where o.canvass_id = cv.id and o.is_winner)
       -- Buying already done without a winner (ordered anyway) is not left to source.
       and not coalesce(comp_sor.is_ordered, false)
       and coalesce(item_sor.status, '') not in ('ordered', 'received', 'from_stock', 'substituted', 'cannot_source', 'cancelled')
  ),
  has_canvass as (
    select i.id as item_id
      from items i
     where exists (select 1 from public.sor_canvasses cv where cv.requested_item_id = i.id or (i.component_id is not null and cv.component_id = i.component_id))
  ),
  r as (
  -- To source: Requested Items, one row per Purchase Request
  select i.opportunity_id, 'to_source'::text as grp, 'purchase_request'::text as target_kind, i.request_id as target_id,
         max(i.request_title) as target_label, count(*)::int as item_count, 0 as no_canvass_count,
         max(i.buyer_id::text)::uuid as buyer_id, max(i.canvasser_id::text)::uuid as canvasser_id, min(i.created_at) as since, i.request_id as request_id
    from items i
   where i.status in ('requested', 'to_order')
   group by i.opportunity_id, i.request_id
  union all
  -- To source: Canvasses with no winner
  select c.opportunity_id, 'to_source', 'canvass', c.id, c.number, 1, 0, c.buyer_id, c.canvasser_id, c.created_at, c.request_id
    from canvasses c
  union all
  -- To price: unpriced Components, plus the matrix when it still needs a decision
  select m.opportunity_id, 'to_price', 'costing_matrix', m.opportunity_id, null,
         ((select count(*) from comps c where c.matrix_id = m.id and c.acquire_unit is null)
           + case when m.verdict is null or m.verdict = 'revise' then 1 else 0 end)::int,
         0, null, m.purchasing_incharge_id, m.created_at, null
    from matrices m
   where coalesce(m.verdict, '') <> 'no_go'
     and ((m.verdict is null or m.verdict = 'revise')
          or exists (select 1 from comps c where c.matrix_id = m.id and c.acquire_unit is null))
  union all
  -- To order: priced, decided Go, no PO yet
  select c.opportunity_id, 'to_order', 'costing_matrix', c.opportunity_id, null,
         count(*)::int, 0, null, max(c.purchasing_incharge_id::text)::uuid, min(c.decided_at), null
    from comps c
   where c.verdict = 'go' and c.acquire_unit is not null and not c.is_ordered
   group by c.opportunity_id
  union all
  -- On order: Ordered, not yet Received. One row per IPAS when the PO has one,
  -- else per Purchase Request.
  select i.opportunity_id, 'on_order',
         case when i.ipas_id is not null then 'ipas' else 'purchase_request' end,
         coalesce(i.ipas_id, i.request_id),
         coalesce((select ip.number from public.ipas ip where ip.id = i.ipas_id), max(i.request_title)),
         count(*)::int,
         count(*) filter (where i.id not in (select item_id from has_canvass))::int,
         max(i.buyer_id::text)::uuid, max(i.canvasser_id::text)::uuid, min(coalesce(i.status_changed_at, i.created_at)),
         max(i.request_id::text)::uuid
    from items i
   where i.status = 'ordered'
   group by i.opportunity_id, i.ipas_id, coalesce(i.ipas_id, i.request_id)
  union all
  -- To check: submitted Transmittals moving through their checks
  select ts.opportunity_id, 'to_check', 'transmittal', t.id, t.number,
         greatest(1, (select count(*) from public.transmittal_lines l where l.transmittal_id = t.id and l.opportunity_id = ts.opportunity_id))::int,
         0, null, null, coalesce(t.submitted_at, t.created_at), null
    from public.transmittals t
    join public.transmittal_sors ts on ts.transmittal_id = t.id
    join sors s on s.id = ts.opportunity_id
   where t.state in ('warehouse_checking', 'warehouse_releasing', 'technical_inspection', 'awaiting_check')
  union all
  -- To check: Received on an IPAS that no Transmittal names yet. Items with no
  -- IPAS are left out: nothing links them to a Transmittal, and older ones were
  -- received before Transmittals existed.
  select i.opportunity_id, 'to_check', 'ipas', i.ipas_id,
         (select ip.number from public.ipas ip where ip.id = i.ipas_id),
         count(*)::int, 0,
         max(i.buyer_id::text)::uuid, max(i.canvasser_id::text)::uuid, min(coalesce(i.status_changed_at, i.created_at)),
         max(i.request_id::text)::uuid
    from items i
   where i.status = 'received' and i.ipas_id is not null
     and not exists (
       select 1 from public.transmittal_ipas ti join public.transmittals t on t.id = ti.transmittal_id
        where ti.ipas_id = i.ipas_id and t.state <> 'cancelled')
   group by i.opportunity_id, i.ipas_id
  )
  -- The SOR's name is filled once here rather than in each branch above.
  select r.opportunity_id, s.sales_reference, coalesce(s.project_title, case when r.opportunity_id is null then 'Direct request' end), r.grp, r.target_kind, r.target_id, r.target_label,
         r.item_count, r.no_canvass_count, r.buyer_id, r.canvasser_id, r.since, r.request_id
    from r left join sors s on s.id = r.opportunity_id
   where r.item_count > 0
$function$
;
CREATE OR REPLACE FUNCTION public.record_currency_rate(p_currency text, p_rate_date date, p_php_per_unit numeric, p_source text)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
  insert into public.currency_rates (currency, rate_date, php_per_unit, source, fetched_at)
  values (upper(p_currency), p_rate_date, p_php_per_unit, p_source, now())
  on conflict (currency, rate_date) do update
    set php_per_unit = excluded.php_per_unit,
        source = excluded.source,
        fetched_at = excluded.fetched_at
    where public.currency_rates.overridden_at is null;
$function$
;
CREATE OR REPLACE FUNCTION public.record_stage_visit()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_next_sequence integer;
  v_actor uuid;
  v_left_visit uuid;
  v_left_snapshot uuid;
  v_terminal boolean;
  v_cancel text;
  v_stage_name text;
  v_new_visit uuid;
begin
  if coalesce(current_setting('app.sor_revert', true), '') = 'on' then
    return NEW;
  end if;

  if TG_OP = 'INSERT' then
    if NEW.flow_stage_id is null then
      return NEW;
    end if;

    insert into public.sor_stage_visits (opportunity_id, flow_stage_id, flow_snapshot_id, sequence, entered_at, entered_by)
    values (NEW.id, NEW.flow_stage_id, NEW.flow_snapshot_id, 1, coalesce(NEW.created_at, now()), NEW.registered_by);

    return NEW;
  end if;

  -- UPDATE: only react to an actual stage change.
  if NEW.flow_stage_id is not distinct from OLD.flow_stage_id then
    return NEW;
  end if;

  v_actor := public.get_employee_id();

  update public.sor_stage_visits
    set left_at = now(), left_by = v_actor
    where opportunity_id = NEW.id and left_at is null and undone_at is null
    returning id, flow_snapshot_id into v_left_visit, v_left_snapshot;

  -- Leaving a Stage puts the open tasks its Actions created on hold: off
  -- everyone's lists until a Return decides them, unless the action carries on. Finished work is untouched.
  if v_left_visit is not null then
    update public.tasks
      set held_prev_status = status, status = 'ON_HOLD', held_at = now(), held_from_visit_id = v_left_visit
      where stage_visit_id = v_left_visit and stage_action_id is not null
        and status in ('INCOMPLETE', 'AWAITING APPROVAL', 'NOT APPROVED')
        and not public.stage_action_carries_on(v_left_snapshot, stage_action_id);
    update public.committee_tasks
      set held_prev_status = status, status = 'ON_HOLD', held_at = now(), held_from_visit_id = v_left_visit
      where stage_visit_id = v_left_visit and stage_action_id is not null
        and status = 'ACTIVE'
        and not public.stage_action_carries_on(v_left_snapshot, stage_action_id);
  end if;

  if NEW.flow_stage_id is not null then
    select coalesce(max(sequence), 0) + 1 into v_next_sequence
      from public.sor_stage_visits where opportunity_id = NEW.id;

    insert into public.sor_stage_visits
      (opportunity_id, flow_stage_id, flow_snapshot_id, sequence, entered_at, entered_by, contract_date_stamped)
    values
      (NEW.id, NEW.flow_stage_id, NEW.flow_snapshot_id, v_next_sequence, now(), v_actor,
       OLD.contract_date is null and NEW.contract_date is not null)
    returning id into v_new_visit;
  end if;

  -- Only a Revert brings a held task back from a Terminal Stage: the cancel
  -- keeps the hold, and names the Terminal visit that cancelled it.
  select coalesce(is_terminal, false), name into v_terminal, v_stage_name from public.flow_stages where id = NEW.flow_stage_id;
  if coalesce(v_terminal, false) then
    v_cancel := format('Cancelled: the SOR reached %s, a Terminal Stage.', coalesce(v_stage_name, 'a Terminal Stage'));
    update public.tasks
      set status = 'DELETED', cancel_reason = v_cancel, cancelled_by_visit_id = v_new_visit
      where opportunity_id = NEW.id and status = 'ON_HOLD';
    update public.committee_tasks
      set status = 'CANCELLED', cancel_reason = v_cancel, cancelled_by_visit_id = v_new_visit
      where opportunity_id = NEW.id and status = 'ON_HOLD';
  end if;

  return NEW;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.reference_rate(p_currency text, p_on date)
 RETURNS TABLE(currency text, rate_date date, php_per_unit numeric, source text, overridden boolean, divergence_pct numeric)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select r.currency, r.rate_date, r.php_per_unit, r.source, r.overridden_at is not null, c.divergence_pct
  from public.currency_rates r
  join public.currency_rate_currencies c on c.currency = r.currency
  where r.currency = upper(p_currency) and r.rate_date <= p_on
  order by r.rate_date desc
  limit 1;
$function$
;
CREATE OR REPLACE FUNCTION public.reorder_leave_categories(p_ordering jsonb)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
DECLARE
  item record;
BEGIN
  -- First, stage them to negative values to avoid unique constraint violations
  FOR item IN SELECT * FROM jsonb_to_recordset(p_ordering) AS x(id uuid, sort_order int) LOOP
    UPDATE hr_leave_categories SET sort_order = -item.sort_order WHERE id = item.id;
  END LOOP;
  
  -- Then update them to their final values
  FOR item IN SELECT * FROM jsonb_to_recordset(p_ordering) AS x(id uuid, sort_order int) LOOP
    UPDATE hr_leave_categories SET sort_order = item.sort_order, updated_at = now() WHERE id = item.id;
  END LOOP;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.restore_flow_snapshot(p_flow_id uuid, p_snapshot_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_flow record;
  v_snapshot record;
  v_data jsonb;
  v_target_stage_ids uuid[];
  v_target_edge_ids uuid[];
  v_target_action_ids uuid[];
  v_target_condition_ids uuid[];
  v_target_field_ids uuid[];
  v_target_form_field_ids uuid[];
  v_target_follow_up_stage_ids uuid[];
  v_won_stage_id uuid;
  v_blockers text[] := array[]::text[];
  v_rec record;
  v_elem jsonb;
begin
  -- Lock the Sales Flow row first (ADR 0013 / lock_sales_flow).
  select * into v_flow from sales_flows where id = p_flow_id for update;
  if not found then
    raise exception 'Sales Flow not found.';
  end if;
  if v_flow.state <> 'draft' then
    raise exception 'This Sales Flow is locked. Unlock it first, with a reason, to make changes.';
  end if;

  select * into v_snapshot from flow_snapshots where id = p_snapshot_id;
  if not found then
    raise exception 'That Flow Snapshot does not exist.';
  end if;
  if v_snapshot.flow_id <> p_flow_id then
    raise exception 'That Flow Snapshot does not belong to this flow.';
  end if;

  v_data := v_snapshot.snapshot_data;
  v_won_stage_id := nullif(v_data->>'wonStageId', '')::uuid;

  select coalesce(array_agg((e->>'id')::uuid), array[]::uuid[])
    into v_target_stage_ids
  from jsonb_array_elements(coalesce(v_data->'stages', '[]'::jsonb)) as e;

  -- Refuse before writing anything if a live Stage the target drops is still
  -- referenced by an SOR. The foreign key sees soft-deleted SORs too, so they
  -- count, and the message says when they are the whole reason.
  for v_rec in
    select st.name as stage_name,
           count(*) as total,
           count(*) filter (where o.is_deleted is true) as soft_deleted
    from flow_stages st
    join sales_opportunities o on o.flow_stage_id = st.id
    where st.flow_id = p_flow_id
      and not (st.id = any(v_target_stage_ids))
    group by st.id, st.name
    order by st.name
  loop
    v_blockers := array_append(
      v_blockers,
      format(
        '"%s" is referenced by %s SOR%s%s',
        v_rec.stage_name,
        v_rec.total,
        case when v_rec.total = 1 then '' else 's' end,
        case
          when v_rec.soft_deleted = v_rec.total then format(' (all %s soft-deleted)', v_rec.total)
          when v_rec.soft_deleted > 0 then format(' (%s of them soft-deleted)', v_rec.soft_deleted)
          else ''
        end
      )
    );
  end loop;
  if array_length(v_blockers, 1) > 0 then
    raise exception 'This version cannot be restored yet: %. Move those deals to another Stage first.',
      array_to_string(v_blockers, '; ');
  end if;

  -- From here the draft is reshaped to match the target, keeping ids. Clear
  -- the Won Stage first so a dropped Stage that held it can be deleted.
  update sales_flows set won_stage_id = null, updated_at = now() where id = p_flow_id;

  -- Two Stages can swap names. The one-name-per-flow index is checked row by
  -- row, so park every surviving Stage on a unique placeholder first.
  update flow_stages set name = '__restore__' || id::text where flow_id = p_flow_id;

  -- Drop the Stages the target does not have. Their edges, conditions and
  -- actions go by cascade; the check above proved no SOR is referenced.
  delete from flow_stages
   where flow_id = p_flow_id
     and not (id = any(v_target_stage_ids));

  -- Upsert every target Stage under its original id.
  for v_elem in select e from jsonb_array_elements(coalesce(v_data->'stages', '[]'::jsonb)) as e
  loop
    insert into flow_stages (
      id, flow_id, name, sort_order, is_terminal, terminal_outcome, pos_x, pos_y, color, bracket_label, created_at, updated_at
    )
    values (
      (v_elem->>'id')::uuid,
      p_flow_id,
      v_elem->>'name',
      coalesce((v_elem->>'sort_order')::int, 0),
      coalesce((v_elem->>'is_terminal')::boolean, false),
      case when coalesce((v_elem->>'is_terminal')::boolean, false) then nullif(v_elem->>'terminal_outcome', '') end,
      coalesce((v_elem->>'pos_x')::int, 0),
      coalesce((v_elem->>'pos_y')::int, 0),
      nullif(v_elem->>'color', ''),
      nullif(v_elem->>'bracket_label', ''),
      coalesce((v_elem->>'created_at')::timestamptz, now()),
      now()
    )
    on conflict (id) do update set
      name = excluded.name,
      sort_order = excluded.sort_order,
      is_terminal = excluded.is_terminal,
      terminal_outcome = excluded.terminal_outcome,
      pos_x = excluded.pos_x,
      pos_y = excluded.pos_y,
      color = excluded.color,
      bracket_label = excluded.bracket_label,
      updated_at = now();
  end loop;

  -- Moves.
  select coalesce(array_agg((e->>'id')::uuid), array[]::uuid[])
    into v_target_edge_ids
  from jsonb_array_elements(coalesce(v_data->'edges', '[]'::jsonb)) as e;

  delete from flow_edges
   where flow_id = p_flow_id
     and not (id = any(v_target_edge_ids));

  for v_elem in select e from jsonb_array_elements(coalesce(v_data->'edges', '[]'::jsonb)) as e
  loop
    insert into flow_edges (id, flow_id, from_stage_id, to_stage_id, created_at)
    values (
      (v_elem->>'id')::uuid,
      p_flow_id,
      (v_elem->>'from_stage_id')::uuid,
      (v_elem->>'to_stage_id')::uuid,
      coalesce((v_elem->>'created_at')::timestamptz, now())
    )
    on conflict (id) do update set
      from_stage_id = excluded.from_stage_id,
      to_stage_id = excluded.to_stage_id;
  end loop;

  -- Stage Actions.
  select coalesce(array_agg((e->>'id')::uuid), array[]::uuid[])
    into v_target_action_ids
  from jsonb_array_elements(coalesce(v_data->'actions', '[]'::jsonb)) as e;

  delete from flow_stage_actions
   where stage_id in (select id from flow_stages where flow_id = p_flow_id)
     and not (id = any(v_target_action_ids));

  for v_elem in select e from jsonb_array_elements(coalesce(v_data->'actions', '[]'::jsonb)) as e
  loop
    insert into flow_stage_actions (id, stage_id, kind, config, sort_order, archived_at, created_at, updated_at)
    values (
      (v_elem->>'id')::uuid,
      (v_elem->>'stage_id')::uuid,
      v_elem->>'kind',
      coalesce(v_elem->'config', '{}'::jsonb),
      coalesce((v_elem->>'sort_order')::int, 0),
      nullif(v_elem->>'archived_at', '')::timestamptz,
      coalesce((v_elem->>'created_at')::timestamptz, now()),
      now()
    )
    on conflict (id) do update set
      stage_id = excluded.stage_id,
      kind = excluded.kind,
      config = excluded.config,
      sort_order = excluded.sort_order,
      archived_at = excluded.archived_at,
      updated_at = now();
  end loop;

  -- Stage Conditions.
  select coalesce(array_agg((e->>'id')::uuid), array[]::uuid[])
    into v_target_condition_ids
  from jsonb_array_elements(coalesce(v_data->'conditions', '[]'::jsonb)) as e;

  delete from stage_conditions
   where stage_id in (select id from flow_stages where flow_id = p_flow_id)
     and not (id = any(v_target_condition_ids));

  for v_elem in select e from jsonb_array_elements(coalesce(v_data->'conditions', '[]'::jsonb)) as e
  loop
    insert into stage_conditions (id, stage_id, kind, label, is_required, sort_order, config, archived_at, created_at, updated_at)
    values (
      (v_elem->>'id')::uuid,
      (v_elem->>'stage_id')::uuid,
      v_elem->>'kind',
      v_elem->>'label',
      coalesce((v_elem->>'is_required')::boolean, true),
      coalesce((v_elem->>'sort_order')::int, 0),
      coalesce(v_elem->'config', '{}'::jsonb),
      nullif(v_elem->>'archived_at', '')::timestamptz,
      coalesce((v_elem->>'created_at')::timestamptz, now()),
      now()
    )
    on conflict (id) do update set
      stage_id = excluded.stage_id,
      kind = excluded.kind,
      label = excluded.label,
      is_required = excluded.is_required,
      sort_order = excluded.sort_order,
      config = excluded.config,
      archived_at = excluded.archived_at,
      updated_at = now();
  end loop;

  -- Stage Fields (#331). Values recorded against a field cascade from it, so
  -- a field the target lacks is archived, not deleted: the SOR data stays.
  select coalesce(array_agg((e->>'id')::uuid), array[]::uuid[])
    into v_target_field_ids
  from jsonb_array_elements(coalesce(v_data->'stageFields', '[]'::jsonb)) as e;

  update flow_stage_fields
     set archived_at = now(), updated_at = now()
   where stage_id in (select id from flow_stages where flow_id = p_flow_id)
     and not (id = any(v_target_field_ids))
     and archived_at is null;

  for v_elem in select e from jsonb_array_elements(coalesce(v_data->'stageFields', '[]'::jsonb)) as e
  loop
    insert into flow_stage_fields (
      id, stage_id, label, help, source, sor_field, field_type, options, is_required, sort_order, archived_at, created_at, updated_at
    )
    values (
      (v_elem->>'id')::uuid,
      (v_elem->>'stage_id')::uuid,
      v_elem->>'label',
      nullif(v_elem->>'help', ''),
      v_elem->>'source',
      nullif(v_elem->>'sor_field', ''),
      v_elem->>'field_type',
      coalesce(v_elem->'options', '[]'::jsonb),
      coalesce((v_elem->>'is_required')::boolean, true),
      coalesce((v_elem->>'sort_order')::int, 0),
      nullif(v_elem->>'archived_at', '')::timestamptz,
      coalesce((v_elem->>'created_at')::timestamptz, now()),
      now()
    )
    on conflict (id) do update set
      stage_id = excluded.stage_id,
      label = excluded.label,
      help = excluded.help,
      source = excluded.source,
      sor_field = excluded.sor_field,
      field_type = excluded.field_type,
      options = excluded.options,
      is_required = excluded.is_required,
      sort_order = excluded.sort_order,
      archived_at = excluded.archived_at,
      updated_at = now();
  end loop;

  -- Registration form fields: same archive-don't-delete rule (sor_form_values).
  -- A 'default' row is unique per (flow, default_key). When the draft already
  -- has one for a key the target customizes, under a different id, that row
  -- is updated in place (keeping its id and its values) rather than replaced.
  select coalesce(array_agg((e->>'id')::uuid), array[]::uuid[])
    into v_target_form_field_ids
  from jsonb_array_elements(coalesce(v_data->'formFields', '[]'::jsonb)) as e;

  update flow_form_fields
     set archived_at = now(), updated_at = now()
   where flow_id = p_flow_id
     and not (id = any(v_target_form_field_ids))
     and not (
       source = 'default'
       and default_key in (
         select e->>'default_key'
         from jsonb_array_elements(coalesce(v_data->'formFields', '[]'::jsonb)) as e
         where e->>'source' = 'default'
       )
     )
     and archived_at is null;

  for v_elem in select e from jsonb_array_elements(coalesce(v_data->'formFields', '[]'::jsonb)) as e
  loop
    if v_elem->>'source' = 'default' then
      update flow_form_fields set
        label = nullif(v_elem->>'label', ''),
        help = nullif(v_elem->>'help', ''),
        field_type = nullif(v_elem->>'field_type', ''),
        options = coalesce(v_elem->'options', '[]'::jsonb),
        is_required = (v_elem->>'is_required')::boolean,
        is_hidden = coalesce((v_elem->>'is_hidden')::boolean, false),
        sort_order = coalesce((v_elem->>'sort_order')::int, 0),
        archived_at = nullif(v_elem->>'archived_at', '')::timestamptz,
        updated_at = now()
      where flow_id = p_flow_id
        and source = 'default'
        and default_key = v_elem->>'default_key'
        and id <> (v_elem->>'id')::uuid;
      if found then
        continue;
      end if;
    end if;

    insert into flow_form_fields (
      id, flow_id, source, default_key, label, help, field_type, options, is_required, is_hidden, sort_order, archived_at, created_at, updated_at
    )
    values (
      (v_elem->>'id')::uuid,
      p_flow_id,
      v_elem->>'source',
      nullif(v_elem->>'default_key', ''),
      nullif(v_elem->>'label', ''),
      nullif(v_elem->>'help', ''),
      nullif(v_elem->>'field_type', ''),
      coalesce(v_elem->'options', '[]'::jsonb),
      (v_elem->>'is_required')::boolean,
      coalesce((v_elem->>'is_hidden')::boolean, false),
      coalesce((v_elem->>'sort_order')::int, 0),
      nullif(v_elem->>'archived_at', '')::timestamptz,
      coalesce((v_elem->>'created_at')::timestamptz, now()),
      now()
    )
    on conflict (id) do update set
      source = excluded.source,
      default_key = excluded.default_key,
      label = excluded.label,
      help = excluded.help,
      field_type = excluded.field_type,
      options = excluded.options,
      is_required = excluded.is_required,
      is_hidden = excluded.is_hidden,
      sort_order = excluded.sort_order,
      archived_at = excluded.archived_at,
      updated_at = now();
  end loop;

  -- Follow-up Cadence: one row per Stage, carried in the snapshot keyed by
  -- its Stage id (`id` = stage_id), in followUpService's camelCase shape
  -- (everyDays, proofRequired). Nothing hangs off it, so plain replace.
  select coalesce(array_agg((e->>'id')::uuid), array[]::uuid[])
    into v_target_follow_up_stage_ids
  from jsonb_array_elements(coalesce(v_data->'followUps', '[]'::jsonb)) as e;

  delete from flow_stage_follow_ups
   where stage_id in (select id from flow_stages where flow_id = p_flow_id)
     and not (stage_id = any(v_target_follow_up_stage_ids));

  for v_elem in select e from jsonb_array_elements(coalesce(v_data->'followUps', '[]'::jsonb)) as e
  loop
    insert into flow_stage_follow_ups (stage_id, enabled, every_days, recipients, proof_required, created_at, updated_at)
    values (
      (v_elem->>'id')::uuid,
      coalesce((v_elem->>'enabled')::boolean, false),
      nullif(coalesce(v_elem->>'everyDays', v_elem->>'every_days'), '')::int,
      coalesce(v_elem->'recipients', '[{"type":"role","role":"deal_owner"}]'::jsonb),
      coalesce(coalesce(v_elem->>'proofRequired', v_elem->>'proof_required')::boolean, true),
      coalesce(coalesce(v_elem->>'createdAt', v_elem->>'created_at')::timestamptz, now()),
      now()
    )
    on conflict (stage_id) do update set
      enabled = excluded.enabled,
      every_days = excluded.every_days,
      recipients = excluded.recipients,
      proof_required = excluded.proof_required,
      updated_at = now();
  end loop;

  -- Access configuration (snapshot `access`) is deliberately NOT restored:
  -- who sees a flow's SORs is set per environment, and the release transfer
  -- (#331) must land Government and Outright with no flow_access_settings.

  update sales_flows
     set won_stage_id = v_won_stage_id,
         updated_at = now()
   where id = p_flow_id
  returning * into v_flow;

  return json_build_object('flow', row_to_json(v_flow), 'version', v_snapshot.version);
end;
$function$
;
CREATE OR REPLACE FUNCTION public.retail_orders_broadcast_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  -- The sync upserts a whole window every run; only a row that actually
  -- changed is news. updated_at is bumped by trg_retail_orders_updated_at.
  if tg_op = 'UPDATE' and (to_jsonb(new) - 'updated_at') = (to_jsonb(old) - 'updated_at') then
    return null;
  end if;
  begin
    perform realtime.send(
      jsonb_build_object('id', coalesce(new.id, old.id)),
      tg_op,
      'retail_orders-changes',
      true -- private: gated by the realtime.messages policy, not public
    );
  exception when others then
    null;
  end;
  return null;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.sales_opportunities_broadcast_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  begin
    perform realtime.send(
      jsonb_build_object('id', coalesce(new.id, old.id)),
      tg_op,
      'sales_opportunities-changes',
      true -- private: gated by the realtime.messages policy, not public
    );
  exception when others then
    null;
  end;
  return null;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.sales_opportunities_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  if new.registration_date is distinct from old.registration_date then
    raise exception 'registration_date is immutable — it determines deal ownership';
  end if;
  if new.registered_by is distinct from old.registered_by then
    raise exception 'registered_by is immutable';
  end if;
  if new.serial_no is distinct from old.serial_no then
    raise exception 'serial_no is immutable — it is the SOR Code people reference';
  end if;
  return new;
end $function$
;
CREATE OR REPLACE FUNCTION public.sales_opportunities_require_sales_ref()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
declare
  _is_lead boolean;
  _is_lost boolean;
  _old_is_lead boolean;
begin
  -- Normalise before checking
  new.sales_reference := upper(nullif(btrim(new.sales_reference), ''));
  new.itb_number := nullif(btrim(new.itb_number), '');

  select is_default, is_lost into _is_lead, _is_lost
  from public.crm_pipeline_stages
  where code = new.status;

  if tg_op = 'INSERT' then
    if not _is_lead and not _is_lost and new.sales_reference is null then
      raise exception 'A Sales Reference (Odoo quotation no., e.g. S01237) is required to register an opportunity beyond Lead.';
    end if;
    return new;
  end if;

  select is_default into _old_is_lead
  from public.crm_pipeline_stages
  where code = old.status;

  if new.status is distinct from old.status then
    if _old_is_lead and not _is_lead and not _is_lost and new.sales_reference is null then
      raise exception 'A Sales Reference (Odoo quotation no., e.g. S01237) is required before this opportunity can leave Lead.';
    end if;
  end if;

  return new;
end $function$
;
CREATE OR REPLACE FUNCTION public.sales_opportunity_items_touch()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  new.updated_at := now();
  return new;
end $function$
;
CREATE OR REPLACE FUNCTION public.set_bug_report_resolved(p_id uuid, p_resolved boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_was_resolved boolean;
begin
  if not can_read_bug_reports() then
    raise exception 'You do not have Bug Reports access.';
  end if;

  select resolved_at is not null into v_was_resolved from bug_reports where id = p_id for update;
  if not found then
    raise exception 'Bug report not found.';
  end if;

  update bug_reports set
    resolved_at = case when p_resolved then coalesce(resolved_at, now()) end,
    resolved_by = case when p_resolved then coalesce(resolved_by, get_employee_id()) end
  where id = p_id;

  if p_resolved <> v_was_resolved then
    insert into bug_report_notes (report_id, author_id, kind)
    values (p_id, get_employee_id(), case when p_resolved then 'resolved' else 'reopened' end);
  end if;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.set_ipas_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  new.updated_at = now();
  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.set_odoo_retail_queue_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.set_purchase_requests_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  new.updated_at = now();
  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.set_retail_orders_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  new.updated_at = now();
  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.sor_access_contact(p_opportunity_id uuid)
 RETURNS TABLE(deal_owner_name text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select e.name
  from public.sales_opportunities o
  left join public.employees e on e.id = o.deal_owner_id
  where o.id = p_opportunity_id
    and coalesce(o.is_deleted, false) = false
    and public.get_employee_id() is not null
$function$
;
CREATE OR REPLACE FUNCTION public.sor_access_level(p_opportunity_id uuid)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select case
    when not exists (select 1 from public.sales_opportunities where id = p_opportunity_id) then 'none'
    when public.is_super_admin() then 'full'
    when exists (
      select 1 from public.sales_opportunities o
      where o.id = p_opportunity_id
        and (
          public.sor_is_deal_team(o, public.get_employee_id())
          or public.sor_always_sees(o, public.get_employee_id())
        )
    ) then 'full'
    -- #545: the Final Acquire list or the Evaluation list, on an SOR that has a Costing Matrix.
    -- Independent of stage, mention and Stage Participants.
    when (public.costing_on_list('final_acquire') or public.costing_on_list('evaluation'))
      and exists (select 1 from public.costing_matrices m where m.opportunity_id = p_opportunity_id)
    then 'participant'
    when exists (
      select 1 from public.sor_stage_participants p
      where p.opportunity_id = p_opportunity_id
        and p.employee_id = public.get_employee_id()
        and p.closed_at is null
    ) then 'participant'
    -- An open Mention Window, or the header grant on an SOR that still has no visit.
    when exists (
      select 1 from public.sor_mention_viewers m
      left join public.sor_stage_visits v on v.id = m.stage_visit_id
      where m.opportunity_id = p_opportunity_id
        and m.employee_id = public.get_employee_id()
        and (
          (m.stage_visit_id is null
            and not exists (select 1 from public.sor_stage_visits sv where sv.opportunity_id = p_opportunity_id))
          -- v.id, not just v.left_at: a null grant left-joins to all-null v.
          or (v.id is not null and v.left_at is null and v.undone_at is null)
        )
    ) then 'participant'
    when exists (
      select 1 from public.sor_stage_participants p
      where p.opportunity_id = p_opportunity_id
        and p.employee_id = public.get_employee_id()
    ) then 'locked'
    -- A Mention Window the SOR has since left, or a header grant it outgrew.
    when exists (
      select 1 from public.sor_mention_viewers m
      where m.opportunity_id = p_opportunity_id
        and m.employee_id = public.get_employee_id()
    ) then 'locked'
    when exists (
      select 1 from public.purchase_request_members m
      join public.purchase_requests r on r.id = m.request_id
      where r.opportunity_id = p_opportunity_id
        and m.employee_id = public.get_employee_id()
    ) then 'locked'
    else 'none'
  end
$function$
;
CREATE OR REPLACE FUNCTION public.sor_always_edits(p_opp sales_opportunities, p_employee_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1
    from public.sales_flows f
    join public.flow_access_settings fas on fas.flow_id = f.id
    cross join lateral jsonb_array_elements(coalesce(fas.always_edits, '[]'::jsonb)) as selector
    where f.sale_type_id = p_opp.sale_type_id
      and public.sor_selector_covers(selector, p_opp, p_employee_id)
  )
$function$
;
CREATE OR REPLACE FUNCTION public.sor_always_sees(p_opp sales_opportunities, p_employee_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1
    from public.sales_flows f
    join public.flow_access_settings fas on fas.flow_id = f.id
    cross join lateral jsonb_array_elements(coalesce(fas.always_sees, '[]'::jsonb)) as selector
    where f.sale_type_id = p_opp.sale_type_id
      and public.sor_selector_covers(selector, p_opp, p_employee_id)
  )
$function$
;
CREATE OR REPLACE FUNCTION public.sor_begin_action_run(p_opportunity_id uuid, p_stage_id uuid, p_action_id uuid, p_stage_visit_id uuid DEFAULT NULL::uuid, p_decider jsonb DEFAULT NULL::jsonb)
 RETURNS sor_action_runs
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_row public.sor_action_runs;
begin
  insert into public.sor_action_runs (opportunity_id, stage_id, action_id, stage_visit_id, decider)
  values (p_opportunity_id, p_stage_id, p_action_id, p_stage_visit_id, p_decider)
  on conflict (opportunity_id, stage_id, action_id) where closed_off_at is null do nothing;

  select * into v_row
  from public.sor_action_runs
  where opportunity_id = p_opportunity_id
    and stage_id = p_stage_id
    and action_id = p_action_id
    and closed_off_at is null;

  return v_row;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.sor_can_edit_opportunity(p_opportunity_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1 from public.sales_opportunities o
    where o.id = p_opportunity_id
      and (
        o.registered_by = public.get_employee_id()
        or o.deal_owner_id = public.get_employee_id()
        or o.support_sales_1_id = public.get_employee_id()
        or o.support_sales_2_id = public.get_employee_id()
        or o.sales_director_id = public.get_employee_id()
        or exists (
          select 1 from public.employees e
          where e.id = public.get_employee_id()
            and (e.is_head or e.is_super_admin)
        )
        or (
          public.sor_always_edits(o, public.get_employee_id())
          and (
            public.sor_is_deal_team(o, public.get_employee_id())
            or public.sor_always_sees(o, public.get_employee_id())
          )
        )
      )
  )
$function$
;
CREATE OR REPLACE FUNCTION public.sor_can_view_journey(p_opportunity_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select case
    when public.sor_access_level(p_opportunity_id) = 'full' then true
    when public.sor_access_level(p_opportunity_id) != 'participant' then false
    else coalesce((
      select exists (
        select 1
        from public.sales_opportunities o
        join public.sales_flows f on f.sale_type_id = o.sale_type_id
        join public.flow_access_settings fas on fas.flow_id = f.id
        cross join lateral jsonb_array_elements(coalesce(fas.journey_viewers, '[]'::jsonb)) as selector
        where o.id = p_opportunity_id
          and fas.journey_viewers is not null
          and public.sor_selector_covers(selector, o, public.get_employee_id())
      )
    ), false)
  end
$function$
;
CREATE OR REPLACE FUNCTION public.sor_canvass_offer_prices_check_rate()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  new.updated_at := now();
  if new.comparison_rate is not null and exists (
    select 1 from public.sor_canvass_offers o
    where o.id = new.offer_id and o.currency = 'PHP'
  ) then
    raise exception 'A PHP Offer takes no comparison rate.' using errcode = '23514';
  end if;
  return new;
end
$function$
;
CREATE OR REPLACE FUNCTION public.sor_canvass_offers_check_currency()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if new.currency = 'PHP' and new.currency is distinct from old.currency and exists (
    select 1 from public.sor_canvass_offer_prices p
    where p.offer_id = new.id and p.comparison_rate is not null
  ) then
    raise exception 'Clear the comparison rate before changing an Offer to PHP.' using errcode = '23514';
  end if;
  return new;
end
$function$
;
CREATE OR REPLACE FUNCTION public.sor_canvass_offers_touch()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  new.updated_at := now();
  return new;
end $function$
;
CREATE OR REPLACE FUNCTION public.sor_canvass_signoff_events_append_only()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  -- A cascade from the Canvass (or the Component above it) runs one trigger level down; a direct
  -- delete does not.
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then
    return old;
  end if;
  -- Deleting an employee sets actor_id to null (the foreign key's own update, one level down).
  if tg_op = 'UPDATE' and pg_trigger_depth() > 1 and new.actor_id is null
     and (to_jsonb(new) - 'actor_id') = (to_jsonb(old) - 'actor_id') then
    return new;
  end if;
  raise exception 'The sign-off history is append-only.' using errcode = '42501';
end
$function$
;
CREATE OR REPLACE FUNCTION public.sor_canvasses_assign_number()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  new.number := 'CNV_' || lpad(nextval('public.sor_canvass_number_seq')::text, 4, '0');
  -- Whoever opens it is its creator, whatever the client sent.
  if public.get_employee_id() is not null then
    new.created_by := public.get_employee_id();
  end if;
  return new;
end
$function$
;
CREATE OR REPLACE FUNCTION public.sor_canvasses_default_canvasser()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  if new.canvasser_id is null and new.component_id is null and new.requested_item_id is null then
    new.canvasser_id := new.created_by;
  end if;
  return new;
end
$function$
;
CREATE OR REPLACE FUNCTION public.sor_canvasses_guard_signoff()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  if coalesce(current_setting('canvass.signoff', true), '') = 'on' then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if new.signed_off_by is not null or new.signed_off_at is not null then
      raise exception 'A Canvass is signed only through canvass_sign.' using errcode = '42501';
    end if;
  elsif new.signed_off_by is distinct from old.signed_off_by
     or new.signed_off_at is distinct from old.signed_off_at then
    raise exception 'A Canvass is signed only through canvass_sign.' using errcode = '42501';
  end if;
  return new;
end
$function$
;
CREATE OR REPLACE FUNCTION public.sor_canvasses_keep_number()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  if new.number is distinct from old.number then
    raise exception 'A Canvass number is never changed.' using errcode = '42501';
  end if;
  return new;
end
$function$
;
CREATE OR REPLACE FUNCTION public.sor_canvasses_mark_canvassing()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_actor uuid := coalesce(public.get_employee_id(), new.created_by);
  v_item  public.purchase_request_items;
begin
  for v_item in
    select i.*
      from public.purchase_request_items i
     where i.status = 'to_order'
       and (i.id = new.requested_item_id
            or (new.component_id is not null and i.component_id = new.component_id))
       for update
  loop
    if v_actor is null then
      update public.purchase_request_items
         set status = 'canvassing', status_changed_at = now()
       where id = v_item.id;
    else
      perform public._purchase_request_item_move(v_item, 'canvassing', 'purchasing', v_actor, '{}'::jsonb, 'canvass');
    end if;
  end loop;
  return null;
end
$function$
;
CREATE OR REPLACE FUNCTION public.sor_canvasses_refuse_component_item()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  if new.requested_item_id is not null and exists (
    select 1 from public.purchase_request_items i
    where i.id = new.requested_item_id and i.component_id is not null
  ) then
    raise exception 'This Requested Item names a Component. Canvass the Component instead.'
      using errcode = '23514';
  end if;
  return new;
end
$function$
;
CREATE OR REPLACE FUNCTION public.sor_canvasses_touch()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  new.updated_at := now();
  return new;
end $function$
;
CREATE OR REPLACE FUNCTION public.sor_certify_condition(p_opportunity_id uuid, p_condition_id uuid, p_stage_id uuid, p_actor_id uuid)
 RETURNS TABLE(id uuid, opportunity_id uuid, condition_id uuid, satisfied_by uuid, satisfied_at timestamp with time zone, stage_visit_id uuid, was_new boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_has_flow boolean;
  v_visit public.sor_stage_visits;
  v_existing public.sor_condition_status;
  v_row public.sor_condition_status;
begin
  select so.flow_stage_id is not null into v_has_flow
    from public.sales_opportunities so
    where so.id = p_opportunity_id and coalesce(so.is_deleted, false) = false;
  if v_has_flow is null then
    raise exception 'Certify: that SOR could not be found.' using errcode = 'P0002';
  end if;

  -- A legacy pipeline deal (no flow_stage_id, so no visit ever opens for it)
  -- keeps the pre-#203 opportunity-wide read: stage_visit_id null, same as
  -- the client-side read this replaces.
  if v_has_flow then
    select v.* into v_visit from public.sor_stage_visits v
      where v.opportunity_id = p_opportunity_id and v.left_at is null
      order by v.sequence desc limit 1;
    if v_visit.id is null or v_visit.flow_stage_id is distinct from p_stage_id then
      raise exception 'Certify: the SOR has left this condition''s Stage — the tick was not recorded.' using errcode = 'P0001';
    end if;
  end if;

  select s.* into v_existing from public.sor_condition_status s
    where s.opportunity_id = p_opportunity_id and s.condition_id = p_condition_id
      and s.stage_visit_id is not distinct from v_visit.id;
  if v_existing.id is not null then
    return query select
      v_existing.id, v_existing.opportunity_id, v_existing.condition_id,
      v_existing.satisfied_by, v_existing.satisfied_at, v_existing.stage_visit_id, false;
    return;
  end if;

  insert into public.sor_condition_status (opportunity_id, condition_id, satisfied_by, stage_visit_id)
  values (p_opportunity_id, p_condition_id, p_actor_id, v_visit.id)
  returning * into v_row;

  return query select
    v_row.id, v_row.opportunity_id, v_row.condition_id,
    v_row.satisfied_by, v_row.satisfied_at, v_row.stage_visit_id, true;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.sor_create_stage_action_task(p_run_id uuid, p_task_description text, p_project_title text DEFAULT NULL::text, p_category_id text DEFAULT NULL::text, p_logged_by uuid DEFAULT NULL::uuid, p_priority text DEFAULT 'MEDIUM'::text, p_checklist jsonb DEFAULT NULL::jsonb, p_end_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_reported_to uuid DEFAULT NULL::uuid)
 RETURNS tasks
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_run  public.sor_action_runs;
  v_actor uuid := public.get_employee_id();
  v_task public.tasks;
begin
  if v_actor is null then
    raise exception 'sor_create_stage_action_task: not signed in' using errcode = '42501';
  end if;

  select * into v_run from public.sor_action_runs where id = p_run_id;
  if v_run.id is null then
    raise exception 'sor_create_stage_action_task: run % not found', p_run_id;
  end if;

  if v_run.task_id is not null then
    raise exception 'sor_create_stage_action_task: run % already has a task', p_run_id using errcode = '42501';
  end if;

  if v_run.outcome not in ('pending', 'created') then
    raise exception 'sor_create_stage_action_task: run % is not pending', p_run_id using errcode = '42501';
  end if;

  if not (
    public.sor_can_edit_opportunity(v_run.opportunity_id)
    or public.sor_access_level(v_run.opportunity_id) = 'full'
  ) then
    raise exception 'sor_create_stage_action_task: actor % lacks full access to opportunity %', v_actor, v_run.opportunity_id
      using errcode = '42501';
  end if;

  insert into public.tasks (
    task_description, project_title, category_id, logged_by, priority,
    checklist, status, remarks, start_at, end_at, reported_to,
    opportunity_id, stage_action_id, stage_visit_id
  ) values (
    p_task_description,
    p_project_title,
    p_category_id,
    coalesce(p_logged_by, v_actor),
    coalesce(p_priority, 'MEDIUM'),
    p_checklist,
    'INCOMPLETE',
    '',
    now(),
    p_end_at,
    p_reported_to,
    v_run.opportunity_id,
    v_run.action_id,
    v_run.stage_visit_id
  )
  returning * into v_task;

  update public.sor_action_runs
  set outcome = 'created',
      task_id = v_task.id
  where id = p_run_id;

  return v_task;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.sor_create_stage_group_task_action(p_run_id uuid, p_title text, p_description text, p_members jsonb, p_due_date timestamp with time zone DEFAULT NULL::timestamp with time zone, p_template_id uuid DEFAULT NULL::uuid, p_tag_ids uuid[] DEFAULT NULL::uuid[], p_created_by uuid DEFAULT NULL::uuid)
 RETURNS committee_tasks
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_run  public.sor_action_runs;
  v_actor uuid := public.get_employee_id();
  v_group_task public.committee_tasks;
  v_member jsonb;
  v_tag_id uuid;
begin
  if v_actor is null then
    raise exception 'sor_create_stage_group_task_action: not signed in' using errcode = '42501';
  end if;

  select * into v_run from public.sor_action_runs where id = p_run_id;
  if v_run.id is null then
    raise exception 'sor_create_stage_group_task_action: run % not found', p_run_id;
  end if;

  if v_run.group_task_id is not null then
    raise exception 'sor_create_stage_group_task_action: run % already has a group task', p_run_id using errcode = '42501';
  end if;

  if v_run.outcome not in ('pending', 'created') then
    raise exception 'sor_create_stage_group_task_action: run % is not pending', p_run_id using errcode = '42501';
  end if;

  if not (
    public.sor_can_edit_opportunity(v_run.opportunity_id)
    or public.sor_access_level(v_run.opportunity_id) = 'full'
  ) then
    raise exception 'sor_create_stage_group_task_action: actor % lacks full access to opportunity %', v_actor, v_run.opportunity_id
      using errcode = '42501';
  end if;

  if p_members is null or jsonb_array_length(p_members) = 0 then
    raise exception 'sor_create_stage_group_task_action: at least one member is required';
  end if;

  insert into public.committee_tasks (
    title, description, created_by, due_date, status,
    template_id, opportunity_id, stage_action_id, stage_visit_id
  ) values (
    p_title,
    p_description,
    coalesce(p_created_by, v_actor),
    p_due_date,
    'ACTIVE',
    p_template_id,
    v_run.opportunity_id,
    v_run.action_id,
    v_run.stage_visit_id
  )
  returning * into v_group_task;

  for v_member in select * from jsonb_array_elements(p_members)
  loop
    insert into public.committee_task_members (
      committee_task_id, employee_id, task_description, checklist, role, custom_role, status
    ) values (
      v_group_task.id,
      (v_member->>'employee_id')::uuid,
      coalesce(v_member->>'task_description', ''),
      v_member->'checklist',
      v_member->>'role',
      v_member->>'custom_role',
      'PENDING'
    );
  end loop;

  if p_tag_ids is not null then
    foreach v_tag_id in array p_tag_ids
    loop
      insert into public.committee_task_tags (committee_task_id, tag_id, added_by)
      values (v_group_task.id, v_tag_id, v_actor);
    end loop;
  end if;

  update public.sor_action_runs
  set outcome = 'created',
      group_task_id = v_group_task.id
  where id = p_run_id;

  return v_group_task;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.sor_decide_action_run(p_run_id uuid, p_decision text, p_actor_id uuid)
 RETURNS sor_action_runs
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_row public.sor_action_runs;
  v_opportunity public.sales_opportunities;
  v_selector jsonb;
  v_allowed boolean := false;
begin
  if p_decision not in ('create', 'skip') then
    raise exception 'sor_decide_action_run: invalid decision %', p_decision;
  end if;

  select * into v_row from public.sor_action_runs where id = p_run_id;
  if v_row.id is null then
    raise exception 'sor_decide_action_run: run % not found', p_run_id;
  end if;

  if v_row.outcome <> 'pending' then
    raise exception 'sor_decide_action_run: run % already decided', p_run_id;
  end if;
  if v_row.held_at is not null then
    raise exception 'sor_decide_action_run: run % is on hold, not decidable', p_run_id;
  end if;
  if v_row.closed_off_at is not null then
    raise exception 'sor_decide_action_run: run % is closed off, not decidable', p_run_id;
  end if;

  select * into v_opportunity from public.sales_opportunities where id = v_row.opportunity_id;

  if v_row.decider is null or jsonb_array_length(v_row.decider) = 0 then
    v_allowed := false;
  else
    for v_selector in select * from jsonb_array_elements(v_row.decider)
    loop
      if v_selector->>'type' = 'employee' and (v_selector->>'id')::uuid = p_actor_id then
        v_allowed := true;
      elsif v_selector->>'type' = 'group'
        and exists (
          select 1 from public.employee_group_members egm
          where egm.group_id = (v_selector->>'id')::uuid
            and egm.employee_id = p_actor_id
        ) then
        v_allowed := true;
      elsif v_selector->>'type' = 'team'
        and exists (
          select 1 from public.employees e
          where e.id = p_actor_id
            and upper(trim(e.sub_department)) = upper(trim(v_selector->>'team'))
        ) then
        v_allowed := true;
      elsif v_selector->>'type' = 'role' and v_opportunity.id is not null then
        case v_selector->>'role'
          when 'deal_owner' then
            v_allowed := v_opportunity.deal_owner_id = p_actor_id;
          when 'closing_sales' then
            v_allowed := v_opportunity.closing_sales_id = p_actor_id;
          when 'support_sales' then
            v_allowed := v_opportunity.support_sales_1_id = p_actor_id
              or v_opportunity.support_sales_2_id = p_actor_id;
          when 'sales_director' then
            v_allowed := v_opportunity.sales_director_id = p_actor_id;
          when 'registrar' then
            v_allowed := v_opportunity.registered_by = p_actor_id;
          else
            v_allowed := false;
        end case;
      end if;
      exit when v_allowed;
    end loop;
  end if;

  if not v_allowed then
    raise exception 'sor_decide_action_run: actor % is not a decider for run %', p_actor_id, p_run_id;
  end if;

  update public.sor_action_runs
  set decided_by = p_actor_id,
      decided_at = now(),
      outcome = case when p_decision = 'create' then 'created' else 'skipped' end
  where id = p_run_id
  returning * into v_row;

  return v_row;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.sor_delivery_deadlines(p_opportunity_ids uuid[])
 RETURNS TABLE(opportunity_id uuid, due_at timestamp with time zone, days integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with asked as (
    select o.id, o.flow_snapshot_id
      from public.sales_opportunities o
     where public.get_employee_id() is not null
       and o.id = any (coalesce(p_opportunity_ids, '{}'::uuid[]))
       and not o.is_deleted
       and (
         coalesce(public.has_purchasing_access(), false)
         or coalesce(public.has_finance_access(), false)
         or coalesce(public.is_super_admin(), false)
         or coalesce(public.sor_access_level(o.id), 'none') <> 'none'
       )
  ),
  conds as (
    select a.id as opportunity_id,
           c.cond->>'stage_id' as stage_id,
           (c.cond->'config'->>'days')::integer as days
      from asked a
      join public.flow_snapshots fs on fs.id = a.flow_snapshot_id
      cross join lateral (
        select e.cond
          from jsonb_array_elements(
                 case jsonb_typeof(fs.snapshot_data->'conditions')
                   when 'array' then fs.snapshot_data->'conditions'
                   when 'object' then (
                     select coalesce(jsonb_agg(x.val), '[]'::jsonb)
                       from jsonb_each(fs.snapshot_data->'conditions') je,
                            jsonb_array_elements(je.value) x(val)
                      where jsonb_typeof(je.value) = 'array'
                   )
                   else '[]'::jsonb
                 end
               ) e(cond)
         where e.cond->>'kind' = 'deadline'
           and (e.cond->>'archived_at') is null
           and (e.cond->'config'->>'days') ~ '^[0-9]+$'
      ) c
  ),
  dated as (
    select c.opportunity_id,
           c.days,
           (
             select v.entered_at
               from public.sor_stage_visits v
              where v.opportunity_id = c.opportunity_id
                and v.flow_stage_id::text = c.stage_id
                and v.undone_at is null
              order by v.entered_at desc
              limit 1
           ) as entered_at
      from conds c
     where c.days > 0
  )
  select distinct on (d.opportunity_id)
         d.opportunity_id,
         d.entered_at + (d.days || ' days')::interval as due_at,
         d.days
    from dated d
   where d.entered_at is not null
   order by d.opportunity_id, d.entered_at + (d.days || ' days')::interval;
$function$
;
CREATE OR REPLACE FUNCTION public.sor_due_follow_ups(p_now timestamp with time zone DEFAULT now())
 RETURNS TABLE(opportunity_id uuid, stage_visit_id uuid, stage_id uuid, entered_at timestamp with time zone, every_days integer, recipients jsonb, due_at timestamp with time zone)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  with open_visits as (
    select
      v.id as stage_visit_id,
      v.opportunity_id,
      v.flow_stage_id as stage_id,
      v.entered_at,
      so.flow_snapshot_id
    from public.sor_stage_visits v
    join public.sales_opportunities so on so.id = v.opportunity_id
    where v.left_at is null
  ),
  cadences as (
    select
      ov.*,
      fu.value as follow_up_cfg
    from open_visits ov
    join public.flow_snapshots fs on fs.id = ov.flow_snapshot_id
    cross join lateral jsonb_array_elements(coalesce(fs.snapshot_data->'followUps', '[]'::jsonb)) as fu(value)
    where fu.value->>'id' = ov.stage_id::text
      and (fu.value->>'enabled')::boolean is true
      and (fu.value->>'everyDays') is not null
  ),
  last_logged as (
    select
      (metadata->>'stageVisitId')::uuid as stage_visit_id,
      max(created_at) as last_at
    from public.sales_opportunity_logs
    where metadata->>'event' = 'FOLLOW_UP_LOGGED'
    group by 1
  ),
  last_reminder as (
    select
      (metadata->>'stageVisitId')::uuid as stage_visit_id,
      max(created_at) as last_at
    from public.sales_opportunity_logs
    where metadata->>'event' = 'FOLLOW_UP_REMINDER'
    group by 1
  )
  select
    c.opportunity_id,
    c.stage_visit_id,
    c.stage_id,
    c.entered_at,
    (c.follow_up_cfg->>'everyDays')::integer as every_days,
    coalesce(c.follow_up_cfg->'recipients', '[]'::jsonb) as recipients,
    greatest(c.entered_at, coalesce(ll.last_at, c.entered_at), coalesce(lr.last_at, c.entered_at))
      + ((c.follow_up_cfg->>'everyDays')::integer) * interval '1 day' as due_at
  from cadences c
  left join last_logged ll on ll.stage_visit_id = c.stage_visit_id
  left join last_reminder lr on lr.stage_visit_id = c.stage_visit_id
  where
    greatest(c.entered_at, coalesce(ll.last_at, c.entered_at), coalesce(lr.last_at, c.entered_at))
      + ((c.follow_up_cfg->>'everyDays')::integer) * interval '1 day' <= p_now;
$function$
;
CREATE OR REPLACE FUNCTION public.sor_finish_action_run(p_run_id uuid, p_outcome text, p_task_id uuid DEFAULT NULL::uuid, p_group_task_id uuid DEFAULT NULL::uuid)
 RETURNS sor_action_runs
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_row public.sor_action_runs;
begin
  if p_outcome not in ('created', 'skipped', 'failed') then
    raise exception 'sor_finish_action_run: invalid outcome %', p_outcome;
  end if;

  update public.sor_action_runs
  set outcome = p_outcome,
      task_id = coalesce(p_task_id, task_id),
      group_task_id = coalesce(p_group_task_id, group_task_id)
  where id = p_run_id
  returning * into v_row;

  return v_row;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.sor_grant_mention_view(p_opportunity_id uuid, p_employee_ids uuid[])
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_count integer;
  v_visit uuid;
begin
  -- Whoever can post a note on the SOR can mention someone into it, including
  -- someone who is only there by a Mention.
  if public.sor_access_level(p_opportunity_id) not in ('full', 'participant') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  -- TIGHTEN(mention): only the Deal Team, Always sees and Stage Participants
  -- invite; a mentioned person cannot chain. Replace the check above with:
  -- if public.sor_access_level(p_opportunity_id) <> 'full'
  --    and not exists (
  --      select 1 from public.sor_stage_participants p
  --      where p.opportunity_id = p_opportunity_id
  --        and p.employee_id = public.get_employee_id()
  --        and p.closed_at is null
  --    ) then
  --   raise exception 'not allowed' using errcode = '42501';
  -- end if;

  select v.id into v_visit
  from public.sor_stage_visits v
  where v.opportunity_id = p_opportunity_id
    and v.left_at is null
    and v.undone_at is null
  order by v.sequence desc
  limit 1;

  insert into public.sor_mention_viewers (opportunity_id, employee_id, granted_by, stage_visit_id)
  select p_opportunity_id, c, public.get_employee_id(), v_visit
  from public.sor_mention_window_candidates(p_opportunity_id, p_employee_ids) c
  on conflict do nothing;
  get diagnostics v_count = row_count;
  return v_count;
end
$function$
;
CREATE OR REPLACE FUNCTION public.sor_guard_non_editor_update()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if auth.role() = 'service_role' or auth.uid() is null then
    return NEW;
  end if;

  if public.sor_can_edit_opportunity(OLD.id) then
    return NEW;
  end if;

  if (to_jsonb(NEW) - 'flow_stage_id' - 'contract_date' - 'updated_at' - 'sor_code')
     is distinct from (to_jsonb(OLD) - 'flow_stage_id' - 'contract_date' - 'updated_at' - 'sor_code') then
    raise exception 'You can move this SOR, but not edit it.' using errcode = '42501';
  end if;

  return NEW;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.sor_guard_stage_move()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if NEW.flow_stage_id is not distinct from OLD.flow_stage_id then
    return NEW;
  end if;

  if auth.role() = 'service_role' then
    return NEW;
  end if;

  -- Revert authorises itself (mover / Deal Owner / Super Admin) and a
  -- Restricted Stage does not stop it.
  if coalesce(current_setting('app.sor_revert', true), '') = 'on' then
    return NEW;
  end if;

  if public.sor_access_level(OLD.id) <> 'full' then
    raise exception 'You do not have access to move this stage.' using errcode = '42501';
  end if;

  if public.sor_is_stage_shut_out(OLD, public.get_employee_id(), OLD.flow_stage_id) then
    raise exception 'This stage is restricted — you cannot move this SOR.' using errcode = '42501';
  end if;

  return NEW;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.sor_inclusions_touch()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  new.updated_at := now();
  return new;
end $function$
;
CREATE OR REPLACE FUNCTION public.sor_is_deal_team(p_opp sales_opportunities, p_employee_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
AS $function$
  select
    p_opp.registered_by = p_employee_id
    or p_opp.deal_owner_id = p_employee_id
    or p_opp.closing_sales_id = p_employee_id
    or p_opp.support_sales_1_id = p_employee_id
    or p_opp.support_sales_2_id = p_employee_id
    or p_opp.sales_director_id = p_employee_id
$function$
;
CREATE OR REPLACE FUNCTION public.sor_is_stage_shut_out(p_opp sales_opportunities, p_employee_id uuid, p_stage_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with fsa as (
    select * from public.flow_stage_access where stage_id = p_stage_id
  ),
  roles as (
    select role from (values
      ('deal_owner', p_opp.deal_owner_id = p_employee_id),
      ('closing_sales', p_opp.closing_sales_id = p_employee_id),
      ('support_sales', p_opp.support_sales_1_id = p_employee_id or p_opp.support_sales_2_id = p_employee_id),
      ('sales_director', p_opp.sales_director_id = p_employee_id),
      ('registrar', p_opp.registered_by = p_employee_id)
    ) as t(role, matches)
    where matches
  )
  select exists (select 1 from fsa)
    and (
      -- Every Deal Team role this employee holds on this opportunity is
      -- shut out of this stage. An employee holding no role here at all
      -- never satisfies this arm — that's the Employee Group arm's job.
      (
        exists (select 1 from roles)
        and not exists (
          select 1 from roles, fsa
          where not (roles.role = any(fsa.shut_out_roles))
        )
      )
      or exists (
        select 1
        from fsa, unnest(fsa.excluded_group_ids) as gid
        where exists (select 1 from public.employee_group_member_ids(gid) m where m = p_employee_id)
      )
    )
$function$
;
CREATE OR REPLACE FUNCTION public.sor_link_label(p_opportunity_id uuid)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce(o.sales_reference, o.client_name)
  from public.sales_opportunities o
  where o.id = p_opportunity_id
    and public.sor_access_level(p_opportunity_id) in ('full', 'participant', 'locked')
$function$
;
CREATE OR REPLACE FUNCTION public.sor_locked_summary(p_opportunity_id uuid)
 RETURNS TABLE(sales_reference text, project_title text, current_stage_name text, is_restricted boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select
    o.sales_reference,
    o.project_title,
    fs.name,
    (
      (
        public.sor_is_deal_team(o, public.get_employee_id())
        or public.sor_always_sees(o, public.get_employee_id())
      )
      and public.sor_is_stage_shut_out(o, public.get_employee_id(), o.flow_stage_id)
      and not public.is_super_admin()
    )
  from public.sales_opportunities o
  left join public.flow_stages fs on fs.id = o.flow_stage_id
  where o.id = p_opportunity_id
    and public.sor_access_level(p_opportunity_id) in ('full', 'participant', 'locked')
$function$
;
CREATE OR REPLACE FUNCTION public.sor_mention_shares(p_opportunity_id uuid)
 RETURNS TABLE(id uuid, employee_id uuid, employee_name text, granted_by_name text, stage_name text, is_open boolean, created_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select
    m.id,
    m.employee_id,
    e.name,
    g.name,
    fs.name,
    case
      when m.stage_visit_id is null
        then not exists (select 1 from public.sor_stage_visits sv where sv.opportunity_id = p_opportunity_id)
      else v.left_at is null and v.undone_at is null
    end,
    m.created_at
  from public.sor_mention_viewers m
  join public.employees e on e.id = m.employee_id
  left join public.employees g on g.id = m.granted_by
  left join public.sor_stage_visits v on v.id = m.stage_visit_id
  left join public.flow_stages fs on fs.id = v.flow_stage_id
  where m.opportunity_id = p_opportunity_id
    and public.sor_access_level(p_opportunity_id) = 'full'
    and (v.id is null or v.undone_at is null)
  order by m.created_at desc
$function$
;
CREATE OR REPLACE FUNCTION public.sor_mention_window_candidates(p_opportunity_id uuid, p_employee_ids uuid[])
 RETURNS SETOF uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with cur as (
    select v.id, v.sequence, v.flow_stage_id
    from public.sor_stage_visits v
    where v.opportunity_id = p_opportunity_id
      and v.left_at is null
      and v.undone_at is null
    order by v.sequence desc
    limit 1
  )
  select e.id
  from public.employees e
  join public.sales_opportunities o on o.id = p_opportunity_id
  left join cur on true
  where e.id = any (p_employee_ids)
    -- Only someone who could post here may ask who a Mention would open for.
    and public.sor_access_level(p_opportunity_id) in ('full', 'participant')
    and coalesce(e.is_deleted, false) = false
    and not coalesce(e.is_super_admin, false)
    -- Already reaches this Stage as Deal Team / Always sees. Someone on the
    -- Deal Team shut out of a Restricted Stage does not, so a Mention opens it.
    -- sor_is_deal_team is NULL, not false, when some Deal Team columns are empty.
    and not (
      (coalesce(public.sor_is_deal_team(o, e.id), false) or coalesce(public.sor_always_sees(o, e.id), false))
      and (cur.id is null or not public.sor_is_stage_shut_out(o, e.id, cur.flow_stage_id))
    )
    -- TIGHTEN(mention): a Restricted Stage stays shut to a Mention. Uncomment:
    -- and (cur.id is null or not public.sor_is_stage_shut_out(o, e.id, cur.flow_stage_id))
    -- Already inside an open Stage Participant window that reaches this visit.
    and not exists (
      select 1
      from public.sor_stage_participants p
      join public.sor_stage_visits opened on opened.id = p.opened_visit_id
      where p.opportunity_id = p_opportunity_id
        and p.employee_id = e.id
        and p.closed_at is null
        and opened.undone_at is null
        and cur.id is not null
        and opened.sequence <= cur.sequence
    )
    -- Already holds a window on this visit (or the header grant on a visitless SOR).
    and not exists (
      select 1 from public.sor_mention_viewers m
      where m.opportunity_id = p_opportunity_id
        and m.employee_id = e.id
        and m.stage_visit_id is not distinct from cur.id
    )
$function$
;
CREATE OR REPLACE FUNCTION public.sor_move_and_resume(p_opportunity_id uuid, p_flow_stage_id uuid, p_contract_date date DEFAULT NULL::date)
 RETURNS sor_stage_visits
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  update public.sales_opportunities
    set flow_stage_id = p_flow_stage_id,
        contract_date = coalesce(p_contract_date, contract_date)
    where id = p_opportunity_id;
  if not found then
    raise exception 'Resume: that SOR could not be moved.' using errcode = '42501';
  end if;
  return public.sor_resume_stage_work(p_opportunity_id);
end;
$function$
;
CREATE OR REPLACE FUNCTION public.sor_move_and_start_fresh(p_opportunity_id uuid, p_flow_stage_id uuid, p_contract_date date DEFAULT NULL::date)
 RETURNS sor_stage_visits
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  update public.sales_opportunities
    set flow_stage_id = p_flow_stage_id,
        contract_date = coalesce(p_contract_date, contract_date)
    where id = p_opportunity_id;
  if not found then
    raise exception 'Start fresh: that SOR could not be moved.' using errcode = '42501';
  end if;
  return public.sor_start_fresh_stage_work(p_opportunity_id);
end;
$function$
;
CREATE OR REPLACE FUNCTION public.sor_my_deal_team_sor_ids()
 RETURNS SETOF uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select o.id from public.sales_opportunities o
  where o.registered_by = public.get_employee_id() and not o.is_deleted and not o.is_scratch
  union
  select o.id from public.sales_opportunities o
  where o.deal_owner_id = public.get_employee_id() and not o.is_deleted and not o.is_scratch
  union
  select o.id from public.sales_opportunities o
  where o.closing_sales_id = public.get_employee_id() and not o.is_deleted and not o.is_scratch
  union
  select o.id from public.sales_opportunities o
  where o.support_sales_1_id = public.get_employee_id() and not o.is_deleted and not o.is_scratch
  union
  select o.id from public.sales_opportunities o
  where o.support_sales_2_id = public.get_employee_id() and not o.is_deleted and not o.is_scratch
  union
  select o.id from public.sales_opportunities o
  where o.sales_director_id = public.get_employee_id() and not o.is_deleted and not o.is_scratch
$function$
;
CREATE OR REPLACE FUNCTION public.sor_my_sors_facets(p_opportunity_ids uuid[])
 RETURNS TABLE(opportunity_id uuid, sor_code text, sale_type_name text, last_activity_at timestamp with time zone, client_name text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select o.id, o.sor_code, st.name,
    -- Last activity and the client are shown to Full and Participant readers
    -- only, as elsewhere; a locked reader gets neither.
    case when public.sor_access_level(o.id) in ('full', 'participant') then
      greatest(
        o.updated_at,
        (select max(greatest(v.entered_at, v.left_at)) from public.sor_stage_visits v where v.opportunity_id = o.id),
        (select max(l.created_at) from public.sales_opportunity_logs l where l.opportunity_id = o.id)
      )
    end,
    case when public.sor_access_level(o.id) in ('full', 'participant') then o.client_name end
  from public.sales_opportunities o
  left join public.sale_types st on st.id = o.sale_type_id
  where o.id = any (p_opportunity_ids)
    and public.sor_access_level(o.id) <> 'none'
$function$
;
CREATE OR REPLACE FUNCTION public.sor_open_costing_matrix(p_run_id uuid, p_config jsonb DEFAULT '{}'::jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_actor uuid := public.get_employee_id();
  v_run public.sor_action_runs;
  v_action jsonb;
  v_opp public.sales_opportunities;
  v_visit uuid;
  v_matrix uuid;
begin
  if v_actor is null then
    raise exception 'sor_open_costing_matrix: not signed in' using errcode = '42501';
  end if;

  select * into v_run from public.sor_action_runs where id = p_run_id for update;
  if v_run.id is null then
    raise exception 'sor_open_costing_matrix: run % not found', p_run_id;
  end if;
  if v_run.costing_matrix_id is not null then
    raise exception 'sor_open_costing_matrix: run % already opened its matrix', p_run_id using errcode = '42501';
  end if;
  -- `created` with a decision is a Decider's Create, still to be built.
  if not (v_run.outcome = 'pending' or (v_run.outcome = 'created' and v_run.decided_by is not null)) then
    raise exception 'sor_open_costing_matrix: run % is not pending', p_run_id using errcode = '42501';
  end if;

  if not (
    public.sor_can_edit_opportunity(v_run.opportunity_id)
    or public.sor_access_level(v_run.opportunity_id) = 'full'
  ) then
    raise exception 'sor_open_costing_matrix: actor % lacks full access to opportunity %', v_actor, v_run.opportunity_id
      using errcode = '42501';
  end if;

  v_action := public._sor_action_run_saved_action(p_run_id);
  if v_action->>'kind' is distinct from 'open_costing_matrix' then
    raise exception 'sor_open_costing_matrix: run % is not an Open Costing Matrix action', p_run_id
      using errcode = '22023';
  end if;

  select * into v_opp from public.sales_opportunities where id = v_run.opportunity_id;

  v_visit := coalesce(
    v_run.stage_visit_id,
    (select v.id from public.sor_stage_visits v
      where v.opportunity_id = v_run.opportunity_id and v.left_at is null and v.undone_at is null
      order by v.sequence desc limit 1)
  );

  v_matrix := public.costing_open_matrix(
    v_run.opportunity_id,
    public._costing_action_open_args(v_opp, coalesce(v_action->'config', '{}'::jsonb), v_visit)
  );

  update public.sor_action_runs
  set outcome = 'created', costing_matrix_id = v_matrix
  where id = p_run_id;

  return v_matrix;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.sor_open_purchase_request(p_run_id uuid, p_config jsonb DEFAULT '{}'::jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_actor uuid := public.get_employee_id();
  v_run public.sor_action_runs;
  v_action jsonb;
  v_config jsonb;
  v_opp public.sales_opportunities;
  v_req public.purchase_requests;
  v_left_out text[];
  v_buyer uuid;
  v_until text;
  v_until_stage uuid;
  v_emp uuid;
  v_created boolean;
  v_buyer_set boolean := false;
  v_requesters jsonb;
begin
  if v_actor is null then
    raise exception 'sor_open_purchase_request: not signed in' using errcode = '42501';
  end if;

  select * into v_run from public.sor_action_runs where id = p_run_id for update;
  if v_run.id is null then
    raise exception 'sor_open_purchase_request: run % not found', p_run_id;
  end if;
  if v_run.purchase_request_id is not null then
    raise exception 'sor_open_purchase_request: run % already opened its request', p_run_id using errcode = '42501';
  end if;
  -- `created` with a decision is a Decider's Create, still to be built.
  if not (v_run.outcome = 'pending' or (v_run.outcome = 'created' and v_run.decided_by is not null)) then
    raise exception 'sor_open_purchase_request: run % is not pending', p_run_id using errcode = '42501';
  end if;

  if not (
    public.sor_can_edit_opportunity(v_run.opportunity_id)
    or public.sor_access_level(v_run.opportunity_id) = 'full'
  ) then
    raise exception 'sor_open_purchase_request: actor % lacks full access to opportunity %', v_actor, v_run.opportunity_id
      using errcode = '42501';
  end if;

  v_action := public._sor_action_run_saved_action(p_run_id);
  if v_action->>'kind' is distinct from 'open_purchase_request' then
    raise exception 'sor_open_purchase_request: run % is not an Open Purchase Request action', p_run_id
      using errcode = '22023';
  end if;
  v_config := coalesce(v_action->'config', '{}'::jsonb);

  -- #462: the Costing Matrix's Purchasing Incharge, if the SOR has a matrix that
  -- names one; otherwise nobody and the request waits for a Take.
  if v_config->'buyer'->>'type' = 'employee' then
    v_buyer := nullif(v_config->'buyer'->>'id', '')::uuid;
  elsif v_config->'buyer'->>'type' = 'costing_incharge' then
    select m.purchasing_incharge_id into v_buyer
    from public.costing_matrices m
    where m.opportunity_id = v_run.opportunity_id;
  end if;

  v_until := coalesce(nullif(v_config->'access'->>'until', ''), 'stage_left');
  if v_until in ('stage_entered', 'later_stage_left') then
    v_until_stage := nullif(v_config->'access'->>'stageId', '')::uuid;
  end if;

  select coalesce(array_agg(r), '{}') into v_left_out
  from jsonb_array_elements_text(
    case when jsonb_typeof(v_config->'leaveOutRoles') = 'array' then v_config->'leaveOutRoles' else '[]'::jsonb end
  ) r;

  select * into v_opp from public.sales_opportunities where id = v_run.opportunity_id;

  -- Who may request items: the action's list, or null (the Deal Team, as
  -- before) for an action saved before the setting existed.
  if jsonb_typeof(v_config->'requesters') = 'array' then
    v_requesters := v_config->'requesters';
  end if;

  insert into public.purchase_requests
    (opportunity_id, opened_by_action_id, opened_visit_id, buyer_id, created_by, access_until, access_until_stage_id, requesters)
  values
    (v_run.opportunity_id, v_run.action_id, v_run.stage_visit_id, v_buyer, v_actor, v_until, v_until_stage, v_requesters)
  on conflict (opportunity_id) do nothing
  returning * into v_req;
  v_created := v_req.id is not null;

  if not v_created then
    -- An existing request (an earlier action, or a concurrent open that won
    -- the race) is topped up: a Buyer only if it has none.
    update public.purchase_requests set buyer_id = v_buyer
    where opportunity_id = v_run.opportunity_id and buyer_id is null and v_buyer is not null
    returning true into v_buyer_set;
    -- A list arriving for a request that had none takes effect.
    update public.purchase_requests set requesters = v_requesters
    where opportunity_id = v_run.opportunity_id and requesters is null and v_requesters is not null;
    select * into v_req from public.purchase_requests where opportunity_id = v_run.opportunity_id;
  end if;

  -- Members: Purchasing access, the Deal Team minus the left-out roles, the
  -- configured extras, whoever may request items, and the Buyer.
  for v_emp in
    select e.id from public.employees e
    where public._employee_has_purchasing_access(e.id)
    union
    select t.employee_id from public._sor_deal_team_roles(v_opp) t
    where not (t.role = any (v_left_out))
      and exists (select 1 from public.employees d where d.id = t.employee_id and not coalesce(d.is_deleted, false))
    union
    select e.id from public.employees e
    where not coalesce(e.is_deleted, false)
      and exists (
        select 1 from jsonb_array_elements(
          case when jsonb_typeof(v_config->'extras') = 'array' then v_config->'extras' else '[]'::jsonb end
        ) s
        where public.sor_selector_covers(s, v_opp, e.id)
      )
    union
    select e.id from public.employees e
    where not coalesce(e.is_deleted, false)
      and exists (
        select 1 from jsonb_array_elements(coalesce(v_req.requesters, '[]'::jsonb)) s
        where public.sor_selector_covers(s, v_opp, e.id)
      )
    union
    select v_req.buyer_id where v_req.buyer_id is not null
  loop
    perform public._purchase_request_add_member(v_req.id, v_emp, v_actor);
  end loop;

  -- A top-up that gave a Buyer to a request that had none posts the same
  -- `buyer_set` event as Take / Set Buyer; the message trigger notifies them.
  if v_buyer_set then
    perform public._purchase_request_post_event(
      v_req.id, v_actor,
      format('%s was set as Buyer.', coalesce((select name from public.employees where id = v_req.buyer_id), 'Someone')),
      jsonb_build_object('event', 'buyer_set', 'buyer_id', v_req.buyer_id, 'previous_buyer_id', null)
    );
  end if;

  if v_created then
    insert into public.purchase_request_messages (request_id, author_id, content, metadata)
    values (v_req.id, v_actor, 'Purchase Request opened.', jsonb_build_object('event', 'opened'));
  end if;

  update public.sor_action_runs
  set outcome = 'created', purchase_request_id = v_req.id
  where id = p_run_id;

  return v_req.id;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.sor_participant_items(p_opportunity_id uuid)
 RETURNS TABLE(id uuid, opportunity_id uuid, product_name text, unit text, quantity numeric, sort_order integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select i.id, i.opportunity_id, i.product_name, i.unit, i.quantity, i.sort_order
  from public.sales_opportunity_items i
  where i.opportunity_id = p_opportunity_id
    and public.sor_access_level(p_opportunity_id) in ('full', 'participant')
$function$
;
CREATE OR REPLACE FUNCTION public.sor_participant_record(p_opportunity_id uuid)
 RETURNS TABLE(id uuid, opportunity_no text, client_name text, contact_person text, project_title text, project_type text, sales_reference text, status text, lost_reason text, registration_date date, expected_award_date date, po_date date, lead_source text, lead_source_detail text, itb_number text, itb_exempt boolean, is_scratch boolean, sale_type_id uuid, flow_stage_id uuid, flow_snapshot_id uuid, registered_by uuid, deal_owner_id uuid, closing_sales_id uuid, support_sales_1_id uuid, support_sales_2_id uuid, sales_director_id uuid)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select
    o.id,
    o.opportunity_no,
    o.client_name,
    o.contact_person,
    o.project_title,
    o.project_type,
    o.sales_reference,
    o.status,
    o.lost_reason,
    o.registration_date,
    o.expected_award_date,
    o.po_date,
    o.lead_source,
    o.lead_source_detail,
    o.itb_number,
    o.itb_exempt,
    o.is_scratch,
    o.sale_type_id,
    o.flow_stage_id,
    o.flow_snapshot_id,
    o.registered_by,
    o.deal_owner_id,
    o.closing_sales_id,
    o.support_sales_1_id,
    o.support_sales_2_id,
    o.sales_director_id
  from public.sales_opportunities o
  where o.id = p_opportunity_id
    and public.sor_access_level(p_opportunity_id) in ('full', 'participant')
$function$
;
CREATE OR REPLACE FUNCTION public.sor_procurement_requests_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  actor      uuid := public.get_employee_id();
  is_manager boolean;
begin
  -- Nothing purchasing owns was touched: this is the requester amending their
  -- own ask, which is exactly what 0017 intends to allow.
  if new.outcome          is not distinct from old.outcome
 and new.outcome_note     is not distinct from old.outcome_note
 and new.po_number        is not distinct from old.po_number
 and new.odoo_product_ref is not distinct from old.odoo_product_ref
 and new.odoo_vendor      is not distinct from old.odoo_vendor
 and new.eta              is not distinct from old.eta
 and new.verification     is not distinct from old.verification
 and new.resolved_by      is not distinct from old.resolved_by
 and new.resolved_at      is not distinct from old.resolved_at
  then
    return new;
  end if;

  select (e.is_head or e.is_super_admin)
    into is_manager
    from public.employees e
   where e.id = actor;

  if old.assigned_to is not distinct from actor
     or coalesce(is_manager, false)
  then
    return new;
  end if;

  raise exception
    'Only the assigned purchaser can record the outcome, PO number or Odoo verification for a procurement request.'
    using errcode = 'check_violation';
end $function$
;
CREATE OR REPLACE FUNCTION public.sor_procurement_requests_touch()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  new.updated_at := now();
  return new;
end $function$
;
CREATE OR REPLACE FUNCTION public.sor_project_evaluations_touch()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  new.updated_at := now();
  return new;
end $function$
;
CREATE OR REPLACE FUNCTION public.sor_purchase_order_links_touch()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  new.updated_at := now();
  return new;
end $function$
;
CREATE OR REPLACE FUNCTION public.sor_purchase_request_item_states(p_opportunity_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_request_id uuid;
begin
  if public.get_employee_id() is null then
    raise exception 'sor_purchase_request_item_states: sign in first' using errcode = '42501';
  end if;
  if public.sor_access_level(p_opportunity_id) = 'none' then
    raise exception 'sor_purchase_request_item_states: you can''t see this SOR' using errcode = '42501';
  end if;

  select r.id into v_request_id
    from public.purchase_requests r
   where r.opportunity_id = p_opportunity_id;
  if v_request_id is null then
    return null;
  end if;

  return coalesce(
    (select jsonb_agg(
              jsonb_build_object(
                'status', i.status,
                'created_at', i.created_at,
                'status_changed_at', i.status_changed_at
              )
              order by i.created_at, i.id
            )
       from public.purchase_request_items i
      where i.request_id = v_request_id),
    '[]'::jsonb
  );
end;
$function$
;
CREATE OR REPLACE FUNCTION public.sor_purchase_request_overview(p_opportunity_id uuid)
 RETURNS TABLE(request_id uuid, buyer_id uuid, buyer_name text, buyer_avatar_path text, opened_visit_id uuid, created_at timestamp with time zone, items jsonb)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select
    r.id,
    r.buyer_id,
    b.name,
    b.avatar_path,
    r.opened_visit_id,
    r.created_at,
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', it.id,
        'name', it.name,
        'odoo_product_id', it.odoo_product_id,
        'quantity', it.quantity,
        'unit', it.unit,
        'status', it.status,
        'source', it.source,
        'created_at', it.created_at
      ) order by it.created_at, it.id)
      from public.purchase_request_items it
      where it.request_id = r.id
    ), '[]'::jsonb)
  from public.purchase_requests r
  left join public.employees b on b.id = r.buyer_id
  where r.opportunity_id = p_opportunity_id
    and public.can_read_purchase_request(r.id);
$function$
;
CREATE OR REPLACE FUNCTION public.sor_purge_opportunity(p_id uuid, p_confirm_text text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_actor uuid := public.get_employee_id();
  v_row record;
  v_task_count int;
  v_committee_task_count int;
  v_expect text;
begin
  if v_actor is null then
    raise exception 'Not signed in.' using errcode = '42501';
  end if;

  if not public.is_super_admin() then
    raise exception 'Only a Super Admin can permanently delete an SOR.' using errcode = '42501';
  end if;

  select * into v_row from public.sales_opportunities where id = p_id;
  if not found then
    raise exception 'That SOR no longer exists.' using errcode = '22023';
  end if;

  v_expect := coalesce(v_row.sales_reference, v_row.client_name);
  if p_confirm_text is null or btrim(p_confirm_text) <> v_expect then
    raise exception 'Confirmation text does not match — type % to permanently delete this SOR.', v_expect
      using errcode = '22023';
  end if;

  select count(*) into v_task_count from public.tasks where opportunity_id = p_id;
  select count(*) into v_committee_task_count from public.committee_tasks where opportunity_id = p_id;

  delete from public.sales_opportunities where id = p_id;

  return jsonb_build_object(
    'id', p_id,
    'client_name', v_row.client_name,
    'sales_reference', v_row.sales_reference,
    'tasks_unlinked', v_task_count,
    'committee_tasks_unlinked', v_committee_task_count
  );
end $function$
;
CREATE OR REPLACE FUNCTION public.sor_recalc_expected_value()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  target_id uuid := coalesce(new.opportunity_id, old.opportunity_id);
begin
  update public.sales_opportunities
  set expected_value = coalesce((
    select sum(quantity * unit_price)
    from public.sales_opportunity_items
    where opportunity_id = target_id
  ), 0)
  where id = target_id;
  return null; -- AFTER trigger; return value is ignored
end $function$
;
CREATE OR REPLACE FUNCTION public.sor_replace_items(p_opportunity_id uuid, p_items jsonb)
 RETURNS SETOF sales_opportunity_items
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if public.get_employee_id() is null then
    raise exception 'Not signed in.' using errcode = '42501';
  end if;

  -- Serializes concurrent replaces of the same opportunity's Product List
  -- (see 20260929030000). Locked before the authorization check so a caller
  -- who fails it still releases the lock immediately (the transaction ends).
  perform 1 from public.sales_opportunities where id = p_opportunity_id for update;

  if not public.sor_can_edit_opportunity(p_opportunity_id) then
    raise exception 'You cannot edit this opportunity''s Product List.' using errcode = '42501';
  end if;

  -- The "before" snapshot, handed back to the caller for its own change log
  -- -- captured here, bypassing RLS, rather than left to a separate
  -- SELECT the caller might not have visibility to run.
  return query
    select * from public.sales_opportunity_items where opportunity_id = p_opportunity_id;

  delete from public.sales_opportunity_items where opportunity_id = p_opportunity_id;

  insert into public.sales_opportunity_items (
    opportunity_id, product_name, unit, quantity, unit_price, sort_order, odoo_product_id
  )
  select
    p_opportunity_id,
    trim(item ->> 'product_name'),
    nullif(trim(item ->> 'unit'), ''),
    coalesce((item ->> 'quantity')::numeric, 0),
    coalesce((item ->> 'unit_price')::numeric, 0),
    (ordinality - 1)::int,
    nullif(item ->> 'odoo_product_id', '')::int
  from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) with ordinality as t(item, ordinality)
  where nullif(trim(item ->> 'product_name'), '') is not null;

  return;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.sor_request_packing_list(p_run_id uuid, p_config jsonb DEFAULT '{}'::jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_actor uuid := public.get_employee_id();
  v_run public.sor_action_runs;
  v_action jsonb;
  v_config jsonb;
  v_opp public.sales_opportunities;
  v_row public.packing_lists;
  v_notify uuid[];
  v_to uuid;
begin
  if v_actor is null then
    raise exception 'sor_request_packing_list: not signed in' using errcode = '42501';
  end if;

  select * into v_run from public.sor_action_runs where id = p_run_id for update;
  if v_run.id is null then
    raise exception 'sor_request_packing_list: run % not found', p_run_id;
  end if;
  -- `created` with a decision is a Decider's Create.
  if not (v_run.outcome = 'pending' or (v_run.outcome = 'created' and v_run.decided_by is not null)) then
    raise exception 'sor_request_packing_list: run % is not pending', p_run_id using errcode = '42501';
  end if;
  if v_run.packing_list_id is not null then
    raise exception 'sor_request_packing_list: run % already created its Packing List', p_run_id using errcode = '42501';
  end if;

  if not (
    public.sor_can_edit_opportunity(v_run.opportunity_id)
    or public.sor_access_level(v_run.opportunity_id) = 'full'
  ) then
    raise exception 'sor_request_packing_list: actor % lacks full access to opportunity %', v_actor, v_run.opportunity_id
      using errcode = '42501';
  end if;

  v_action := public._sor_action_run_saved_action(p_run_id);
  if v_action->>'kind' is distinct from 'request_packing_list' then
    raise exception 'sor_request_packing_list: run % is not a Request Packing List action', p_run_id
      using errcode = '22023';
  end if;
  v_config := coalesce(v_action->'config', '{}'::jsonb);

  select * into v_opp from public.sales_opportunities
   where id = v_run.opportunity_id and not coalesce(is_deleted, false);
  if v_opp.id is null then
    raise exception 'sor_request_packing_list: opportunity % not found', v_run.opportunity_id using errcode = '22023';
  end if;

  -- An open (unsigned) Packing List already asks the Warehouse to pack: do nothing.
  if exists (
    select 1 from public.packing_lists p
     where p.opportunity_id = v_opp.id and p.state = 'draft'
  ) then
    update public.sor_action_runs set outcome = 'created' where id = p_run_id;
    return null;
  end if;

  insert into public.packing_lists (opportunity_id, created_by)
  values (v_opp.id, v_actor)
  returning * into v_row;

  perform public._packing_list_event(v_row.id, v_actor, 'created', jsonb_build_object('number', v_row.number));

  -- Who to tell: the config's people and groups, else the Warehouse staff list.
  if jsonb_typeof(v_config->'notify') = 'array' and jsonb_array_length(v_config->'notify') > 0 then
    select coalesce(array_agg(e.id), '{}'::uuid[]) into v_notify
    from public.employees e
    where not coalesce(e.is_deleted, false)
      and e.id <> v_actor
      and exists (
        select 1 from jsonb_array_elements(v_config->'notify') s
        where public.sor_selector_covers(s, v_opp, e.id)
      );
  else
    v_notify := public._ipas_list_members(array['transmittal_warehouse'], v_actor);
  end if;

  foreach v_to in array coalesce(v_notify, '{}'::uuid[])
  loop
    insert into public.notifications (recipient_id, sender_id, type, title, message, reference_id)
    values (
      v_to,
      v_actor,
      'PACKING_LIST_REQUESTED',
      'Packing List requested',
      format('Please pack "%s": draft Packing List %s is ready.', coalesce(v_opp.project_title, 'this deal'), v_row.number),
      v_row.id::text
    );
  end loop;

  update public.sor_action_runs
  set outcome = 'created', packing_list_id = v_row.id
  where id = p_run_id;

  return v_row.id;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.sor_resume_stage_work(p_opportunity_id uuid)
 RETURNS sor_stage_visits
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_actor uuid := public.get_employee_id();
  v_new public.sor_stage_visits;
  v_old public.sor_stage_visits;
begin
  select * into v_new from public.sor_stage_visits
    where opportunity_id = p_opportunity_id and left_at is null and undone_at is null
    order by sequence desc limit 1;
  if v_new.id is null then
    raise exception 'Resume: this SOR is not on a Stage.' using errcode = 'P0001';
  end if;
  if v_new.return_choice is not null then
    raise exception 'Resume: this visit already recorded a Return choice.' using errcode = 'P0001';
  end if;
  if not (public.is_super_admin() or (v_actor is not null and v_new.entered_by = v_actor)) then
    raise exception 'Resume: only whoever made the move can resume previous work.' using errcode = '42501';
  end if;

  -- The earlier visit that holds this Stage's work: the latest before this one.
  select * into v_old from public.sor_stage_visits
    where opportunity_id = p_opportunity_id and flow_stage_id = v_new.flow_stage_id
      and undone_at is null and revert_choice is distinct from 'remove' and sequence < v_new.sequence
    order by sequence desc limit 1;
  if v_old.id is null then
    raise exception 'Resume: this is not a Return — there is no earlier visit to this Stage.' using errcode = 'P0001';
  end if;

  loop
    -- Held tasks reopen, due dates pushed back by the time they were held.
    update public.tasks
      set status = coalesce(held_prev_status, 'INCOMPLETE'),
          end_at = case when end_at is null then null else end_at + (now() - held_at) end,
          held_at = null, held_from_visit_id = null, held_prev_status = null
      where stage_visit_id = v_old.id and status = 'ON_HOLD' and held_at is not null;
    update public.committee_tasks
      set status = coalesce(held_prev_status, 'ACTIVE'),
          due_date = case when due_date is null then null else due_date + (now() - held_at) end,
          held_at = null, held_from_visit_id = null, held_prev_status = null
      where stage_visit_id = v_old.id and status = 'ON_HOLD' and held_at is not null;

    update public.tasks set stage_visit_id = v_new.id, carried_from_visit_id = v_old.id where stage_visit_id = v_old.id;
    update public.committee_tasks set stage_visit_id = v_new.id, carried_from_visit_id = v_old.id where stage_visit_id = v_old.id;
    update public.sor_condition_status set stage_visit_id = v_new.id, carried_from_visit_id = v_old.id where stage_visit_id = v_old.id;
    update public.sor_stage_field_values set stage_visit_id = v_new.id, carried_from_visit_id = v_old.id where stage_visit_id = v_old.id;
    update public.sor_action_runs set stage_visit_id = v_new.id, carried_from_visit_id = v_old.id, held_at = null where stage_visit_id = v_old.id;

    update public.sales_opportunity_logs
      set stage_visit_id = v_new.id,
          metadata = (metadata || jsonb_build_object('stageVisitId', v_new.id, 'carriedFromVisitId', v_old.id))
            || public.sor_retarget_attachment_metadata(metadata, v_old.id, v_new.id)
      where opportunity_id = p_opportunity_id
        and stage_visit_id = v_old.id
        and (metadata ? 'attachments' or metadata->>'event' in ('FOLLOW_UP_LOGGED', 'FOLLOW_UP_REMINDER'));

    update public.sor_stage_participants
      set opened_visit_id = v_new.id, closed_at = null, closed_reason = null
      where opened_visit_id = v_old.id and closed_reason = 'rule_met';

    update public.sor_stage_visits
      set resumed_at = now(), resumed_by = v_actor, resumed_into_visit_id = v_new.id
      where id = v_old.id;

    -- Only a visit that was itself a Resume can have had its carried work
    -- handed back to an earlier visit by a Revert; anything else ends here.
    exit when v_old.return_choice is distinct from 'resume';
    select * into v_old from public.sor_stage_visits
      where opportunity_id = p_opportunity_id and flow_stage_id = v_new.flow_stage_id
        and undone_at is null and revert_choice is distinct from 'remove'
        and resumed_at is null and sequence < v_old.sequence
      order by sequence desc limit 1;
    exit when v_old.id is null;
  end loop;

  update public.sor_stage_visits set return_choice = 'resume' where id = v_new.id
    returning * into v_new;

  return v_new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.sor_retarget_attachment_metadata(p_metadata jsonb, p_from_visit uuid, p_to_visit uuid)
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select case
    when p_metadata ? 'attachments' then jsonb_build_object(
      'attachments',
      coalesce(
        (
          select jsonb_agg(
            case when att->>'stageVisitId' = p_from_visit::text
              then att || jsonb_build_object('stageVisitId', p_to_visit)
              else att
            end
          )
          from jsonb_array_elements(p_metadata->'attachments') att
        ),
        '[]'::jsonb
      )
    )
    else '{}'::jsonb
  end
$function$
;
CREATE OR REPLACE FUNCTION public.sor_revert_needs_progress_choice(p_opportunity_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_actor uuid := public.get_employee_id();
  v_opp public.sales_opportunities;
  v_cur public.sor_stage_visits;
  v_reason text;
begin
  select * into v_opp from public.sales_opportunities
    where id = p_opportunity_id and coalesce(is_deleted, false) = false;
  if v_opp.id is null then
    return false;
  end if;

  select * into v_cur from public.sor_stage_visits
    where opportunity_id = p_opportunity_id and left_at is null and undone_at is null
    order by sequence desc limit 1;
  if v_cur.id is null then
    return false;
  end if;

  v_reason := case
    -- A Stage Action's own task counts the moment it exists (CONTEXT.md
    -- lists "the tasks its Stage Actions created" as Stage Work on its
    -- own); a task nobody added through a Stage Action only counts once
    -- it has progressed.
    when exists (
      select 1 from public.tasks t
      where t.stage_visit_id = v_cur.id and t.carried_from_visit_id is null
        and (t.stage_action_id is not null or t.status is distinct from 'INCOMPLETE')
    ) or exists (
      select 1 from public.committee_tasks t
      where t.stage_visit_id = v_cur.id and t.carried_from_visit_id is null
        and (t.stage_action_id is not null or t.status is distinct from 'ACTIVE')
    ) then 'a task was created there'
    when exists (select 1 from public.sor_condition_status s where s.stage_visit_id = v_cur.id and s.carried_from_visit_id is null)
      then 'a tickbox was ticked or a condition file given'
    when exists (
      select 1 from public.sales_opportunity_logs l, jsonb_array_elements(l.metadata->'attachments') att
      where l.opportunity_id = p_opportunity_id
        and l.stage_visit_id = v_cur.id
        and l.metadata ? 'attachments'
        and not (l.metadata ? 'carriedFromVisitId')
        and att ? 'conditionId'
    ) then 'a tickbox was ticked or a condition file given'
    when exists (select 1 from public.sor_stage_field_values f where f.stage_visit_id = v_cur.id and f.carried_from_visit_id is null)
      then 'a Stage Field value was saved'
    when exists (
      select 1 from public.sor_action_runs r where r.stage_visit_id = v_cur.id and r.carried_from_visit_id is null and r.decided_by is not null
    ) then 'an Optional Action was decided'
    when exists (
      select 1 from public.sales_opportunity_logs l
      where l.opportunity_id = p_opportunity_id
        and l.stage_visit_id = v_cur.id
        and l.metadata->>'event' = 'FOLLOW_UP_LOGGED'
        and not (l.metadata ? 'carriedFromVisitId')
    ) then 'a follow-up was logged'
    else null
  end;

  return v_reason is not null and not public.sor_is_stage_shut_out(v_opp, v_actor, v_cur.flow_stage_id);
end;
$function$
;
CREATE OR REPLACE FUNCTION public.sor_revert_stage(p_opportunity_id uuid, p_progress_choice text DEFAULT NULL::text)
 RETURNS sales_opportunities
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_actor uuid := public.get_employee_id();
  v_opp public.sales_opportunities;
  v_cur public.sor_stage_visits;
  v_prev public.sor_stage_visits;
  v_new_visit public.sor_stage_visits;
  v_latest_undone boolean;
  v_from_name text;
  v_to_name text;
  v_reason text;
  v_choice text;
  v_shut_out boolean;
  v_cancel text;
  v_content text;
  v_meta jsonb;
  v_title text;
  v_msg text;
  v_earlier uuid;
  v_earlier_snapshot uuid;
  v_old_fresh_id uuid;
  v_next_seq integer;
  v_restored record;
begin
  select * into v_opp from public.sales_opportunities
    where id = p_opportunity_id and coalesce(is_deleted, false) = false
    for update;
  if v_opp.id is null then
    raise exception 'Revert: that SOR could not be found.' using errcode = 'P0002';
  end if;

  select * into v_cur from public.sor_stage_visits
    where opportunity_id = p_opportunity_id and left_at is null and undone_at is null
    order by sequence desc limit 1;
  if v_cur.id is null then
    raise exception 'Revert: this SOR is not on a Stage.' using errcode = 'P0001';
  end if;

  select undone_at is not null into v_latest_undone from public.sor_stage_visits
    where opportunity_id = p_opportunity_id order by sequence desc limit 1;
  -- One step only: straight after a no-work Revert the latest visit is the
  -- undone one; after a Keep/Remove Revert it is the visit that Revert opened.
  if v_latest_undone or v_cur.opened_by_revert then
    raise exception 'Revert: the last move was already reverted. Going further back takes a move.' using errcode = 'P0001';
  end if;

  select * into v_prev from public.sor_stage_visits
    where opportunity_id = p_opportunity_id and undone_at is null and sequence < v_cur.sequence
    order by sequence desc limit 1;
  if v_prev.id is null then
    raise exception 'Revert: this SOR has never moved, so there is nothing to revert.' using errcode = 'P0001';
  end if;

  if not (
    public.is_super_admin()
    or (v_actor is not null and (v_cur.entered_by = v_actor or v_opp.deal_owner_id = v_actor))
  ) then
    raise exception 'Revert: only whoever made the last move, the Deal Owner, or a Super Admin can revert it.' using errcode = '42501';
  end if;

  select name into v_from_name from public.flow_stages where id = v_cur.flow_stage_id;
  select name into v_to_name from public.flow_stages where id = v_prev.flow_stage_id;

  -- Stage Work done on the Stage being left: a progress choice decides it.
  -- A Stage Action's own task counts the moment it exists — CONTEXT.md
  -- lists "the tasks its Stage Actions created" as Stage Work on its own,
  -- no requirement that anyone has acted on it yet; a task nobody added
  -- through a Stage Action only counts once it has progressed.
  v_reason := case
    when exists (
      select 1 from public.tasks t
      where t.stage_visit_id = v_cur.id and t.carried_from_visit_id is null
        and (t.stage_action_id is not null or t.status is distinct from 'INCOMPLETE')
    ) or exists (
      select 1 from public.committee_tasks t
      where t.stage_visit_id = v_cur.id and t.carried_from_visit_id is null
        and (t.stage_action_id is not null or t.status is distinct from 'ACTIVE')
    ) then 'a task was created there'
    when exists (select 1 from public.sor_condition_status s where s.stage_visit_id = v_cur.id and s.carried_from_visit_id is null)
      then 'a tickbox was ticked or a condition file given'
    when exists (
      select 1 from public.sales_opportunity_logs l, jsonb_array_elements(l.metadata->'attachments') att
      where l.opportunity_id = p_opportunity_id
        and l.stage_visit_id = v_cur.id
        and l.metadata ? 'attachments'
        and not (l.metadata ? 'carriedFromVisitId')
        and att ? 'conditionId'
    ) then 'a tickbox was ticked or a condition file given'
    when exists (select 1 from public.sor_stage_field_values f where f.stage_visit_id = v_cur.id and f.carried_from_visit_id is null)
      then 'a Stage Field value was saved'
    when exists (
      select 1 from public.sor_action_runs r where r.stage_visit_id = v_cur.id and r.carried_from_visit_id is null and r.decided_by is not null
    ) then 'an Optional Action was decided'
    when exists (
      select 1 from public.sales_opportunity_logs l
      where l.opportunity_id = p_opportunity_id
        and l.stage_visit_id = v_cur.id
        and l.metadata->>'event' = 'FOLLOW_UP_LOGGED'
        and not (l.metadata ? 'carriedFromVisitId')
    ) then 'a follow-up was logged'
    else null
  end;

  v_shut_out := public.sor_is_stage_shut_out(v_opp, v_actor, v_cur.flow_stage_id);

  if v_reason is not null then
    v_choice := case when v_shut_out then 'keep' else p_progress_choice end;
    if v_choice is null then
      raise exception 'Revert: Stage Work was done on % (%), so it cannot be reverted without choosing what to do with that work.',
        coalesce(v_from_name, 'that Stage'), v_reason using errcode = 'P0001';
    end if;
    if v_choice not in ('keep', 'remove') then
      raise exception 'Revert: the progress choice must be "keep" or "remove".' using errcode = 'P0001';
    end if;
  end if;

  perform set_config('app.sor_revert', 'on', true);

  update public.sales_opportunities
    set flow_stage_id = v_prev.flow_stage_id,
        contract_date = case when v_cur.contract_date_stamped then null else contract_date end
    where id = p_opportunity_id
    returning * into v_opp;

  -- A Terminal Stage cancelled every held task on the way in; the tasks it
  -- cancelled go back on hold, their hold intact, before anything below reads
  -- holds (the no-work path then brings back live what this move held).
  update public.tasks
    set status = 'ON_HOLD', cancel_reason = null, cancelled_by_visit_id = null
    where cancelled_by_visit_id = v_cur.id;
  update public.committee_tasks
    set status = 'ON_HOLD', cancel_reason = null, cancelled_by_visit_id = null
    where cancelled_by_visit_id = v_cur.id;

  -- ADR 0027 — reverting a Return undoes its Resume: the carried work moves
  -- back to the earlier visit, and its open action tasks go back on hold, as
  -- leaving that Stage put them. Done first, so nothing below treats carried
  -- work as the reverted move's own.
  -- (A Resume can carry from more than one earlier visit — see the header —
  -- so every one of them gets its work back. v_earlier ends as the latest,
  -- which the participant-window undo below repoints to.)
  for v_restored in
    select id, flow_snapshot_id from public.sor_stage_visits
      where resumed_into_visit_id = v_cur.id order by sequence
  loop
    v_earlier := v_restored.id;
    v_earlier_snapshot := v_restored.flow_snapshot_id;
    update public.tasks set stage_visit_id = carried_from_visit_id, carried_from_visit_id = null
      where stage_visit_id = v_cur.id and carried_from_visit_id = v_earlier;
    update public.committee_tasks set stage_visit_id = carried_from_visit_id, carried_from_visit_id = null
      where stage_visit_id = v_cur.id and carried_from_visit_id = v_earlier;
    update public.sor_condition_status set stage_visit_id = carried_from_visit_id, carried_from_visit_id = null
      where stage_visit_id = v_cur.id and carried_from_visit_id = v_earlier;
    update public.sor_stage_field_values set stage_visit_id = carried_from_visit_id, carried_from_visit_id = null
      where stage_visit_id = v_cur.id and carried_from_visit_id = v_earlier;
    update public.sor_action_runs set stage_visit_id = carried_from_visit_id, carried_from_visit_id = null
      where stage_visit_id = v_cur.id and carried_from_visit_id = v_earlier;
    -- Issue #412 — mirrors the forward carry above: an attachment's own
    -- stageVisitId moves back to v_earlier too, so a file Resume carried in
    -- and this Revert now uncarries reads unsatisfied on v_cur again (it
    -- never really happened there) and satisfied on v_earlier once more.
    update public.sales_opportunity_logs
      set stage_visit_id = v_earlier,
          metadata = ((metadata - 'carriedFromVisitId') || jsonb_build_object('stageVisitId', v_earlier))
            || public.sor_retarget_attachment_metadata(metadata, v_cur.id, v_earlier)
      where opportunity_id = p_opportunity_id and stage_visit_id = v_cur.id
        and metadata->>'carriedFromVisitId' = v_earlier::text;

    update public.tasks
      set held_prev_status = status, status = 'ON_HOLD', held_at = now(), held_from_visit_id = v_earlier
      where stage_visit_id = v_earlier and stage_action_id is not null
        and status in ('INCOMPLETE', 'AWAITING APPROVAL', 'NOT APPROVED')
        and not public.stage_action_carries_on(v_earlier_snapshot, stage_action_id);
    update public.committee_tasks
      set held_prev_status = status, status = 'ON_HOLD', held_at = now(), held_from_visit_id = v_earlier
      where stage_visit_id = v_earlier and stage_action_id is not null
        and status = 'ACTIVE'
        and not public.stage_action_carries_on(v_earlier_snapshot, stage_action_id);

    update public.sor_stage_visits set resumed_at = null, resumed_by = null, resumed_into_visit_id = null
      where id = v_earlier;
  end loop;

  -- ADR 0027 — reverting a Return undoes its Start fresh: the earlier visit's
  -- cancelled tasks/Group Tasks un-cancel back to their prior status. That
  -- earlier visit is found the same way sor_start_fresh_stage_work found it:
  -- the latest not-undone visit to the same Stage before the reverted one.
  -- Its action runs reopen later, once whatever the Start fresh's own visit
  -- created is closed off below — reopening here first could collide with a
  -- still-live run the Start fresh's re-fired Stage Action just created,
  -- against sor_action_runs_live_unique (#385).
  if v_cur.return_choice = 'start_fresh' then
    select id into v_old_fresh_id from public.sor_stage_visits
      where opportunity_id = p_opportunity_id and flow_stage_id = v_cur.flow_stage_id
        and undone_at is null and revert_choice is distinct from 'remove' and sequence < v_cur.sequence
      order by sequence desc limit 1;
    if v_old_fresh_id is not null then
      -- A task that was on hold when Start fresh cancelled it goes back on
      -- hold (the SOR is not on its Stage any more); a live one goes back live.
      update public.tasks
        set status = case when held_at is not null then 'ON_HOLD' else coalesce(held_prev_status, 'INCOMPLETE') end,
            held_prev_status = case when held_at is not null then held_prev_status else null end,
            cancel_reason = null
        where stage_visit_id = v_old_fresh_id and cancel_reason = 'Superseded by a fresh start.';
      update public.committee_tasks
        set status = case when held_at is not null then 'ON_HOLD' else coalesce(held_prev_status, 'ACTIVE') end,
            held_prev_status = case when held_at is not null then held_prev_status else null end,
            cancel_reason = null
        where stage_visit_id = v_old_fresh_id and cancel_reason = 'Superseded by a fresh start.';
    end if;
  end if;

  -- Everyone the reverted move notified hears to disregard it (collected before
  -- the work is cancelled; the notifying rows themselves are left as history).
  v_title := coalesce(v_opp.project_title, 'this SOR');
  v_msg := format('The move into %s on "%s" was reverted. Disregard what it sent you.', coalesce(v_from_name, 'a Stage'), v_title);
  insert into public.notifications (recipient_id, sender_id, type, title, message, reference_id)
  select distinct r.rid, v_actor, 'OPPORTUNITY_STAGE_REVERTED', 'Stage move reverted: ' || v_title, v_msg, p_opportunity_id::text
  from (
    select t.logged_by as rid from public.tasks t where t.stage_visit_id = v_cur.id
    union
    select m.employee_id from public.committee_task_members m
      join public.committee_tasks ct on ct.id = m.committee_task_id where ct.stage_visit_id = v_cur.id
    union
    select n.recipient_id from public.notifications n
      where n.type = 'OPPORTUNITY_ACTION_DECISION_DUE' and n.reference_id = p_opportunity_id::text
        and n.created_at >= v_cur.entered_at
  ) r
  where r.rid is not null and r.rid is distinct from v_actor;

  if v_reason is not null then
    -- Issue #392 — the choice decides the left visit's own work; either way a
    -- fresh visit on the earlier Stage resumes that Stage's own earlier work.
    -- Either way the left visit stands (left, not undone): the History still
    -- shows who did what, even when that work was removed.
    update public.sor_stage_visits
      set revert_choice = v_choice, left_at = now(), left_by = v_actor
      where id = v_cur.id;

    if v_choice = 'keep' then
      -- Held exactly as leaving the Stage holds (record_stage_visit): open
      -- Stage Action tasks, except those whose action carries on past the Stage.
      update public.tasks
        set held_prev_status = status, status = 'ON_HOLD', held_at = now(), held_from_visit_id = v_cur.id
        where stage_visit_id = v_cur.id and carried_from_visit_id is null and stage_action_id is not null
          and status in ('INCOMPLETE', 'AWAITING APPROVAL', 'NOT APPROVED')
          and not public.stage_action_carries_on(v_cur.flow_snapshot_id, stage_action_id);
      update public.committee_tasks
        set held_prev_status = status, status = 'ON_HOLD', held_at = now(), held_from_visit_id = v_cur.id
        where stage_visit_id = v_cur.id and carried_from_visit_id is null and stage_action_id is not null
          and status = 'ACTIVE'
          and not public.stage_action_carries_on(v_cur.flow_snapshot_id, stage_action_id);

      -- Issue #405, S94005 — a still-pending Optional Action is Stage Work
      -- too (kept alongside the tasks above): held, not decidable, until
      -- Resume brings it back (sor_resume_stage_work clears held_at).
      update public.sor_action_runs
        set held_at = now()
        where stage_visit_id = v_cur.id and carried_from_visit_id is null
          and outcome = 'pending' and closed_off_at is null and held_at is null;
    else
      v_cancel := format('Cancelled: the Revert out of %s removed its progress.', coalesce(v_from_name, 'this Stage'));
      update public.tasks set status = 'DELETED', cancel_reason = v_cancel
        where stage_visit_id = v_cur.id and carried_from_visit_id is null and status not in ('COMPLETED', 'DELETED');
      update public.committee_tasks set status = 'CANCELLED', cancel_reason = v_cancel
        where stage_visit_id = v_cur.id and carried_from_visit_id is null and status in ('ACTIVE', 'ON_HOLD');
      update public.sor_action_runs
        set closed_off_at = now(), closed_off_reason = 'reverted'
        where stage_visit_id = v_cur.id and carried_from_visit_id is null and closed_off_at is null;
    end if;

    select coalesce(max(sequence), 0) + 1 into v_next_seq from public.sor_stage_visits where opportunity_id = p_opportunity_id;
    insert into public.sor_stage_visits (opportunity_id, flow_stage_id, flow_snapshot_id, sequence, entered_at, entered_by, opened_by_revert)
    values (p_opportunity_id, v_prev.flow_stage_id, v_prev.flow_snapshot_id, v_next_seq, now(), v_actor, true)
    returning * into v_new_visit;

    -- v_prev is exactly the visit sor_resume_stage_work looks for: the latest
    -- visit to this Stage before the one just opened, neither undone nor removed.
    perform public.sor_resume_stage_work(p_opportunity_id);

    -- The left visit stands, so windows its own rule closed stay closed. A
    -- Terminal Stage closes every window regardless of rule; one whose rule the
    -- move into it did not meet reopens now the SOR is live again.
    update public.sor_stage_participants p
      set closed_at = null, closed_reason = null
      from public.sor_stage_visits opened
      where p.opportunity_id = p_opportunity_id
        and p.closed_reason = 'terminal' and p.closed_at >= v_cur.entered_at
        and opened.id = p.opened_visit_id
        and not (
          (p.until_rule = 'stage_left' and opened.flow_stage_id = v_prev.flow_stage_id)
          or (p.until_rule = 'stage_entered' and p.until_stage_id = v_cur.flow_stage_id)
          or (p.until_rule = 'later_stage_left' and p.until_stage_id = v_prev.flow_stage_id)
        );
  else
    -- Left as well as undone, so the reopened earlier visit is the only open
    -- one: every reader of "the current visit" by left_at finds it.
    update public.sor_stage_visits
      set undone_at = now(), undone_by = v_actor, left_at = now(), left_by = v_actor
      where id = v_cur.id;

    update public.sor_stage_visits
      set left_at = null, left_by = null
      where id = v_prev.id;

    -- Work the reverted move put on hold comes straight back.
    update public.tasks
      set status = coalesce(held_prev_status, 'INCOMPLETE'), held_at = null, held_from_visit_id = null, held_prev_status = null
      where held_from_visit_id = v_prev.id and status = 'ON_HOLD' and held_at >= v_cur.entered_at;
    update public.committee_tasks
      set status = coalesce(held_prev_status, 'ACTIVE'), held_at = null, held_from_visit_id = null, held_prev_status = null
      where held_from_visit_id = v_prev.id and status = 'ON_HOLD' and held_at >= v_cur.entered_at;

    update public.tasks set status = 'DELETED', cancel_reason = format('Cancelled: the move into %s was reverted.', coalesce(v_from_name, 'this Stage'))
      where stage_visit_id = v_cur.id;

    update public.committee_tasks set status = 'CANCELLED', cancel_reason = format('Cancelled: the move into %s was reverted.', coalesce(v_from_name, 'this Stage'))
      where stage_visit_id = v_cur.id;

    update public.sor_action_runs
      set closed_off_at = now(), closed_off_reason = 'reverted'
      where stage_visit_id = v_cur.id and closed_off_at is null;

    -- Issue #405 — leaving v_prev for v_cur (the move now being undone) auto-
    -- skipped whatever of v_prev's Optional Actions was still pending
    -- (opportunityService.js step 2b). Nothing else sets outcome 'skipped'
    -- without a decider, so this is exactly (and only) that skip, undone.
    for v_restored in
      update public.sor_action_runs
        set outcome = 'pending', held_at = null
        where stage_visit_id = v_prev.id and outcome = 'skipped'
          and decided_by is null and closed_off_at is null
        returning id, stage_id, action_id
    loop
      insert into public.sales_opportunity_logs (opportunity_id, author_id, type, content, metadata)
      values (
        p_opportunity_id, v_actor, 'SYSTEM',
        format('Optional Action restored to pending: reverting the move out of %s undid its skip.', coalesce(v_to_name, 'that Stage')),
        jsonb_build_object('event', 'ACTION_RUN_RESTORED', 'runId', v_restored.id, 'stageId', v_restored.stage_id, 'actionId', v_restored.action_id)
      );
    end loop;

    -- Access windows stand as they did before the erased move: what it (and
    -- this Revert's own stage change) closed by rule reopens, and what was
    -- opened on the erased visit closes.
    update public.sor_stage_participants
      set closed_at = null, closed_reason = null
      where opportunity_id = p_opportunity_id
        and closed_reason in ('rule_met', 'terminal') and closed_at >= v_cur.entered_at
        and opened_visit_id <> v_cur.id;
    update public.sor_stage_participants
      set closed_at = now(), closed_reason = 'reverted'
      where opened_visit_id = v_cur.id and closed_at is null;
  end if;

  -- #403 — the window Resume reopened on v_cur closes again and moves back
  -- to v_earlier, exactly mirroring the ADR 0027 task/condition/field undo
  -- above. Done last, after both branches' own window updates: the no-work
  -- branch's blanket reopen above (closed_reason in ('rule_met', 'terminal')
  -- and opened_visit_id <> v_cur.id) would otherwise immediately undo this
  -- one, since by the time it runs this window's opened_visit_id already
  -- points at v_earlier. Not `closed_at is null`: the flow_stage_id update
  -- near the top of this function already fired
  -- close_stage_participant_windows(), which closed a "stage_left" window on
  -- v_cur (rule_met) before either branch above ran — the same window this
  -- clause needs to catch and repoint. A "terminal" close is excluded, same
  -- guard sor_resume_stage_work uses: that decision stands independent of
  -- this move.
  if v_earlier is not null then
    update public.sor_stage_participants
      set opened_visit_id = v_earlier, closed_at = now(), closed_reason = 'rule_met'
      where opened_visit_id = v_cur.id and closed_reason is distinct from 'terminal';
  end if;

  -- A "keep" choice leaves whatever the Start fresh re-fired on v_cur live
  -- (kept work, not closed off, exactly like any other kept Optional Action —
  -- resumable later). Reopening the earlier run too would then double up a
  -- live run for the same Stage Action, against sor_action_runs_live_unique
  -- (#385); the earlier run stays closed off in that one case, since v_cur's
  -- still-live run already occupies its slot.
  if v_old_fresh_id is not null then
    update public.sor_action_runs r
      set closed_off_at = null, closed_off_reason = null
      where r.stage_visit_id = v_old_fresh_id and r.closed_off_reason = 'start_fresh'
        and not exists (
          select 1 from public.sor_action_runs live
          where live.opportunity_id = r.opportunity_id and live.stage_id = r.stage_id
            and live.action_id = r.action_id and live.closed_off_at is null
        );
  end if;

  perform set_config('app.sor_revert', 'off', true);

  v_content := format('Stage reverted: %s → %s', coalesce(v_from_name, '—'), coalesce(v_to_name, '—'))
    || case when v_cur.contract_date_stamped then ' (Contract Date cleared)' else '' end
    || case
         when v_reason is not null and v_choice = 'keep' then ' (kept the earlier progress)'
         when v_reason is not null and v_choice = 'remove' then ' (removed the earlier progress)'
         else ''
       end;
  v_meta := jsonb_build_object(
    'event', 'STAGE_REVERTED',
    'from', v_cur.flow_stage_id,
    'to', v_prev.flow_stage_id,
    'employeeId', v_actor,
    'clearedContractDate', coalesce(v_cur.contract_date_stamped, false),
    'progressChoice', case when v_reason is not null then v_choice else null end
  );

  insert into public.sales_opportunity_logs (opportunity_id, author_id, type, content, metadata)
  values (p_opportunity_id, v_actor, 'SYSTEM', v_content, v_meta);

  insert into public.system_audit_logs (author_id, entity_type, entity_id, content, type, metadata)
  values (v_actor, 'OPPORTUNITY', p_opportunity_id::text, v_content, 'SYSTEM', v_meta);

  return v_opp;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.sor_run_stage_actions(p_opportunity_id uuid, p_stage_id uuid, p_stage_visit_id uuid, p_actions jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_actor uuid := public.get_employee_id();
  v_action jsonb;
  v_run public.sor_action_runs;
  v_decider_id text;
  v_failed text[] := '{}';
  v_created jsonb[] := '{}';
  v_project_title text;
begin
  if v_actor is null then
    raise exception 'sor_run_stage_actions: not signed in' using errcode = '42501';
  end if;

  if not (
    public.sor_can_edit_opportunity(p_opportunity_id)
    or public.sor_access_level(p_opportunity_id) = 'full'
  ) then
    raise exception 'sor_run_stage_actions: actor % lacks full access to opportunity %', v_actor, p_opportunity_id
      using errcode = '42501';
  end if;

  select project_title into v_project_title from public.sales_opportunities where id = p_opportunity_id;

  for v_action in select * from jsonb_array_elements(coalesce(p_actions, '[]'::jsonb))
  loop
    v_run := public.sor_begin_action_run(
      p_opportunity_id,
      p_stage_id,
      (v_action->>'action_id')::uuid,
      p_stage_visit_id,
      case when (v_action->>'confirm')::boolean then v_action->'decider' else null end
    );
    if v_run.outcome <> 'pending' then
      continue;
    end if;

    if (v_action->>'confirm')::boolean then
      for v_decider_id in select * from jsonb_array_elements_text(coalesce(v_action->'decider_ids', '[]'::jsonb))
      loop
        insert into public.notifications (recipient_id, sender_id, type, title, message, reference_id)
        values (
          v_decider_id::uuid,
          v_actor,
          'OPPORTUNITY_ACTION_DECISION_DUE',
          coalesce(v_action->>'notification_title', v_action->>'name', 'Stage Action'),
          format(
            'A Stage Action on "%s" (%s) needs your decision: Create or Skip.',
            coalesce(v_project_title, v_action->>'name', 'this deal'),
            coalesce(v_action->>'stage_name', '')
          ),
          p_opportunity_id::text
        );
      end loop;
      continue;
    end if;

    begin
      if v_action->>'kind' = 'create_individual_task' then
        perform public.sor_create_stage_action_task(
          v_run.id,
          v_action->>'task_description',
          v_action->>'project_title',
          v_action->>'category_id',
          nullif(v_action->>'logged_by', '')::uuid,
          coalesce(v_action->>'priority', 'MEDIUM'),
          v_action->'checklist',
          nullif(v_action->>'end_at', '')::timestamptz,
          nullif(v_action->>'reported_to', '')::uuid
        );
        v_created := v_created || jsonb_build_object(
          'action_id', v_action->>'action_id',
          'kind', 'create_individual_task',
          'task_id', (select task_id from public.sor_action_runs where id = v_run.id)
        );
      elsif v_action->>'kind' = 'create_group_task' then
        perform public.sor_create_stage_group_task_action(
          v_run.id,
          v_action->>'group_title',
          v_action->>'group_description',
          coalesce(v_action->'members', '[]'::jsonb),
          nullif(v_action->>'due_date', '')::timestamptz,
          nullif(v_action->>'template_id', '')::uuid,
          case
            when jsonb_typeof(v_action->'tag_ids') = 'array' then
              (select array_agg(t::uuid) from jsonb_array_elements_text(v_action->'tag_ids') t)
            else null
          end,
          nullif(v_action->>'created_by', '')::uuid
        );
        v_created := v_created || jsonb_build_object(
          'action_id', v_action->>'action_id',
          'kind', 'create_group_task',
          'group_task_id', (select group_task_id from public.sor_action_runs where id = v_run.id)
        );
      elsif v_action->>'kind' = 'open_purchase_request' then
        v_created := v_created || jsonb_build_object(
          'action_id', v_action->>'action_id',
          'kind', 'open_purchase_request',
          'request_id', public.sor_open_purchase_request(v_run.id, coalesce(v_action->'purchase_request', '{}'::jsonb))
        );
      elsif v_action->>'kind' = 'open_costing_matrix' then
        v_created := v_created || jsonb_build_object(
          'action_id', v_action->>'action_id',
          'kind', 'open_costing_matrix',
          'matrix_id', public.sor_open_costing_matrix(v_run.id, '{}'::jsonb)
        );
      elsif v_action->>'kind' = 'request_packing_list' then
        v_created := v_created || jsonb_build_object(
          'action_id', v_action->>'action_id',
          'kind', 'request_packing_list',
          'packing_list_id', public.sor_request_packing_list(v_run.id, '{}'::jsonb)
        );
      else
        raise exception 'sor_run_stage_actions: no builder for kind %', v_action->>'kind';
      end if;
    exception when others then
      perform public.sor_finish_action_run(v_run.id, 'failed');
      v_failed := array_append(v_failed, coalesce(v_action->>'name', 'Stage Action'));
    end;
  end loop;

  return jsonb_build_object('failed', to_jsonb(v_failed), 'created', to_jsonb(v_created));
end;
$function$
;
CREATE OR REPLACE FUNCTION public.sor_selector_covers(p_selector jsonb, p_opp sales_opportunities, p_employee_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select case p_selector->>'type'
    when 'everyone' then exists (
      select 1 from public.employees e
      where e.id = p_employee_id
        and coalesce(e.is_deleted, false) = false
    )
    when 'employee' then (p_selector->>'id')::uuid = p_employee_id
    when 'group' then exists (
      select 1 from public.employee_group_member_ids((p_selector->>'id')::uuid) gm
      where gm = p_employee_id
    )
    when 'team' then exists (
      select 1 from public.employees e
      where e.id = p_employee_id
        and upper(trim(e.sub_department)) = upper(trim(p_selector->>'team'))
    )
    when 'department' then exists (
      select 1 from public.employees e
      where e.id = p_employee_id
        and coalesce(e.is_deleted, false) = false
        and nullif(upper(trim(p_selector->>'department')), '') is not null
        and upper(trim(e.department)) = upper(trim(p_selector->>'department'))
    )
    when 'role' then (
      (p_selector->>'role' = 'deal_owner' and p_opp.deal_owner_id = p_employee_id)
      or (p_selector->>'role' = 'closing_sales' and p_opp.closing_sales_id = p_employee_id)
      or (p_selector->>'role' = 'sales_director' and p_opp.sales_director_id = p_employee_id)
      or (p_selector->>'role' = 'registrar' and p_opp.registered_by = p_employee_id)
      or (
        p_selector->>'role' = 'support_sales'
        and (p_opp.support_sales_1_id = p_employee_id or p_opp.support_sales_2_id = p_employee_id)
      )
    )
    else false
  end
$function$
;
CREATE OR REPLACE FUNCTION public.sor_set_log_stage_visit()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if NEW.stage_visit_id is null then
    select id into NEW.stage_visit_id
    from public.sor_stage_visits
    where opportunity_id = NEW.opportunity_id and left_at is null
    limit 1;
  end if;
  return NEW;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.sor_start_fresh_stage_work(p_opportunity_id uuid)
 RETURNS sor_stage_visits
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_actor uuid := public.get_employee_id();
  v_new public.sor_stage_visits;
  v_old public.sor_stage_visits;
  v_cancel text := 'Superseded by a fresh start.';
begin
  select * into v_new from public.sor_stage_visits
    where opportunity_id = p_opportunity_id and left_at is null and undone_at is null
    order by sequence desc limit 1;
  if v_new.id is null then
    raise exception 'Start fresh: this SOR is not on a Stage.' using errcode = 'P0001';
  end if;
  if v_new.return_choice is not null then
    raise exception 'Start fresh: this visit already recorded a Return choice.' using errcode = 'P0001';
  end if;
  if not (public.is_super_admin() or (v_actor is not null and v_new.entered_by = v_actor)) then
    raise exception 'Start fresh: only whoever made the move can choose it.' using errcode = '42501';
  end if;

  -- The earlier visit that holds this Stage's work: the latest before this one.
  select * into v_old from public.sor_stage_visits
    where opportunity_id = p_opportunity_id and flow_stage_id = v_new.flow_stage_id
      and undone_at is null and revert_choice is distinct from 'remove' and sequence < v_new.sequence
    order by sequence desc limit 1;
  if v_old.id is null then
    raise exception 'Start fresh: this is not a Return — there is no earlier visit to this Stage.' using errcode = 'P0001';
  end if;

  -- Live and held tasks are cancelled; a completed one stands as it was. The
  -- prior status is kept (not overwritten if a hold already recorded one) so
  -- reverting a Start fresh can restore it exactly, mirroring the on-hold column.
  update public.tasks
    set held_prev_status = coalesce(held_prev_status, status), status = 'DELETED', cancel_reason = v_cancel
    where stage_visit_id = v_old.id and status not in ('COMPLETED', 'DELETED');
  update public.committee_tasks
    set held_prev_status = coalesce(held_prev_status, status), status = 'CANCELLED', cancel_reason = v_cancel
    where stage_visit_id = v_old.id and status in ('ACTIVE', 'ON_HOLD');

  -- Closed off, not deleted, so the earlier visit's history still shows them —
  -- and #385's live-unique index lets sor_begin_action_run start a fresh one.
  update public.sor_action_runs
    set closed_off_at = now(), closed_off_reason = 'start_fresh'
    where stage_visit_id = v_old.id and closed_off_at is null;

  update public.sor_stage_visits set return_choice = 'start_fresh' where id = v_new.id
    returning * into v_new;

  return v_new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.sor_visible_visit_ids(p_opportunity_id uuid)
 RETURNS SETOF uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select v.id
  from public.sor_stage_visits v
  where v.opportunity_id = p_opportunity_id
    and v.undone_at is null
    and public.is_super_admin()

  union

  select v.id
  from public.sor_stage_visits v
  join public.sales_opportunities o on o.id = v.opportunity_id
  where v.opportunity_id = p_opportunity_id
    and v.undone_at is null
    and not public.is_super_admin()
    and (
      public.sor_is_deal_team(o, public.get_employee_id())
      or public.sor_always_sees(o, public.get_employee_id())
    )
    and not public.sor_is_stage_shut_out(o, public.get_employee_id(), v.flow_stage_id)

  union

  select v.id
  from public.sor_stage_participants p
  join public.sor_stage_visits opened on opened.id = p.opened_visit_id
  join public.sor_stage_visits v on v.opportunity_id = p.opportunity_id
  where p.opportunity_id = p_opportunity_id
    and p.employee_id = public.get_employee_id()
    and not public.is_super_admin()
    and opened.undone_at is null
    and v.undone_at is null
    and (
      (p.closed_at is null and v.sequence >= opened.sequence)
      or (
        p.closed_at is not null
        and v.sequence >= opened.sequence
        and v.sequence <= (
          select max(closing.sequence)
          from public.sor_stage_visits closing
          where closing.opportunity_id = p.opportunity_id
            and closing.sequence >= opened.sequence
            and closing.left_at is not null
            and closing.left_at <= p.closed_at
        )
      )
    )

  union

  -- Mention Windows: exactly the visit each Mention was made on, open or since
  -- left (a left one is the locked view's read-only look).
  select v.id
  from public.sor_mention_viewers m
  join public.sor_stage_visits v on v.id = m.stage_visit_id
  where m.opportunity_id = p_opportunity_id
    and m.employee_id = public.get_employee_id()
    and not public.is_super_admin()
    and v.undone_at is null
    -- TIGHTEN(mention): a Restricted Stage stays shut to a Mention. Uncomment:
    -- and not exists (
    --   select 1 from public.sales_opportunities o
    --   where o.id = v.opportunity_id
    --     and public.sor_is_stage_shut_out(o, public.get_employee_id(), v.flow_stage_id)
    -- )
$function$
;
CREATE OR REPLACE FUNCTION public.sor_visit_audience(p_opportunity_id uuid, p_visit_id uuid)
 RETURNS SETOF uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with allowed as (
    select public.sor_access_level(p_opportunity_id) in ('full', 'participant') as ok
  )
  select e.id from public.employees e, allowed
  where allowed.ok and e.is_super_admin

  union

  select e.id
  from public.employees e
  join public.sales_opportunities o on o.id = p_opportunity_id
  join public.sor_stage_visits v on v.id = p_visit_id and v.opportunity_id = p_opportunity_id
  , allowed
  where allowed.ok
    and v.undone_at is null
    and (
      public.sor_is_deal_team(o, e.id)
      or public.sor_always_sees(o, e.id)
    )
    and not public.sor_is_stage_shut_out(o, e.id, v.flow_stage_id)

  union

  select p.employee_id
  from public.sor_stage_participants p
  join public.sor_stage_visits opened on opened.id = p.opened_visit_id
  join public.sor_stage_visits v on v.id = p_visit_id and v.opportunity_id = p.opportunity_id
  , allowed
  where allowed.ok
    and p.opportunity_id = p_opportunity_id
    and p.closed_at is null
    and opened.undone_at is null
    and v.undone_at is null
    and v.sequence >= opened.sequence

  union

  select m.employee_id
  from public.sor_mention_viewers m
  join public.sor_stage_visits v on v.id = m.stage_visit_id
  , allowed
  where allowed.ok
    and m.opportunity_id = p_opportunity_id
    and m.stage_visit_id = p_visit_id
    and v.left_at is null
    and v.undone_at is null
$function$
;
CREATE OR REPLACE FUNCTION public.stage_action_carries_on(p_snapshot_id uuid, p_action_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce((
    select (a.value->'config'->>'carries_on') = 'true'
    from public.flow_snapshots s,
      lateral (
        select value from jsonb_array_elements(
          case jsonb_typeof(s.snapshot_data->'actions')
            when 'array' then s.snapshot_data->'actions'
            when 'object' then (
              select coalesce(jsonb_agg(e), '[]'::jsonb)
              from jsonb_each(s.snapshot_data->'actions') g, jsonb_array_elements(g.value) e
            )
            else '[]'::jsonb
          end
        ) value
      ) a
    where s.id = p_snapshot_id and a.value->>'id' = p_action_id::text
    limit 1
  ), false);
$function$
;
CREATE OR REPLACE FUNCTION public.submit_bug_report(p_description text, p_attachments jsonb DEFAULT '[]'::jsonb, p_page_url text DEFAULT NULL::text, p_user_agent text DEFAULT NULL::text, p_app_version text DEFAULT NULL::text, p_environment text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_reporter uuid;
  v_attachments jsonb := coalesce(p_attachments, '[]'::jsonb);
  v_id uuid;
begin
  v_reporter := get_employee_id();
  if v_reporter is null then
    raise exception 'Not signed in as a recognized employee.';
  end if;

  if length(btrim(coalesce(p_description, ''))) = 0 then
    raise exception 'Describe the bug before sending.';
  end if;

  if jsonb_typeof(v_attachments) <> 'array' then
    raise exception 'Attachments must be a list.';
  end if;
  if jsonb_array_length(v_attachments) > 5 then
    raise exception 'At most 5 attachments.';
  end if;
  if exists (
    select 1 from jsonb_array_elements(v_attachments) a
    where coalesce(a->>'path', '') not like v_reporter::text || '/%'
  ) then
    raise exception 'Attachment is not one of your uploads.';
  end if;

  insert into bug_reports (reporter_id, description, attachments, page_url, user_agent, app_version, environment)
  values (v_reporter, btrim(p_description), v_attachments, p_page_url, p_user_agent, p_app_version, p_environment)
  returning id into v_id;

  insert into notifications (recipient_id, sender_id, type, title, message, reference_id)
  select e.id, v_reporter, 'BUG_REPORT_SUBMITTED', 'New bug report',
         left(split_part(btrim(p_description), E'\n', 1), 140), v_id::text
  from employees e
  where (e.is_super_admin or e.has_bug_report_access)
    and not coalesce(e.is_deleted, false)
    and e.id <> v_reporter;

  return v_id;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.tasks_broadcast_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  begin
    perform realtime.send(
      jsonb_build_object('id', coalesce(new.id, old.id)),
      tg_op,
      'tasks-changes',
      true -- private: gated by the realtime.messages policy above, not public
    );
  exception when others then
    null;
  end;
  return null;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.toggle_chat_reaction(p_table text, p_message_id uuid, p_user_id uuid, p_emoji text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
    v_metadata jsonb;
    v_reactions jsonb;
    v_users jsonb;
    v_user_idx int;
BEGIN
    IF p_table = 'task_activity' THEN
        SELECT COALESCE(metadata, '{}'::jsonb) INTO v_metadata
        FROM public.task_activity WHERE id = p_message_id;
    ELSIF p_table = 'committee_task_activity' THEN
        SELECT COALESCE(metadata, '{}'::jsonb) INTO v_metadata
        FROM public.committee_task_activity WHERE id = p_message_id;
    ELSE
        RAISE EXCEPTION 'Invalid table %', p_table;
    END IF;

    IF v_metadata IS NULL THEN
        RAISE EXCEPTION 'Message not found';
    END IF;

    v_reactions := COALESCE(v_metadata->'reactions', '{}'::jsonb);
    v_users := COALESCE(v_reactions->p_emoji, '[]'::jsonb);

    -- Find if user is in the array
    SELECT position - 1 INTO v_user_idx
    FROM jsonb_array_elements_text(v_users) WITH ORDINALITY arr(elem, position)
    WHERE elem = p_user_id::text;

    IF v_user_idx IS NOT NULL THEN
        -- Remove user
        v_users := v_users - v_user_idx;
        IF jsonb_array_length(v_users) = 0 THEN
            v_reactions := v_reactions - p_emoji;
        ELSE
            v_reactions := jsonb_set(v_reactions, ARRAY[p_emoji], v_users);
        END IF;
    ELSE
        -- Add user
        v_users := v_users || to_jsonb(p_user_id::text);
        v_reactions := jsonb_set(v_reactions, ARRAY[p_emoji], v_users);
    END IF;

    -- If reactions is empty, we can just remove the key, or leave it empty {}
    IF v_reactions = '{}'::jsonb THEN
        v_metadata := v_metadata - 'reactions';
    ELSE
        v_metadata := jsonb_set(v_metadata, ARRAY['reactions'], v_reactions);
    END IF;

    IF p_table = 'task_activity' THEN
        UPDATE public.task_activity SET metadata = v_metadata WHERE id = p_message_id;
    ELSIF p_table = 'committee_task_activity' THEN
        UPDATE public.committee_task_activity SET metadata = v_metadata WHERE id = p_message_id;
    END IF;

    RETURN v_metadata;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.transmittal_attach_evidence(p_stage_id uuid, p_kind text, p_path text, p_file_name text, p_mime text, p_size bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'storage'
AS $function$
declare
  v_actor uuid := public.get_employee_id();
  v_stage public.transmittal_stages;
  v_row public.transmittals;
  v_id uuid;
begin
  if v_actor is null then
    raise exception 'transmittal_attach_evidence: not signed in' using errcode = '42501';
  end if;

  select * into v_stage from public.transmittal_stages s where s.id = p_stage_id;
  if not found then
    raise exception 'transmittal_attach_evidence: that stage doesn''t exist' using errcode = '22023';
  end if;
  select * into v_row from public.transmittals t where t.id = v_stage.transmittal_id;

  if v_stage.completed_at is not null or v_row.state in ('closed', 'cancelled') then
    raise exception 'transmittal_attach_evidence: the stage of % is signed; its files can''t change', v_row.number
      using errcode = '42501';
  end if;
  if not public.transmittal_on_list(
       case when v_stage.stage = 'technical_inspection' then 'transmittal_technical' else 'transmittal_warehouse' end
     ) then
    raise exception 'transmittal_attach_evidence: only the stage''s list adds files' using errcode = '42501';
  end if;
  if p_kind not in ('picture', 'video') then
    raise exception 'transmittal_attach_evidence: a file is a picture or a video' using errcode = '22023';
  end if;
  if p_size is null or p_size <= 0 or p_size > 52428800 then
    raise exception 'transmittal_attach_evidence: a file is 50 MB or less' using errcode = '22023';
  end if;
  if p_path is null
     or public._pms_evidence_transmittal_id(p_path) is distinct from v_row.id
     or (storage.foldername(p_path))[2] is distinct from p_stage_id::text then
    raise exception 'transmittal_attach_evidence: that file isn''t stored for this stage' using errcode = '22023';
  end if;

  insert into public.pms_evidence (
    record_type, record_id, transmittal_id, kind, storage_path, file_name, mime_type, size_bytes, uploaded_by
  ) values (
    'transmittal_stage', p_stage_id, v_row.id, p_kind, p_path,
    coalesce(nullif(btrim(p_file_name), ''), 'file'), p_mime, p_size, v_actor
  )
  returning id into v_id;

  return jsonb_build_object('id', v_id, 'transmittal_id', v_row.id, 'stage_id', p_stage_id);
end;
$function$
;
CREATE OR REPLACE FUNCTION public.transmittal_can_prepare()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce(public.has_purchasing_access(), false)
    or public.transmittal_on_list('transmittal_warehouse')
    or public.transmittal_on_list('transmittal_logistics');
$function$
;
CREATE OR REPLACE FUNCTION public.transmittal_can_read(p_transmittal_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select public.ipas_can_read()
    or public.transmittal_on_list('transmittal_warehouse')
    or public.transmittal_on_list('transmittal_technical')
    or public.transmittal_on_list('transmittal_logistics')
    or public.transmittal_on_list('transmittal_check_by')
    or exists (
      select 1 from public.transmittals t
       where t.id = p_transmittal_id
         and t.prepared_by = public.get_employee_id()
    );
$function$
;
CREATE OR REPLACE FUNCTION public.transmittal_cancel(p_transmittal_id uuid, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_actor uuid := public.get_employee_id();
  v_row public.transmittals;
  v_reason text := nullif(btrim(p_reason), '');
begin
  if v_actor is null then
    raise exception 'transmittal_cancel: not signed in' using errcode = '42501';
  end if;

  select * into v_row from public.transmittals t where t.id = p_transmittal_id for update;
  if not found then
    raise exception 'transmittal_cancel: that Transmittal doesn''t exist' using errcode = '22023';
  end if;
  if not (v_row.prepared_by = v_actor or coalesce(public.has_purchasing_access(), false)) then
    raise exception 'transmittal_cancel: only the preparer or Purchasing cancels a slip' using errcode = '42501';
  end if;
  if v_row.state in ('closed', 'cancelled') then
    raise exception 'transmittal_cancel: % is already %', v_row.number, v_row.state using errcode = '22023';
  end if;
  if v_reason is null then
    raise exception 'transmittal_cancel: a cancel needs a reason' using errcode = '22023';
  end if;
  if exists (
       select 1 from public.transmittal_stages s
        where s.transmittal_id = p_transmittal_id and s.completed_at is not null
     ) then
    raise exception 'transmittal_cancel: % has a signed stage and can''t be cancelled', v_row.number
      using errcode = '42501';
  end if;

  update public.transmittals
     set state = 'cancelled',
         cancelled_by = v_actor,
         cancelled_at = now(),
         cancel_reason = v_reason
   where id = p_transmittal_id;

  perform public._transmittal_event(p_transmittal_id, v_actor, 'cancelled', jsonb_build_object(
    'number', v_row.number,
    'reason', v_reason,
    'from_state', v_row.state
  ));

  -- The preparer hears of a cancel by someone else; nobody hears their own.
  return jsonb_build_object(
    'id', p_transmittal_id,
    'number', v_row.number,
    'notify_id', case when v_row.prepared_by = v_actor then null else v_row.prepared_by end
  );
end;
$function$
;
CREATE OR REPLACE FUNCTION public.transmittal_check(p_transmittal_id uuid, p_slot integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_actor uuid := public.get_employee_id();
  v_row public.transmittals;
  v_open_stages int;
  v_po_lines int;
  v_closed boolean := false;
begin
  if v_actor is null then
    raise exception 'transmittal_check: not signed in' using errcode = '42501';
  end if;

  select * into v_row from public.transmittals t where t.id = p_transmittal_id for update;
  if not found then
    raise exception 'transmittal_check: that Transmittal doesn''t exist' using errcode = '22023';
  end if;
  if not public.transmittal_on_list('transmittal_check_by') then
    raise exception 'transmittal_check: only the Check by list signs a Transmittal' using errcode = '42501';
  end if;
  if p_slot is null or p_slot not in (1, 2) then
    raise exception 'transmittal_check: the slot is 1 or 2' using errcode = '22023';
  end if;
  if v_row.state <> 'awaiting_check' then
    raise exception 'transmittal_check: % is %, not awaiting Check by', v_row.number, v_row.state using errcode = '42501';
  end if;
  if v_row.prepared_by = v_actor then
    raise exception 'transmittal_check: the preparer can''t check their own slip' using errcode = '42501';
  end if;

  if p_slot = 1 and v_row.check_by_first_id is not null
     or p_slot = 2 and v_row.check_by_second_id is not null then
    raise exception 'transmittal_check: that Check by slot is signed already' using errcode = '22023';
  end if;
  if (v_row.check_by_first_id = v_actor and p_slot = 2)
     or (v_row.check_by_second_id = v_actor and p_slot = 1) then
    raise exception 'transmittal_check: the same person can''t sign both Check by slots' using errcode = '42501';
  end if;

  select count(*) into v_open_stages from public.transmittal_stages s
   where s.transmittal_id = p_transmittal_id and s.completed_at is null;
  if v_open_stages > 0 then
    raise exception 'transmittal_check: % has a stage still open', v_row.number using errcode = '22023';
  end if;

  select count(*) into v_po_lines from public.transmittal_lines l
   where l.transmittal_id = p_transmittal_id and l.kind = 'po_line';
  if v_po_lines > 0 and v_row.odoo_received_at is null then
    raise exception 'transmittal_check: % is a PO slip; record Received in Odoo first', v_row.number using errcode = '22023';
  end if;

  if p_slot = 1 then
    update public.transmittals
       set check_by_first_id = v_actor, check_by_first_at = now(), check_by_first_signature_declined = false
     where id = p_transmittal_id;
  else
    update public.transmittals
       set check_by_second_id = v_actor, check_by_second_at = now(), check_by_second_signature_declined = false
     where id = p_transmittal_id;
  end if;

  -- The second signature closes the slip.
  if (p_slot = 1 and v_row.check_by_second_id is not null)
     or (p_slot = 2 and v_row.check_by_first_id is not null) then
    v_closed := true;
    update public.transmittals
       set state = 'closed', closed_at = now()
     where id = p_transmittal_id;
  end if;

  perform public._transmittal_event(p_transmittal_id, v_actor,
    case when v_closed then 'closed' else 'check_signed' end,
    jsonb_build_object('number', v_row.number, 'slot', p_slot));

  return jsonb_build_object(
    'id', p_transmittal_id,
    'number', v_row.number,
    'slot', p_slot,
    'state', case when v_closed then 'closed' else 'awaiting_check' end,
    'closed', v_closed,
    'notify_id', case when v_closed then v_row.prepared_by else null end
  );
end;
$function$
;
CREATE OR REPLACE FUNCTION public.transmittal_check_signature(p_transmittal_id uuid, p_slot integer, p_decline boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_actor uuid := public.get_employee_id();
  v_row public.transmittals;
  v_decline boolean := coalesce(p_decline, false);
begin
  if v_actor is null then
    raise exception 'transmittal_check_signature: not signed in' using errcode = '42501';
  end if;
  if p_slot is null or p_slot not in (1, 2) then
    raise exception 'transmittal_check_signature: the slot is 1 or 2' using errcode = '22023';
  end if;

  select * into v_row from public.transmittals t where t.id = p_transmittal_id for update;
  if not found then
    raise exception 'transmittal_check_signature: that Transmittal doesn''t exist' using errcode = '22023';
  end if;
  if (case p_slot when 1 then v_row.check_by_first_id else v_row.check_by_second_id end) is distinct from v_actor then
    raise exception 'transmittal_check_signature: only the person who signed that Check by can decline or apply its signature'
      using errcode = '42501';
  end if;

  if p_slot = 1 then
    update public.transmittals set check_by_first_signature_declined = v_decline where id = p_transmittal_id;
  else
    update public.transmittals set check_by_second_signature_declined = v_decline where id = p_transmittal_id;
  end if;

  perform public._transmittal_event(p_transmittal_id, v_actor,
    case when v_decline then 'signature_declined' else 'signature_confirmed' end,
    jsonb_build_object('number', v_row.number, 'slot', p_slot, 'check_by', true));

  return jsonb_build_object('id', p_transmittal_id, 'number', v_row.number, 'slot', p_slot, 'declined', v_decline);
end;
$function$
;
CREATE OR REPLACE FUNCTION public.transmittal_children_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_id uuid := coalesce(new.transmittal_id, old.transmittal_id);
  v_state text;
  v_number text;
begin
  select state, number into v_state, v_number from public.transmittals where id = v_id;
  if v_state is distinct from 'draft' then
    raise exception 'transmittal: % is %, and its % can''t change', v_number, v_state, tg_table_name
      using errcode = '42501';
  end if;
  return coalesce(new, old);
end;
$function$
;
CREATE OR REPLACE FUNCTION public.transmittal_cleared_signatures_append_only()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  raise exception 'transmittal_cleared_signatures is append-only: history can''t be changed (% refused)', tg_op
    using errcode = '42501';
end;
$function$
;
CREATE OR REPLACE FUNCTION public.transmittal_complete_stage(p_transmittal_id uuid, p_stage text, p_other_signer_id uuid, p_other_signer_name text, p_remarks text, p_no_pictures_reason text, p_sign_as_second boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_actor uuid := public.get_employee_id();
  v_row public.transmittals;
  v_stage public.transmittal_stages;
  v_other_name text;
  v_reason text := nullif(btrim(coalesce(p_no_pictures_reason, '')), '');
  v_remarks text := nullif(btrim(coalesce(p_remarks, '')), '');
  v_unrated int;
  v_na int := 0;
  v_pictures int;
  v_next_state text;
  v_next_list text := null;
  v_next_ids jsonb := '[]'::jsonb;
  v_na_ids uuid[] := '{}';
  v_tech boolean := p_stage = 'technical_inspection';
  v_as_second boolean := coalesce(p_sign_as_second, false);
  v_actor_name text;
begin
  if v_actor is null then
    raise exception 'transmittal_complete_stage: not signed in' using errcode = '42501';
  end if;

  select * into v_row from public.transmittals t where t.id = p_transmittal_id for update;
  if not found then
    raise exception 'transmittal_complete_stage: that Transmittal doesn''t exist' using errcode = '22023';
  end if;
  if v_row.state in ('closed', 'cancelled') then
    raise exception 'transmittal_complete_stage: % is %', v_row.number, v_row.state using errcode = '42501';
  end if;
  if p_stage not in ('warehouse_checking', 'warehouse_releasing', 'technical_inspection') then
    raise exception 'transmittal_complete_stage: the stage is Warehouse checking, releasing or Technical inspection'
      using errcode = '22023';
  end if;
  if v_tech then
    if not public.transmittal_on_list('transmittal_technical') then
      raise exception 'transmittal_complete_stage: only the Technical list signs Technical inspection' using errcode = '42501';
    end if;
  elsif not public.transmittal_on_list('transmittal_warehouse') then
    raise exception 'transmittal_complete_stage: only the Warehouse list signs the Warehouse stages' using errcode = '42501';
  end if;

  select * into v_stage from public.transmittal_stages s
   where s.transmittal_id = p_transmittal_id and s.stage = p_stage
   for update;
  if not found then
    if p_stage = 'warehouse_releasing' and not v_row.check_technical then
      insert into public.transmittal_stages (transmittal_id, stage)
      values (p_transmittal_id, p_stage)
      returning * into v_stage;
    else
      raise exception 'transmittal_complete_stage: % has no % stage', v_row.number, p_stage using errcode = '22023';
    end if;
  end if;

  if v_stage.completed_at is not null then
    raise exception 'transmittal_complete_stage: the % stage of % is already signed', p_stage, v_row.number
      using errcode = '42501';
  end if;
  if p_stage = 'warehouse_checking' and v_row.state <> 'warehouse_checking' then
    raise exception 'transmittal_complete_stage: Warehouse checking is not open on %', v_row.number using errcode = '42501';
  end if;
  if p_stage = 'warehouse_releasing' and v_row.check_technical and v_row.state <> 'warehouse_releasing' then
    raise exception 'transmittal_complete_stage: releasing is not open on %', v_row.number using errcode = '42501';
  end if;
  if v_tech and v_row.state <> 'technical_inspection' then
    raise exception 'transmittal_complete_stage: Technical inspection is not open on %', v_row.number using errcode = '42501';
  end if;

  -- Releasing's caller is Released by: Received by is the receiving side.
  if v_as_second and p_stage = 'warehouse_releasing' then
    raise exception 'transmittal_complete_stage: the Warehouse signs releasing as Released by' using errcode = '22023';
  end if;

  -- The other signatory.
  if p_stage = 'warehouse_checking' then
    if p_other_signer_id is null or not exists (
         select 1 from public.ipas_signer_lists l
          where l.list_key = 'transmittal_warehouse' and l.employee_id = p_other_signer_id
       ) then
      raise exception 'transmittal_complete_stage: name the other signatory from the Warehouse list' using errcode = '22023';
    end if;
  elsif v_tech or v_row.check_technical then
    if p_other_signer_id is null or not exists (
         select 1 from public.ipas_signer_lists l
          where l.list_key = 'transmittal_technical' and l.employee_id = p_other_signer_id
       ) then
      raise exception 'transmittal_complete_stage: the other signatory is on the Technical list' using errcode = '22023';
    end if;
  end if;

  if p_other_signer_id is not null then
    select e.name into v_other_name from public.employees e where e.id = p_other_signer_id;
    if not found then
      raise exception 'transmittal_complete_stage: that signatory doesn''t exist' using errcode = '22023';
    end if;
  else
    v_other_name := nullif(btrim(coalesce(p_other_signer_name, '')), '');
  end if;
  if v_other_name is null then
    raise exception 'transmittal_complete_stage: name who signs with you' using errcode = '22023';
  end if;

  select e.name into v_actor_name from public.employees e where e.id = v_actor;

  select count(*) into v_pictures from public.pms_evidence e
   where e.record_type = 'transmittal_stage' and e.record_id = v_stage.id;

  if p_stage = 'warehouse_checking' then
    select count(*) into v_unrated from public.transmittal_lines l
     where l.transmittal_id = p_transmittal_id and (l.wh_rating is null or l.wh_in_charge_id is null);
    if v_unrated > 0 then
      raise exception 'transmittal_complete_stage: % line(s) of % still need a GC or NA rating',
        v_unrated, v_row.number using errcode = '22023';
    end if;
  elsif v_tech then
    select count(*) into v_unrated from public.transmittal_lines l
     where l.transmittal_id = p_transmittal_id and (l.tech_rating is null or l.tech_in_charge_id is null);
    if v_unrated > 0 then
      raise exception 'transmittal_complete_stage: % line(s) of % still need a GC or NA rating from Technical',
        v_unrated, v_row.number using errcode = '22023';
    end if;
  end if;

  -- Every stage: "Provided Pictures & Videos" is No only with a reason (spec #251).
  if v_pictures = 0 and v_reason is null then
    raise exception 'transmittal_complete_stage: attach a picture or video, or give the reason none' using errcode = '22023';
  end if;

  if p_stage = 'warehouse_checking' then
    select count(*) into v_na from public.transmittal_lines l
     where l.transmittal_id = p_transmittal_id and l.wh_rating = 'na';
  elsif v_tech then
    select count(*) into v_na from public.transmittal_lines l
     where l.transmittal_id = p_transmittal_id and l.tech_rating = 'na';
  end if;

  update public.transmittal_stages
     set remarks = v_remarks,
         no_pictures_reason = case when v_pictures > 0 then null else v_reason end,
         completed_by = v_actor,
         completed_at = now(),
         first_signer_id = case when v_as_second then p_other_signer_id else v_actor end,
         first_signed_at = now(),
         first_confirmed = not v_as_second,
         second_signer_id = case when v_as_second then v_actor else p_other_signer_id end,
         second_signer_name = case when v_as_second then v_actor_name else v_other_name end,
         second_signed_at = now(),
         second_confirmed = v_as_second
   where id = v_stage.id;

  -- Advance the slip.
  if p_stage = 'warehouse_checking' then
    if v_row.check_technical then
      v_next_state := 'warehouse_releasing';
      v_next_list := 'transmittal_warehouse';
    else
      v_next_state := 'awaiting_check';
      v_next_list := 'transmittal_check_by';
    end if;
  elsif v_tech then
    v_next_state := 'awaiting_check';
    v_next_list := 'transmittal_check_by';
  elsif v_row.check_technical then
    v_next_state := 'technical_inspection';
    v_next_list := 'transmittal_technical';
  else
    v_next_state := v_row.state;
  end if;

  if v_next_state is distinct from v_row.state then
    update public.transmittals set state = v_next_state where id = p_transmittal_id;
  end if;

  if v_next_list is not null then
    v_next_ids := public._transmittal_list_ids(v_next_list);
  end if;

  if v_na > 0 then
    v_na_ids := array(
      select distinct u from unnest(
        array_cat(
          array[v_row.prepared_by],
          array(
            select l.employee_id from public.ipas_signer_lists l
              join public.employees e on e.id = l.employee_id
             where l.list_key = 'transmittal_check_by' and not coalesce(e.is_deleted, false)
          )
        )
      ) as u
    );
  end if;

  perform public._transmittal_event(p_transmittal_id, v_actor, 'stage_signed', jsonb_build_object(
    'number', v_row.number,
    'stage', p_stage,
    'state_to', v_next_state,
    'na_count', v_na,
    'other_signer', v_other_name
  ));

  return jsonb_build_object(
    'id', p_transmittal_id,
    'number', v_row.number,
    'stage', p_stage,
    'state', v_next_state,
    'na_count', v_na,
    'notify_next_list', v_next_list,
    'notify_next_ids', v_next_ids,
    'notify_confirm_id', p_other_signer_id,
    'notify_na_ids', case when v_na > 0 then to_jsonb(v_na_ids) else '[]'::jsonb end
  );
end;
$function$
;
CREATE OR REPLACE FUNCTION public.transmittal_confirm_signature(p_stage_id uuid, p_confirm boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_actor uuid := public.get_employee_id();
  v_stage public.transmittal_stages;
  v_number text;
  v_first boolean;
begin
  if v_actor is null then
    raise exception 'transmittal_confirm_signature: not signed in' using errcode = '42501';
  end if;

  select * into v_stage from public.transmittal_stages s where s.id = p_stage_id for update;
  if not found then
    raise exception 'transmittal_confirm_signature: that stage doesn''t exist' using errcode = '22023';
  end if;
  if v_stage.completed_at is null then
    raise exception 'transmittal_confirm_signature: the stage isn''t signed yet' using errcode = '22023';
  end if;
  -- The co-signer is whichever slot the completer didn't sign: the second,
  -- or the first when the completer signed as the second.
  -- When one person holds both slots, the co-signer's is the one still open.
  if v_stage.first_signer_id = v_actor and v_stage.second_signer_id = v_actor then
    if not v_stage.first_confirmed or v_stage.first_signature_declined then
      v_first := true;
    elsif not v_stage.second_confirmed or v_stage.second_signature_declined then
      v_first := false;
    else
      raise exception 'transmittal_confirm_signature: both signatures are already confirmed' using errcode = '22023';
    end if;
  elsif v_stage.second_signer_id = v_actor and v_actor is distinct from v_stage.completed_by then
    v_first := false;
  elsif v_stage.first_signer_id = v_actor and v_actor is distinct from v_stage.completed_by then
    v_first := true;
  else
    raise exception 'transmittal_confirm_signature: only the co-signer confirms this signature' using errcode = '42501';
  end if;

  if v_first then
    update public.transmittal_stages
       set first_confirmed = coalesce(p_confirm, false), first_signature_declined = not coalesce(p_confirm, false)
     where id = p_stage_id;
  else
    update public.transmittal_stages
       set second_confirmed = coalesce(p_confirm, false), second_signature_declined = not coalesce(p_confirm, false)
     where id = p_stage_id;
  end if;

  select number into v_number from public.transmittals where id = v_stage.transmittal_id;
  perform public._transmittal_event(v_stage.transmittal_id, v_actor,
    case when coalesce(p_confirm, false) then 'signature_confirmed' else 'signature_declined' end,
    jsonb_build_object('number', v_number, 'stage', v_stage.stage));

  return jsonb_build_object(
    'id', v_stage.transmittal_id,
    'stage_id', p_stage_id,
    'confirmed', coalesce(p_confirm, false),
    'notify_id', case when coalesce(p_confirm, false) then null else v_stage.completed_by end
  );
end;
$function$
;
CREATE OR REPLACE FUNCTION public.transmittal_create(p_fields jsonb, p_product_ids uuid[], p_reference_ids uuid[], p_lines jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_actor uuid := public.get_employee_id();
  v_header jsonb;
  v_row public.transmittals;
  v_warnings jsonb;
begin
  if v_actor is null then
    raise exception 'transmittal_create: not signed in' using errcode = '42501';
  end if;
  if not public.transmittal_can_prepare() then
    raise exception 'transmittal_create: only Purchasing, or the Warehouse or Logistics list, raises a Transmittal'
      using errcode = '42501';
  end if;

  v_header := public._transmittal_clean_header(coalesce(p_fields, '{}'::jsonb));

  insert into public.transmittals (
    origin, origin_other, check_warehouse, check_technical, check_other, priority, entity,
    product_other, item_location_id, prepared_by
  ) values (
    v_header->>'origin',
    v_header->>'origin_other',
    (v_header->>'check_warehouse')::boolean,
    (v_header->>'check_technical')::boolean,
    v_header->>'check_other',
    v_header->>'priority',
    v_header->>'entity',
    v_header->>'product_other',
    nullif(v_header->>'item_location_id', '')::uuid,
    v_actor
  )
  returning * into v_row;

  v_warnings := public._transmittal_write_children(v_row.id, p_product_ids, p_reference_ids, p_lines);

  perform public._transmittal_event(v_row.id, v_actor, 'created', jsonb_build_object(
    'number', v_row.number,
    'lines', coalesce(jsonb_array_length(coalesce(p_lines, '[]'::jsonb)), 0)
  ));

  return jsonb_build_object('id', v_row.id, 'number', v_row.number, 'warnings', v_warnings);
end;
$function$
;
CREATE OR REPLACE FUNCTION public.transmittal_line_refs(p_transmittal_id uuid)
 RETURNS TABLE(line_id uuid, ipas_number text, po_number text, sor_id uuid, sor_reference text, sor_project text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if auth.uid() is null then
    raise exception 'transmittal_line_refs: not signed in' using errcode = '42501';
  end if;
  if not public.transmittal_can_read(p_transmittal_id) then
    return;
  end if;

  return query
    select l.id, i.number, i.po_number, o.id, o.sales_reference, o.project_title
      from public.transmittal_lines l
      left join public.ipas i on i.id = l.ipas_id
      left join public.sales_opportunities o on o.id = l.opportunity_id
     where l.transmittal_id = p_transmittal_id
     order by l.position;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.transmittal_lines_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_id uuid := coalesce(new.transmittal_id, old.transmittal_id);
  v_state text;
  v_number text;
begin
  select state, number into v_state, v_number from public.transmittals where id = v_id;

  if tg_op = 'DELETE' then
    if v_state is distinct from 'draft' then
      raise exception 'transmittal: % is %, and its lines can''t change', v_number, v_state using errcode = '42501';
    end if;
    return old;
  end if;

  if tg_op = 'INSERT' then
    if v_state is distinct from 'draft' then
      raise exception 'transmittal: % is %, and its lines can''t change', v_number, v_state using errcode = '42501';
    end if;
    return new;
  end if;

  -- UPDATE
  if v_state in ('closed', 'cancelled') then
    raise exception 'transmittal: % is %, and its lines can''t change', v_number, v_state using errcode = '42501';
  end if;
  if v_state = 'draft' then
    return new;
  end if;

  if (new.position, new.kind, new.ipas_id, new.odoo_po_line_id, new.description, new.quantity,
      new.unit, new.opportunity_id, new.serial_numbers, new.box_quantity)
     is distinct from
     (old.position, old.kind, old.ipas_id, old.odoo_po_line_id, old.description, old.quantity,
      old.unit, old.opportunity_id, old.serial_numbers, old.box_quantity) then
    raise exception 'transmittal: % is submitted; its lines are fixed', v_number using errcode = '42501';
  end if;

  if (new.wh_in_charge_id, new.wh_rating, new.wh_remark, new.quantity_received)
     is distinct from
     (old.wh_in_charge_id, old.wh_rating, old.wh_remark, old.quantity_received) then
    if exists (
      select 1 from public.transmittal_stages s
       where s.transmittal_id = v_id and s.stage = 'warehouse_checking' and s.completed_at is not null
    ) then
      raise exception 'transmittal: % Warehouse checking is signed; its ratings can''t change', v_number
        using errcode = '42501';
    end if;
  end if;

  if (new.tech_in_charge_id, new.tech_rating, new.tech_remark)
     is distinct from
     (old.tech_in_charge_id, old.tech_rating, old.tech_remark) then
    if exists (
      select 1 from public.transmittal_stages s
       where s.transmittal_id = v_id and s.stage = 'technical_inspection' and s.completed_at is not null
    ) then
      raise exception 'transmittal: % Technical inspection is signed; its ratings can''t change', v_number
        using errcode = '42501';
    end if;
  end if;

  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.transmittal_lines_sync_links()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if tg_op in ('INSERT', 'UPDATE') then
    perform public._transmittal_sync_links(new.transmittal_id);
  end if;
  if tg_op = 'DELETE' or (tg_op = 'UPDATE' and old.transmittal_id is distinct from new.transmittal_id) then
    perform public._transmittal_sync_links(old.transmittal_id);
  end if;
  return null;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.transmittal_on_list(p_list_key text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1
      from public.ipas_signer_lists l
      join public.employees e on e.id = l.employee_id
     where l.list_key = p_list_key
       and l.employee_id = public.get_employee_id()
       and not coalesce(e.is_deleted, false)
  );
$function$
;
CREATE OR REPLACE FUNCTION public.transmittal_pickable_po_lines(p_search text DEFAULT NULL::text)
 RETURNS TABLE(ipas_id uuid, ipas_number text, po_number text, odoo_po_line_id integer, product_name text, quantity numeric, unit text, entity text, sors jsonb)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public.transmittal_can_prepare() then
    raise exception 'transmittal_pickable_po_lines: only a Transmittal preparer picks PO lines' using errcode = '42501';
  end if;

  return query
  select
    i.id,
    i.number,
    i.po_number,
    (l->>'line_id')::integer,
    nullif(btrim(l->>'name'), ''),
    nullif(l->>'quantity', '')::numeric,
    nullif(btrim(l->>'unit'), ''),
    coalesce(nullif(btrim(i.entity_override), ''), nullif(btrim(i.odoo_copy #>> '{po,company}'), '')),
    coalesce((
      select jsonb_agg(jsonb_build_object(
          'id', o.id, 'sales_reference', o.sales_reference, 'project_title', o.project_title
        ) order by o.sales_reference)
        from public.ipas_sors s
        join public.sales_opportunities o on o.id = s.opportunity_id
       where s.ipas_id = i.id
    ), '[]'::jsonb)
  from public.ipas i
  cross join lateral jsonb_array_elements(coalesce(i.odoo_copy -> 'lines', '[]'::jsonb)) as l
  where i.state <> 'cancelled'
    and (
      nullif(btrim(p_search), '') is null
      or i.po_number ilike '%' || btrim(p_search) || '%'
      or (l->>'name') ilike '%' || btrim(p_search) || '%'
    )
  order by i.po_number, (l->>'line_id')::integer
  limit 200;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.transmittal_rate(p_transmittal_id uuid, p_line_ratings jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_actor uuid := public.get_employee_id();
  v_row public.transmittals;
  v_stage public.transmittal_stages;
  v_item jsonb;
  v_line public.transmittal_lines;
  v_rating text;
  v_remark text;
  v_in_charge uuid;
  v_received numeric;
  v_count int := 0;
  v_tech boolean;
begin
  if v_actor is null then
    raise exception 'transmittal_rate: not signed in' using errcode = '42501';
  end if;

  select * into v_row from public.transmittals t where t.id = p_transmittal_id for update;
  if not found then
    raise exception 'transmittal_rate: that Transmittal doesn''t exist' using errcode = '22023';
  end if;

  -- Technical inspection is rated by the Technical list; Warehouse checking by the Warehouse list.
  v_tech := v_row.state = 'technical_inspection';
  if v_tech then
    if not public.transmittal_on_list('transmittal_technical') then
      raise exception 'transmittal_rate: only the Technical list rates the lines' using errcode = '42501';
    end if;
  elsif not public.transmittal_on_list('transmittal_warehouse') then
    raise exception 'transmittal_rate: only the Warehouse list rates the lines' using errcode = '42501';
  end if;
  if jsonb_typeof(p_line_ratings) is distinct from 'array' then
    raise exception 'transmittal_rate: the ratings are a list' using errcode = '22023';
  end if;

  select * into v_stage from public.transmittal_stages s
   where s.transmittal_id = p_transmittal_id
     and s.stage = case when v_tech then 'technical_inspection' else 'warehouse_checking' end;
  if not found or v_stage.completed_at is not null
     or v_row.state not in ('warehouse_checking', 'technical_inspection') then
    raise exception 'transmittal_rate: % is not open on %', case when v_tech then 'Technical inspection' else 'Warehouse checking' end,
      v_row.number using errcode = '42501';
  end if;
  if not v_tech and v_row.state <> 'warehouse_checking' then
    raise exception 'transmittal_rate: Warehouse checking is not open on %', v_row.number using errcode = '42501';
  end if;

  for v_item in select value from jsonb_array_elements(p_line_ratings) loop
    select * into v_line from public.transmittal_lines l
     where l.id = nullif(v_item->>'line_id', '')::uuid and l.transmittal_id = p_transmittal_id;
    if not found then
      raise exception 'transmittal_rate: that line isn''t on %', v_row.number using errcode = '22023';
    end if;

    v_rating := lower(coalesce(v_item->>'rating', ''));
    if v_rating not in ('gc', 'na') then
      raise exception 'transmittal_rate: each line is GC or NA' using errcode = '22023';
    end if;

    v_remark := nullif(btrim(coalesce(v_item->>'remark', '')), '');
    if v_rating = 'na' and v_remark is null then
      raise exception 'transmittal_rate: an NA needs a remark' using errcode = '22023';
    end if;

    v_in_charge := coalesce(nullif(v_item->>'in_charge_id', '')::uuid, v_actor);
    if not exists (
      select 1 from public.ipas_signer_lists l
       where l.list_key = case when v_tech then 'transmittal_technical' else 'transmittal_warehouse' end
         and l.employee_id = v_in_charge
    ) then
      raise exception 'transmittal_rate: the in-charge is on the % list',
        case when v_tech then 'Technical' else 'Warehouse' end using errcode = '22023';
    end if;

    -- One quantity received per line: the Warehouse's, or Technical's on a
    -- slip with no Warehouse checking.
    v_received := nullif(v_item->>'quantity_received', '')::numeric;
    if v_received is not null and v_received < 0 then
      raise exception 'transmittal_rate: a quantity received is zero or more' using errcode = '22023';
    end if;
    if v_received = v_line.quantity then
      v_received := null;
    end if;

    if v_tech then
      update public.transmittal_lines
         set tech_in_charge_id = v_in_charge,
             tech_rating = v_rating,
             tech_remark = v_remark,
             quantity_received = case when v_row.check_warehouse then quantity_received else v_received end
       where id = v_line.id;
    else
      update public.transmittal_lines
         set wh_in_charge_id = v_in_charge,
             wh_rating = v_rating,
             wh_remark = v_remark,
             quantity_received = v_received
       where id = v_line.id;
    end if;
    v_count := v_count + 1;
  end loop;

  perform public._transmittal_event(p_transmittal_id, v_actor, 'rated', jsonb_build_object(
    'number', v_row.number,
    'lines', v_count,
    'stage', case when v_tech then 'technical_inspection' else 'warehouse_checking' end
  ));

  return jsonb_build_object('id', p_transmittal_id, 'number', v_row.number, 'rated', v_count);
end;
$function$
;
CREATE OR REPLACE FUNCTION public.transmittal_received_in_odoo(p_transmittal_id uuid, p_ref text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_actor uuid := public.get_employee_id();
  v_row public.transmittals;
  v_ref text := nullif(btrim(coalesce(p_ref, '')), '');
  v_at timestamptz := now();
begin
  if v_actor is null then
    raise exception 'transmittal_received_in_odoo: not signed in' using errcode = '42501';
  end if;

  select * into v_row from public.transmittals t where t.id = p_transmittal_id for update;
  if not found then
    raise exception 'transmittal_received_in_odoo: that Transmittal doesn''t exist' using errcode = '22023';
  end if;
  if not (public.transmittal_on_list('transmittal_warehouse') or coalesce(public.has_purchasing_access(), false)) then
    raise exception 'transmittal_received_in_odoo: only the Warehouse list or Purchasing records the Odoo receipt'
      using errcode = '42501';
  end if;
  if v_row.state not in ('warehouse_checking', 'warehouse_releasing', 'technical_inspection', 'awaiting_check') then
    raise exception 'transmittal_received_in_odoo: % is %; the Odoo receipt is recorded from submission until close',
      v_row.number, v_row.state using errcode = '22023';
  end if;
  if v_row.odoo_received_at is not null then
    raise exception 'transmittal_received_in_odoo: % already has its Odoo receipt', v_row.number using errcode = '22023';
  end if;

  update public.transmittals
     set odoo_received_by = v_actor, odoo_received_at = v_at, odoo_receipt_ref = v_ref
   where id = p_transmittal_id;

  perform public._transmittal_event(p_transmittal_id, v_actor, 'received_in_odoo', jsonb_build_object(
    'number', v_row.number,
    'receipt_ref', v_ref
  ));

  return jsonb_build_object('id', p_transmittal_id, 'number', v_row.number, 'received_at', v_at, 'receipt_ref', v_ref);
end;
$function$
;
CREATE OR REPLACE FUNCTION public.transmittal_remove_evidence(p_evidence_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_actor uuid := public.get_employee_id();
  v_ev public.pms_evidence;
begin
  if v_actor is null then
    raise exception 'transmittal_remove_evidence: not signed in' using errcode = '42501';
  end if;

  select * into v_ev from public.pms_evidence e where e.id = p_evidence_id for update;
  if not found then
    raise exception 'transmittal_remove_evidence: that file doesn''t exist' using errcode = '22023';
  end if;
  if v_ev.uploaded_by is distinct from v_actor then
    raise exception 'transmittal_remove_evidence: only the uploader removes a file' using errcode = '42501';
  end if;

  delete from public.pms_evidence where id = p_evidence_id;

  perform public._transmittal_event(v_ev.transmittal_id, v_actor, 'evidence_removed', jsonb_build_object(
    'file_name', v_ev.file_name,
    'stage_id', v_ev.record_id
  ));

  return jsonb_build_object('id', p_evidence_id, 'storage_path', v_ev.storage_path);
end;
$function$
;
CREATE OR REPLACE FUNCTION public.transmittal_set_first_number(p_number bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not coalesce(public.is_super_admin(), false) then
    raise exception 'transmittal_set_first_number: only a Super Admin sets the first number' using errcode = '42501';
  end if;
  if p_number is null or p_number < 1 then
    raise exception 'transmittal_set_first_number: the first number must be 1 or more' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('transmittal_number_seq'));
  if exists (select 1 from public.transmittals) then
    raise exception 'transmittal_set_first_number: a Transmittal already exists; the first number is fixed'
      using errcode = '42501';
  end if;

  perform setval('public.transmittal_number_seq', p_number, false);

  return jsonb_build_object('first_number', p_number, 'number_format', 'TG03-' || p_number);
end;
$function$
;
CREATE OR REPLACE FUNCTION public.transmittal_stage_list_members(p_transmittal_id uuid, p_list_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public.transmittal_can_read(p_transmittal_id) then
    raise exception 'transmittal_stage_list_members: that Transmittal doesn''t exist or you can''t read it'
      using errcode = '42501';
  end if;
  if p_list_key not in ('transmittal_warehouse', 'transmittal_technical', 'transmittal_logistics', 'transmittal_check_by') then
    raise exception 'transmittal_stage_list_members: % isn''t a Transmittal list', p_list_key using errcode = '22023';
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object('id', e.id, 'name', e.name) order by e.name)
      from public.ipas_signer_lists l
      join public.employees e on e.id = l.employee_id
     where l.list_key = p_list_key
       and not coalesce(e.is_deleted, false)
  ), '[]'::jsonb);
end;
$function$
;
CREATE OR REPLACE FUNCTION public.transmittal_stages_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_number text;
begin
  if tg_op = 'DELETE' then
    raise exception 'transmittal: a stage is never deleted' using errcode = '42501';
  end if;

  if old.completed_at is null then
    return new;
  end if;

  -- transmittal_undo_signature clears the signature columns of a signed stage.
  if coalesce(current_setting('app.transmittal_undo', true), '') = 'on' then
    return new;
  end if;

  if (new.id, new.transmittal_id, new.stage, new.remarks, new.no_pictures_reason, new.completed_by,
      new.completed_at, new.first_signer_id, new.first_signed_at, new.second_signer_id, new.second_signer_name, new.second_signed_at,
      new.created_at)
     is distinct from
     (old.id, old.transmittal_id, old.stage, old.remarks, old.no_pictures_reason, old.completed_by,
      old.completed_at, old.first_signer_id, old.first_signed_at, old.second_signer_id, old.second_signer_name, old.second_signed_at,
      old.created_at) then
    select number into v_number from public.transmittals where id = old.transmittal_id;
    raise exception 'transmittal: the % stage of % is signed; its remarks and signatures can''t change',
      old.stage, v_number using errcode = '42501';
  end if;

  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.transmittal_submit(p_transmittal_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_actor uuid := public.get_employee_id();
  v_row public.transmittals;
  v_first text;
  v_notify text;
begin
  if v_actor is null then
    raise exception 'transmittal_submit: not signed in' using errcode = '42501';
  end if;
  if not public.transmittal_can_prepare() then
    raise exception 'transmittal_submit: only a Transmittal preparer submits a slip' using errcode = '42501';
  end if;

  select * into v_row from public.transmittals t where t.id = p_transmittal_id for update;
  if not found then
    raise exception 'transmittal_submit: that Transmittal doesn''t exist' using errcode = '22023';
  end if;
  if not (v_row.prepared_by = v_actor or coalesce(public.has_purchasing_access(), false)) then
    raise exception 'transmittal_submit: only the preparer or Purchasing submits a slip' using errcode = '42501';
  end if;
  if v_row.state <> 'draft' then
    raise exception 'transmittal_submit: % is already %', v_row.number, v_row.state using errcode = '22023';
  end if;
  if not exists (select 1 from public.transmittal_lines l where l.transmittal_id = p_transmittal_id) then
    raise exception 'transmittal_submit: % needs at least one line', v_row.number using errcode = '22023';
  end if;

  v_first := case when v_row.check_warehouse then 'warehouse_checking' else 'technical_inspection' end;
  v_notify := case when v_row.check_warehouse then 'transmittal_warehouse' else 'transmittal_technical' end;

  if v_row.check_warehouse then
    insert into public.transmittal_stages (transmittal_id, stage) values (p_transmittal_id, 'warehouse_checking');
  end if;
  if v_row.check_warehouse and v_row.check_technical then
    insert into public.transmittal_stages (transmittal_id, stage) values (p_transmittal_id, 'warehouse_releasing');
  end if;
  if v_row.check_technical then
    insert into public.transmittal_stages (transmittal_id, stage) values (p_transmittal_id, 'technical_inspection');
  end if;

  update public.transmittals
     set state = v_first, submitted_at = now()
   where id = p_transmittal_id;

  perform public._transmittal_event(p_transmittal_id, v_actor, 'submitted', jsonb_build_object(
    'number', v_row.number,
    'first_stage', v_first
  ));

  -- The list's members are read here, not by the caller: the staff lists are
  -- not readable to a preparer under row level security.
  return jsonb_build_object(
    'id', p_transmittal_id,
    'number', v_row.number,
    'state', v_first,
    'notify_list', v_notify,
    'notify_ids', coalesce((
      select jsonb_agg(l.employee_id)
        from public.ipas_signer_lists l
        join public.employees e on e.id = l.employee_id
       where l.list_key = v_notify
         and not coalesce(e.is_deleted, false)
    ), '[]'::jsonb)
  );
end;
$function$
;
CREATE OR REPLACE FUNCTION public.transmittal_undo_signature(p_transmittal_id uuid, p_kind text, p_reason text, p_stage text DEFAULT NULL::text, p_slot integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_actor uuid := public.get_employee_id();
  v_row public.transmittals;
  v_stage public.transmittal_stages;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_order int;
  v_state text;
  v_notify uuid[] := '{}';
  v_signer uuid;
  v_signer_name text;
  v_signed_at timestamptz;
  v_other uuid;
  v_other_name text;
  v_ref text;
begin
  if v_actor is null then
    raise exception 'transmittal_undo_signature: not signed in' using errcode = '42501';
  end if;
  if v_reason is null then
    raise exception 'transmittal_undo_signature: give the reason for undoing the signature' using errcode = '22023';
  end if;
  if p_kind is null or p_kind not in ('stage', 'odoo', 'check_by') then
    raise exception 'transmittal_undo_signature: undo a stage, Received in Odoo or a Check by' using errcode = '22023';
  end if;

  select * into v_row from public.transmittals t where t.id = p_transmittal_id for update;
  if not found then
    raise exception 'transmittal_undo_signature: that Transmittal doesn''t exist' using errcode = '22023';
  end if;
  if v_row.state in ('draft', 'cancelled') then
    raise exception 'transmittal_undo_signature: % is %; nothing is signed', v_row.number, v_row.state
      using errcode = '42501';
  end if;

  if p_kind = 'stage' then
    if p_stage is null or p_stage not in ('warehouse_checking', 'warehouse_releasing', 'technical_inspection') then
      raise exception 'transmittal_undo_signature: name the stage' using errcode = '22023';
    end if;
    -- Whoever may sign the stage may undo it.
    if p_stage = 'technical_inspection' then
      if not public.transmittal_on_list('transmittal_technical') then
        raise exception 'transmittal_undo_signature: only the Technical list undoes Technical inspection'
          using errcode = '42501';
      end if;
    elsif not public.transmittal_on_list('transmittal_warehouse') then
      raise exception 'transmittal_undo_signature: only the Warehouse list undoes a Warehouse stage'
        using errcode = '42501';
    end if;
    if v_row.state = 'closed' or v_row.check_by_first_id is not null or v_row.check_by_second_id is not null then
      raise exception 'transmittal_undo_signature: % has a Check by signed; undo that first', v_row.number
        using errcode = '42501';
    end if;

    select * into v_stage from public.transmittal_stages s
     where s.transmittal_id = p_transmittal_id and s.stage = p_stage
     for update;
    if not found or v_stage.completed_at is null then
      raise exception 'transmittal_undo_signature: the % stage of % isn''t signed', p_stage, v_row.number
        using errcode = '22023';
    end if;

    v_order := case p_stage when 'warehouse_checking' then 1 when 'warehouse_releasing' then 2 else 3 end;
    if exists (
      select 1 from public.transmittal_stages s
       where s.transmittal_id = p_transmittal_id
         and s.completed_at is not null
         and (case s.stage when 'warehouse_checking' then 1 when 'warehouse_releasing' then 2 else 3 end) > v_order
    ) then
      raise exception 'transmittal_undo_signature: a later stage of % is signed; undo that first', v_row.number
        using errcode = '42501';
    end if;

    v_signer := v_stage.first_signer_id;
    v_signed_at := v_stage.completed_at;
    v_other := v_stage.second_signer_id;
    v_other_name := v_stage.second_signer_name;
    select e.name into v_signer_name from public.employees e where e.id = v_signer;
    v_notify := array_remove(array[v_stage.first_signer_id, v_stage.second_signer_id, v_stage.completed_by], null);

    insert into public.transmittal_cleared_signatures
      (transmittal_id, kind, stage, signer_id, signer_name, signed_at, other_signer_id, other_signer_name,
       cleared_by, cleared_reason)
    values
      (p_transmittal_id, 'stage', p_stage, v_signer, v_signer_name, v_signed_at, v_other, v_other_name,
       v_actor, v_reason);

    perform set_config('app.transmittal_undo', 'on', true);
    update public.transmittal_stages
       set completed_by = null,
           completed_at = null,
           first_signer_id = null,
           first_signed_at = null,
           first_confirmed = false,
           first_signature_declined = false,
           second_signer_id = null,
           second_signer_name = null,
           second_signed_at = null,
           second_confirmed = false,
           second_signature_declined = false
     where id = v_stage.id;

    -- The stage is the one being worked again. Warehouse releasing on a
    -- Warehouse-only slip is optional and leaves the state where it is.
    v_state := case
      when p_stage = 'warehouse_releasing' and not v_row.check_technical then v_row.state
      else p_stage
    end;
    if v_state is distinct from v_row.state then
      update public.transmittals set state = v_state where id = p_transmittal_id;
    end if;
    perform set_config('app.transmittal_undo', 'off', true);

  elsif p_kind = 'odoo' then
    if not (public.transmittal_on_list('transmittal_warehouse') or coalesce(public.has_purchasing_access(), false)) then
      raise exception 'transmittal_undo_signature: only the Warehouse list or Purchasing undoes the Odoo receipt'
        using errcode = '42501';
    end if;
    if v_row.odoo_received_at is null then
      raise exception 'transmittal_undo_signature: % has no Odoo receipt to undo', v_row.number using errcode = '22023';
    end if;
    if v_row.state = 'closed' or v_row.check_by_first_id is not null or v_row.check_by_second_id is not null then
      raise exception 'transmittal_undo_signature: % has a Check by signed; undo that first', v_row.number
        using errcode = '42501';
    end if;

    v_signer := v_row.odoo_received_by;
    v_signed_at := v_row.odoo_received_at;
    v_ref := v_row.odoo_receipt_ref;
    select e.name into v_signer_name from public.employees e where e.id = v_signer;
    v_notify := array_remove(array[v_signer], null);

    insert into public.transmittal_cleared_signatures
      (transmittal_id, kind, signer_id, signer_name, signed_at, receipt_ref, cleared_by, cleared_reason)
    values
      (p_transmittal_id, 'odoo', v_signer, v_signer_name, v_signed_at, v_ref, v_actor, v_reason);

    perform set_config('app.transmittal_undo', 'on', true);
    update public.transmittals
       set odoo_received_by = null, odoo_received_at = null, odoo_receipt_ref = null
     where id = p_transmittal_id;
    perform set_config('app.transmittal_undo', 'off', true);
    v_state := v_row.state;

  else
    if not public.transmittal_on_list('transmittal_check_by') then
      raise exception 'transmittal_undo_signature: only the Check by list undoes a Check by' using errcode = '42501';
    end if;
    if v_row.prepared_by = v_actor then
      raise exception 'transmittal_undo_signature: the preparer can''t check their own slip' using errcode = '42501';
    end if;
    if p_slot is null or p_slot not in (1, 2) then
      raise exception 'transmittal_undo_signature: the slot is 1 or 2' using errcode = '22023';
    end if;

    v_signer := case p_slot when 1 then v_row.check_by_first_id else v_row.check_by_second_id end;
    v_signed_at := case p_slot when 1 then v_row.check_by_first_at else v_row.check_by_second_at end;
    if v_signer is null then
      raise exception 'transmittal_undo_signature: Check by (%) of % isn''t signed', p_slot, v_row.number
        using errcode = '22023';
    end if;
    select e.name into v_signer_name from public.employees e where e.id = v_signer;
    v_notify := array[v_signer];

    insert into public.transmittal_cleared_signatures
      (transmittal_id, kind, slot, signer_id, signer_name, signed_at, cleared_by, cleared_reason)
    values
      (p_transmittal_id, 'check_by', p_slot, v_signer, v_signer_name, v_signed_at, v_actor, v_reason);

    -- One statement: the slot goes and, on a closed slip, the slip reopens with it (a closed slip
    -- must hold its second signature, so the two can't be separate updates).
    perform set_config('app.transmittal_undo', 'on', true);
    update public.transmittals
       set check_by_first_id = case when p_slot = 1 then null else check_by_first_id end,
           check_by_first_at = case when p_slot = 1 then null else check_by_first_at end,
           check_by_second_id = case when p_slot = 2 then null else check_by_second_id end,
           check_by_second_at = case when p_slot = 2 then null else check_by_second_at end,
           state = case when state = 'closed' then 'awaiting_check' else state end,
           closed_at = case when state = 'closed' then null else closed_at end
     where id = p_transmittal_id
     returning state into v_state;
    perform set_config('app.transmittal_undo', 'off', true);
  end if;

  perform public._transmittal_event(p_transmittal_id, v_actor, 'signature_undone', jsonb_build_object(
    'number', v_row.number,
    'kind', p_kind,
    'stage', p_stage,
    'slot', p_slot,
    'state_to', v_state,
    'reason', v_reason
  ));

  return jsonb_build_object(
    'id', p_transmittal_id,
    'number', v_row.number,
    'kind', p_kind,
    'state', v_state,
    'notify_ids', to_jsonb(array(
      select distinct u from unnest(array_append(v_notify, v_row.prepared_by)) as u
       where u is not null and u <> v_actor
    ))
  );
end;
$function$
;
CREATE OR REPLACE FUNCTION public.transmittal_update_draft(p_transmittal_id uuid, p_fields jsonb, p_product_ids uuid[], p_reference_ids uuid[], p_lines jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_actor uuid := public.get_employee_id();
  v_row public.transmittals;
  v_header jsonb;
  v_warnings jsonb;
begin
  if v_actor is null then
    raise exception 'transmittal_update_draft: not signed in' using errcode = '42501';
  end if;
  if not public.transmittal_can_prepare() then
    raise exception 'transmittal_update_draft: only a Transmittal preparer changes a slip' using errcode = '42501';
  end if;

  select * into v_row from public.transmittals t where t.id = p_transmittal_id for update;
  if not found then
    raise exception 'transmittal_update_draft: that Transmittal doesn''t exist' using errcode = '22023';
  end if;
  if not (v_row.prepared_by = v_actor or coalesce(public.has_purchasing_access(), false)) then
    raise exception 'transmittal_update_draft: only the preparer or Purchasing changes a slip' using errcode = '42501';
  end if;
  if v_row.state <> 'draft' then
    raise exception 'transmittal_update_draft: % is %; only a draft changes', v_row.number, v_row.state
      using errcode = '42501';
  end if;

  v_header := public._transmittal_clean_header(coalesce(p_fields, '{}'::jsonb));

  update public.transmittals set
    origin = v_header->>'origin',
    origin_other = v_header->>'origin_other',
    check_warehouse = (v_header->>'check_warehouse')::boolean,
    check_technical = (v_header->>'check_technical')::boolean,
    check_other = v_header->>'check_other',
    priority = v_header->>'priority',
    entity = v_header->>'entity',
    product_other = v_header->>'product_other',
    item_location_id = nullif(v_header->>'item_location_id', '')::uuid
   where id = p_transmittal_id;

  v_warnings := public._transmittal_write_children(p_transmittal_id, p_product_ids, p_reference_ids, p_lines);

  perform public._transmittal_event(p_transmittal_id, v_actor, 'draft_updated', jsonb_build_object(
    'number', v_row.number,
    'lines', coalesce(jsonb_array_length(coalesce(p_lines, '[]'::jsonb)), 0)
  ));

  return jsonb_build_object('id', p_transmittal_id, 'number', v_row.number, 'warnings', v_warnings);
end;
$function$
;
CREATE OR REPLACE FUNCTION public.transmittals_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if tg_op = 'DELETE' then
    raise exception 'transmittal: a Transmittal is never deleted; cancel it instead' using errcode = '42501';
  end if;

  -- transmittal_undo_signature clears a signature, and reopens a closed slip when it clears a Check by.
  if coalesce(current_setting('app.transmittal_undo', true), '') = 'on' then
    return new;
  end if;

  -- A Check by signer may decline or re-apply their stored signature on a
  -- closed slip: nothing else about the row may change.
  if old.state = 'closed'
     and (to_jsonb(new) - 'check_by_first_signature_declined' - 'check_by_second_signature_declined')
       = (to_jsonb(old) - 'check_by_first_signature_declined' - 'check_by_second_signature_declined') then
    return new;
  end if;

  if old.state in ('closed', 'cancelled') then
    raise exception 'transmittal: % is %, and can''t change', old.number, old.state using errcode = '42501';
  end if;

  if new.number is distinct from old.number
     or new.prepared_by is distinct from old.prepared_by
     or new.prepared_on is distinct from old.prepared_on then
    raise exception 'transmittal: the number, preparer and date of % can''t change', old.number using errcode = '42501';
  end if;

  if old.state <> 'draft' and (
       new.origin, new.origin_other, new.check_warehouse, new.check_technical, new.check_other,
       new.priority, new.entity, new.product_other, new.item_location_id
     ) is distinct from (
       old.origin, old.origin_other, old.check_warehouse, old.check_technical, old.check_other,
       old.priority, old.entity, old.product_other, old.item_location_id
     ) then
    raise exception 'transmittal: % is submitted; its header is fixed', old.number using errcode = '42501';
  end if;

  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.undo_offset_leave_decision(p_group_id uuid, p_hr_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_employee_id uuid;
  v_previous_status text;
  v_row_count integer;
  v_total_hours numeric;
  v_dates date[];
  v_balance numeric;
  v_now timestamptz := now();
BEGIN
  PERFORM 1 FROM offset_leaves WHERE leave_group_id = p_group_id ORDER BY id FOR UPDATE;

  SELECT count(*), COALESCE(sum(COALESCE(approved_hours, hours)), 0), array_agg(date ORDER BY date)
    INTO v_row_count, v_total_hours, v_dates
    FROM offset_leaves WHERE leave_group_id = p_group_id;

  IF v_row_count = 0 THEN
    RAISE EXCEPTION 'Leave application not found.';
  END IF;

  SELECT employee_id, status
    INTO v_employee_id, v_previous_status
    FROM offset_leaves WHERE leave_group_id = p_group_id ORDER BY id LIMIT 1;

  IF v_previous_status = 'PENDING' THEN
    RAISE EXCEPTION 'Leave is already pending.';
  END IF;

  -- The refund is an addition, so it can never take the balance negative the
  -- way undoing an overtime credit can (#108) — there is nothing to refuse.
  IF v_previous_status = 'APPROVED' THEN
    SELECT offset_hours_balance INTO v_balance FROM employees WHERE id = v_employee_id FOR UPDATE;
    UPDATE employees
       SET offset_hours_balance = COALESCE(v_balance, 0) + v_total_hours, updated_at = v_now
     WHERE id = v_employee_id;
  END IF;

  UPDATE offset_leaves SET
    status = 'PENDING',
    hr_notes = NULL,
    updated_at = v_now,
    approval_hash = NULL,
    hr_signature_version = NULL,
    hr_signature_timestamp = NULL,
    approval_credits_snapshot = NULL,
    hr_processed_by = NULL,
    approved_hours = NULL
  WHERE leave_group_id = p_group_id;

  RETURN jsonb_build_object(
    'rows', (SELECT jsonb_agg(to_jsonb(l) ORDER BY l.date) FROM offset_leaves l WHERE l.leave_group_id = p_group_id),
    'employee_id', v_employee_id,
    'total_hours', v_total_hours,
    'dates', to_jsonb(v_dates),
    'previous_status', v_previous_status
  );
END;
$function$
;
CREATE OR REPLACE FUNCTION public.undo_overtime_decision(p_request_id uuid, p_hr_id uuid)
 RETURNS overtime_requests
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_request overtime_requests;
  v_credited numeric;
  v_balance numeric;
  v_new_balance numeric;
  v_now timestamptz := now();
BEGIN
  SELECT * INTO v_request FROM overtime_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Overtime request not found.';
  END IF;
  IF v_request.status = 'PENDING' THEN
    RAISE EXCEPTION 'Request is already pending.';
  END IF;

  IF v_request.status = 'APPROVED_OFFSET' THEN
    v_credited := COALESCE(v_request.approved_hours, v_request.hours, 0);

    -- Same lock-before-read as decide_overtime_request, so this can't
    -- compute its deduction from a balance a concurrent decision on another
    -- request for this employee is about to change.
    SELECT offset_hours_balance INTO v_balance FROM employees WHERE id = v_request.employee_id FOR UPDATE;
    v_new_balance := COALESCE(v_balance, 0) - v_credited;

    -- Refuse rather than clamp at zero: clamping would silently invent hours
    -- the employee never gave back once the credit had already been spent.
    IF v_new_balance < 0 THEN
      RAISE EXCEPTION 'Cannot undo: this would deduct % hrs, but only % hrs remain on the balance.',
        trim_scale(round(v_credited, 2)), trim_scale(round(COALESCE(v_balance, 0), 2));
    END IF;

    UPDATE employees SET offset_hours_balance = v_new_balance, updated_at = v_now WHERE id = v_request.employee_id;
  END IF;

  UPDATE overtime_requests SET
    status = 'PENDING',
    approved_hours = NULL,
    hr_notes = NULL,
    updated_at = v_now,
    approval_hash = NULL,
    hr_signature_version = NULL,
    hr_signature_timestamp = NULL,
    approval_credits_snapshot = NULL,
    hr_processed_by = NULL
  WHERE id = p_request_id
  RETURNING * INTO v_request;

  RETURN v_request;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.undo_sil_leave_decision(p_group_id uuid, p_hr_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_employee_id uuid;
  v_employee_name text;
  v_employment_status text;
  v_previous_status text;
  v_row_count integer;
  v_total_hours numeric;
  v_dates date[];
  v_balance numeric;
  v_refund_withheld boolean := false;
  v_now timestamptz := now();
BEGIN
  PERFORM 1 FROM sil_leaves WHERE leave_group_id = p_group_id ORDER BY id FOR UPDATE;

  SELECT count(*), COALESCE(sum(hours), 0), array_agg(date ORDER BY date)
    INTO v_row_count, v_total_hours, v_dates
    FROM sil_leaves WHERE leave_group_id = p_group_id;

  IF v_row_count = 0 THEN
    RAISE EXCEPTION 'Leave application not found.';
  END IF;

  SELECT employee_id, status
    INTO v_employee_id, v_previous_status
    FROM sil_leaves WHERE leave_group_id = p_group_id ORDER BY id LIMIT 1;

  IF v_previous_status = 'PENDING' THEN
    RAISE EXCEPTION 'Leave is already pending.';
  END IF;

  IF v_previous_status = 'APPROVED' THEN
    SELECT sil_hours_balance, employment_status, name
      INTO v_balance, v_employment_status, v_employee_name
      FROM employees WHERE id = v_employee_id FOR UPDATE;

    -- A gate, not a cap: a still-eligible employee gets the whole amount back,
    -- anyone else gets none of it and the caller is told so it can record the
    -- anomaly HR reviews.
    IF v_employment_status IS NOT DISTINCT FROM 'Regular' THEN
      UPDATE employees
         SET sil_hours_balance = COALESCE(v_balance, 0) + v_total_hours, updated_at = v_now
       WHERE id = v_employee_id;
    ELSE
      v_refund_withheld := true;
    END IF;
  END IF;

  UPDATE sil_leaves SET
    status = 'PENDING',
    hr_notes = NULL,
    hr_processed_by = NULL,
    hr_processed_at = NULL,
    approval_hash = NULL,
    hr_signature_version = NULL,
    hr_signature_timestamp = NULL,
    approval_credits_snapshot = NULL
  WHERE leave_group_id = p_group_id;

  RETURN jsonb_build_object(
    'rows', (SELECT jsonb_agg(to_jsonb(l) ORDER BY l.date) FROM sil_leaves l WHERE l.leave_group_id = p_group_id),
    'employee_id', v_employee_id,
    'employee_name', v_employee_name,
    'employment_status', v_employment_status,
    'refund_withheld', v_refund_withheld,
    'total_hours', v_total_hours,
    'dates', to_jsonb(v_dates),
    'previous_status', v_previous_status
  );
END;
$function$
;
CREATE OR REPLACE FUNCTION public.undo_undertime_decision(p_request_id uuid, p_hr_id uuid)
 RETURNS undertime_requests
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_request undertime_requests;
  v_now timestamptz := now();
BEGIN
  SELECT * INTO v_request FROM undertime_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Undertime request not found.';
  END IF;
  IF v_request.status = 'PENDING' THEN
    RAISE EXCEPTION 'Request is already pending.';
  END IF;

  UPDATE undertime_requests SET
    status = 'PENDING',
    approved_hours = NULL,
    hr_notes = NULL,
    updated_at = v_now,
    approval_hash = NULL,
    hr_signature_version = NULL,
    hr_signature_timestamp = NULL,
    hr_processed_by = NULL,
    hr_processed_at = NULL
  WHERE id = p_request_id
  RETURNING * INTO v_request;

  RETURN v_request;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.verify_form_token(lookup_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  client_ip TEXT;
  rate_limit_row RECORD;
  result_json JSONB;
  settings RECORD;
  rec RECORD;
  group_dates TEXT[];
  group_hours NUMERIC;
  dates_string TEXT;
  canon_hours TEXT;
  canon_credits TEXT;
  computed_app_hash TEXT;
  computed_appr_hash TEXT;
  app_valid BOOLEAN;
  appr_valid BOOLEAN;
BEGIN
  -- Extract client IP
  client_ip := current_setting('request.headers', true)::json->>'x-forwarded-for';
  IF client_ip IS NULL THEN
    client_ip := 'unknown';
  ELSE
    client_ip := split_part(client_ip, ',', 1);
  END IF;

  -- Simple rate limiting logic
  SELECT * INTO rate_limit_row FROM public.verification_rate_limits WHERE ip_address = client_ip;
  IF FOUND THEN
    IF rate_limit_row.last_request > NOW() - INTERVAL '1 minute' THEN
      IF rate_limit_row.request_count >= 20 THEN
        RAISE EXCEPTION 'Rate limit exceeded. Please try again later.';
      ELSE
        UPDATE public.verification_rate_limits
        SET request_count = request_count + 1, last_request = NOW()
        WHERE ip_address = client_ip;
      END IF;
    ELSE
      UPDATE public.verification_rate_limits
      SET request_count = 1, last_request = NOW()
      WHERE ip_address = client_ip;
    END IF;
  ELSE
    INSERT INTO public.verification_rate_limits (ip_address, request_count, last_request)
    VALUES (client_ip, 1, NOW());
  END IF;

  SELECT * INTO settings FROM public.hr_form_settings WHERE id = 1;

  -- Try SIL Leaves
  SELECT s.*, e.name AS employee_name, c.label AS category_label,
         hr.name AS hr_name
  INTO rec
  FROM public.sil_leaves s
  JOIN public.employees e ON s.employee_id = e.id
  LEFT JOIN public.hr_leave_categories c ON s.category_id = c.id
  LEFT JOIN public.employees hr ON s.hr_processed_by = hr.id
  WHERE s.verification_token = lookup_token;

  IF FOUND THEN
    SELECT array_agg(date::TEXT ORDER BY date), sum(hours) INTO group_dates, group_hours
    FROM public.sil_leaves WHERE leave_group_id = rec.leave_group_id;

    dates_string := array_to_string(group_dates, ',');
    canon_hours := COALESCE(trim_scale(round(group_hours, 2))::text, '');
    computed_app_hash := encode(digest(
      format('%s|%s|%s|%s|%s', rec.employee_id, COALESCE(rec.category_id::text, ''), dates_string, canon_hours, COALESCE(rec.reason, '')),
      'sha256'), 'hex');
    app_valid := (rec.application_hash IS NOT NULL) AND (computed_app_hash = rec.application_hash);

    appr_valid := NULL;
    IF rec.approval_hash IS NOT NULL AND (rec.status LIKE 'APPROVED%' OR rec.status = 'REJECTED') THEN
      canon_credits := CASE WHEN rec.approval_credits_snapshot IS NULL THEN '' ELSE trim_scale(round(rec.approval_credits_snapshot, 2))::text END;
      computed_appr_hash := encode(digest(
        format('%s|%s|%s|%s', rec.application_hash, rec.status, COALESCE(rec.hr_processed_by::text, ''), canon_credits),
        'sha256'), 'hex');
      appr_valid := (computed_appr_hash = rec.approval_hash);
    END IF;

    result_json := jsonb_build_object(
      'form_type', 'Leave',
      'employee_name', rec.employee_name,
      'category', rec.category_label,
      'inclusive_dates', to_char(rec.date, 'Mon DD, YYYY'),
      'total_hours', group_hours,
      'status', rec.status,
      'approver_name', COALESCE(rec.hr_name, settings.approver_name),
      'approval_date', COALESCE(to_char(rec.hr_processed_at, 'Mon DD, YYYY'), to_char(rec.updated_at, 'Mon DD, YYYY')),
      'application_valid', app_valid,
      'approval_valid', appr_valid,
      'employee_signature_timestamp', rec.employee_signature_timestamp,
      'hr_signature_timestamp', rec.hr_signature_timestamp
    );
    RETURN result_json;
  END IF;

  -- Try Offset Leaves
  SELECT o.*, e.name AS employee_name, c.label AS category_label,
         hr.name AS hr_name
  INTO rec
  FROM public.offset_leaves o
  JOIN public.employees e ON o.employee_id = e.id
  LEFT JOIN public.hr_leave_categories c ON o.category_id = c.id
  LEFT JOIN public.employees hr ON o.hr_processed_by = hr.id
  WHERE o.verification_token = lookup_token;

  IF FOUND THEN
    SELECT array_agg(date::TEXT ORDER BY date), sum(hours) INTO group_dates, group_hours
    FROM public.offset_leaves WHERE leave_group_id = rec.leave_group_id;

    dates_string := array_to_string(group_dates, ',');
    canon_hours := COALESCE(trim_scale(round(group_hours, 2))::text, '');
    computed_app_hash := encode(digest(
      format('%s|%s|%s|%s|%s', rec.employee_id, COALESCE(rec.category_id::text, ''), dates_string, canon_hours, COALESCE(rec.reason, '')),
      'sha256'), 'hex');
    app_valid := (rec.application_hash IS NOT NULL) AND (computed_app_hash = rec.application_hash);

    appr_valid := NULL;
    IF rec.approval_hash IS NOT NULL AND (rec.status LIKE 'APPROVED%' OR rec.status = 'REJECTED') THEN
      canon_credits := CASE WHEN rec.approval_credits_snapshot IS NULL THEN '' ELSE trim_scale(round(rec.approval_credits_snapshot, 2))::text END;
      computed_appr_hash := encode(digest(
        format('%s|%s|%s|%s', rec.application_hash, rec.status, COALESCE(rec.hr_processed_by::text, ''), canon_credits),
        'sha256'), 'hex');
      appr_valid := (computed_appr_hash = rec.approval_hash);
    END IF;

    result_json := jsonb_build_object(
      'form_type', 'Offset',
      'employee_name', rec.employee_name,
      'category', rec.category_label,
      'inclusive_dates', to_char(rec.date, 'Mon DD, YYYY'),
      'total_hours', group_hours,
      'status', rec.status,
      'approver_name', COALESCE(rec.hr_name, settings.approver_name),
      'approval_date', to_char(rec.updated_at, 'Mon DD, YYYY'),
      'application_valid', app_valid,
      'approval_valid', appr_valid,
      'employee_signature_timestamp', rec.employee_signature_timestamp,
      'hr_signature_timestamp', rec.hr_signature_timestamp
    );
    RETURN result_json;
  END IF;

  -- Try Overtime Requests
  SELECT ot.*, e.name AS employee_name, c.label AS category_label,
         hr.name AS hr_name
  INTO rec
  FROM public.overtime_requests ot
  JOIN public.employees e ON ot.employee_id = e.id
  LEFT JOIN public.hr_leave_categories c ON ot.category_id = c.id
  LEFT JOIN public.employees hr ON ot.hr_processed_by = hr.id
  WHERE ot.verification_token = lookup_token;

  IF FOUND THEN
    canon_hours := COALESCE(trim_scale(round(rec.hours, 2))::text, '');
    computed_app_hash := encode(digest(
      format('%s|%s|%s|%s|%s', rec.employee_id, COALESCE(rec.category_id::text, ''), rec.date::TEXT, canon_hours, COALESCE(rec.reason, '')),
      'sha256'), 'hex');
    app_valid := (rec.application_hash IS NOT NULL) AND (computed_app_hash = rec.application_hash);

    appr_valid := NULL;
    IF rec.approval_hash IS NOT NULL AND (rec.status LIKE 'APPROVED%' OR rec.status = 'REJECTED') THEN
      canon_credits := CASE WHEN rec.approval_credits_snapshot IS NULL THEN '' ELSE trim_scale(round(rec.approval_credits_snapshot, 2))::text END;
      computed_appr_hash := encode(digest(
        format('%s|%s|%s|%s', rec.application_hash, rec.status, COALESCE(rec.hr_processed_by::text, ''), canon_credits),
        'sha256'), 'hex');
      appr_valid := (computed_appr_hash = rec.approval_hash);
    END IF;

    result_json := jsonb_build_object(
      'form_type', 'Overtime',
      'employee_name', rec.employee_name,
      'category', rec.category_label,
      'inclusive_dates', to_char(rec.date, 'Mon DD, YYYY'),
      'total_hours', rec.hours,
      'status', rec.status,
      'approver_name', COALESCE(rec.hr_name, settings.approver_name),
      'approval_date', to_char(rec.updated_at, 'Mon DD, YYYY'),
      'application_valid', app_valid,
      'approval_valid', appr_valid,
      'employee_signature_timestamp', rec.employee_signature_timestamp,
      'hr_signature_timestamp', rec.hr_signature_timestamp
    );
    RETURN result_json;
  END IF;

  -- If not found
  RETURN NULL;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.withdraw_offset_leave(p_leave_id uuid, p_employee_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_group_id uuid;
  v_employee_id uuid;
  v_previous_status text;
  v_total_hours numeric;
  v_dates date[];
  v_first_date date;
  v_balance numeric;
  v_now timestamptz := now();
BEGIN
  SELECT leave_group_id INTO v_group_id FROM offset_leaves WHERE id = p_leave_id;
  IF v_group_id IS NULL THEN
    RAISE EXCEPTION 'Leave application not found.';
  END IF;

  PERFORM 1 FROM offset_leaves WHERE leave_group_id = v_group_id ORDER BY id FOR UPDATE;

  SELECT employee_id, status INTO v_employee_id, v_previous_status
    FROM offset_leaves WHERE id = p_leave_id;

  IF v_employee_id <> p_employee_id THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  IF v_previous_status IN ('REJECTED', 'CANCELLED') THEN
    RAISE EXCEPTION 'Cannot withdraw this request.';
  END IF;

  SELECT COALESCE(sum(COALESCE(approved_hours, hours)), 0), array_agg(date ORDER BY date), min(date)
    INTO v_total_hours, v_dates, v_first_date
    FROM offset_leaves WHERE leave_group_id = v_group_id;

  -- Issue #111 (HR-06): hours already taken are not refundable on the
  -- employee's own say-so. The cutoff is the leave's first date — see ADR 0015
  -- for why that anchor and not the printed form's filing deadline, and for
  -- why HR's undo is deliberately left unguarded as the correction route. Only
  -- an approved leave has hours to give back, so only an approved leave is
  -- guarded: a pending one has spent nothing, and guarding it would strand a
  -- past-dated application with no way for the employee to take it back.
  IF v_previous_status = 'APPROVED' AND v_first_date < CURRENT_DATE THEN
    RAISE EXCEPTION 'This leave started on % and has already been taken, so its hours cannot be withdrawn. Ask HR to undo the approval if the leave was not actually taken.', v_first_date;
  END IF;

  UPDATE offset_leaves SET
    status = 'CANCELLED',
    updated_at = v_now
  WHERE leave_group_id = v_group_id;

  IF v_previous_status = 'APPROVED' THEN
    SELECT offset_hours_balance INTO v_balance FROM employees WHERE id = v_employee_id FOR UPDATE;
    UPDATE employees
       SET offset_hours_balance = COALESCE(v_balance, 0) + v_total_hours, updated_at = v_now
     WHERE id = v_employee_id;
  END IF;

  RETURN jsonb_build_object(
    'rows', (SELECT jsonb_agg(to_jsonb(l) ORDER BY l.date) FROM offset_leaves l WHERE l.leave_group_id = v_group_id),
    'employee_id', v_employee_id,
    'group_id', v_group_id,
    'total_hours', v_total_hours,
    'dates', to_jsonb(v_dates),
    'previous_status', v_previous_status
  );
END;
$function$
;

-- ============================================================
-- Triggers
-- ============================================================

CREATE TRIGGER costing_events_write AFTER INSERT OR DELETE OR UPDATE ON public.costing_bid_decisions FOR EACH ROW EXECUTE FUNCTION costing_write_events();
CREATE TRIGGER costing_bands BEFORE INSERT OR DELETE OR UPDATE ON public.costing_component_costs FOR EACH ROW EXECUTE FUNCTION costing_enforce_bands();
CREATE TRIGGER costing_bid_clear_component AFTER INSERT OR DELETE OR UPDATE ON public.costing_component_costs FOR EACH ROW EXECUTE FUNCTION costing_bid_decisions_clear('A Final Acquire changed', 'final_acquire_unit');
CREATE TRIGGER costing_events_write AFTER INSERT OR DELETE OR UPDATE ON public.costing_component_costs FOR EACH ROW EXECUTE FUNCTION costing_write_events();
CREATE TRIGGER costing_print_clear_acquire AFTER INSERT OR DELETE OR UPDATE ON public.costing_component_costs FOR EACH ROW EXECUTE FUNCTION costing_clear_print_signoffs('costed', 'An Acquire changed', 'acquire_unit');
CREATE TRIGGER costing_print_clear_factor AFTER INSERT OR DELETE OR UPDATE ON public.costing_component_costs FOR EACH ROW EXECUTE FUNCTION costing_clear_print_signoffs('costed', 'A markup factor changed', 'markup_factor');
CREATE TRIGGER costing_print_clear_final_acquire AFTER INSERT OR DELETE OR UPDATE ON public.costing_component_costs FOR EACH ROW EXECUTE FUNCTION costing_clear_print_signoffs('final_approved', 'A Final Acquire changed', 'final_acquire_unit');
CREATE TRIGGER trg_canvass_null_fill_mark BEFORE UPDATE OF acquire_unit ON public.costing_component_costs FOR EACH ROW EXECUTE FUNCTION canvass_null_fill_mark();
CREATE TRIGGER costing_bands BEFORE INSERT OR DELETE OR UPDATE ON public.costing_components FOR EACH ROW EXECUTE FUNCTION costing_enforce_bands();
CREATE TRIGGER costing_bundle_keeps_inclusions BEFORE UPDATE OF is_bundle ON public.costing_components FOR EACH ROW EXECUTE FUNCTION costing_bundle_keeps_inclusions();
CREATE TRIGGER costing_check_incharge BEFORE INSERT OR UPDATE OF sales_incharge_id, purchasing_incharge_id ON public.costing_components FOR EACH ROW EXECUTE FUNCTION costing_check_incharge();
CREATE TRIGGER costing_clear_evaluation_components AFTER INSERT OR DELETE OR UPDATE OF offer_specification, compliance, compliance_note ON public.costing_components FOR EACH ROW EXECUTE FUNCTION costing_clear_evaluation_approval();
CREATE TRIGGER costing_component_delete_guard BEFORE DELETE ON public.costing_components FOR EACH ROW EXECUTE FUNCTION costing_component_delete_guard();
CREATE TRIGGER costing_components_cleanup BEFORE DELETE ON public.costing_components FOR EACH ROW EXECUTE FUNCTION costing_components_cleanup();
CREATE TRIGGER costing_events_write AFTER INSERT OR DELETE OR UPDATE ON public.costing_components FOR EACH ROW EXECUTE FUNCTION costing_write_events();
CREATE TRIGGER trg_canvass_null_fill_mark BEFORE UPDATE OF offer_specification ON public.costing_components FOR EACH ROW EXECUTE FUNCTION canvass_null_fill_mark();
CREATE TRIGGER costing_bands BEFORE INSERT OR DELETE OR UPDATE ON public.costing_cost_rows FOR EACH ROW EXECUTE FUNCTION costing_enforce_bands();
CREATE TRIGGER costing_bid_clear_cost_row AFTER INSERT OR DELETE OR UPDATE ON public.costing_cost_rows FOR EACH ROW EXECUTE FUNCTION costing_bid_decisions_clear('A Final Acquire changed', 'final_acquire_unit');
CREATE TRIGGER costing_events_write AFTER INSERT OR DELETE OR UPDATE ON public.costing_cost_rows FOR EACH ROW EXECUTE FUNCTION costing_write_events();
CREATE TRIGGER costing_print_clear_acquire AFTER INSERT OR DELETE OR UPDATE ON public.costing_cost_rows FOR EACH ROW EXECUTE FUNCTION costing_clear_print_signoffs('costed', 'An Acquire changed', 'acquire_unit');
CREATE TRIGGER costing_print_clear_factor AFTER INSERT OR DELETE OR UPDATE ON public.costing_cost_rows FOR EACH ROW EXECUTE FUNCTION costing_clear_print_signoffs('costed', 'A markup factor changed', 'markup_factor');
CREATE TRIGGER costing_print_clear_final_acquire AFTER INSERT OR DELETE OR UPDATE ON public.costing_cost_rows FOR EACH ROW EXECUTE FUNCTION costing_clear_print_signoffs('final_approved', 'A Final Acquire changed', 'final_acquire_unit');
CREATE TRIGGER costing_events_no_change BEFORE DELETE OR UPDATE ON public.costing_events FOR EACH ROW EXECUTE FUNCTION costing_events_append_only();
CREATE TRIGGER costing_events_no_truncate BEFORE TRUNCATE ON public.costing_events FOR EACH STATEMENT EXECUTE FUNCTION costing_events_append_only();
CREATE TRIGGER costing_bands BEFORE INSERT OR DELETE OR UPDATE ON public.costing_inclusions FOR EACH ROW EXECUTE FUNCTION costing_enforce_bands();
CREATE TRIGGER costing_events_write AFTER INSERT OR DELETE OR UPDATE ON public.costing_inclusions FOR EACH ROW EXECUTE FUNCTION costing_write_events();
CREATE TRIGGER costing_inclusion_needs_bundle BEFORE INSERT OR UPDATE OF component_id ON public.costing_inclusions FOR EACH ROW EXECUTE FUNCTION costing_inclusion_needs_bundle();
CREATE TRIGGER costing_markup_presets_touch BEFORE UPDATE ON public.costing_markup_presets FOR EACH ROW EXECUTE FUNCTION costing_markup_presets_touch();
CREATE TRIGGER costing_bands BEFORE INSERT OR DELETE OR UPDATE ON public.costing_matrices FOR EACH ROW EXECUTE FUNCTION costing_enforce_bands();
CREATE TRIGGER costing_check_incharge BEFORE INSERT OR UPDATE OF sales_incharge_id, purchasing_incharge_id ON public.costing_matrices FOR EACH ROW EXECUTE FUNCTION costing_check_incharge();
CREATE TRIGGER costing_events_write AFTER INSERT OR DELETE OR UPDATE ON public.costing_matrices FOR EACH ROW EXECUTE FUNCTION costing_write_events();
CREATE TRIGGER costing_matrices_touch BEFORE UPDATE ON public.costing_matrices FOR EACH ROW EXECUTE FUNCTION costing_touch_updated_at();
CREATE TRIGGER costing_bands BEFORE INSERT OR DELETE OR UPDATE ON public.costing_matrix_money FOR EACH ROW EXECUTE FUNCTION costing_enforce_bands();
CREATE TRIGGER costing_events_write AFTER INSERT OR DELETE OR UPDATE ON public.costing_matrix_money FOR EACH ROW EXECUTE FUNCTION costing_write_events();
CREATE TRIGGER costing_matrix_money_touch BEFORE UPDATE ON public.costing_matrix_money FOR EACH ROW EXECUTE FUNCTION costing_touch_updated_at();
CREATE TRIGGER costing_print_clear_default_factor AFTER UPDATE ON public.costing_matrix_money FOR EACH ROW EXECUTE FUNCTION costing_clear_print_signoffs('costed', 'A markup factor changed', 'default_factor');
CREATE TRIGGER costing_settings_stamp BEFORE UPDATE ON public.costing_settings FOR EACH ROW EXECUTE FUNCTION costing_settings_stamp();
CREATE TRIGGER costing_events_write AFTER INSERT OR DELETE OR UPDATE ON public.costing_signoffs FOR EACH ROW EXECUTE FUNCTION costing_write_events();
CREATE TRIGGER costing_signoffs_guard BEFORE UPDATE ON public.costing_signoffs FOR EACH ROW EXECUTE FUNCTION costing_signoffs_guard();
CREATE TRIGGER costing_bands BEFORE INSERT OR DELETE OR UPDATE ON public.costing_tender_line_prices FOR EACH ROW EXECUTE FUNCTION costing_enforce_bands();
CREATE TRIGGER costing_bid_clear_offer AFTER INSERT OR DELETE OR UPDATE ON public.costing_tender_line_prices FOR EACH ROW EXECUTE FUNCTION costing_bid_decisions_clear('The Final Offer changed', 'final_offer_unit');
CREATE TRIGGER costing_events_write AFTER INSERT OR DELETE OR UPDATE ON public.costing_tender_line_prices FOR EACH ROW EXECUTE FUNCTION costing_write_events();
CREATE TRIGGER costing_final_offer_log AFTER INSERT OR UPDATE OF final_offer_unit ON public.costing_tender_line_prices FOR EACH ROW EXECUTE FUNCTION costing_log_final_offer_change();
CREATE TRIGGER costing_print_clear_offer AFTER INSERT OR DELETE OR UPDATE ON public.costing_tender_line_prices FOR EACH ROW EXECUTE FUNCTION costing_clear_print_signoffs('prepared,final_approved', 'The Final Offer changed', 'final_offer_unit');
CREATE TRIGGER costing_bands BEFORE INSERT OR DELETE OR UPDATE ON public.costing_tender_lines FOR EACH ROW EXECUTE FUNCTION costing_enforce_bands();
CREATE TRIGGER costing_bid_clear_quantity AFTER UPDATE ON public.costing_tender_lines FOR EACH ROW EXECUTE FUNCTION costing_bid_decisions_clear('The Final Offer changed', 'quantity');
CREATE TRIGGER costing_clear_evaluation_lines AFTER INSERT OR DELETE OR UPDATE OF tender_specification ON public.costing_tender_lines FOR EACH ROW EXECUTE FUNCTION costing_clear_evaluation_approval();
CREATE TRIGGER costing_events_write AFTER INSERT OR DELETE OR UPDATE ON public.costing_tender_lines FOR EACH ROW EXECUTE FUNCTION costing_write_events();
CREATE TRIGGER costing_print_clear_quantity AFTER UPDATE ON public.costing_tender_lines FOR EACH ROW EXECUTE FUNCTION costing_clear_print_signoffs('prepared,final_approved', 'The Final Offer changed', 'quantity');
CREATE TRIGGER costing_tender_line_delete_guard BEFORE DELETE ON public.costing_tender_lines FOR EACH ROW EXECUTE FUNCTION costing_tender_line_delete_guard();
CREATE TRIGGER costing_tender_lines_cleanup BEFORE DELETE ON public.costing_tender_lines FOR EACH ROW EXECUTE FUNCTION costing_tender_lines_cleanup();
CREATE TRIGGER purchase_request_access_changed AFTER UPDATE OF has_purchasing_flow, is_deleted ON public.employees FOR EACH ROW WHEN (((old.has_purchasing_flow IS DISTINCT FROM new.has_purchasing_flow) OR (old.is_deleted IS DISTINCT FROM new.is_deleted))) EXECUTE FUNCTION _purchase_request_purchasing_access_changed();
CREATE TRIGGER purchase_request_access_granted_on_insert AFTER INSERT ON public.employees FOR EACH ROW EXECUTE FUNCTION _purchase_request_purchasing_access_changed();
CREATE TRIGGER trg_prevent_role_escalation BEFORE UPDATE ON public.employees FOR EACH ROW EXECUTE FUNCTION prevent_role_escalation();
CREATE TRIGGER trg_group_task_templates_touch BEFORE UPDATE ON public.group_task_templates FOR EACH ROW EXECUTE FUNCTION group_task_templates_touch();
CREATE TRIGGER ipas_actual_checking_hand_guard BEFORE UPDATE ON public.ipas FOR EACH ROW EXECUTE FUNCTION ipas_actual_checking_hand_guard();
CREATE TRIGGER ipas_filing_clears_hold BEFORE UPDATE OF state ON public.ipas FOR EACH ROW EXECUTE FUNCTION ipas_filing_clears_hold();
CREATE TRIGGER ipas_fill_from_odoo_copy BEFORE INSERT OR UPDATE OF odoo_copy ON public.ipas FOR EACH ROW EXECUTE FUNCTION ipas_fill_from_odoo_copy();
CREATE TRIGGER ipas_freeze BEFORE DELETE OR UPDATE ON public.ipas FOR EACH ROW EXECUTE FUNCTION ipas_freeze_guard();
CREATE TRIGGER ipas_guard BEFORE UPDATE ON public.ipas FOR EACH ROW EXECUTE FUNCTION ipas_guard();
CREATE TRIGGER ipas_lc_clear AFTER UPDATE OF landed_cost_split, computation_status, odoo_copy ON public.ipas FOR EACH ROW EXECUTE FUNCTION ipas_lc_header_changed();
CREATE CONSTRAINT TRIGGER ipas_sor_rule_on_ipas AFTER INSERT OR UPDATE OF purpose ON public.ipas DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION ipas_enforce_sor_rule();
CREATE TRIGGER ipas_suggest_documents AFTER INSERT ON public.ipas FOR EACH ROW EXECUTE FUNCTION ipas_suggest_documents_on_insert();
CREATE TRIGGER ipas_updated_at BEFORE UPDATE ON public.ipas FOR EACH ROW EXECUTE FUNCTION set_ipas_updated_at();
CREATE TRIGGER ipas_bank_details_freeze BEFORE INSERT OR DELETE OR UPDATE ON public.ipas_bank_details FOR EACH ROW EXECUTE FUNCTION ipas_children_freeze_guard();
CREATE TRIGGER ipas_bank_details_updated_at BEFORE UPDATE ON public.ipas_bank_details FOR EACH ROW EXECUTE FUNCTION set_ipas_updated_at();
CREATE TRIGGER ipas_charges_freeze BEFORE INSERT OR DELETE OR UPDATE ON public.ipas_charges FOR EACH ROW EXECUTE FUNCTION ipas_children_freeze_guard();
CREATE TRIGGER ipas_charges_lc_clear AFTER INSERT OR DELETE OR UPDATE ON public.ipas_charges FOR EACH ROW EXECUTE FUNCTION ipas_lc_money_changed();
CREATE TRIGGER ipas_charges_updated_at BEFORE UPDATE ON public.ipas_charges FOR EACH ROW EXECUTE FUNCTION set_ipas_updated_at();
CREATE TRIGGER ipas_documents_freeze BEFORE INSERT OR DELETE OR UPDATE ON public.ipas_documents FOR EACH ROW EXECUTE FUNCTION ipas_children_freeze_guard();
CREATE TRIGGER ipas_documents_updated_at BEFORE UPDATE ON public.ipas_documents FOR EACH ROW EXECUTE FUNCTION set_ipas_updated_at();
CREATE TRIGGER ipas_events_no_change BEFORE DELETE OR UPDATE ON public.ipas_events FOR EACH ROW EXECUTE FUNCTION ipas_events_append_only();
CREATE TRIGGER ipas_events_no_truncate BEFORE TRUNCATE ON public.ipas_events FOR EACH STATEMENT EXECUTE FUNCTION ipas_events_append_only();
CREATE TRIGGER ipas_options_filed_guard BEFORE UPDATE ON public.ipas_options FOR EACH ROW EXECUTE FUNCTION ipas_options_filed_guard();
CREATE TRIGGER ipas_options_guard BEFORE UPDATE ON public.ipas_options FOR EACH ROW EXECUTE FUNCTION ipas_options_guard();
CREATE TRIGGER ipas_options_updated_at BEFORE UPDATE ON public.ipas_options FOR EACH ROW EXECUTE FUNCTION set_ipas_updated_at();
CREATE TRIGGER ipas_payments_freeze BEFORE INSERT OR DELETE OR UPDATE ON public.ipas_payments FOR EACH ROW EXECUTE FUNCTION ipas_children_freeze_guard();
CREATE TRIGGER ipas_payments_lc_clear AFTER INSERT OR DELETE OR UPDATE ON public.ipas_payments FOR EACH ROW EXECUTE FUNCTION ipas_lc_money_changed();
CREATE TRIGGER ipas_payments_paid_before_approval BEFORE INSERT OR UPDATE ON public.ipas_payments FOR EACH ROW EXECUTE FUNCTION ipas_payments_paid_before_approval();
CREATE TRIGGER ipas_payments_updated_at BEFORE UPDATE ON public.ipas_payments FOR EACH ROW EXECUTE FUNCTION set_ipas_updated_at();
CREATE TRIGGER ipas_signer_list_log_no_change BEFORE DELETE OR UPDATE ON public.ipas_signer_list_log FOR EACH ROW EXECUTE FUNCTION ipas_signer_list_log_append_only();
CREATE TRIGGER ipas_signer_list_log_no_truncate BEFORE TRUNCATE ON public.ipas_signer_list_log FOR EACH STATEMENT EXECUTE FUNCTION ipas_signer_list_log_append_only();
CREATE TRIGGER ipas_signoffs_guard BEFORE UPDATE ON public.ipas_signoffs FOR EACH ROW EXECUTE FUNCTION ipas_signoffs_guard();
CREATE TRIGGER ipas_signoffs_lc_fingerprint BEFORE INSERT ON public.ipas_signoffs FOR EACH ROW EXECUTE FUNCTION ipas_signoffs_lc_fingerprint();
CREATE CONSTRAINT TRIGGER ipas_sor_rule_on_sors AFTER INSERT OR DELETE OR UPDATE ON public.ipas_sors DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION ipas_enforce_sor_rule();
CREATE TRIGGER ipas_sors_freeze BEFORE INSERT OR DELETE OR UPDATE ON public.ipas_sors FOR EACH ROW EXECUTE FUNCTION ipas_children_freeze_guard();
CREATE TRIGGER trg_odoo_retail_queue_updated_at BEFORE UPDATE ON public.odoo_retail_queue FOR EACH ROW EXECUTE FUNCTION set_odoo_retail_queue_updated_at();
CREATE TRIGGER offset_leaves_guard_head_status BEFORE UPDATE ON public.offset_leaves FOR EACH ROW EXECUTE FUNCTION guard_head_status_change();
CREATE TRIGGER order_ageing_rules_stamp BEFORE INSERT OR UPDATE ON public.order_ageing_rules FOR EACH ROW EXECUTE FUNCTION order_ageing_rules_stamp();
CREATE TRIGGER order_deadline_setting_stamp BEFORE INSERT OR UPDATE ON public.order_deadline_setting FOR EACH ROW EXECUTE FUNCTION order_deadline_setting_stamp();
CREATE TRIGGER overtime_requests_guard_head_status BEFORE UPDATE ON public.overtime_requests FOR EACH ROW EXECUTE FUNCTION guard_head_status_change();
CREATE TRIGGER packing_list_boxes_guard BEFORE INSERT OR DELETE OR UPDATE ON public.packing_list_boxes FOR EACH ROW EXECUTE FUNCTION packing_list_boxes_guard();
CREATE TRIGGER packing_list_contents_guard BEFORE INSERT OR DELETE OR UPDATE ON public.packing_list_contents FOR EACH ROW EXECUTE FUNCTION packing_list_contents_guard();
CREATE TRIGGER packing_lists_guard BEFORE DELETE OR UPDATE ON public.packing_lists FOR EACH ROW EXECUTE FUNCTION packing_lists_guard();
CREATE TRIGGER pms_evidence_guard BEFORE INSERT OR DELETE OR UPDATE ON public.pms_evidence FOR EACH ROW EXECUTE FUNCTION pms_evidence_guard();
CREATE TRIGGER pms_handoff_events_no_change BEFORE DELETE OR UPDATE ON public.pms_handoff_events FOR EACH ROW EXECUTE FUNCTION pms_handoff_events_append_only();
CREATE TRIGGER pms_handoff_events_no_truncate BEFORE TRUNCATE ON public.pms_handoff_events FOR EACH STATEMENT EXECUTE FUNCTION pms_handoff_events_append_only();
CREATE TRIGGER purchase_request_messages_broadcast_change_trigger AFTER INSERT ON public.purchase_request_messages FOR EACH ROW EXECUTE FUNCTION purchase_request_messages_broadcast_change();
CREATE TRIGGER purchase_request_messages_notify AFTER INSERT ON public.purchase_request_messages FOR EACH ROW EXECUTE FUNCTION _purchase_request_message_notify();
CREATE TRIGGER purchase_requests_updated_at BEFORE UPDATE ON public.purchase_requests FOR EACH ROW EXECUTE FUNCTION set_purchase_requests_updated_at();
CREATE TRIGGER retail_orders_broadcast_change_trigger AFTER INSERT OR DELETE OR UPDATE ON public.retail_orders FOR EACH ROW EXECUTE FUNCTION retail_orders_broadcast_change();
CREATE TRIGGER trg_retail_orders_updated_at BEFORE UPDATE ON public.retail_orders FOR EACH ROW EXECUTE FUNCTION set_retail_orders_updated_at();
CREATE TRIGGER purchase_request_sor_status_notify AFTER UPDATE OF is_deleted, flow_stage_id ON public.sales_opportunities FOR EACH ROW EXECUTE FUNCTION _purchase_request_sor_status_notify();
CREATE TRIGGER sales_opportunities_broadcast_change_trigger AFTER INSERT OR DELETE OR UPDATE ON public.sales_opportunities FOR EACH ROW EXECUTE FUNCTION sales_opportunities_broadcast_change();
CREATE TRIGGER sor_guard_non_editor_update BEFORE UPDATE ON public.sales_opportunities FOR EACH ROW EXECUTE FUNCTION sor_guard_non_editor_update();
CREATE TRIGGER sor_guard_stage_move BEFORE UPDATE OF flow_stage_id ON public.sales_opportunities FOR EACH ROW EXECUTE FUNCTION sor_guard_stage_move();
CREATE TRIGGER sor_stage_participants_on_stage_change AFTER UPDATE OF flow_stage_id ON public.sales_opportunities FOR EACH ROW EXECUTE FUNCTION close_stage_participant_windows();
CREATE TRIGGER sor_stage_visits_on_insert AFTER INSERT ON public.sales_opportunities FOR EACH ROW EXECUTE FUNCTION record_stage_visit();
CREATE TRIGGER sor_stage_visits_on_stage_change AFTER UPDATE OF flow_stage_id ON public.sales_opportunities FOR EACH ROW EXECUTE FUNCTION record_stage_visit();
CREATE TRIGGER trg_sales_opportunities_guard BEFORE UPDATE ON public.sales_opportunities FOR EACH ROW EXECUTE FUNCTION sales_opportunities_guard();
CREATE TRIGGER trg_sales_opportunities_require_sales_ref BEFORE INSERT OR UPDATE ON public.sales_opportunities FOR EACH ROW EXECUTE FUNCTION sales_opportunities_require_sales_ref();
CREATE TRIGGER trg_sales_opportunity_items_touch BEFORE UPDATE ON public.sales_opportunity_items FOR EACH ROW EXECUTE FUNCTION sales_opportunity_items_touch();
CREATE TRIGGER trg_sor_items_recalc AFTER INSERT OR DELETE OR UPDATE ON public.sales_opportunity_items FOR EACH ROW EXECUTE FUNCTION sor_recalc_expected_value();
CREATE TRIGGER sor_logs_set_stage_visit BEFORE INSERT ON public.sales_opportunity_logs FOR EACH ROW EXECUTE FUNCTION sor_set_log_stage_visit();
CREATE TRIGGER sil_leaves_guard_head_status BEFORE UPDATE ON public.sil_leaves FOR EACH ROW EXECUTE FUNCTION guard_head_status_change();
CREATE TRIGGER trg_canvass_clear_on_price_change AFTER INSERT OR DELETE OR UPDATE ON public.sor_canvass_offer_prices FOR EACH ROW EXECUTE FUNCTION canvass_clear_on_price_change();
CREATE TRIGGER trg_sor_canvass_offer_prices_check_rate BEFORE INSERT OR UPDATE ON public.sor_canvass_offer_prices FOR EACH ROW EXECUTE FUNCTION sor_canvass_offer_prices_check_rate();
CREATE TRIGGER trg_canvass_clear_on_offer_change AFTER INSERT OR DELETE OR UPDATE ON public.sor_canvass_offers FOR EACH ROW EXECUTE FUNCTION canvass_clear_on_offer_change();
CREATE TRIGGER trg_sor_canvass_offers_check_currency BEFORE UPDATE OF currency ON public.sor_canvass_offers FOR EACH ROW EXECUTE FUNCTION sor_canvass_offers_check_currency();
CREATE TRIGGER trg_sor_canvass_offers_touch BEFORE UPDATE ON public.sor_canvass_offers FOR EACH ROW EXECUTE FUNCTION sor_canvass_offers_touch();
CREATE TRIGGER trg_sor_canvass_signoff_events_append_only BEFORE DELETE OR UPDATE ON public.sor_canvass_signoff_events FOR EACH ROW EXECUTE FUNCTION sor_canvass_signoff_events_append_only();
CREATE TRIGGER trg_canvass_clear_on_reason_change AFTER UPDATE OF reason ON public.sor_canvasses FOR EACH ROW EXECUTE FUNCTION canvass_clear_on_reason_change();
CREATE TRIGGER trg_sor_canvasses_assign_number BEFORE INSERT ON public.sor_canvasses FOR EACH ROW EXECUTE FUNCTION sor_canvasses_assign_number();
CREATE TRIGGER trg_sor_canvasses_default_canvasser BEFORE INSERT ON public.sor_canvasses FOR EACH ROW EXECUTE FUNCTION sor_canvasses_default_canvasser();
CREATE TRIGGER trg_sor_canvasses_guard_signoff BEFORE INSERT OR UPDATE ON public.sor_canvasses FOR EACH ROW EXECUTE FUNCTION sor_canvasses_guard_signoff();
CREATE TRIGGER trg_sor_canvasses_keep_number BEFORE UPDATE ON public.sor_canvasses FOR EACH ROW EXECUTE FUNCTION sor_canvasses_keep_number();
CREATE TRIGGER trg_sor_canvasses_mark_canvassing AFTER INSERT ON public.sor_canvasses FOR EACH ROW EXECUTE FUNCTION sor_canvasses_mark_canvassing();
CREATE TRIGGER trg_sor_canvasses_refuse_component_item BEFORE INSERT OR UPDATE OF requested_item_id ON public.sor_canvasses FOR EACH ROW EXECUTE FUNCTION sor_canvasses_refuse_component_item();
CREATE TRIGGER trg_sor_canvasses_touch BEFORE UPDATE ON public.sor_canvasses FOR EACH ROW EXECUTE FUNCTION sor_canvasses_touch();
CREATE TRIGGER trg_sor_inclusions_touch BEFORE UPDATE ON public.sor_inclusions FOR EACH ROW EXECUTE FUNCTION sor_inclusions_touch();
CREATE TRIGGER trg_sor_procurement_requests_guard BEFORE UPDATE ON public.sor_procurement_requests FOR EACH ROW EXECUTE FUNCTION sor_procurement_requests_guard();
CREATE TRIGGER trg_sor_procurement_requests_touch BEFORE UPDATE ON public.sor_procurement_requests FOR EACH ROW EXECUTE FUNCTION sor_procurement_requests_touch();
CREATE TRIGGER trg_sor_purchase_order_links_touch BEFORE UPDATE ON public.sor_purchase_order_links FOR EACH ROW EXECUTE FUNCTION sor_purchase_order_links_touch();
CREATE TRIGGER enforce_task_verification_security BEFORE UPDATE ON public.tasks FOR EACH ROW EXECUTE FUNCTION protect_task_verification();
CREATE TRIGGER tasks_broadcast_change_trigger AFTER INSERT OR DELETE OR UPDATE ON public.tasks FOR EACH ROW EXECUTE FUNCTION tasks_broadcast_change();
CREATE TRIGGER transmittal_cleared_signatures_no_change BEFORE DELETE OR UPDATE ON public.transmittal_cleared_signatures FOR EACH ROW EXECUTE FUNCTION transmittal_cleared_signatures_append_only();
CREATE TRIGGER transmittal_lines_guard BEFORE INSERT OR DELETE OR UPDATE ON public.transmittal_lines FOR EACH ROW EXECUTE FUNCTION transmittal_lines_guard();
CREATE TRIGGER transmittal_lines_sync_links AFTER INSERT OR DELETE OR UPDATE ON public.transmittal_lines FOR EACH ROW EXECUTE FUNCTION transmittal_lines_sync_links();
CREATE TRIGGER transmittal_products_guard BEFORE INSERT OR DELETE OR UPDATE ON public.transmittal_products FOR EACH ROW EXECUTE FUNCTION transmittal_children_guard();
CREATE TRIGGER transmittal_references_guard BEFORE INSERT OR DELETE OR UPDATE ON public.transmittal_references FOR EACH ROW EXECUTE FUNCTION transmittal_children_guard();
CREATE TRIGGER transmittal_stages_guard BEFORE DELETE OR UPDATE ON public.transmittal_stages FOR EACH ROW EXECUTE FUNCTION transmittal_stages_guard();
CREATE TRIGGER transmittals_guard BEFORE DELETE OR UPDATE ON public.transmittals FOR EACH ROW EXECUTE FUNCTION transmittals_guard();
CREATE TRIGGER undertime_requests_guard_head_status BEFORE UPDATE ON public.undertime_requests FOR EACH ROW EXECUTE FUNCTION guard_head_status_change();

-- ============================================================
-- Views
-- ============================================================

