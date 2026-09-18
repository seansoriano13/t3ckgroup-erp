-- Issue #179 — the Quota System (monthly target, amendable weekly plan,
-- daily scheduled activities, head verification, revenue log) belonged to a
-- sales feature that was removed deliberately. Nothing in src/ writes or
-- reads these six tables any more (src/lib/seedSanitize.js carries a stray
-- sanitizer for local dev seed data, not a real reader). If the workflow
-- ever returns, the spec document referenced from issue #179 records what it
-- looked like.
--
-- Row check recorded on issue #179 before this ran: both staging and
-- production hold real historical rows (sales_quotas 24, sales_quota_logs
-- 20, sales_weekly_plans 62, sales_activities 1895, sales_activity_logs
-- 4241, sales_revenue_logs 102) — the spec's stated precondition of "no
-- rows" did not hold. Dropped anyway on explicit instruction; the row
-- counts are the record of what this removed.
--
-- get_user_active_chats() unions a sales_chats CTE built from two of these
-- tables — left in place it would 500 on every call once they're gone, so
-- it is recreated here without that branch. update_sales_quota_metrics()
-- and update_sales_quota_progress() exist only for this feature (the former
-- already dead — see 20260909100000 — the latter fired only by the trigger
-- dropped with sales_revenue_logs below) and are dropped with it.
--
-- revenue_activity_logs (comments on a revenue log entry) is a seventh,
-- unnamed table hanging off sales_revenue_logs by foreign key. It is not
-- one of the six the ticket names, so it is left in place — CASCADE below
-- only drops its now-dangling foreign key constraint, not the table itself.

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

drop table if exists public.sales_activity_logs cascade;
drop table if exists public.sales_activities cascade;
drop table if exists public.sales_quota_logs cascade;
drop table if exists public.sales_quotas cascade;
drop table if exists public.sales_revenue_logs cascade;
drop table if exists public.sales_weekly_plans cascade;

drop function if exists public.update_sales_quota_metrics();
drop function if exists public.update_sales_quota_progress();
