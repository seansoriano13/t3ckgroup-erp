-- ==============================================================================
-- 20260904000000_baseline_schema.sql
--
-- Baseline (issue #87): supabase/migrations/ built 17 tables while both live
-- databases held 57 — the other 40-odd tables existed only inside the two
-- Supabase projects, so supabase db reset produced a database this
-- application could not run against and every migration's first real
-- audience was the staging database itself.
--
-- This file closes that gap. It is generated, once, from the shared schema
-- of production and staging (schema-identical as of 2026-09-05 — see the
-- Phase 0 inspection on issue #87) and is then treated as immutable history,
-- like any other applied migration: it is not regenerated or hand-edited
-- after this commit.
--
-- Ordering ahead of every existing migration (see docs/adr/0007) puts the
-- full schema in place before the three migrations already recorded in both
-- databases' ledgers replay on top of it — harmlessly, since all three are
-- idempotent (IF NOT EXISTS / OR REPLACE / WHERE-guarded backfills) and this
-- baseline already contains everything they create.
--
-- Section order departs from the generated schema mirror
-- (supabase/schema/{prod,staging}.sql) in two ways, both required for this
-- content to actually execute against an empty database rather than merely
-- describe one:
--
--   1. Constraints are ordered primary key / unique, then check, then
--      foreign key (scripts/db-snapshot.mjs now generates them in this order
--      for the mirror too). A foreign key needs the unique index it
--      references to exist first; the mirror's original alphabetical-by-type
--      ordering ('c','f','p','u') put foreign keys before the primary keys
--      they pointed at, which is invisible in a file nothing ever executes
--      and fatal in a baseline that is executed. Found by actually applying
--      this file to an empty database — see docs/adr/0011.
--   2. Functions are created before Row Level Security and Policies, not
--      after, because CREATE POLICY resolves the functions its USING/WITH
--      CHECK clauses call at creation time (e.g. public.get_employee_id())
--      — creating the policies first fails against an empty database with
--      "function ... does not exist".
--
-- NEVER MARK THIS "APPLIED" ON A DATABASE THAT DOES NOT ALREADY HAVE THIS
-- SCHEMA. It is not meant to run against production or staging — both
-- already have every object it creates. It is marked as already applied in
-- both ledgers via a repair workflow (see
-- .github/workflows/repair-migration-history.yml), never executed there.
-- ==============================================================================

-- ============================================================
-- Extensions
-- ============================================================

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
  "require_revenue_verification" boolean not null default false,
  "allow_reported_to_reassignment" boolean not null default false,
  "sales_self_approve_expenses" boolean default false
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
  "opportunity_id" uuid
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
  "last_seen_changelog_version" text
);

create table if not exists public."faq_data" (
  "id" integer not null default 1,
  "categories" jsonb not null default '[]'::jsonb,
  "updated_at" timestamp with time zone not null default now()
);

create table if not exists public."flow_edges" (
  "id" uuid not null default gen_random_uuid(),
  "flow_id" uuid not null,
  "from_stage_id" uuid not null,
  "to_stage_id" uuid not null,
  "created_at" timestamp with time zone not null default now()
);

create table if not exists public."flow_plans" (
  "id" uuid not null default gen_random_uuid(),
  "name" text not null,
  "yjs_state" bytea,
  "created_by" uuid,
  "created_at" timestamp with time zone not null default now(),
  "updated_at" timestamp with time zone not null default now()
);

create table if not exists public."flow_snapshots" (
  "id" uuid not null default gen_random_uuid(),
  "flow_id" uuid not null,
  "version" integer not null,
  "snapshot_data" jsonb not null,
  "created_at" timestamp with time zone not null default now(),
  "created_by" uuid
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
  "bracket_label" text
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

create table if not exists public."hr_form_settings" (
  "id" integer not null,
  "supervisor_name" text not null default ''::text,
  "supervisor_title" text not null default ''::text,
  "approver_name" text not null default ''::text,
  "approver_title" text not null default '201'::text,
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
  "printed_by" uuid
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
  "printed_by" uuid
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

create table if not exists public."sales_activities" (
  "id" bigint not null generated always as identity,
  "plan_id" bigint,
  "employee_id" uuid not null,
  "scheduled_date" date not null,
  "completed_at" timestamp with time zone,
  "status" character varying default 'INCOMPLETE'::character varying,
  "time_of_day" character varying not null,
  "activity_type" character varying not null,
  "account_name" text,
  "contact_person" text,
  "contact_number" text,
  "email_address" text,
  "address" text,
  "remarks_plan" text,
  "details_daily" text,
  "is_unplanned" boolean default false,
  "is_verified" boolean default false,
  "created_at" timestamp with time zone not null default timezone('utc'::text, now()),
  "head_remarks" text,
  "head_verified_at" timestamp with time zone,
  "head_verified_by" uuid,
  "reference_number" text,
  "expense_amount" numeric,
  "sales_outcome" text,
  "is_deleted" boolean default false,
  "delete_reason" text,
  "delete_requested_by" uuid,
  "attachments" jsonb default '[]'::jsonb
);

create table if not exists public."sales_activity_logs" (
  "id" uuid not null default gen_random_uuid(),
  "sales_activity_id" bigint not null,
  "author_id" uuid,
  "type" character varying not null,
  "content" text not null,
  "metadata" jsonb,
  "created_at" timestamp with time zone not null default timezone('utc'::text, now())
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
  "flow_snapshot_id" uuid
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
  "updated_at" timestamp with time zone not null default now()
);

create table if not exists public."sales_opportunity_logs" (
  "id" uuid not null default gen_random_uuid(),
  "opportunity_id" uuid not null,
  "author_id" uuid,
  "type" text not null default 'COMMENT'::text,
  "content" text not null,
  "metadata" jsonb,
  "created_at" timestamp with time zone not null default now()
);

create table if not exists public."sales_opportunity_members" (
  "id" uuid not null default gen_random_uuid(),
  "opportunity_id" uuid not null,
  "employee_id" uuid not null,
  "added_by" uuid,
  "added_at" timestamp with time zone not null default now()
);

create table if not exists public."sales_quota_logs" (
  "id" uuid not null default gen_random_uuid(),
  "quota_id" bigint not null,
  "changed_by" uuid,
  "old_amount" numeric,
  "new_amount" numeric not null,
  "action" character varying not null,
  "created_at" timestamp with time zone not null default timezone('utc'::text, now())
);

create table if not exists public."sales_quotas" (
  "id" bigint not null generated always as identity,
  "employee_id" uuid not null,
  "amount_target" numeric not null,
  "month_year" character varying not null,
  "created_at" timestamp with time zone not null default timezone('utc'::text, now()),
  "status" character varying not null default 'PUBLISHED'::character varying,
  "current_actual" numeric default 0,
  "revenue_lost" numeric default 0,
  "deals_won" integer default 0,
  "deals_lost" integer default 0,
  "deals_pending" integer default 0
);

create table if not exists public."sales_revenue_logs" (
  "id" bigint not null generated always as identity,
  "employee_id" uuid not null,
  "date" date not null,
  "status" character varying not null,
  "account" character varying not null,
  "product_item_sold" text not null,
  "revenue_amount" numeric not null,
  "remarks" text,
  "is_deleted" boolean not null default false,
  "deleted_at" timestamp with time zone,
  "so_number" character varying,
  "created_at" timestamp with time zone not null default timezone('utc'::text, now()),
  "last_edited_by" uuid,
  "last_edited_at" timestamp with time zone,
  "is_verified" boolean default true,
  "edit_request_amount" numeric,
  "edit_request_reason" text,
  "edit_request_status" character varying,
  "edit_requested_at" timestamp with time zone,
  "record_type" character varying not null default 'SALES_ORDER'::character varying,
  "quotation_number" character varying,
  "reference_number" character varying,
  "is_converted" boolean default false
);

create table if not exists public."sales_weekly_plans" (
  "id" bigint not null generated always as identity,
  "employee_id" uuid not null,
  "week_start_date" date not null,
  "status" character varying not null,
  "created_at" timestamp with time zone not null default timezone('utc'::text, now()),
  "amendment_snapshot" jsonb,
  "amendment_reason" text,
  "amendment_requested_at" timestamp with time zone
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
  "printed_by" uuid
);

create table if not exists public."sor_canvass_offers" (
  "id" uuid not null default gen_random_uuid(),
  "canvass_id" uuid not null,
  "brand" text,
  "description" text,
  "source_link" text,
  "brochure" jsonb not null default '[]'::jsonb,
  "remarks" text,
  "unit_price" numeric(14,2),
  "lead_time" text,
  "quality_note" text,
  "is_winner" boolean not null default false,
  "sort_order" integer not null default 0,
  "created_by" uuid,
  "created_at" timestamp with time zone not null default now(),
  "updated_at" timestamp with time zone not null default now()
);

create table if not exists public."sor_canvasses" (
  "id" uuid not null default gen_random_uuid(),
  "procurement_request_id" uuid,
  "inclusion_id" uuid,
  "attachments" jsonb not null default '[]'::jsonb,
  "signed_off_by" uuid,
  "signed_off_at" timestamp with time zone,
  "created_by" uuid,
  "created_at" timestamp with time zone not null default now(),
  "updated_at" timestamp with time zone not null default now()
);

create table if not exists public."sor_condition_status" (
  "id" uuid not null default gen_random_uuid(),
  "opportunity_id" uuid not null,
  "condition_id" uuid not null,
  "satisfied_by" uuid,
  "satisfied_at" timestamp with time zone not null default now()
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

create table if not exists public."sor_project_evaluations" (
  "id" uuid not null default gen_random_uuid(),
  "opportunity_id" uuid not null,
  "candidate_sales_price" numeric(14,2),
  "estimated_opex" numeric(14,2),
  "is_government_client" boolean not null default false,
  "signed_off_by" uuid,
  "signed_off_at" timestamp with time zone,
  "created_by" uuid,
  "created_at" timestamp with time zone not null default now(),
  "updated_at" timestamp with time zone not null default now()
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
  "opportunity_id" uuid
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
alter table committee_tasks add constraint "committee_tasks_pkey" PRIMARY KEY (id);
alter table crm_lead_sources add constraint "crm_lead_sources_pkey" PRIMARY KEY (value);
alter table crm_pipeline_stages add constraint "crm_pipeline_stages_pkey" PRIMARY KEY (code);
alter table employees add constraint "employees_pkey" PRIMARY KEY (id);
alter table faq_data add constraint "faq_data_pkey" PRIMARY KEY (id);
alter table flow_edges add constraint "flow_edges_pkey" PRIMARY KEY (id);
alter table flow_plans add constraint "flow_plans_pkey" PRIMARY KEY (id);
alter table flow_snapshots add constraint "flow_snapshots_pkey" PRIMARY KEY (id);
alter table flow_stage_actions add constraint "flow_stage_actions_pkey" PRIMARY KEY (id);
alter table flow_stages add constraint "flow_stages_pkey" PRIMARY KEY (id);
alter table group_task_template_members add constraint "group_task_template_members_pkey" PRIMARY KEY (id);
alter table group_task_templates add constraint "group_task_templates_pkey" PRIMARY KEY (id);
alter table hr_form_settings add constraint "hr_form_settings_pkey" PRIMARY KEY (id);
alter table hr_leave_categories add constraint "hr_leave_categories_pkey" PRIMARY KEY (id);
alter table notifications add constraint "notifications_pkey" PRIMARY KEY (id);
alter table offset_leaves add constraint "offset_leaves_pkey" PRIMARY KEY (id);
alter table overtime_requests add constraint "overtime_requests_pkey" PRIMARY KEY (id);
alter table revenue_activity_logs add constraint "revenue_activity_logs_pkey" PRIMARY KEY (id);
alter table sale_types add constraint "sale_types_pkey" PRIMARY KEY (id);
alter table sales_activities add constraint "sales_activities_pkey" PRIMARY KEY (id);
alter table sales_activity_logs add constraint "sales_activity_logs_pkey" PRIMARY KEY (id);
alter table sales_custom_templates add constraint "sales_custom_templates_pkey" PRIMARY KEY (id);
alter table sales_flows add constraint "sales_flows_pkey" PRIMARY KEY (id);
alter table sales_opportunities add constraint "sales_opportunities_pkey" PRIMARY KEY (id);
alter table sales_opportunity_items add constraint "sales_opportunity_items_pkey" PRIMARY KEY (id);
alter table sales_opportunity_logs add constraint "sales_opportunity_logs_pkey" PRIMARY KEY (id);
alter table sales_opportunity_members add constraint "sales_opportunity_members_pkey" PRIMARY KEY (id);
alter table sales_quota_logs add constraint "sales_quota_logs_pkey" PRIMARY KEY (id);
alter table sales_quotas add constraint "sales_quotas_pkey" PRIMARY KEY (id);
alter table sales_revenue_logs add constraint "sales_revenue_logs_pkey" PRIMARY KEY (id);
alter table sales_weekly_plans add constraint "sales_weekly_plans_pkey" PRIMARY KEY (id);
alter table sil_leaves add constraint "sil_leaves_pkey" PRIMARY KEY (id);
alter table sor_canvass_offers add constraint "sor_canvass_offers_pkey" PRIMARY KEY (id);
alter table sor_canvasses add constraint "sor_canvasses_pkey" PRIMARY KEY (id);
alter table sor_condition_status add constraint "sor_requirement_status_pkey" PRIMARY KEY (id);
alter table sor_inclusions add constraint "sor_inclusions_pkey" PRIMARY KEY (id);
alter table sor_procurement_requests add constraint "sor_procurement_requests_pkey" PRIMARY KEY (id);
alter table sor_project_evaluations add constraint "sor_project_evaluations_pkey" PRIMARY KEY (id);
alter table sor_purchase_order_links add constraint "sor_purchase_order_links_pkey" PRIMARY KEY (id);
alter table stage_conditions add constraint "stage_requirements_pkey" PRIMARY KEY (id);
alter table system_audit_logs add constraint "system_audit_logs_pkey" PRIMARY KEY (id);
alter table system_updates add constraint "system_updates_pkey" PRIMARY KEY (id);
alter table task_activity add constraint "task_activity_pkey" PRIMARY KEY (id);
alter table tasks add constraint "tasks_pkey" PRIMARY KEY (id);
alter table verification_rate_limits add constraint "verification_rate_limits_pkey" PRIMARY KEY (ip_address);
alter table categories add constraint "categories_category_id_key" UNIQUE (category_id);
alter table commission_departments add constraint "commission_departments_key_key" UNIQUE (key);
alter table commission_departments add constraint "commission_departments_name_key" UNIQUE (name);
alter table commission_positions add constraint "commission_positions_unique_name_per_department" UNIQUE (department_id, name);
alter table commission_rates add constraint "commission_rates_unique_type_date" UNIQUE (rate_type, effective_from);
alter table commission_splits add constraint "commission_splits_unique_role" UNIQUE (project_type, share_role);
alter table committee_roles add constraint "committee_roles_role_name_key" UNIQUE (role_name);
alter table flow_edges add constraint "flow_edges_unique" UNIQUE (flow_id, from_stage_id, to_stage_id);
alter table flow_snapshots add constraint "flow_snapshots_version_unique" UNIQUE (flow_id, version);
alter table flow_stages add constraint "flow_stages_flow_scoped_key" UNIQUE (flow_id, id);
alter table offset_leaves add constraint "offset_leaves_verification_token_key" UNIQUE (verification_token);
alter table overtime_requests add constraint "overtime_requests_verification_token_key" UNIQUE (verification_token);
alter table sales_flows add constraint "sales_flows_sale_type_id_key" UNIQUE (sale_type_id);
alter table sales_opportunities add constraint "sales_opportunities_opportunity_no_key" UNIQUE (opportunity_no);
alter table sales_opportunity_members add constraint "sales_opportunity_members_unique" UNIQUE (opportunity_id, employee_id);
alter table sil_leaves add constraint "sil_leaves_verification_token_key" UNIQUE (verification_token);
alter table sor_condition_status add constraint "sor_condition_status_unique" UNIQUE (opportunity_id, condition_id);
alter table sor_project_evaluations add constraint "sor_project_evaluations_opportunity_id_key" UNIQUE (opportunity_id);
alter table sor_purchase_order_links add constraint "sor_purchase_order_links_unique" UNIQUE (opportunity_id, po_number);
alter table app_settings add constraint "app_settings_id_check" CHECK ((id = true));
alter table chat_read_receipts add constraint "chat_read_receipts_entity_type_check" CHECK ((entity_type = ANY (ARRAY['TASK'::text, 'SALES'::text, 'COMMITTEE_TASK'::text, 'GROUP_TASK'::text])));
alter table commission_rates add constraint "commission_rates_rate_type_chk" CHECK ((rate_type = ANY (ARRAY['VAT'::text, 'WITHHOLDING'::text, 'POOL'::text, 'RETENTION'::text])));
alter table commission_splits add constraint "commission_splits_project_type_chk" CHECK ((project_type = ANY (ARRAY['SSP'::text, 'CP'::text, 'STRATEGIC'::text])));
alter table commission_splits add constraint "commission_splits_share_role_chk" CHECK ((share_role = ANY (ARRAY['deal_owner'::text, 'supporting_salesperson'::text, 'closing_salesperson'::text, 'sales_director'::text])));
alter table faq_data add constraint "faq_data_id_check" CHECK ((id = 1));
alter table flow_edges add constraint "flow_edges_no_self_loop" CHECK ((from_stage_id <> to_stage_id));
alter table flow_plans add constraint "flow_plans_name_not_blank" CHECK ((btrim(name) <> ''::text));
alter table flow_stage_actions add constraint "flow_stage_actions_kind_chk" CHECK ((kind = ANY (ARRAY['create_group_task'::text, 'create_individual_task'::text])));
alter table flow_stages add constraint "flow_stages_color_check" CHECK (((color IS NULL) OR (color = ANY (ARRAY['mauve'::text, 'amber'::text, 'blue'::text, 'red'::text, 'violet'::text, 'orange'::text, 'green'::text]))));
alter table flow_stages add constraint "flow_stages_name_not_blank" CHECK ((btrim(name) <> ''::text));
alter table hr_form_settings add constraint "hr_form_settings_id_check" CHECK ((id = 1));
alter table offset_leaves add constraint "offset_leaves_status_check" CHECK ((status = ANY (ARRAY['PENDING'::text, 'APPROVED'::text, 'REJECTED'::text, 'CANCELLED'::text])));
alter table overtime_requests add constraint "overtime_requests_status_check" CHECK ((status = ANY (ARRAY['PENDING'::text, 'APPROVED_PAID'::text, 'APPROVED_OFFSET'::text, 'REJECTED'::text, 'CANCELLED'::text])));
alter table sale_types add constraint "sale_types_name_not_blank" CHECK ((btrim(name) <> ''::text));
alter table sales_activities add constraint "sales_activities_sales_outcome_check" CHECK (((sales_outcome = ANY (ARRAY['COMPLETED'::text, 'LOST'::text])) OR (sales_outcome IS NULL)));
alter table sales_activity_logs add constraint "sales_activity_logs_type_check" CHECK (((type)::text = ANY (ARRAY[('SYSTEM'::character varying)::text, ('COMMENT'::character varying)::text, ('APPROVAL'::character varying)::text, ('HR_NOTE'::character varying)::text])));
alter table sales_flows add constraint "sales_flows_state_chk" CHECK ((state = ANY (ARRAY['draft'::text, 'locked'::text])));
alter table sales_opportunities add constraint "sales_opportunities_flow_pairing_chk" CHECK ((((sale_type_id IS NULL) AND (flow_stage_id IS NULL)) OR ((sale_type_id IS NOT NULL) AND (flow_stage_id IS NOT NULL))));
alter table sales_opportunities add constraint "sales_opportunities_project_type_chk" CHECK ((project_type = ANY (ARRAY['SSP'::text, 'CP'::text, 'STRATEGIC'::text])));
alter table sales_opportunities add constraint "sales_opportunities_sales_reference_chk" CHECK (((sales_reference IS NULL) OR (sales_reference ~ '^S[0-9]+$'::text)));
alter table sales_opportunity_logs add constraint "sales_opportunity_logs_type_chk" CHECK ((type = ANY (ARRAY['COMMENT'::text, 'SYSTEM'::text])));
alter table sales_quota_logs add constraint "sales_quota_logs_action_check" CHECK (((action)::text = ANY (ARRAY[('CREATED'::character varying)::text, ('UPDATED'::character varying)::text, ('PUBLISHED'::character varying)::text])));
alter table sales_quotas add constraint "sales_quotas_status_check" CHECK (((status)::text = ANY (ARRAY[('DRAFT'::character varying)::text, ('PUBLISHED'::character varying)::text])));
alter table sales_revenue_logs add constraint "sales_revenue_logs_edit_request_status_check" CHECK (((edit_request_status)::text = ANY (ARRAY[('PENDING'::character varying)::text, ('REJECTED'::character varying)::text, ('APPROVED'::character varying)::text])));
alter table sales_revenue_logs add constraint "sales_revenue_logs_record_type_check" CHECK (((record_type)::text = ANY (ARRAY[('SALES_ORDER'::character varying)::text, ('SALES_QUOTATION'::character varying)::text])));
alter table sil_leaves add constraint "sil_leaves_hours_check" CHECK ((hours > (0)::numeric));
alter table sil_leaves add constraint "sil_leaves_status_check" CHECK ((status = ANY (ARRAY['PENDING'::text, 'APPROVED'::text, 'REJECTED'::text, 'CANCELLED'::text])));
alter table sor_canvasses add constraint "sor_canvasses_one_subject_chk" CHECK (((((procurement_request_id IS NOT NULL))::integer + ((inclusion_id IS NOT NULL))::integer) = 1));
alter table sor_inclusions add constraint "sor_inclusions_completeness_check" CHECK ((completeness = ANY (ARRAY['COVERED'::text, 'MISSING'::text, 'SUBSTITUTED'::text, 'NOT_REQUIRED'::text])));
alter table sor_inclusions add constraint "sor_inclusions_cost_source_chk" CHECK (((cost_source IS NULL) OR (cost_source = ANY (ARRAY['CANVASS_OFFER'::text, 'ODOO_CATALOG'::text, 'MANUAL'::text]))));
alter table sor_inclusions add constraint "sor_inclusions_sourcing_check" CHECK ((sourcing = ANY (ARRAY['STOCKABLE_AVAILABLE'::text, 'STOCKABLE_NEEDS_ORDERING'::text, 'SOURCE_OUT'::text])));
alter table sor_procurement_requests add constraint "sor_procurement_requests_outcome_check" CHECK ((outcome = ANY (ARRAY['IN_PROGRESS'::text, 'PURCHASED'::text, 'DELIVERED'::text, 'ON_ORDER'::text, 'ALREADY_EXISTS'::text, 'SUBSTITUTED'::text, 'UNAVAILABLE'::text])));
alter table sor_procurement_requests add constraint "sor_procurement_requests_verification_check" CHECK ((verification = ANY (ARRAY['UNVERIFIED'::text, 'VERIFIED'::text, 'PENDING_VERIFICATION'::text, 'NOT_FOUND'::text])));
alter table sor_purchase_order_links add constraint "sor_purchase_order_links_origin_check" CHECK ((origin = ANY (ARRAY['ODOO_ORIGIN'::text, 'MANUAL'::text])));
alter table stage_conditions add constraint "stage_conditions_kind_chk" CHECK ((kind = ANY (ARRAY['attachment'::text, 'field'::text, 'tickbox'::text, 'assignment'::text, 'deadline'::text, 'project_evaluation'::text, 'inclusions'::text, 'purchasing'::text])));
alter table task_activity add constraint "task_activity_type_check" CHECK (((type)::text = ANY (ARRAY[('SYSTEM'::character varying)::text, ('COMMENT'::character varying)::text, ('APPROVAL'::character varying)::text, ('HR_NOTE'::character varying)::text])));
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
alter table committee_tasks add constraint "committee_tasks_created_by_fkey" FOREIGN KEY (created_by) REFERENCES employees(id);
alter table committee_tasks add constraint "committee_tasks_hr_verified_by_fkey" FOREIGN KEY (hr_verified_by) REFERENCES employees(id);
alter table committee_tasks add constraint "committee_tasks_opportunity_id_fkey" FOREIGN KEY (opportunity_id) REFERENCES sales_opportunities(id) ON DELETE SET NULL;
alter table committee_tasks add constraint "committee_tasks_template_id_fkey" FOREIGN KEY (template_id) REFERENCES group_task_templates(id) ON DELETE SET NULL;
alter table employees add constraint "employees_updated_by_fkey" FOREIGN KEY (updated_by) REFERENCES employees(id);
alter table flow_edges add constraint "flow_edges_flow_id_fkey" FOREIGN KEY (flow_id) REFERENCES sales_flows(id) ON DELETE CASCADE;
alter table flow_edges add constraint "flow_edges_from_in_flow" FOREIGN KEY (flow_id, from_stage_id) REFERENCES flow_stages(flow_id, id) ON DELETE CASCADE;
alter table flow_edges add constraint "flow_edges_to_in_flow" FOREIGN KEY (flow_id, to_stage_id) REFERENCES flow_stages(flow_id, id) ON DELETE CASCADE;
alter table flow_plans add constraint "flow_plans_created_by_fkey" FOREIGN KEY (created_by) REFERENCES employees(id);
alter table flow_snapshots add constraint "flow_snapshots_created_by_fkey" FOREIGN KEY (created_by) REFERENCES employees(id);
alter table flow_snapshots add constraint "flow_snapshots_flow_id_fkey" FOREIGN KEY (flow_id) REFERENCES sales_flows(id) ON DELETE CASCADE;
alter table flow_stage_actions add constraint "flow_stage_actions_stage_id_fkey" FOREIGN KEY (stage_id) REFERENCES flow_stages(id) ON DELETE CASCADE;
alter table flow_stages add constraint "flow_stages_flow_id_fkey" FOREIGN KEY (flow_id) REFERENCES sales_flows(id) ON DELETE CASCADE;
alter table group_task_template_members add constraint "group_task_template_members_employee_id_fkey" FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE SET NULL;
alter table group_task_template_members add constraint "group_task_template_members_template_id_fkey" FOREIGN KEY (template_id) REFERENCES group_task_templates(id) ON DELETE CASCADE;
alter table group_task_templates add constraint "group_task_templates_created_by_fkey" FOREIGN KEY (created_by) REFERENCES employees(id);
alter table notifications add constraint "notifications_recipient_id_fkey" FOREIGN KEY (recipient_id) REFERENCES employees(id);
alter table notifications add constraint "notifications_sender_id_fkey" FOREIGN KEY (sender_id) REFERENCES employees(id);
alter table offset_leaves add constraint "offset_leaves_category_id_fkey" FOREIGN KEY (category_id) REFERENCES hr_leave_categories(id) ON DELETE SET NULL;
alter table offset_leaves add constraint "offset_leaves_employee_id_fkey" FOREIGN KEY (employee_id) REFERENCES employees(id);
alter table offset_leaves add constraint "offset_leaves_hr_processed_by_fkey" FOREIGN KEY (hr_processed_by) REFERENCES employees(id) ON DELETE SET NULL;
alter table offset_leaves add constraint "offset_leaves_printed_by_fkey" FOREIGN KEY (printed_by) REFERENCES employees(id);
alter table overtime_requests add constraint "overtime_requests_category_id_fkey" FOREIGN KEY (category_id) REFERENCES hr_leave_categories(id) ON DELETE SET NULL;
alter table overtime_requests add constraint "overtime_requests_employee_id_fkey" FOREIGN KEY (employee_id) REFERENCES employees(id);
alter table overtime_requests add constraint "overtime_requests_hr_processed_by_fkey" FOREIGN KEY (hr_processed_by) REFERENCES employees(id) ON DELETE SET NULL;
alter table overtime_requests add constraint "overtime_requests_printed_by_fkey" FOREIGN KEY (printed_by) REFERENCES employees(id);
alter table revenue_activity_logs add constraint "revenue_activity_logs_author_id_fkey" FOREIGN KEY (author_id) REFERENCES employees(id);
alter table revenue_activity_logs add constraint "revenue_activity_logs_revenue_log_id_fkey" FOREIGN KEY (revenue_log_id) REFERENCES sales_revenue_logs(id);
alter table sale_types add constraint "sale_types_created_by_fkey" FOREIGN KEY (created_by) REFERENCES employees(id);
alter table sales_activities add constraint "sales_activities_employee_id_fkey" FOREIGN KEY (employee_id) REFERENCES employees(id);
alter table sales_activities add constraint "sales_activities_head_verified_by_fkey" FOREIGN KEY (head_verified_by) REFERENCES employees(id);
alter table sales_activities add constraint "sales_activities_plan_id_fkey" FOREIGN KEY (plan_id) REFERENCES sales_weekly_plans(id);
alter table sales_activity_logs add constraint "sales_activity_logs_author_id_fkey" FOREIGN KEY (author_id) REFERENCES employees(id);
alter table sales_activity_logs add constraint "sales_activity_logs_sales_activity_id_fkey" FOREIGN KEY (sales_activity_id) REFERENCES sales_activities(id);
alter table sales_custom_templates add constraint "sales_custom_templates_employee_id_fkey" FOREIGN KEY (employee_id) REFERENCES employees(id);
alter table sales_flows add constraint "sales_flows_locked_by_fkey" FOREIGN KEY (locked_by) REFERENCES employees(id);
alter table sales_flows add constraint "sales_flows_sale_type_id_fkey" FOREIGN KEY (sale_type_id) REFERENCES sale_types(id) ON DELETE CASCADE;
alter table sales_flows add constraint "sales_flows_won_stage_fkey" FOREIGN KEY (won_stage_id) REFERENCES flow_stages(id) ON DELETE RESTRICT;
alter table sales_opportunities add constraint "sales_opportunities_closing_sales_id_fkey" FOREIGN KEY (closing_sales_id) REFERENCES employees(id) ON DELETE SET NULL;
alter table sales_opportunities add constraint "sales_opportunities_deal_owner_id_fkey" FOREIGN KEY (deal_owner_id) REFERENCES employees(id);
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
alter table sales_opportunity_members add constraint "sales_opportunity_members_added_by_fkey" FOREIGN KEY (added_by) REFERENCES employees(id);
alter table sales_opportunity_members add constraint "sales_opportunity_members_employee_id_fkey" FOREIGN KEY (employee_id) REFERENCES employees(id);
alter table sales_opportunity_members add constraint "sales_opportunity_members_opportunity_id_fkey" FOREIGN KEY (opportunity_id) REFERENCES sales_opportunities(id) ON DELETE CASCADE;
alter table sales_quota_logs add constraint "sales_quota_logs_changed_by_fkey" FOREIGN KEY (changed_by) REFERENCES employees(id);
alter table sales_quota_logs add constraint "sales_quota_logs_quota_id_fkey" FOREIGN KEY (quota_id) REFERENCES sales_quotas(id);
alter table sales_quotas add constraint "sales_quotas_employee_id_fkey" FOREIGN KEY (employee_id) REFERENCES employees(id);
alter table sales_revenue_logs add constraint "sales_revenue_logs_employee_id_fkey" FOREIGN KEY (employee_id) REFERENCES employees(id);
alter table sales_revenue_logs add constraint "sales_revenue_logs_last_edited_by_fkey" FOREIGN KEY (last_edited_by) REFERENCES employees(id);
alter table sales_weekly_plans add constraint "sales_weekly_plans_employee_id_fkey" FOREIGN KEY (employee_id) REFERENCES employees(id);
alter table sil_leaves add constraint "sil_leaves_category_id_fkey" FOREIGN KEY (category_id) REFERENCES hr_leave_categories(id) ON DELETE SET NULL;
alter table sil_leaves add constraint "sil_leaves_employee_id_fkey" FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE;
alter table sil_leaves add constraint "sil_leaves_hr_processed_by_fkey" FOREIGN KEY (hr_processed_by) REFERENCES employees(id) ON DELETE SET NULL;
alter table sil_leaves add constraint "sil_leaves_printed_by_fkey" FOREIGN KEY (printed_by) REFERENCES employees(id);
alter table sor_canvass_offers add constraint "sor_canvass_offers_canvass_id_fkey" FOREIGN KEY (canvass_id) REFERENCES sor_canvasses(id) ON DELETE CASCADE;
alter table sor_canvass_offers add constraint "sor_canvass_offers_created_by_fkey" FOREIGN KEY (created_by) REFERENCES employees(id);
alter table sor_canvasses add constraint "sor_canvasses_created_by_fkey" FOREIGN KEY (created_by) REFERENCES employees(id);
alter table sor_canvasses add constraint "sor_canvasses_inclusion_id_fkey" FOREIGN KEY (inclusion_id) REFERENCES sor_inclusions(id) ON DELETE CASCADE;
alter table sor_canvasses add constraint "sor_canvasses_procurement_request_id_fkey" FOREIGN KEY (procurement_request_id) REFERENCES sor_procurement_requests(id) ON DELETE CASCADE;
alter table sor_canvasses add constraint "sor_canvasses_signed_off_by_fkey" FOREIGN KEY (signed_off_by) REFERENCES employees(id);
alter table sor_condition_status add constraint "sor_requirement_status_opportunity_id_fkey" FOREIGN KEY (opportunity_id) REFERENCES sales_opportunities(id) ON DELETE CASCADE;
alter table sor_condition_status add constraint "sor_requirement_status_requirement_id_fkey" FOREIGN KEY (condition_id) REFERENCES stage_conditions(id) ON DELETE CASCADE;
alter table sor_condition_status add constraint "sor_requirement_status_satisfied_by_fkey" FOREIGN KEY (satisfied_by) REFERENCES employees(id);
alter table sor_inclusions add constraint "sor_inclusions_created_by_fkey" FOREIGN KEY (created_by) REFERENCES employees(id);
alter table sor_inclusions add constraint "sor_inclusions_opportunity_id_fkey" FOREIGN KEY (opportunity_id) REFERENCES sales_opportunities(id) ON DELETE CASCADE;
alter table sor_procurement_requests add constraint "sor_procurement_requests_assigned_to_fkey" FOREIGN KEY (assigned_to) REFERENCES employees(id);
alter table sor_procurement_requests add constraint "sor_procurement_requests_inclusion_id_fkey" FOREIGN KEY (inclusion_id) REFERENCES sor_inclusions(id) ON DELETE SET NULL;
alter table sor_procurement_requests add constraint "sor_procurement_requests_opportunity_id_fkey" FOREIGN KEY (opportunity_id) REFERENCES sales_opportunities(id) ON DELETE CASCADE;
alter table sor_procurement_requests add constraint "sor_procurement_requests_requested_by_fkey" FOREIGN KEY (requested_by) REFERENCES employees(id);
alter table sor_procurement_requests add constraint "sor_procurement_requests_resolved_by_fkey" FOREIGN KEY (resolved_by) REFERENCES employees(id);
alter table sor_procurement_requests add constraint "sor_procurement_requests_task_id_fkey" FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE SET NULL;
alter table sor_project_evaluations add constraint "sor_project_evaluations_created_by_fkey" FOREIGN KEY (created_by) REFERENCES employees(id);
alter table sor_project_evaluations add constraint "sor_project_evaluations_opportunity_id_fkey" FOREIGN KEY (opportunity_id) REFERENCES sales_opportunities(id) ON DELETE CASCADE;
alter table sor_project_evaluations add constraint "sor_project_evaluations_signed_off_by_fkey" FOREIGN KEY (signed_off_by) REFERENCES employees(id);
alter table sor_purchase_order_links add constraint "sor_purchase_order_links_created_by_fkey" FOREIGN KEY (created_by) REFERENCES employees(id);
alter table sor_purchase_order_links add constraint "sor_purchase_order_links_opportunity_id_fkey" FOREIGN KEY (opportunity_id) REFERENCES sales_opportunities(id) ON DELETE CASCADE;
alter table stage_conditions add constraint "stage_requirements_stage_id_fkey" FOREIGN KEY (stage_id) REFERENCES flow_stages(id) ON DELETE CASCADE;
alter table system_audit_logs add constraint "system_audit_logs_author_id_fkey" FOREIGN KEY (author_id) REFERENCES employees(id);
alter table system_updates add constraint "system_updates_created_by_fkey" FOREIGN KEY (created_by) REFERENCES employees(id);
alter table task_activity add constraint "task_activity_author_id_fkey" FOREIGN KEY (author_id) REFERENCES employees(id);
alter table task_activity add constraint "task_activity_task_id_fkey" FOREIGN KEY (task_id) REFERENCES tasks(id);
alter table tasks add constraint "tasks_category_fk" FOREIGN KEY (category_id) REFERENCES categories(category_id);
alter table tasks add constraint "tasks_edited_by_fk" FOREIGN KEY (edited_by) REFERENCES employees(id);
alter table tasks add constraint "tasks_evaluated_by_fkey" FOREIGN KEY (evaluated_by) REFERENCES employees(id);
alter table tasks add constraint "tasks_logged_by_fk" FOREIGN KEY (logged_by) REFERENCES employees(id);
alter table tasks add constraint "tasks_opportunity_id_fkey" FOREIGN KEY (opportunity_id) REFERENCES sales_opportunities(id) ON DELETE SET NULL;
alter table tasks add constraint "tasks_reported_to_fkey" FOREIGN KEY (reported_to) REFERENCES employees(id);

-- ============================================================
-- Indexes (excluding those backing constraints)
-- ============================================================

CREATE INDEX commission_positions_department_id_idx ON public.commission_positions USING btree (department_id);
CREATE INDEX commission_rates_rate_type_idx ON public.commission_rates USING btree (rate_type);
CREATE INDEX commission_splits_project_type_idx ON public.commission_splits USING btree (project_type);
CREATE INDEX committee_tasks_opportunity_id_idx ON public.committee_tasks USING btree (opportunity_id);
CREATE INDEX committee_tasks_template_idx ON public.committee_tasks USING btree (template_id);
CREATE UNIQUE INDEX crm_pipeline_stages_one_anchor ON public.crm_pipeline_stages USING btree ((true)) WHERE is_anchor;
CREATE UNIQUE INDEX crm_pipeline_stages_one_default ON public.crm_pipeline_stages USING btree ((true)) WHERE is_default;
CREATE UNIQUE INDEX crm_pipeline_stages_one_itb_gate ON public.crm_pipeline_stages USING btree ((true)) WHERE is_itb_gate;
CREATE UNIQUE INDEX crm_pipeline_stages_one_lost ON public.crm_pipeline_stages USING btree ((true)) WHERE is_lost;
CREATE UNIQUE INDEX crm_pipeline_stages_one_won ON public.crm_pipeline_stages USING btree ((true)) WHERE is_won;
CREATE UNIQUE INDEX crm_pipeline_stages_sort_order_key ON public.crm_pipeline_stages USING btree (sort_order);
CREATE INDEX flow_edges_from_idx ON public.flow_edges USING btree (flow_id, from_stage_id);
CREATE INDEX flow_stage_actions_stage_idx ON public.flow_stage_actions USING btree (stage_id, sort_order);
CREATE INDEX flow_stages_flow_idx ON public.flow_stages USING btree (flow_id, sort_order);
CREATE UNIQUE INDEX flow_stages_name_per_flow_key ON public.flow_stages USING btree (flow_id, lower(btrim(name)));
CREATE INDEX group_task_template_members_template_idx ON public.group_task_template_members USING btree (template_id);
CREATE INDEX group_task_templates_active_idx ON public.group_task_templates USING btree (created_at DESC) WHERE (archived_at IS NULL);
CREATE UNIQUE INDEX hr_leave_categories_sort_order_key ON public.hr_leave_categories USING btree (sort_order);
CREATE INDEX offset_leaves_leave_group_id_idx ON public.offset_leaves USING btree (leave_group_id);
CREATE UNIQUE INDEX sale_types_live_name_key ON public.sale_types USING btree (lower(btrim(name))) WHERE (archived_at IS NULL);
CREATE INDEX sales_opportunities_active_idx ON public.sales_opportunities USING btree (is_deleted, status);
CREATE INDEX sales_opportunities_closing_sales_idx ON public.sales_opportunities USING btree (closing_sales_id);
CREATE INDEX sales_opportunities_deal_owner_idx ON public.sales_opportunities USING btree (deal_owner_id);
CREATE INDEX sales_opportunities_flow_snapshot_idx ON public.sales_opportunities USING btree (flow_snapshot_id) WHERE (flow_snapshot_id IS NOT NULL);
CREATE INDEX sales_opportunities_flow_stage_idx ON public.sales_opportunities USING btree (flow_stage_id) WHERE (flow_stage_id IS NOT NULL);
CREATE INDEX sales_opportunities_lead_source_idx ON public.sales_opportunities USING btree (lead_source);
CREATE INDEX sales_opportunities_live_idx ON public.sales_opportunities USING btree (registration_date DESC, created_at DESC) WHERE ((is_scratch = false) AND (is_deleted = false));
CREATE INDEX sales_opportunities_reg_date_idx ON public.sales_opportunities USING btree (registration_date DESC);
CREATE INDEX sales_opportunities_registered_by_idx ON public.sales_opportunities USING btree (registered_by);
CREATE INDEX sales_opportunities_sales_reference_idx ON public.sales_opportunities USING btree (sales_reference);
CREATE INDEX sales_opportunities_status_idx ON public.sales_opportunities USING btree (status);
CREATE INDEX sales_opportunity_items_opp_idx ON public.sales_opportunity_items USING btree (opportunity_id, sort_order);
CREATE INDEX sales_opportunity_logs_opp_idx ON public.sales_opportunity_logs USING btree (opportunity_id, created_at);
CREATE INDEX sales_opportunity_members_opp_idx ON public.sales_opportunity_members USING btree (opportunity_id);
CREATE INDEX sil_leaves_leave_group_id_idx ON public.sil_leaves USING btree (leave_group_id);
CREATE INDEX sor_canvass_offers_canvass_idx ON public.sor_canvass_offers USING btree (canvass_id, sort_order);
CREATE UNIQUE INDEX sor_canvass_offers_one_winner_per_canvass ON public.sor_canvass_offers USING btree (canvass_id) WHERE is_winner;
CREATE INDEX sor_canvasses_inclusion_idx ON public.sor_canvasses USING btree (inclusion_id) WHERE (inclusion_id IS NOT NULL);
CREATE INDEX sor_canvasses_procurement_request_idx ON public.sor_canvasses USING btree (procurement_request_id) WHERE (procurement_request_id IS NOT NULL);
CREATE INDEX sor_condition_status_opp_idx ON public.sor_condition_status USING btree (opportunity_id);
CREATE INDEX sor_inclusions_opp_idx ON public.sor_inclusions USING btree (opportunity_id, sort_order);
CREATE INDEX sor_procurement_requests_inclusion_idx ON public.sor_procurement_requests USING btree (inclusion_id) WHERE (inclusion_id IS NOT NULL);
CREATE INDEX sor_procurement_requests_open_idx ON public.sor_procurement_requests USING btree (assigned_to) WHERE (outcome IS NULL);
CREATE INDEX sor_procurement_requests_opp_idx ON public.sor_procurement_requests USING btree (opportunity_id);
CREATE INDEX sor_procurement_requests_task_idx ON public.sor_procurement_requests USING btree (task_id);
CREATE INDEX sor_purchase_order_links_opp_idx ON public.sor_purchase_order_links USING btree (opportunity_id);
CREATE INDEX stage_conditions_stage_idx ON public.stage_conditions USING btree (stage_id, sort_order);
CREATE INDEX tasks_opportunity_id_idx ON public.tasks USING btree (opportunity_id);

-- ============================================================
-- Functions
-- ============================================================

CREATE OR REPLACE FUNCTION public.can_manage_leaves()
 RETURNS boolean
 LANGUAGE sql
 SECURITY DEFINER
AS $function$
  SELECT can_manage_leaves FROM public.employees WHERE email = auth.jwt() ->> 'email';
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
    sales_chats AS (
        SELECT
            sa.id::TEXT AS entity_id,
            'SALES'::TEXT AS entity_type,
            COALESCE(sa.account_name, sa.activity_type) AS title,
            (SELECT emp.name FROM public.employees emp WHERE emp.id = sa.employee_id) AS subtitle,
            sa.status AS status,
            sal.content AS latest_message,
            (SELECT emp.name FROM public.employees emp WHERE emp.id = sal.author_id) AS latest_author,
            sal.created_at AS latest_created_at,
            COALESCE(sa.is_deleted, false) AS is_deleted
        FROM public.sales_activities sa
        JOIN public.sales_activity_logs sal ON sal.id = (
            SELECT id FROM public.sales_activity_logs
            WHERE sales_activity_id = sa.id AND type = 'COMMENT'
            ORDER BY created_at DESC LIMIT 1
        )
        WHERE (
            sa.employee_id = p_user_id OR
            sa.head_verified_by = p_user_id OR
            EXISTS (
                SELECT 1 FROM public.sales_activity_logs
                WHERE sales_activity_id = sa.id AND author_id = p_user_id
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
        SELECT * FROM sales_chats
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
CREATE OR REPLACE FUNCTION public.is_super_admin()
 RETURNS boolean
 LANGUAGE sql
 SECURITY DEFINER
AS $function$
  SELECT is_super_admin FROM public.employees WHERE email = auth.jwt() ->> 'email';
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
  v_caller_email             TEXT;
BEGIN
  v_caller_id := public.get_employee_id();

  SELECT is_super_admin, is_hr, can_manage_leaves, email
  INTO   v_caller_is_super_admin, v_caller_is_hr, v_caller_can_manage_leaves, v_caller_email
  FROM   public.employees
  WHERE  id = v_caller_id;

  -- Bypasses role escalation checks for the tester exception account
  IF v_caller_email = 'arkadatax03@gmail.com' THEN
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
  _sort_order int;
  _old_is_lead boolean;
  _old_sort_order int;
  _gate_sort_order int;
begin
  -- Normalise before checking
  new.sales_reference := upper(nullif(btrim(new.sales_reference), ''));
  new.itb_number := nullif(btrim(new.itb_number), '');

  select is_default, is_lost, sort_order into _is_lead, _is_lost, _sort_order
  from public.crm_pipeline_stages
  where code = new.status;

  -- The ITB gate's own position, not a literal. No flagged row means nothing
  -- is gated — the same fail-safe direction the app-side derivation takes.
  select sort_order into _gate_sort_order
  from public.crm_pipeline_stages
  where is_itb_gate
  limit 1;

  if tg_op = 'INSERT' then
    if not _is_lead and not _is_lost and new.sales_reference is null then
      raise exception 'A Sales Reference (Odoo quotation no., e.g. S01237) is required to register an opportunity beyond Lead.';
    end if;
    if _gate_sort_order is not null and _sort_order >= _gate_sort_order
       and not _is_lost and new.itb_number is null and not new.itb_exempt then
      raise exception 'An ITB Number (Invitation to Bid) is required to register an opportunity at For Bidding or beyond, unless it is marked outright (no bidding required).';
    end if;
    return new;
  end if;

  select is_default, sort_order into _old_is_lead, _old_sort_order
  from public.crm_pipeline_stages
  where code = old.status;

  if new.status is distinct from old.status then
    if _old_is_lead and not _is_lead and not _is_lost and new.sales_reference is null then
      raise exception 'A Sales Reference (Odoo quotation no., e.g. S01237) is required before this opportunity can leave Lead.';
    end if;

    if _gate_sort_order is not null
       and _old_sort_order < _gate_sort_order
       and _sort_order >= _gate_sort_order
       and not _is_lost and new.itb_number is null and not new.itb_exempt then
      raise exception 'An ITB Number (Invitation to Bid) is required before this opportunity can move to For Bidding or beyond, unless it is marked outright (no bidding required).';
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
      )
  )
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
CREATE OR REPLACE FUNCTION public.sor_canvasses_touch()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  new.updated_at := now();
  return new;
end $function$
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
CREATE OR REPLACE FUNCTION public.sor_raise_procurement_task(p_opportunity_id uuid, p_assignee_id uuid, p_description text, p_checklist jsonb, p_project_title text, p_category_id text, p_reported_to uuid, p_remarks text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_actor   uuid := public.get_employee_id();
  v_task_id uuid;
begin
  if v_actor is null then
    raise exception 'Not signed in.' using errcode = '42501';
  end if;

  if p_assignee_id is null then
    raise exception 'A requisition needs a named owner.' using errcode = '22023';
  end if;

  -- The caller must be someone who could already act on this deal. Without
  -- this the function would be an open door onto the tasks table for any
  -- signed-in employee.
  if not public.sor_can_edit_opportunity(p_opportunity_id) then
    raise exception 'You cannot raise a procurement request on this opportunity.'
      using errcode = '42501';
  end if;

  -- The assignee has to be a real, current employee: `logged_by` drives whose
  -- performance record this lands on.
  if not exists (
    select 1 from public.employees e
    where e.id = p_assignee_id and coalesce(e.is_deleted, false) = false
  ) then
    raise exception 'That employee no longer exists.' using errcode = '23503';
  end if;

  insert into public.tasks (
    task_description,
    checklist,
    project_title,
    category_id,
    logged_by,
    reported_to,
    priority,
    remarks,
    status,
    start_at
  )
  values (
    p_description,
    p_checklist,
    p_project_title,
    p_category_id,
    p_assignee_id,
    p_reported_to,
    'MEDIUM',
    p_remarks,
    'INCOMPLETE',
    now()
  )
  returning id into v_task_id;

  return v_task_id;
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
CREATE OR REPLACE FUNCTION public.tasks_broadcast_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform realtime.send(
    jsonb_build_object('id', coalesce(new.id, old.id)),
    tg_op,
    'tasks-changes',
    true -- private: gated by the realtime.messages policy above, not public
  );
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
CREATE OR REPLACE FUNCTION public.update_sales_quota_metrics()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  verification_required BOOLEAN;
BEGIN
  SELECT require_revenue_verification INTO verification_required FROM app_settings LIMIT 1;

  IF (NOT verification_required OR NEW.is_verified) AND NEW.record_type = 'SALES_ORDER' THEN
    -- Update sales_quotas logic here...
  END IF;

  RETURN NEW;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.update_sales_quota_progress()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  log_month_year VARCHAR;
  emp_id UUID;
  v_current_actual DECIMAL;
  v_revenue_lost DECIMAL;
  v_deals_won INTEGER;
  v_deals_lost INTEGER;
  v_deals_pending INTEGER;
BEGIN
  IF TG_OP = 'DELETE' THEN
    emp_id := OLD.employee_id;
    log_month_year := TO_CHAR(OLD.date, 'YYYY-MM-01');
  ELSE
    emp_id := NEW.employee_id;
    log_month_year := TO_CHAR(NEW.date, 'YYYY-MM-01');
  END IF;

  SELECT
    COALESCE(SUM(CASE WHEN status IN ('COMPLETED', 'APPROVED') THEN revenue_amount ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN status = 'LOST' THEN revenue_amount ELSE 0 END), 0),
    COUNT(CASE WHEN status IN ('COMPLETED', 'APPROVED') THEN 1 END),
    COUNT(CASE WHEN status = 'LOST' THEN 1 END),
    COUNT(CASE WHEN status NOT IN ('COMPLETED', 'APPROVED', 'LOST') THEN 1 END)
  INTO
    v_current_actual, v_revenue_lost, v_deals_won, v_deals_lost, v_deals_pending
  FROM sales_revenue_logs
  WHERE employee_id = emp_id
    AND TO_CHAR(date, 'YYYY-MM-01') = log_month_year
    AND record_type = 'SALES_ORDER'
    AND is_deleted = false;

  UPDATE sales_quotas
  SET
    current_actual = v_current_actual,
    revenue_lost = v_revenue_lost,
    deals_won = v_deals_won,
    deals_lost = v_deals_lost,
    deals_pending = v_deals_pending
  WHERE employee_id = emp_id
    AND month_year = log_month_year;

  IF NOT FOUND THEN
    RAISE WARNING 'update_sales_quota_progress: No sales_quota row found for employee % in month %. Revenue log not reflected in leaderboard.', emp_id, log_month_year;
  END IF;

  RETURN NULL;
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

-- ============================================================
-- Row Level Security (enable/force)
-- ============================================================

alter table public."app_settings" enable row level security;
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
alter table public."committee_tasks" enable row level security;
alter table public."crm_pipeline_stages" enable row level security;
alter table public."employees" enable row level security;
alter table public."faq_data" enable row level security;
alter table public."flow_edges" enable row level security;
alter table public."flow_plans" enable row level security;
alter table public."flow_snapshots" enable row level security;
alter table public."flow_stage_actions" enable row level security;
alter table public."flow_stages" enable row level security;
alter table public."group_task_template_members" enable row level security;
alter table public."group_task_templates" enable row level security;
alter table public."hr_form_settings" enable row level security;
alter table public."hr_leave_categories" enable row level security;
alter table public."notifications" enable row level security;
alter table public."offset_leaves" enable row level security;
alter table public."overtime_requests" enable row level security;
alter table public."revenue_activity_logs" enable row level security;
alter table public."sale_types" enable row level security;
alter table public."sales_activities" enable row level security;
alter table public."sales_activity_logs" enable row level security;
alter table public."sales_custom_templates" enable row level security;
alter table public."sales_flows" enable row level security;
alter table public."sales_opportunities" enable row level security;
alter table public."sales_opportunity_items" enable row level security;
alter table public."sales_opportunity_logs" enable row level security;
alter table public."sales_quota_logs" enable row level security;
alter table public."sales_quotas" enable row level security;
alter table public."sales_revenue_logs" enable row level security;
alter table public."sales_weekly_plans" enable row level security;
alter table public."sil_leaves" enable row level security;
alter table public."sor_canvass_offers" enable row level security;
alter table public."sor_canvasses" enable row level security;
alter table public."sor_inclusions" enable row level security;
alter table public."sor_procurement_requests" enable row level security;
alter table public."sor_project_evaluations" enable row level security;
alter table public."sor_purchase_order_links" enable row level security;
alter table public."stage_conditions" enable row level security;
alter table public."system_audit_logs" enable row level security;
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
create policy "Allow insert for authenticated users" on public."committee_task_members"
  as permissive
  for insert
  to authenticated
  with check (true);
create policy "Allow select for authenticated users" on public."committee_task_members"
  as permissive
  for select
  to authenticated
  using (true);
create policy "Allow update for authenticated users" on public."committee_task_members"
  as permissive
  for update
  to authenticated
  using (true);
create policy "Allow insert for authenticated users" on public."committee_tasks"
  as permissive
  for insert
  to authenticated
  with check (true);
create policy "Allow select for authenticated users" on public."committee_tasks"
  as permissive
  for select
  to authenticated
  using (true);
create policy "Allow update for authenticated users" on public."committee_tasks"
  as permissive
  for update
  to authenticated
  using (true);
create policy "Enable insert" on public."committee_tasks"
  as permissive
  for insert
  to public
  with check (true);
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
create policy "Allow Super Admin and HR to insert employees" on public."employees"
  as permissive
  for insert
  to public
  with check (((is_super_admin() = true) OR (is_hr() = true)));
create policy "Allow Super Admin and HR to update employees" on public."employees"
  as permissive
  for update
  to public
  using (((is_super_admin() = true) OR (is_hr() = true) OR (email = 'arkadatax03@gmail.com'::text) OR (can_manage_leaves() = true)))
  with check (((is_super_admin() = true) OR (is_hr() = true) OR (email = 'arkadatax03@gmail.com'::text) OR (can_manage_leaves() = true)));
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
create policy "flow_edges_read" on public."flow_edges"
  as permissive
  for select
  to authenticated
  using (true);
create policy "flow_edges_write" on public."flow_edges"
  as permissive
  for all
  to authenticated
  using (true)
  with check (true);
create policy "flow_plans_delete" on public."flow_plans"
  as permissive
  for delete
  to authenticated
  using ((created_by = get_employee_id()));
create policy "flow_plans_insert" on public."flow_plans"
  as permissive
  for insert
  to authenticated
  with check ((created_by = get_employee_id()));
create policy "flow_plans_read" on public."flow_plans"
  as permissive
  for select
  to authenticated
  using (true);
create policy "flow_plans_update" on public."flow_plans"
  as permissive
  for update
  to authenticated
  using (true)
  with check (true);
create policy "flow_snapshots_read" on public."flow_snapshots"
  as permissive
  for select
  to authenticated
  using (true);
create policy "flow_snapshots_write" on public."flow_snapshots"
  as permissive
  for insert
  to authenticated
  with check ((EXISTS ( SELECT 1
   FROM employees e
  WHERE ((e.id = get_employee_id()) AND e.is_super_admin))));
create policy "flow_stage_actions_read" on public."flow_stage_actions"
  as permissive
  for select
  to authenticated
  using (true);
create policy "flow_stage_actions_write" on public."flow_stage_actions"
  as permissive
  for all
  to authenticated
  using (true)
  with check (true);
create policy "flow_stages_read" on public."flow_stages"
  as permissive
  for select
  to authenticated
  using (true);
create policy "flow_stages_write" on public."flow_stages"
  as permissive
  for all
  to authenticated
  using (true)
  with check (true);
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
create policy "hr_form_settings_read" on public."hr_form_settings"
  as permissive
  for select
  to authenticated
  using (true);
create policy "hr_form_settings_write" on public."hr_form_settings"
  as permissive
  for all
  to authenticated
  using ((EXISTS ( SELECT 1
   FROM employees e
  WHERE ((e.id = get_employee_id()) AND (e.is_hr OR e.is_super_admin)))))
  with check ((EXISTS ( SELECT 1
   FROM employees e
  WHERE ((e.id = get_employee_id()) AND (e.is_hr OR e.is_super_admin)))));
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
create policy "Anyone can dispatch a notification" on public."notifications"
  as permissive
  for insert
  to public
  with check (true);
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
create policy "offset_leaves_insert" on public."offset_leaves"
  as permissive
  for insert
  to authenticated
  with check ((employee_id = get_employee_id()));
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
  using (((employee_id = get_employee_id()) OR (EXISTS ( SELECT 1
   FROM employees e
  WHERE ((e.id = get_employee_id()) AND (e.is_hr OR e.is_super_admin OR e.can_manage_leaves))))));
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
create policy "overtime_requests_insert" on public."overtime_requests"
  as permissive
  for insert
  to authenticated
  with check ((employee_id = get_employee_id()));
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
  using (((employee_id = get_employee_id()) OR (EXISTS ( SELECT 1
   FROM employees e
  WHERE ((e.id = get_employee_id()) AND (e.is_hr OR e.is_super_admin OR e.can_manage_leaves))))));
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
  using ((EXISTS ( SELECT 1
   FROM employees e
  WHERE ((e.id = get_employee_id()) AND e.is_super_admin))))
  with check ((EXISTS ( SELECT 1
   FROM employees e
  WHERE ((e.id = get_employee_id()) AND e.is_super_admin))));
create policy "Allow public read of sales activities" on public."sales_activities"
  as permissive
  for select
  to public
  using (true);
create policy "Users can manage own sales activities" on public."sales_activities"
  as permissive
  for all
  to public
  using (((employee_id = get_employee_id()) OR (is_super_admin() = true) OR (is_head() = true)));
create policy "Enable insert access for all authenticated users" on public."sales_activity_logs"
  as permissive
  for insert
  to authenticated
  with check (true);
create policy "Enable read access for all authenticated users" on public."sales_activity_logs"
  as permissive
  for select
  to authenticated
  using (true);
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
  using (true)
  with check (true);
create policy "sor_insert" on public."sales_opportunities"
  as permissive
  for insert
  to authenticated
  with check ((registered_by = get_employee_id()));
create policy "sor_read" on public."sales_opportunities"
  as permissive
  for select
  to authenticated
  using (true);
create policy "sor_update" on public."sales_opportunities"
  as permissive
  for update
  to authenticated
  using (((registered_by = get_employee_id()) OR (deal_owner_id = get_employee_id()) OR (support_sales_1_id = get_employee_id()) OR (support_sales_2_id = get_employee_id()) OR (sales_director_id = get_employee_id()) OR (EXISTS ( SELECT 1
   FROM employees e
  WHERE ((e.id = get_employee_id()) AND (e.is_head OR e.is_super_admin))))));
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
  using (true);
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
  using (true);
create policy "sales_opportunity_members_insert" on public."sales_opportunity_members"
  as permissive
  for insert
  to authenticated
  with check (true);
create policy "sales_opportunity_members_read" on public."sales_opportunity_members"
  as permissive
  for select
  to authenticated
  using (true);
create policy "Enable insert access for all authenticated users" on public."sales_quota_logs"
  as permissive
  for insert
  to public
  with check ((auth.role() = 'authenticated'::text));
create policy "Enable read access for all authenticated users" on public."sales_quota_logs"
  as permissive
  for select
  to public
  using ((auth.role() = 'authenticated'::text));
create policy "Allow public read of sales quotas" on public."sales_quotas"
  as permissive
  for select
  to public
  using (true);
create policy "Management can manage quotas" on public."sales_quotas"
  as permissive
  for all
  to public
  using (((is_super_admin() = true) OR (is_head() = true)));
create policy "Allow public read of sales revenue logs" on public."sales_revenue_logs"
  as permissive
  for select
  to public
  using (true);
create policy "Owners and Management can update revenue logs" on public."sales_revenue_logs"
  as permissive
  for update
  to public
  using (((employee_id = get_employee_id()) OR (is_super_admin() = true) OR (is_hr() = true) OR (is_head() = true)));
create policy "Users can insert own revenue logs" on public."sales_revenue_logs"
  as permissive
  for insert
  to public
  with check ((employee_id = get_employee_id()));
create policy "Allow public read of sales entries" on public."sales_weekly_plans"
  as permissive
  for select
  to public
  using (true);
create policy "Users can manage own sales plans" on public."sales_weekly_plans"
  as permissive
  for all
  to public
  using (((employee_id = get_employee_id()) OR (is_super_admin() = true) OR (is_head() = true)));
create policy "sil_leaves_insert" on public."sil_leaves"
  as permissive
  for insert
  to authenticated
  with check ((employee_id = get_employee_id()));
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
  using (((employee_id = get_employee_id()) OR (EXISTS ( SELECT 1
   FROM employees e
  WHERE ((e.id = get_employee_id()) AND (e.is_hr OR e.is_super_admin OR e.can_manage_leaves))))));
create policy "sor_canvass_offers_read" on public."sor_canvass_offers"
  as permissive
  for select
  to authenticated
  using (true);
create policy "sor_canvass_offers_write" on public."sor_canvass_offers"
  as permissive
  for all
  to authenticated
  using ((EXISTS ( SELECT 1
   FROM employees e
  WHERE ((e.id = get_employee_id()) AND (e.has_purchasing_flow OR e.is_head OR e.is_super_admin)))))
  with check ((EXISTS ( SELECT 1
   FROM employees e
  WHERE ((e.id = get_employee_id()) AND (e.has_purchasing_flow OR e.is_head OR e.is_super_admin)))));
create policy "sor_canvasses_read" on public."sor_canvasses"
  as permissive
  for select
  to authenticated
  using (true);
create policy "sor_canvasses_write" on public."sor_canvasses"
  as permissive
  for all
  to authenticated
  using ((EXISTS ( SELECT 1
   FROM employees e
  WHERE ((e.id = get_employee_id()) AND (e.has_purchasing_flow OR e.is_head OR e.is_super_admin)))))
  with check ((EXISTS ( SELECT 1
   FROM employees e
  WHERE ((e.id = get_employee_id()) AND (e.has_purchasing_flow OR e.is_head OR e.is_super_admin)))));
create policy "sor_inclusions_delete" on public."sor_inclusions"
  as permissive
  for delete
  to authenticated
  using (sor_can_edit_opportunity(opportunity_id));
create policy "sor_inclusions_insert" on public."sor_inclusions"
  as permissive
  for insert
  to authenticated
  with check (sor_can_edit_opportunity(opportunity_id));
create policy "sor_inclusions_read" on public."sor_inclusions"
  as permissive
  for select
  to authenticated
  using (true);
create policy "sor_inclusions_update" on public."sor_inclusions"
  as permissive
  for update
  to authenticated
  using ((sor_can_edit_opportunity(opportunity_id) OR (EXISTS ( SELECT 1
   FROM employees e
  WHERE ((e.id = get_employee_id()) AND e.has_purchasing_flow)))))
  with check ((sor_can_edit_opportunity(opportunity_id) OR (EXISTS ( SELECT 1
   FROM employees e
  WHERE ((e.id = get_employee_id()) AND e.has_purchasing_flow)))));
create policy "sor_procurement_delete" on public."sor_procurement_requests"
  as permissive
  for delete
  to authenticated
  using (((requested_by = get_employee_id()) OR (EXISTS ( SELECT 1
   FROM employees e
  WHERE ((e.id = get_employee_id()) AND (e.is_head OR e.is_super_admin))))));
create policy "sor_procurement_insert" on public."sor_procurement_requests"
  as permissive
  for insert
  to authenticated
  with check ((sor_can_edit_opportunity(opportunity_id) AND (requested_by = get_employee_id())));
create policy "sor_procurement_read" on public."sor_procurement_requests"
  as permissive
  for select
  to authenticated
  using (true);
create policy "sor_procurement_update" on public."sor_procurement_requests"
  as permissive
  for update
  to authenticated
  using (((assigned_to = get_employee_id()) OR (requested_by = get_employee_id()) OR (EXISTS ( SELECT 1
   FROM employees e
  WHERE ((e.id = get_employee_id()) AND (e.is_head OR e.is_super_admin))))))
  with check (((assigned_to = get_employee_id()) OR (requested_by = get_employee_id()) OR (EXISTS ( SELECT 1
   FROM employees e
  WHERE ((e.id = get_employee_id()) AND (e.is_head OR e.is_super_admin))))));
create policy "sor_project_evaluations_read" on public."sor_project_evaluations"
  as permissive
  for select
  to authenticated
  using (true);
create policy "sor_project_evaluations_write" on public."sor_project_evaluations"
  as permissive
  for all
  to authenticated
  using (sor_can_edit_opportunity(opportunity_id))
  with check (sor_can_edit_opportunity(opportunity_id));
create policy "sor_purchase_order_links_read" on public."sor_purchase_order_links"
  as permissive
  for select
  to authenticated
  using (true);
create policy "sor_purchase_order_links_write" on public."sor_purchase_order_links"
  as permissive
  for all
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
  using (true)
  with check (true);
create policy "authenticated_insert_system_audit_logs" on public."system_audit_logs"
  as permissive
  for insert
  to public
  with check ((auth.uid() IS NOT NULL));
create policy "super_admin_all_system_audit_logs" on public."system_audit_logs"
  as permissive
  for all
  to public
  using ((EXISTS ( SELECT 1
   FROM employees
  WHERE ((employees.id = auth.uid()) AND (employees.is_super_admin = true)))))
  with check ((EXISTS ( SELECT 1
   FROM employees
  WHERE ((employees.id = auth.uid()) AND (employees.is_super_admin = true)))));
create policy "Authenticated users can update task activity" on public."task_activity"
  as permissive
  for update
  to public
  using (true)
  with check (true);

-- ============================================================
-- Triggers
-- ============================================================

CREATE TRIGGER trg_prevent_role_escalation BEFORE UPDATE ON public.employees FOR EACH ROW EXECUTE FUNCTION prevent_role_escalation();
CREATE TRIGGER trg_group_task_templates_touch BEFORE UPDATE ON public.group_task_templates FOR EACH ROW EXECUTE FUNCTION group_task_templates_touch();
CREATE TRIGGER trg_sales_opportunities_guard BEFORE UPDATE ON public.sales_opportunities FOR EACH ROW EXECUTE FUNCTION sales_opportunities_guard();
CREATE TRIGGER trg_sales_opportunities_require_sales_ref BEFORE INSERT OR UPDATE ON public.sales_opportunities FOR EACH ROW EXECUTE FUNCTION sales_opportunities_require_sales_ref();
CREATE TRIGGER trg_sales_opportunity_items_touch BEFORE UPDATE ON public.sales_opportunity_items FOR EACH ROW EXECUTE FUNCTION sales_opportunity_items_touch();
CREATE TRIGGER trg_sor_items_recalc AFTER INSERT OR DELETE OR UPDATE ON public.sales_opportunity_items FOR EACH ROW EXECUTE FUNCTION sor_recalc_expected_value();
CREATE TRIGGER trigger_update_sales_quota_progress AFTER INSERT OR DELETE OR UPDATE ON public.sales_revenue_logs FOR EACH ROW EXECUTE FUNCTION update_sales_quota_progress();
CREATE TRIGGER trg_sor_canvass_offers_touch BEFORE UPDATE ON public.sor_canvass_offers FOR EACH ROW EXECUTE FUNCTION sor_canvass_offers_touch();
CREATE TRIGGER trg_sor_canvasses_touch BEFORE UPDATE ON public.sor_canvasses FOR EACH ROW EXECUTE FUNCTION sor_canvasses_touch();
CREATE TRIGGER trg_sor_inclusions_touch BEFORE UPDATE ON public.sor_inclusions FOR EACH ROW EXECUTE FUNCTION sor_inclusions_touch();
CREATE TRIGGER trg_sor_procurement_requests_guard BEFORE UPDATE ON public.sor_procurement_requests FOR EACH ROW EXECUTE FUNCTION sor_procurement_requests_guard();
CREATE TRIGGER trg_sor_procurement_requests_touch BEFORE UPDATE ON public.sor_procurement_requests FOR EACH ROW EXECUTE FUNCTION sor_procurement_requests_touch();
CREATE TRIGGER trg_sor_project_evaluations_touch BEFORE UPDATE ON public.sor_project_evaluations FOR EACH ROW EXECUTE FUNCTION sor_project_evaluations_touch();
CREATE TRIGGER trg_sor_purchase_order_links_touch BEFORE UPDATE ON public.sor_purchase_order_links FOR EACH ROW EXECUTE FUNCTION sor_purchase_order_links_touch();
CREATE TRIGGER enforce_task_verification_security BEFORE UPDATE ON public.tasks FOR EACH ROW EXECUTE FUNCTION protect_task_verification();
CREATE TRIGGER tasks_broadcast_change_trigger AFTER INSERT OR DELETE OR UPDATE ON public.tasks FOR EACH ROW EXECUTE FUNCTION tasks_broadcast_change();

-- ============================================================
-- Views
-- ============================================================


