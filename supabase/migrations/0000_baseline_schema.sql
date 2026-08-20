-- ============================================================================
-- Baseline: schema that predates this migrations folder.
--
-- Migration tracking started at 0001_sales_opportunities.sql, but the app
-- already had a full schema in production by then — this file is that
-- pre-existing state, sourced from a live dump of the database (t3ckgroup.sql,
-- kept locally for AI/editor context and not tracked in the repo).
--
-- Every table below already exists in production. This migration is written
-- to be safe to run anyway (create table if not exists), and its column set
-- deliberately stops BEFORE anything a later numbered migration adds via
-- ALTER TABLE — 0005/0007 (status CHECK relaxation on overtime_requests /
-- offset_leaves), 0008 (employees.employment_status,
-- employees.sil_hours_balance), 0009 (the reason columns), 0012 (the
-- attachments columns) — so replaying 0000 through the current last migration
-- against an empty database reaches the same schema as production, in the
-- same order it was actually built.
-- ============================================================================

create table if not exists public.employees (
  id uuid not null default gen_random_uuid(),
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  updated_by uuid,
  email text,
  name text,
  department text,
  sub_department text,
  role character varying,
  is_head boolean default false,
  is_hr boolean default false,
  is_super_admin boolean default false,
  is_deleted boolean default false,
  avatar_path text,
  dashboard_banner_path text,
  dashboard_quote text,
  has_sales_flow boolean default false,
  has_task_flow boolean default true,
  offset_hours_balance numeric not null default 0,
  constraint employees_pkey primary key (id),
  constraint employees_updated_by_fkey foreign key (updated_by) references public.employees(id)
);

create table if not exists public.categories (
  id bigint generated always as identity not null,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  updated_by uuid,
  category_id text not null unique,
  description text,
  department text,
  sub_department text,
  constraint categories_pkey primary key (id),
  constraint categories_updated_by_fkey foreign key (updated_by) references public.employees(id)
);

create table if not exists public.tasks (
  id uuid not null default gen_random_uuid(),
  created_at timestamp with time zone not null default now(),
  category_id text,
  logged_by uuid,
  reported_to uuid,
  task_description text,
  project_title text,
  priority text default 'LOW'::text,
  status text default 'INCOMPLETE'::text,
  remarks text default ''::text,
  grade smallint default '0'::smallint,
  start_at timestamp with time zone,
  end_at timestamp with time zone,
  hr_verified boolean default false,
  hr_verified_at timestamp with time zone,
  hr_remarks text default ''::text,
  evaluated_by uuid,
  evaluated_at timestamp with time zone,
  edited_by uuid,
  edited_at timestamp with time zone,
  payment_voucher text,
  attachment_urls text[] default '{}'::text[],
  constraint tasks_pkey primary key (id),
  constraint tasks_category_fk foreign key (category_id) references public.categories(category_id),
  constraint tasks_logged_by_fk foreign key (logged_by) references public.employees(id),
  constraint tasks_edited_by_fk foreign key (edited_by) references public.employees(id),
  constraint tasks_evaluated_by_fkey foreign key (evaluated_by) references public.employees(id),
  constraint tasks_reported_to_fkey foreign key (reported_to) references public.employees(id)
);

create table if not exists public.sales_quotas (
  id bigint generated always as identity not null,
  employee_id uuid not null,
  amount_target numeric not null,
  month_year character varying not null,
  created_at timestamp with time zone not null default timezone('utc'::text, now()),
  status character varying not null default 'PUBLISHED'::character varying
    check (status::text = any (array['DRAFT'::character varying, 'PUBLISHED'::character varying]::text[])),
  current_actual numeric default 0,
  revenue_lost numeric default 0,
  deals_won integer default 0,
  deals_lost integer default 0,
  deals_pending integer default 0,
  constraint sales_quotas_pkey primary key (id),
  constraint sales_quotas_employee_id_fkey foreign key (employee_id) references public.employees(id)
);

create table if not exists public.sales_weekly_plans (
  id bigint generated always as identity not null,
  employee_id uuid not null,
  week_start_date date not null,
  status character varying not null,
  created_at timestamp with time zone not null default timezone('utc'::text, now()),
  amendment_snapshot jsonb,
  amendment_reason text,
  amendment_requested_at timestamp with time zone,
  constraint sales_weekly_plans_pkey primary key (id),
  constraint sales_weekly_plans_employee_id_fkey foreign key (employee_id) references public.employees(id)
);

create table if not exists public.sales_activities (
  id bigint generated always as identity not null,
  plan_id bigint,
  employee_id uuid not null,
  scheduled_date date not null,
  completed_at timestamp with time zone,
  status character varying default 'INCOMPLETE'::character varying,
  time_of_day character varying not null,
  activity_type character varying not null,
  account_name text,
  contact_person text,
  contact_number text,
  email_address text,
  address text,
  remarks_plan text,
  details_daily text,
  is_unplanned boolean default false,
  is_verified boolean default false,
  created_at timestamp with time zone not null default timezone('utc'::text, now()),
  head_remarks text,
  head_verified_at timestamp with time zone,
  head_verified_by uuid,
  reference_number text,
  expense_amount numeric,
  sales_outcome text check ((sales_outcome = any (array['COMPLETED'::text, 'LOST'::text])) or sales_outcome is null),
  is_deleted boolean default false,
  delete_reason text,
  delete_requested_by uuid,
  attachments jsonb default '[]'::jsonb,
  constraint sales_activities_pkey primary key (id),
  constraint sales_activities_plan_id_fkey foreign key (plan_id) references public.sales_weekly_plans(id),
  constraint sales_activities_employee_id_fkey foreign key (employee_id) references public.employees(id),
  constraint sales_activities_head_verified_by_fkey foreign key (head_verified_by) references public.employees(id)
);

create table if not exists public.sales_revenue_logs (
  id bigint generated always as identity not null,
  employee_id uuid not null,
  date date not null,
  status character varying not null,
  account character varying not null,
  product_item_sold text not null,
  revenue_amount numeric not null,
  remarks text,
  is_deleted boolean not null default false,
  deleted_at timestamp with time zone,
  so_number character varying,
  created_at timestamp with time zone not null default timezone('utc'::text, now()),
  last_edited_by uuid,
  last_edited_at timestamp with time zone,
  is_verified boolean default true,
  edit_request_amount numeric,
  edit_request_reason text,
  edit_request_status character varying
    check (edit_request_status::text = any (array['PENDING'::character varying, 'REJECTED'::character varying, 'APPROVED'::character varying]::text[])),
  edit_requested_at timestamp with time zone,
  record_type character varying not null default 'SALES_ORDER'::character varying
    check (record_type::text = any (array['SALES_ORDER'::character varying, 'SALES_QUOTATION'::character varying]::text[])),
  quotation_number character varying,
  reference_number character varying,
  is_converted boolean default false,
  constraint sales_revenue_logs_pkey primary key (id),
  constraint sales_revenue_logs_employee_id_fkey foreign key (employee_id) references public.employees(id),
  constraint sales_revenue_logs_last_edited_by_fkey foreign key (last_edited_by) references public.employees(id)
);

create table if not exists public.app_settings (
  id boolean not null default true check (id = true),
  updated_at timestamp with time zone not null default now(),
  universal_task_submission boolean not null default false,
  marketing_approval_by_ops_manager boolean default false,
  enable_self_verification boolean not null default false,
  enable_bulk_approval boolean not null default false,
  enable_visual_shaming boolean not null default false,
  require_revenue_verification boolean not null default false,
  allow_reported_to_reassignment boolean not null default false,
  sales_self_approve_expenses boolean default false,
  constraint app_settings_pkey primary key (id)
);

create table if not exists public.notifications (
  id uuid not null default gen_random_uuid(),
  recipient_id uuid not null,
  sender_id uuid,
  type character varying not null,
  title text not null,
  message text not null,
  is_read boolean default false,
  reference_id text,
  created_at timestamp with time zone not null default timezone('utc'::text, now()),
  constraint notifications_pkey primary key (id),
  constraint notifications_recipient_id_fkey foreign key (recipient_id) references public.employees(id),
  constraint notifications_sender_id_fkey foreign key (sender_id) references public.employees(id)
);

create table if not exists public.task_activity (
  id uuid not null default gen_random_uuid(),
  created_at timestamp with time zone not null default timezone('utc'::text, now()),
  task_id uuid not null,
  author_id uuid,
  type character varying not null
    check (type::text = any (array['SYSTEM'::character varying, 'COMMENT'::character varying, 'APPROVAL'::character varying, 'HR_NOTE'::character varying]::text[])),
  content text not null,
  metadata jsonb,
  constraint task_activity_pkey primary key (id),
  constraint task_activity_task_id_fkey foreign key (task_id) references public.tasks(id),
  constraint task_activity_author_id_fkey foreign key (author_id) references public.employees(id)
);

create table if not exists public.sales_activity_logs (
  id uuid not null default gen_random_uuid(),
  sales_activity_id bigint not null,
  author_id uuid,
  type character varying not null
    check (type::text = any (array['SYSTEM'::character varying::text, 'COMMENT'::character varying::text, 'APPROVAL'::character varying::text, 'HR_NOTE'::character varying::text])),
  content text not null,
  metadata jsonb,
  created_at timestamp with time zone not null default timezone('utc'::text, now()),
  constraint sales_activity_logs_pkey primary key (id),
  constraint sales_activity_logs_sales_activity_id_fkey foreign key (sales_activity_id) references public.sales_activities(id),
  constraint sales_activity_logs_author_id_fkey foreign key (author_id) references public.employees(id)
);

create table if not exists public.system_updates (
  id uuid not null default gen_random_uuid(),
  content text not null,
  created_by uuid,
  type text not null default 'feature'::text,
  is_active boolean not null default true,
  expires_at timestamp with time zone not null default (now() + '24:00:00'::interval),
  created_at timestamp with time zone default now(),
  constraint system_updates_pkey primary key (id),
  constraint system_updates_created_by_fkey foreign key (created_by) references public.employees(id)
);

create table if not exists public.chat_read_receipts (
  user_id uuid not null,
  entity_type text not null check (entity_type = any (array['TASK'::text, 'SALES'::text, 'COMMITTEE_TASK'::text])),
  entity_id text not null,
  last_read_at timestamp with time zone not null default now(),
  constraint chat_read_receipts_pkey primary key (user_id, entity_type, entity_id),
  constraint chat_read_receipts_user_id_fkey foreign key (user_id) references public.employees(id)
);

create table if not exists public.sales_custom_templates (
  id uuid not null default gen_random_uuid(),
  employee_id uuid not null,
  template_name text not null,
  template_payload jsonb not null,
  created_at timestamp with time zone not null default timezone('utc'::text, now()),
  constraint sales_custom_templates_pkey primary key (id),
  constraint sales_custom_templates_employee_id_fkey foreign key (employee_id) references public.employees(id)
);

create table if not exists public.chat_user_archives (
  user_id uuid not null,
  entity_type text not null,
  entity_id text not null,
  archived_at timestamp with time zone default now(),
  constraint chat_user_archives_pkey primary key (user_id, entity_type, entity_id),
  constraint chat_user_archives_user_id_fkey foreign key (user_id) references public.employees(id)
);

create table if not exists public.sales_quota_logs (
  id uuid not null default gen_random_uuid(),
  quota_id bigint not null,
  changed_by uuid,
  old_amount numeric,
  new_amount numeric not null,
  action character varying not null
    check (action::text = any (array['CREATED'::character varying, 'UPDATED'::character varying, 'PUBLISHED'::character varying]::text[])),
  created_at timestamp with time zone not null default timezone('utc'::text, now()),
  constraint sales_quota_logs_pkey primary key (id),
  constraint sales_quota_logs_quota_id_fkey foreign key (quota_id) references public.sales_quotas(id),
  constraint sales_quota_logs_changed_by_fkey foreign key (changed_by) references public.employees(id)
);

create table if not exists public.committee_tasks (
  id uuid not null default gen_random_uuid(),
  title text not null,
  description text,
  created_by uuid not null,
  due_date timestamp with time zone,
  status text not null default 'ACTIVE'::text,
  hr_verified boolean not null default false,
  hr_verified_at timestamp with time zone,
  hr_verified_by uuid,
  hr_remarks text,
  committee_role text,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  constraint committee_tasks_pkey primary key (id),
  constraint committee_tasks_created_by_fkey foreign key (created_by) references public.employees(id),
  constraint committee_tasks_hr_verified_by_fkey foreign key (hr_verified_by) references public.employees(id)
);

create table if not exists public.committee_task_members (
  id uuid not null default gen_random_uuid(),
  committee_task_id uuid not null,
  employee_id uuid not null,
  task_description text not null,
  role text,
  custom_role text,
  status text not null default 'PENDING'::text,
  grade integer,
  grade_remarks text,
  rated_at timestamp with time zone,
  rated_by uuid,
  created_at timestamp with time zone default now(),
  constraint committee_task_members_pkey primary key (id),
  constraint committee_task_members_committee_task_id_fkey foreign key (committee_task_id) references public.committee_tasks(id),
  constraint committee_task_members_employee_id_fkey foreign key (employee_id) references public.employees(id),
  constraint committee_task_members_rated_by_fkey foreign key (rated_by) references public.employees(id)
);

create table if not exists public.committee_task_activity (
  id uuid not null default gen_random_uuid(),
  task_id uuid not null,
  author_id uuid,
  type text not null,
  content text not null,
  metadata jsonb,
  created_at timestamp with time zone not null default now(),
  constraint committee_task_activity_pkey primary key (id),
  constraint committee_task_activity_task_id_fkey foreign key (task_id) references public.committee_tasks(id),
  constraint committee_task_activity_author_id_fkey foreign key (author_id) references public.employees(id)
);

create table if not exists public.committee_task_logs (
  id uuid not null default gen_random_uuid(),
  committee_task_id uuid not null,
  action text not null,
  actor_id uuid,
  details jsonb default '{}'::jsonb,
  created_at timestamp with time zone default now(),
  constraint committee_task_logs_pkey primary key (id),
  constraint committee_task_logs_committee_task_id_fkey foreign key (committee_task_id) references public.committee_tasks(id),
  constraint committee_task_logs_actor_id_fkey foreign key (actor_id) references public.employees(id)
);

create table if not exists public.committee_roles (
  id uuid not null default uuid_generate_v4(),
  role_name text not null unique,
  created_at timestamp with time zone default now(),
  constraint committee_roles_pkey primary key (id)
);

create table if not exists public.faq_data (
  id integer not null default 1 check (id = 1),
  categories jsonb not null default '[]'::jsonb,
  updated_at timestamp with time zone not null default now(),
  constraint faq_data_pkey primary key (id)
);

create table if not exists public.system_audit_logs (
  id uuid not null default gen_random_uuid(),
  author_id uuid,
  entity_type text,
  entity_id text,
  content text not null,
  type text not null default 'SYSTEM'::text,
  metadata jsonb default '{}'::jsonb,
  created_at timestamp with time zone default now(),
  constraint system_audit_logs_pkey primary key (id),
  constraint system_audit_logs_author_id_fkey foreign key (author_id) references public.employees(id)
);

create table if not exists public.revenue_activity_logs (
  id uuid not null default gen_random_uuid(),
  revenue_log_id bigint,
  author_id uuid,
  content text not null,
  type text not null default 'SYSTEM'::text,
  metadata jsonb default '{}'::jsonb,
  created_at timestamp with time zone default now(),
  constraint revenue_activity_logs_pkey primary key (id),
  constraint revenue_activity_logs_revenue_log_id_fkey foreign key (revenue_log_id) references public.sales_revenue_logs(id),
  constraint revenue_activity_logs_author_id_fkey foreign key (author_id) references public.employees(id)
);

-- overtime_requests / offset_leaves: the status CHECK is deliberately absent
-- here — 0005 (then 0007) adds it via ALTER TABLE ADD CONSTRAINT, and 0009 /
-- 0012 add the reason and attachments columns respectively.
create table if not exists public.overtime_requests (
  id uuid not null default gen_random_uuid(),
  employee_id uuid not null,
  date date not null,
  hours numeric not null,
  status text not null default 'PENDING'::text,
  hr_notes text,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint overtime_requests_pkey primary key (id),
  constraint overtime_requests_employee_id_fkey foreign key (employee_id) references public.employees(id)
);

create table if not exists public.offset_leaves (
  id uuid not null default gen_random_uuid(),
  employee_id uuid not null,
  date date not null,
  hours numeric not null,
  status text not null default 'PENDING'::text,
  hr_notes text,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint offset_leaves_pkey primary key (id),
  constraint offset_leaves_employee_id_fkey foreign key (employee_id) references public.employees(id)
);

-- ============================================================================
-- Auth helper / trigger functions applied by hand and never previously
-- captured in a tracked migration. Discovered when the first real preview
-- branch replayed the migrations from scratch: get_employee_id() is called
-- by 0002's sor_insert policy but didn't exist yet, so the branch failed.
-- These are the live definitions pulled straight from production.
-- ============================================================================

create or replace function public.get_employee_id()
returns uuid
language sql
security definer
as $function$
  SELECT id FROM public.employees WHERE email = auth.jwt() ->> 'email';
$function$;

create or replace function public.is_head()
returns boolean
language sql
security definer
as $function$
  SELECT is_head FROM public.employees WHERE email = auth.jwt() ->> 'email';
$function$;

create or replace function public.is_hr()
returns boolean
language sql
security definer
as $function$
  SELECT is_hr FROM public.employees WHERE email = auth.jwt() ->> 'email';
$function$;

create or replace function public.is_super_admin()
returns boolean
language sql
security definer
as $function$
  SELECT is_super_admin FROM public.employees WHERE email = auth.jwt() ->> 'email';
$function$;

create or replace function public.prevent_role_escalation()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
DECLARE
  v_caller_is_super_admin BOOLEAN;
  v_caller_is_hr          BOOLEAN;
BEGIN
  SELECT is_super_admin, is_hr
  INTO   v_caller_is_super_admin, v_caller_is_hr
  FROM   public.employees
  WHERE  id = auth.uid();

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

  RETURN NEW;
END;
$function$;

create trigger trg_prevent_role_escalation
before update on public.employees
for each row execute function public.prevent_role_escalation();

create or replace function public.protect_task_verification()
returns trigger
language plpgsql
security definer
as $function$BEGIN
  IF OLD.hr_verified IS DISTINCT FROM NEW.hr_verified THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.employees
      WHERE email = (auth.jwt() ->> 'email') AND (is_hr = true OR is_super_admin = true)
    ) THEN
      RAISE EXCEPTION 'UNAUTHORIZED: Only HR or Super Administrators can modify the verification status of a task.';
    END IF;
  END IF;
  RETURN NEW;
END;$function$;

create trigger enforce_task_verification_security
before update on public.tasks
for each row execute function public.protect_task_verification();

create or replace function public.get_user_active_chats(p_user_id uuid, p_limit integer default 30)
returns table(entity_id text, entity_type text, title text, subtitle text, status text, latest_message text, latest_author text, latest_created_at timestamp with time zone, last_read_at timestamp with time zone, is_unread boolean, is_deleted boolean, is_archived boolean)
language plpgsql
as $function$BEGIN
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
END;$function$;

create or replace function public.update_sales_quota_metrics()
returns trigger
language plpgsql
as $function$
DECLARE
  verification_required BOOLEAN;
BEGIN
  SELECT require_revenue_verification INTO verification_required FROM app_settings LIMIT 1;

  IF (NOT verification_required OR NEW.is_verified) AND NEW.record_type = 'SALES_ORDER' THEN
    -- Update sales_quotas logic here...
  END IF;

  RETURN NEW;
END;
$function$;

create or replace function public.update_sales_quota_progress()
returns trigger
language plpgsql
as $function$
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
$function$;

create trigger trigger_update_sales_quota_progress
after insert or update or delete on public.sales_revenue_logs
for each row execute function public.update_sales_quota_progress();

-- rls_auto_enable() + its event trigger (ensure_rls) auto-enable RLS on every
-- new table in production. Event triggers need a privileged role the
-- migration runner doesn't have, so this can't be replayed here — it must be
-- created by hand (SQL editor) on any environment that needs it. Until then,
-- new tables on fresh branches need an explicit `enable row level security`,
-- same as migrations already do for 0002/0003/0004/0008/0017/0024.
