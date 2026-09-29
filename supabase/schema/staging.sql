
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
  "has_retail_access" boolean not null default false
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
  "storefront" text not null,
  "partner_name" text not null,
  "buyer_name" text,
  "odoo_salesperson_name" text,
  "amount" numeric not null default 0,
  "ordered_at" timestamp with time zone,
  "odoo_state" text,
  "is_excluded" boolean not null default false,
  "excluded_reason" text,
  "source" text not null default 'sync'::text
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
  "held_at" timestamp with time zone
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
alter table crm_lead_sources add constraint "crm_lead_sources_pkey" PRIMARY KEY (value);
alter table crm_pipeline_stages add constraint "crm_pipeline_stages_pkey" PRIMARY KEY (code);
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
alter table notifications add constraint "notifications_pkey" PRIMARY KEY (id);
alter table odoo_retail_queue add constraint "odoo_retail_queue_pkey" PRIMARY KEY (id);
alter table offset_leaves add constraint "offset_leaves_pkey" PRIMARY KEY (id);
alter table overtime_requests add constraint "overtime_requests_pkey" PRIMARY KEY (id);
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
alter table sor_canvass_offers add constraint "sor_canvass_offers_pkey" PRIMARY KEY (id);
alter table sor_canvasses add constraint "sor_canvasses_pkey" PRIMARY KEY (id);
alter table sor_condition_status add constraint "sor_requirement_status_pkey" PRIMARY KEY (id);
alter table sor_form_values add constraint "sor_form_values_pkey" PRIMARY KEY (id);
alter table sor_inclusions add constraint "sor_inclusions_pkey" PRIMARY KEY (id);
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
alter table undertime_requests add constraint "undertime_requests_pkey" PRIMARY KEY (id);
alter table verification_rate_limits add constraint "verification_rate_limits_pkey" PRIMARY KEY (ip_address);
alter table categories add constraint "categories_category_id_key" UNIQUE (category_id);
alter table commission_departments add constraint "commission_departments_key_key" UNIQUE (key);
alter table commission_departments add constraint "commission_departments_name_key" UNIQUE (name);
alter table commission_positions add constraint "commission_positions_unique_name_per_department" UNIQUE (department_id, name);
alter table commission_rates add constraint "commission_rates_unique_type_date" UNIQUE (rate_type, effective_from);
alter table commission_splits add constraint "commission_splits_unique_role" UNIQUE (project_type, share_role);
alter table committee_roles add constraint "committee_roles_role_name_key" UNIQUE (role_name);
alter table employee_group_members add constraint "employee_group_members_group_employee_key" UNIQUE (group_id, employee_id);
alter table employee_group_teams add constraint "employee_group_teams_group_team_key" UNIQUE (group_id, team);
alter table flow_edges add constraint "flow_edges_unique" UNIQUE (flow_id, from_stage_id, to_stage_id);
alter table flow_form_fields add constraint "flow_form_fields_default_unique" UNIQUE (flow_id, default_key);
alter table flow_snapshots add constraint "flow_snapshots_version_unique" UNIQUE (flow_id, version, version_minor);
alter table flow_stages add constraint "flow_stages_flow_scoped_key" UNIQUE (flow_id, id);
alter table odoo_retail_queue add constraint "odoo_retail_queue_odoo_so_number_key" UNIQUE (odoo_so_number);
alter table offset_leaves add constraint "offset_leaves_verification_token_key" UNIQUE (verification_token);
alter table overtime_requests add constraint "overtime_requests_verification_token_key" UNIQUE (verification_token);
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
alter table sor_purchase_order_links add constraint "sor_purchase_order_links_unique" UNIQUE (opportunity_id, po_number);
alter table sor_stage_field_values add constraint "sor_stage_field_values_unique" UNIQUE (stage_visit_id, field_id);
alter table sor_stage_visits add constraint "sor_stage_visits_unique_sequence" UNIQUE (opportunity_id, sequence);
alter table undertime_requests add constraint "undertime_requests_verification_token_key" UNIQUE (verification_token);
alter table app_settings add constraint "app_settings_id_check" CHECK ((id = true));
alter table chat_read_receipts add constraint "chat_read_receipts_entity_type_check" CHECK ((entity_type = ANY (ARRAY['TASK'::text, 'SALES'::text, 'COMMITTEE_TASK'::text, 'GROUP_TASK'::text])));
alter table commission_rates add constraint "commission_rates_rate_type_chk" CHECK ((rate_type = ANY (ARRAY['VAT'::text, 'WITHHOLDING'::text, 'POOL'::text, 'RETENTION'::text])));
alter table commission_splits add constraint "commission_splits_project_type_chk" CHECK ((project_type = ANY (ARRAY['SSP'::text, 'CP'::text, 'STRATEGIC'::text])));
alter table commission_splits add constraint "commission_splits_share_role_chk" CHECK ((share_role = ANY (ARRAY['deal_owner'::text, 'supporting_salesperson'::text, 'closing_salesperson'::text, 'sales_director'::text])));
alter table faq_data add constraint "faq_data_id_check" CHECK ((id = 1));
alter table flow_edges add constraint "flow_edges_no_self_loop" CHECK ((from_stage_id <> to_stage_id));
alter table flow_form_fields add constraint "flow_form_fields_custom_shape_chk" CHECK (((source <> 'custom'::text) OR ((label IS NOT NULL) AND (btrim(label) <> ''::text) AND (field_type IS NOT NULL))));
alter table flow_form_fields add constraint "flow_form_fields_default_key_chk" CHECK ((((source = 'default'::text) AND (default_key IS NOT NULL)) OR ((source = 'custom'::text) AND (default_key IS NULL))));
alter table flow_form_fields add constraint "flow_form_fields_source_chk" CHECK ((source = ANY (ARRAY['default'::text, 'custom'::text])));
alter table flow_form_fields add constraint "flow_form_fields_type_chk" CHECK (((field_type IS NULL) OR (field_type = ANY (ARRAY['text'::text, 'number'::text, 'date'::text, 'choice'::text]))));
alter table flow_stage_actions add constraint "flow_stage_actions_kind_chk" CHECK ((kind = ANY (ARRAY['create_group_task'::text, 'create_individual_task'::text])));
alter table flow_stage_fields add constraint "flow_stage_fields_label_not_blank" CHECK ((btrim(label) <> ''::text));
alter table flow_stage_fields add constraint "flow_stage_fields_sor_field_chk" CHECK ((((source = 'sor'::text) AND (sor_field IS NOT NULL)) OR ((source = 'custom'::text) AND (sor_field IS NULL))));
alter table flow_stage_fields add constraint "flow_stage_fields_source_chk" CHECK ((source = ANY (ARRAY['sor'::text, 'custom'::text])));
alter table flow_stage_fields add constraint "flow_stage_fields_type_chk" CHECK ((field_type = ANY (ARRAY['text'::text, 'number'::text, 'date'::text, 'choice'::text])));
alter table flow_stage_follow_ups add constraint "flow_stage_follow_ups_days_when_enabled" CHECK (((NOT enabled) OR (every_days IS NOT NULL)));
alter table flow_stage_follow_ups add constraint "flow_stage_follow_ups_every_days_check" CHECK (((every_days IS NULL) OR (every_days > 0)));
alter table flow_stages add constraint "flow_stages_color_check" CHECK (((color IS NULL) OR (color = ANY (ARRAY['tomato'::text, 'red'::text, 'crimson'::text, 'pink'::text, 'plum'::text, 'violet'::text, 'indigo'::text, 'blue'::text, 'sky'::text, 'cyan'::text, 'teal'::text, 'jade'::text, 'green'::text, 'lime'::text, 'yellow'::text, 'amber'::text, 'orange'::text, 'gold'::text, 'brown'::text, 'mauve'::text]))));
alter table flow_stages add constraint "flow_stages_name_not_blank" CHECK ((btrim(name) <> ''::text));
alter table hr_day_shift_config add constraint "hr_day_shift_config_weekday_check" CHECK (((weekday >= 0) AND (weekday <= 6)));
alter table odoo_retail_queue add constraint "odoo_retail_queue_status_check" CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'dismissed'::text])));
alter table offset_leaves add constraint "offset_leaves_head_status_check" CHECK ((head_status = ANY (ARRAY['PENDING'::text, 'APPROVED'::text, 'REJECTED'::text])));
alter table offset_leaves add constraint "offset_leaves_status_check" CHECK ((status = ANY (ARRAY['PENDING'::text, 'APPROVED'::text, 'REJECTED'::text, 'CANCELLED'::text])));
alter table overtime_requests add constraint "overtime_requests_head_status_check" CHECK ((head_status = ANY (ARRAY['PENDING'::text, 'APPROVED'::text, 'REJECTED'::text])));
alter table overtime_requests add constraint "overtime_requests_status_check" CHECK ((status = ANY (ARRAY['PENDING'::text, 'APPROVED_PAID'::text, 'APPROVED_OFFSET'::text, 'REJECTED'::text, 'CANCELLED'::text])));
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
alter table sor_canvasses add constraint "sor_canvasses_one_subject_chk" CHECK (((((procurement_request_id IS NOT NULL))::integer + ((inclusion_id IS NOT NULL))::integer) = 1));
alter table sor_inclusions add constraint "sor_inclusions_completeness_check" CHECK ((completeness = ANY (ARRAY['COVERED'::text, 'MISSING'::text, 'SUBSTITUTED'::text, 'NOT_REQUIRED'::text])));
alter table sor_inclusions add constraint "sor_inclusions_cost_source_chk" CHECK (((cost_source IS NULL) OR (cost_source = ANY (ARRAY['CANVASS_OFFER'::text, 'ODOO_CATALOG'::text, 'MANUAL'::text]))));
alter table sor_inclusions add constraint "sor_inclusions_sourcing_check" CHECK ((sourcing = ANY (ARRAY['STOCKABLE_AVAILABLE'::text, 'STOCKABLE_NEEDS_ORDERING'::text, 'SOURCE_OUT'::text])));
alter table sor_procurement_requests add constraint "sor_procurement_requests_outcome_check" CHECK ((outcome = ANY (ARRAY['IN_PROGRESS'::text, 'PURCHASED'::text, 'DELIVERED'::text, 'ON_ORDER'::text, 'ALREADY_EXISTS'::text, 'SUBSTITUTED'::text, 'UNAVAILABLE'::text])));
alter table sor_procurement_requests add constraint "sor_procurement_requests_verification_check" CHECK ((verification = ANY (ARRAY['UNVERIFIED'::text, 'VERIFIED'::text, 'PENDING_VERIFICATION'::text, 'NOT_FOUND'::text])));
alter table sor_purchase_order_links add constraint "sor_purchase_order_links_origin_check" CHECK ((origin = ANY (ARRAY['ODOO_ORIGIN'::text, 'MANUAL'::text])));
alter table sor_stage_participants add constraint "sor_stage_participants_source_chk" CHECK ((source = ANY (ARRAY['action'::text, 'assignment'::text, 'purchase_request'::text])));
alter table sor_stage_participants add constraint "sor_stage_participants_until_rule_chk" CHECK ((until_rule = ANY (ARRAY['stage_left'::text, 'stage_entered'::text, 'later_stage_left'::text, 'terminal'::text])));
alter table sor_stage_visits add constraint "sor_stage_visits_return_choice_check" CHECK ((return_choice = ANY (ARRAY['resume'::text, 'start_fresh'::text])));
alter table sor_stage_visits add constraint "sor_stage_visits_revert_choice_check" CHECK ((revert_choice = ANY (ARRAY['keep'::text, 'remove'::text])));
alter table stage_conditions add constraint "stage_conditions_kind_chk" CHECK ((kind = ANY (ARRAY['attachment'::text, 'field'::text, 'tickbox'::text, 'assignment'::text, 'deadline'::text, 'project_evaluation'::text, 'inclusions'::text, 'purchasing'::text])));
alter table task_activity add constraint "task_activity_type_check" CHECK (((type)::text = ANY (ARRAY[('SYSTEM'::character varying)::text, ('COMMENT'::character varying)::text, ('APPROVAL'::character varying)::text, ('HR_NOTE'::character varying)::text])));
alter table task_tags add constraint "task_tags_color_check" CHECK ((color = ANY (ARRAY['mauve'::text, 'amber'::text, 'blue'::text, 'red'::text, 'violet'::text, 'orange'::text, 'green'::text])));
alter table undertime_requests add constraint "undertime_requests_head_status_check" CHECK ((head_status = ANY (ARRAY['PENDING'::text, 'APPROVED'::text, 'REJECTED'::text])));
alter table undertime_requests add constraint "undertime_requests_status_check" CHECK ((status = ANY (ARRAY['PENDING'::text, 'APPROVED'::text, 'REJECTED'::text, 'CANCELLED'::text])));
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
alter table overtime_requests add constraint "overtime_requests_category_id_fkey" FOREIGN KEY (category_id) REFERENCES hr_leave_categories(id) ON DELETE SET NULL;
alter table overtime_requests add constraint "overtime_requests_company_id_fkey" FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE SET NULL;
alter table overtime_requests add constraint "overtime_requests_employee_id_fkey" FOREIGN KEY (employee_id) REFERENCES employees(id);
alter table overtime_requests add constraint "overtime_requests_head_id_fkey" FOREIGN KEY (head_id) REFERENCES employees(id) ON DELETE SET NULL;
alter table overtime_requests add constraint "overtime_requests_hr_processed_by_fkey" FOREIGN KEY (hr_processed_by) REFERENCES employees(id) ON DELETE SET NULL;
alter table overtime_requests add constraint "overtime_requests_printed_by_fkey" FOREIGN KEY (printed_by) REFERENCES employees(id);
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
alter table sor_action_runs add constraint "sor_action_runs_decided_by_fkey" FOREIGN KEY (decided_by) REFERENCES employees(id);
alter table sor_action_runs add constraint "sor_action_runs_group_task_id_fkey" FOREIGN KEY (group_task_id) REFERENCES committee_tasks(id) ON DELETE SET NULL;
alter table sor_action_runs add constraint "sor_action_runs_opportunity_id_fkey" FOREIGN KEY (opportunity_id) REFERENCES sales_opportunities(id) ON DELETE CASCADE;
alter table sor_action_runs add constraint "sor_action_runs_stage_id_fkey" FOREIGN KEY (stage_id) REFERENCES flow_stages(id) ON DELETE CASCADE;
alter table sor_action_runs add constraint "sor_action_runs_stage_visit_id_fkey" FOREIGN KEY (stage_visit_id) REFERENCES sor_stage_visits(id) ON DELETE SET NULL;
alter table sor_action_runs add constraint "sor_action_runs_task_id_fkey" FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE SET NULL;
alter table sor_canvass_offers add constraint "sor_canvass_offers_canvass_id_fkey" FOREIGN KEY (canvass_id) REFERENCES sor_canvasses(id) ON DELETE CASCADE;
alter table sor_canvass_offers add constraint "sor_canvass_offers_created_by_fkey" FOREIGN KEY (created_by) REFERENCES employees(id);
alter table sor_canvasses add constraint "sor_canvasses_created_by_fkey" FOREIGN KEY (created_by) REFERENCES employees(id);
alter table sor_canvasses add constraint "sor_canvasses_inclusion_id_fkey" FOREIGN KEY (inclusion_id) REFERENCES sor_inclusions(id) ON DELETE CASCADE;
alter table sor_canvasses add constraint "sor_canvasses_procurement_request_id_fkey" FOREIGN KEY (procurement_request_id) REFERENCES sor_procurement_requests(id) ON DELETE CASCADE;
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
alter table undertime_requests add constraint "undertime_requests_category_id_fkey" FOREIGN KEY (category_id) REFERENCES hr_leave_categories(id) ON DELETE SET NULL;
alter table undertime_requests add constraint "undertime_requests_company_id_fkey" FOREIGN KEY (company_id) REFERENCES companies(id);
alter table undertime_requests add constraint "undertime_requests_employee_id_fkey" FOREIGN KEY (employee_id) REFERENCES employees(id);
alter table undertime_requests add constraint "undertime_requests_head_id_fkey" FOREIGN KEY (head_id) REFERENCES employees(id) ON DELETE SET NULL;
alter table undertime_requests add constraint "undertime_requests_hr_processed_by_fkey" FOREIGN KEY (hr_processed_by) REFERENCES employees(id) ON DELETE SET NULL;
alter table undertime_requests add constraint "undertime_requests_printed_by_fkey" FOREIGN KEY (printed_by) REFERENCES employees(id);

-- ============================================================
-- Indexes (excluding those backing constraints)
-- ============================================================

CREATE INDEX commission_positions_department_id_idx ON public.commission_positions USING btree (department_id);
CREATE INDEX commission_rates_rate_type_idx ON public.commission_rates USING btree (rate_type);
CREATE INDEX commission_splits_project_type_idx ON public.commission_splits USING btree (project_type);
CREATE INDEX committee_tasks_opportunity_id_idx ON public.committee_tasks USING btree (opportunity_id);
CREATE INDEX committee_tasks_stage_visit_id_idx ON public.committee_tasks USING btree (stage_visit_id);
CREATE INDEX committee_tasks_template_idx ON public.committee_tasks USING btree (template_id);
CREATE UNIQUE INDEX companies_sort_order_key ON public.companies USING btree (sort_order);
CREATE UNIQUE INDEX crm_pipeline_stages_one_anchor ON public.crm_pipeline_stages USING btree ((true)) WHERE is_anchor;
CREATE UNIQUE INDEX crm_pipeline_stages_one_default ON public.crm_pipeline_stages USING btree ((true)) WHERE is_default;
CREATE UNIQUE INDEX crm_pipeline_stages_one_itb_gate ON public.crm_pipeline_stages USING btree ((true)) WHERE is_itb_gate;
CREATE UNIQUE INDEX crm_pipeline_stages_one_lost ON public.crm_pipeline_stages USING btree ((true)) WHERE is_lost;
CREATE UNIQUE INDEX crm_pipeline_stages_one_won ON public.crm_pipeline_stages USING btree ((true)) WHERE is_won;
CREATE UNIQUE INDEX crm_pipeline_stages_sort_order_key ON public.crm_pipeline_stages USING btree (sort_order);
CREATE INDEX employee_group_members_employee_idx ON public.employee_group_members USING btree (employee_id);
CREATE UNIQUE INDEX employee_groups_active_name_key ON public.employee_groups USING btree (lower(TRIM(BOTH FROM name))) WHERE (archived_at IS NULL);
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
CREATE INDEX odoo_retail_queue_created_at_idx ON public.odoo_retail_queue USING btree (created_at DESC);
CREATE INDEX odoo_retail_queue_status_idx ON public.odoo_retail_queue USING btree (status);
CREATE INDEX offset_leaves_company_id_idx ON public.offset_leaves USING btree (company_id);
CREATE INDEX offset_leaves_head_id_idx ON public.offset_leaves USING btree (head_id);
CREATE INDEX offset_leaves_leave_group_id_idx ON public.offset_leaves USING btree (leave_group_id);
CREATE INDEX overtime_requests_company_id_idx ON public.overtime_requests USING btree (company_id);
CREATE INDEX overtime_requests_head_id_idx ON public.overtime_requests USING btree (head_id);
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
CREATE INDEX sor_canvasses_inclusion_idx ON public.sor_canvasses USING btree (inclusion_id) WHERE (inclusion_id IS NOT NULL);
CREATE INDEX sor_canvasses_procurement_request_idx ON public.sor_canvasses USING btree (procurement_request_id) WHERE (procurement_request_id IS NOT NULL);
CREATE INDEX sor_condition_status_opp_idx ON public.sor_condition_status USING btree (opportunity_id);
CREATE INDEX sor_condition_status_stage_visit_id_idx ON public.sor_condition_status USING btree (stage_visit_id);
CREATE INDEX sor_form_values_opportunity_id_idx ON public.sor_form_values USING btree (opportunity_id);
CREATE INDEX sor_inclusions_opp_idx ON public.sor_inclusions USING btree (opportunity_id, sort_order);
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
CREATE INDEX undertime_requests_employee_id_idx ON public.undertime_requests USING btree (employee_id);
CREATE INDEX undertime_requests_head_id_idx ON public.undertime_requests USING btree (head_id);

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
alter table public."committee_task_tags" enable row level security;
alter table public."committee_tasks" enable row level security;
alter table public."companies" enable row level security;
alter table public."crm_pipeline_stages" enable row level security;
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
alter table public."notifications" enable row level security;
alter table public."odoo_retail_queue" enable row level security;
alter table public."offset_leaves" enable row level security;
alter table public."overtime_requests" enable row level security;
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
alter table public."sor_canvass_offers" enable row level security;
alter table public."sor_canvasses" enable row level security;
alter table public."sor_form_values" enable row level security;
alter table public."sor_inclusions" enable row level security;
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
  using ((((opportunity_id IS NULL) OR is_super_admin() OR ((stage_visit_id IS NOT NULL) AND (stage_visit_id IN ( SELECT sor_visible_visit_ids(committee_tasks.opportunity_id) AS sor_visible_visit_ids))) OR ((stage_visit_id IS NULL) AND (sor_access_level(opportunity_id) = ANY (ARRAY['full'::text, 'participant'::text])))) AND ((created_by = get_employee_id()) OR is_super_admin() OR (EXISTS ( SELECT 1
   FROM committee_task_members ctm
  WHERE ((ctm.committee_task_id = committee_tasks.id) AND (ctm.employee_id = get_employee_id())))))));
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
create policy "sor_canvass_offers_read" on public."sor_canvass_offers"
  as permissive
  for select
  to authenticated
  using (((EXISTS ( SELECT 1
   FROM employees e
  WHERE ((e.id = get_employee_id()) AND e.has_purchasing_flow))) OR (EXISTS ( SELECT 1
   FROM sor_canvasses c
  WHERE ((c.id = sor_canvass_offers.canvass_id) AND sor_can_edit_opportunity(COALESCE(( SELECT si.opportunity_id
           FROM sor_inclusions si
          WHERE (si.id = c.inclusion_id)), ( SELECT pr.opportunity_id
           FROM sor_procurement_requests pr
          WHERE (pr.id = c.procurement_request_id)))))))));
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
  using (((EXISTS ( SELECT 1
   FROM employees e
  WHERE ((e.id = get_employee_id()) AND e.has_purchasing_flow))) OR sor_can_edit_opportunity(COALESCE(( SELECT si.opportunity_id
   FROM sor_inclusions si
  WHERE (si.id = sor_canvasses.inclusion_id)), ( SELECT pr.opportunity_id
   FROM sor_procurement_requests pr
  WHERE (pr.id = sor_canvasses.procurement_request_id))))));
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
  using ((sor_can_edit_opportunity(opportunity_id) OR is_hr()));
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
  using ((sor_can_edit_opportunity(opportunity_id) OR is_hr()));
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
      id, flow_id, name, sort_order, is_terminal, pos_x, pos_y, color, bracket_label, created_at, updated_at
    )
    values (
      (v_elem->>'id')::uuid,
      p_flow_id,
      v_elem->>'name',
      coalesce((v_elem->>'sort_order')::int, 0),
      coalesce((v_elem->>'is_terminal')::boolean, false),
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
    when exists (
      select 1 from public.sor_stage_participants p
      where p.opportunity_id = p_opportunity_id
        and p.employee_id = public.get_employee_id()
        and p.closed_at is null
    ) then 'participant'
    when exists (
      select 1 from public.sor_stage_participants p
      where p.opportunity_id = p_opportunity_id
        and p.employee_id = public.get_employee_id()
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
  v_tag_ids uuid[];
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
    -- Issue #204 Part 2's fire-once gate — unchanged. A run already begun
    -- (any outcome, by an earlier call that DID make it this far, or by this
    -- same call being retried after a partial failure elsewhere) is skipped.
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
      -- "When confirmed" — no task yet. Notify every Decider directly (a
      -- plain notifications insert, same as createNotification) and leave
      -- the run pending for sor_decide_action_run to resolve later.
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
            -- `tag_ids` may be absent (SQL NULL), a JSON `null` (config
            -- carried no tags), or an array — only the array shape is safe
            -- to feed to jsonb_array_elements_text.
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
      else
        -- No branch for this kind — same "fails loudly, named to the mover"
        -- rule the old client-side builder followed for an unimplemented kind.
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

CREATE TRIGGER trg_prevent_role_escalation BEFORE UPDATE ON public.employees FOR EACH ROW EXECUTE FUNCTION prevent_role_escalation();
CREATE TRIGGER trg_group_task_templates_touch BEFORE UPDATE ON public.group_task_templates FOR EACH ROW EXECUTE FUNCTION group_task_templates_touch();
CREATE TRIGGER trg_odoo_retail_queue_updated_at BEFORE UPDATE ON public.odoo_retail_queue FOR EACH ROW EXECUTE FUNCTION set_odoo_retail_queue_updated_at();
CREATE TRIGGER offset_leaves_guard_head_status BEFORE UPDATE ON public.offset_leaves FOR EACH ROW EXECUTE FUNCTION guard_head_status_change();
CREATE TRIGGER overtime_requests_guard_head_status BEFORE UPDATE ON public.overtime_requests FOR EACH ROW EXECUTE FUNCTION guard_head_status_change();
CREATE TRIGGER trg_retail_orders_updated_at BEFORE UPDATE ON public.retail_orders FOR EACH ROW EXECUTE FUNCTION set_retail_orders_updated_at();
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
CREATE TRIGGER trg_sor_canvass_offers_touch BEFORE UPDATE ON public.sor_canvass_offers FOR EACH ROW EXECUTE FUNCTION sor_canvass_offers_touch();
CREATE TRIGGER trg_sor_canvasses_touch BEFORE UPDATE ON public.sor_canvasses FOR EACH ROW EXECUTE FUNCTION sor_canvasses_touch();
CREATE TRIGGER trg_sor_inclusions_touch BEFORE UPDATE ON public.sor_inclusions FOR EACH ROW EXECUTE FUNCTION sor_inclusions_touch();
CREATE TRIGGER trg_sor_procurement_requests_guard BEFORE UPDATE ON public.sor_procurement_requests FOR EACH ROW EXECUTE FUNCTION sor_procurement_requests_guard();
CREATE TRIGGER trg_sor_procurement_requests_touch BEFORE UPDATE ON public.sor_procurement_requests FOR EACH ROW EXECUTE FUNCTION sor_procurement_requests_touch();
CREATE TRIGGER trg_sor_purchase_order_links_touch BEFORE UPDATE ON public.sor_purchase_order_links FOR EACH ROW EXECUTE FUNCTION sor_purchase_order_links_touch();
CREATE TRIGGER enforce_task_verification_security BEFORE UPDATE ON public.tasks FOR EACH ROW EXECUTE FUNCTION protect_task_verification();
CREATE TRIGGER tasks_broadcast_change_trigger AFTER INSERT OR DELETE OR UPDATE ON public.tasks FOR EACH ROW EXECUTE FUNCTION tasks_broadcast_change();
CREATE TRIGGER undertime_requests_guard_head_status BEFORE UPDATE ON public.undertime_requests FOR EACH ROW EXECUTE FUNCTION guard_head_status_change();

-- ============================================================
-- Views
-- ============================================================

