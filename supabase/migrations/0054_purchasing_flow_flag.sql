-- ==============================================================================
-- 0054_purchasing_flow_flag.sql
--
-- Purchasing access (issue #39). Purchasing becomes a Module of its own, with
-- an open Procurement Request queue behind it, so this is the flag that decides
-- who sees it — the third member of the set `has_sales_flow` and
-- `has_task_flow` already form.
--
-- WHY A FLAG AND NOT THE DEPARTMENT COLUMN
-- `employees.department` and `employees.sub_department` are free text. The org
-- really does file purchasing as a sub-department under OPERATIONS (see the
-- procurementService fixtures, which mirror that deliberately), so gating on
-- the string is tempting and would even work on the day it is written. It fails
-- the first time somebody types "Purchasing " or "PURCHASING/ADMIN": the
-- purchaser's queue disappears with no error anywhere explaining why, because
-- nothing in the system claims that column means anything. A boolean cannot be
-- misspelled, and the Super Admin who sets it can see what they set.
--
-- The existing access booleans are the prior art and the precedent this follows
-- exactly: 0000_baseline_schema.sql declares `has_sales_flow boolean default
-- false` and `has_task_flow boolean default true` on this same table.
--
-- WHY IT DEFAULTS FALSE
-- `has_task_flow` defaults true because everyone logs tasks. Purchasing is a
-- handful of people, so the safe default is the one that grants nothing: an
-- existing employee gains no new visibility from this migration running, and a
-- Super Admin turns it on for the people who do the work.
--
-- NOTE ON SCOPE: this grants sight of the Purchasing Module, nothing more. It
-- confers no write access anywhere. Who may resolve or reassign a Procurement
-- Request is still decided entirely by the RLS policies in
-- 0017_sor_procurement_requests.sql, which key on `assigned_to`,
-- `requested_by`, and the head/super-admin escalation — deliberately not on
-- this flag, so that turning the Module on for somebody cannot silently widen
-- what they may change.
--
-- SAFE TO RUN AT ANY TIME, against a live production frontend of any version:
--   * One new column with a NOT NULL DEFAULT false. Every existing row becomes
--     "no purchasing access", which is what every existing row already is.
--   * No existing row changes meaning, and no deployed frontend selects it.
--   * A frontend deployed before this migration keeps working: it never names
--     the column, and the default makes its inserts valid.
--   * Idempotent.
-- ==============================================================================

alter table public.employees
  add column if not exists has_purchasing_flow boolean not null default false;

comment on column public.employees.has_purchasing_flow is
  'Purchasing Module access (issue #39): shows the Purchasing nav and its open Procurement Request queue. Visibility only — write access to a procurement request is governed by the RLS policies in 0017.';
