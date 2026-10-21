// #168: sends the four notification types that are allowed to reach a closed
// tab. Creation for those types moves here entirely — the row is written
// with the service role, then a push is sent to every subscription the
// recipient holds. Everything else keeps being written client-side by
// src/services/notificationService.js; this function refuses any other type
// so the split between the two paths is enforced, not just documented.
//
// A subscription the push service reports as gone (404/410 — the browser
// unsubscribed, uninstalled, or the profile was wiped) is deleted immediately
// so dead endpoints do not accumulate.
//
// Deploy with the default JWT verification ON. The caller's own token names
// who they are for `sender_id`; a request with no valid session is refused
// before it reaches any of this.
//
// This function can't import from src/ (it's a separately-deployed Deno
// runtime), so the push-type allowlist is re-stated inline.
// src/constants/pushNotificationTypes.js is its JS twin, proven at Seam B —
// keep both in sync if either changes (pushNotificationTypes.sync.test.js
// checks they match).
//
// Local testing: VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT go in
// supabase/functions/.env (gitignored) — NOT supabase/.env.local, which the
// local edge runtime container never reads. `supabase stop` (backs up data)
// then `supabase start` after editing that file to make it pick up the
// change; env vars are read once at container start.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.8";
import webpush from "https://esm.sh/web-push@3.6.7";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const VAPID_PUBLIC_KEY = Deno.env.get("VAPID_PUBLIC_KEY") || "";
const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY") || "";
const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") || "mailto:tggroup.itdept@gmail.com";

const PUSH_NOTIFICATION_TYPES = new Set([
  "TASK_MENTION",
  "GROUP_TASK_MENTION",
  "OPPORTUNITY_MENTION",
  "TASK_ASSIGNED",
  "GROUP_ASSIGNED",
  "TASK_GRADED",
  "TASK_REJECTED",
  "TASK_VERIFIED",
  "TASK_APPROVED_BY_HEAD",
  "SIL_LEAVE_HEAD_DECISION",
  "LWOP_LEAVE_HEAD_DECISION",
  "OFFSET_LEAVE_HEAD_DECISION",
  "OVERTIME_HEAD_DECISION",
  "UNDERTIME_HEAD_DECISION",
  "SIL_LEAVE_DECISION",
  "LWOP_LEAVE_DECISION",
  "OFFSET_LEAVE_DECISION",
  "OVERTIME_DECISION",
  "UNDERTIME_DECISION",
  "MEETING_REQUEST_DECISION",
  "MEETING_APPROVED",
  "MEETING_REMINDER",
  "TASK_AWAITING_APPROVAL",
  "GROUP_TASK_READY_FOR_HR",
  "SIL_LEAVE_REQUEST",
  "LWOP_LEAVE_REQUEST",
  "OFFSET_LEAVE_REQUEST",
  "OVERTIME_REQUEST",
  "UNDERTIME_REQUEST",
  "MEETING_REQUEST",
  "OPPORTUNITY_FOLLOW_UP_DUE",
]);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const authHeader = req.headers.get("Authorization") || "";

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ success: false, message: "Invalid request body." }, 400);
  }

  const { recipient_id, type, title, message } = body;
  const sender_id = body.sender_id ?? null;
  const reference_id = body.reference_id ?? null;

  if (typeof recipient_id !== "string" || !recipient_id) {
    return jsonResponse({ success: false, message: "recipient_id is required." }, 400);
  }
  if (typeof type !== "string" || !PUSH_NOTIFICATION_TYPES.has(type)) {
    return jsonResponse(
      { success: false, message: `"${type}" is not one of the four types this function sends.` },
      400,
    );
  }
  if (typeof title !== "string" || !title || typeof message !== "string" || !message) {
    return jsonResponse({ success: false, message: "title and message are required." }, 400);
  }

  // Caller identity, resolved through their own JWT: `sender_id` can only
  // ever be the caller, never someone impersonated — the same rule the
  // narrowed notifications insert policy enforces for the client-side path.
  const callerClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: callerId, error: callerError } = await callerClient.rpc("get_employee_id");
  if (callerError || !callerId) {
    return jsonResponse({ success: false, message: "Could not resolve the caller." }, 401);
  }
  if (sender_id !== null && sender_id !== callerId) {
    return jsonResponse(
      { success: false, message: "sender_id must be the caller, or omitted." },
      403,
    );
  }

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const { data: notification, error: insertError } = await admin
    .from("notifications")
    .insert({
      recipient_id,
      sender_id: sender_id ?? callerId,
      type,
      title,
      message,
      reference_id,
    })
    .select()
    .single();

  if (insertError) {
    return jsonResponse({ success: false, message: insertError.message }, 500);
  }

  const { data: subscriptions, error: subsError } = await admin
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth")
    .eq("employee_id", recipient_id);

  if (subsError) {
    // The notification row is already written and the drawer will show it —
    // a subscription lookup failure should not look like the whole send failed.
    return jsonResponse({ success: true, notification, pushed: 0, pushError: subsError.message });
  }

  let pushed = 0;
  const gone: string[] = [];

  if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
    const payload = JSON.stringify({ title, message, type, reference_id, notificationId: notification.id });
    await Promise.all(
      (subscriptions || []).map(async (sub) => {
        try {
          await webpush.sendNotification(
            {
              endpoint: sub.endpoint,
              keys: { p256dh: sub.p256dh, auth: sub.auth },
            },
            payload,
          );
          pushed += 1;
        } catch (err) {
          const statusCode = err?.statusCode;
          if (statusCode === 404 || statusCode === 410) {
            gone.push(sub.id);
          }
        }
      }),
    );
  }

  if (gone.length > 0) {
    await admin.from("push_subscriptions").delete().in("id", gone);
  }

  return jsonResponse({ success: true, notification, pushed, removed: gone.length });
});
