// Issue #204 Part 3 — hourly reminder sweep for Follow-up Cadence.
//
// Called by pg_cron (see migration 20260917010000_sor_follow_up_reminder_cron.sql)
// through pg_net's net.http_post, guarded by the same CRON_SECRET/Bearer
// convention odoo-sor-sync/index.ts already uses for its own cron trigger —
// mirrored here rather than inventing a second mechanism.
//
// For each row `sor_due_follow_ups(now())` returns: write one
// FOLLOW_UP_REMINDER timeline entry on `sales_opportunity_logs`, keyed by
// (stage_visit_id, a rounded due_at) so a retried sweep can't double-post —
// checked with an existence query rather than a DB constraint, since
// `sales_opportunity_logs` has no natural unique key to hang one off today.
// Then notify each resolved recipient with an OPPORTUNITY_FOLLOW_UP_DUE
// notification.
//
// This function writes `notifications` directly with the service-role key
// rather than calling `send-push`: that function authenticates its caller
// through their own user JWT (`get_employee_id()`), which a cron sweep has
// none of — there is no signed-in employee to be. Duplicating a minimal
// insert here (and skipping the actual WebPush send) is a deliberate,
// documented trade-off: in-app notifications land, but a closed tab does
// not get a desktop push from this path today. Wiring actual WebPush would
// mean either giving this function its own VAPID send (duplicating
// send-push's logic) or teaching send-push to accept a service-role/cron
// caller — left for follow-up work, called out in the PR report.
//
// UNVERIFIED: there is no live Supabase project or local Postgres available
// while building this, so neither the pg_cron schedule nor this function's
// end-to-end behavior against `sor_due_follow_ups` has been exercised.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.8";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

type DueRow = {
  opportunity_id: string;
  stage_visit_id: string;
  stage_id: string;
  entered_at: string;
  every_days: number;
  recipients: Array<Record<string, unknown>>;
  due_at: string;
};

/**
 * Selector resolution mirrors src/utils/resolvePeople.js, but this function
 * can't import client code (separately-deployed Deno runtime) — a minimal,
 * server-side mirror covering `employee` and `role` selectors (the two the
 * default cadence recipients list uses: deal_owner). `group`/`team`
 * selectors are resolved best-effort against `employee_group_members` /
 * `employees.sub_department` when present.
 */
async function resolveRecipients(
  selectors: Array<Record<string, unknown>>,
  opportunity: Record<string, unknown>,
): Promise<string[]> {
  const ROLE_COLUMNS: Record<string, string[]> = {
    deal_owner: ["deal_owner_id"],
    closing_sales: ["closing_sales_id"],
    support_sales: ["support_sales_1_id", "support_sales_2_id"],
    sales_director: ["sales_director_id"],
    registrar: ["registered_by"],
  };

  const ids = new Set<string>();
  for (const selector of selectors || []) {
    if (!selector) continue;
    const type = selector.type as string;
    if (type === "employee" && selector.id) {
      ids.add(String(selector.id));
    } else if (type === "role") {
      for (const col of ROLE_COLUMNS[selector.role as string] || []) {
        const value = opportunity[col];
        if (value) ids.add(String(value));
      }
    } else if (type === "group" && selector.id) {
      const { data } = await admin
        .from("employee_group_members")
        .select("employee_id")
        .eq("group_id", selector.id);
      for (const row of data || []) ids.add(String(row.employee_id));
    } else if (type === "team" && selector.team) {
      const { data } = await admin
        .from("employees")
        .select("id")
        .eq("sub_department", selector.team)
        .neq("is_deleted", true);
      for (const row of data || []) ids.add(String(row.id));
    }
  }
  return [...ids];
}

Deno.serve(async (req: Request) => {
  const authHeader = req.headers.get("Authorization");
  const CRON_SECRET = Deno.env.get("CRON_SECRET");
  if (CRON_SECRET && authHeader !== `Bearer ${CRON_SECRET}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  try {
    const { data: dueRows, error: dueError } = await admin.rpc("sor_due_follow_ups", {
      p_now: new Date().toISOString(),
    });
    if (dueError) throw dueError;

    let reminded = 0;
    let notified = 0;

    for (const row of (dueRows || []) as DueRow[]) {
      // Idempotency: a retried sweep must not double-post the same visit's
      // reminder for the same due hour.
      const dueHour = new Date(row.due_at).toISOString().slice(0, 13); // yyyy-mm-ddThh
      const { data: existing, error: existingError } = await admin
        .from("sales_opportunity_logs")
        .select("id")
        .eq("opportunity_id", row.opportunity_id)
        .filter("metadata->>event", "eq", "FOLLOW_UP_REMINDER")
        .filter("metadata->>stageVisitId", "eq", row.stage_visit_id)
        .gte("created_at", `${dueHour}:00:00.000Z`)
        .lt("created_at", `${dueHour}:59:59.999Z`)
        .maybeSingle();
      if (existingError) throw existingError;
      if (existing) continue;

      const daysSince = Math.max(
        1,
        Math.round((Date.now() - new Date(row.entered_at).getTime()) / (24 * 60 * 60 * 1000)),
      );

      const { error: logError } = await admin.from("sales_opportunity_logs").insert({
        opportunity_id: row.opportunity_id,
        author_id: null,
        type: "SYSTEM",
        content: `Follow-up due · ${row.every_days} day(s) since the last follow-up`,
        metadata: {
          event: "FOLLOW_UP_REMINDER",
          stageVisitId: row.stage_visit_id,
          stageId: row.stage_id,
          dueAt: row.due_at,
        },
      });
      if (logError) throw logError;
      reminded += 1;

      const { data: opportunity, error: oppError } = await admin
        .from("sales_opportunities")
        .select(
          "id, sales_reference, project_title, client_name, deal_owner_id, closing_sales_id, support_sales_1_id, support_sales_2_id, sales_director_id, registered_by",
        )
        .eq("id", row.opportunity_id)
        .single();
      if (oppError) throw oppError;

      const recipientIds = await resolveRecipients(row.recipients || [], opportunity || {});
      const title = "Follow-up due";
      const label = opportunity?.sales_reference || opportunity?.project_title || "this deal";
      const message = `Follow-up due on ${label} · ${daysSince} day(s) since the last follow-up.`;

      for (const recipientId of recipientIds) {
        const { error: notifyError } = await admin.from("notifications").insert({
          recipient_id: recipientId,
          sender_id: null,
          type: "OPPORTUNITY_FOLLOW_UP_DUE",
          title,
          message,
          reference_id: row.opportunity_id,
        });
        if (!notifyError) notified += 1;
      }
    }

    return jsonResponse({ success: true, reminded, notified });
  } catch (err) {
    console.error("[sor-follow-up-reminders] Error:", err);
    return jsonResponse({ success: false, error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
