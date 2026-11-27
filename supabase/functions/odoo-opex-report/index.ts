// Reads one OPEX Report from Odoo (#1244, spec #1241, ADR 0056).
//
// Body: { s0: "S06637", handP0s?: ["P02367"] }, or { checkP0: "P02367" } to ask whether Odoo has that P0
// (answers { success: true, p0, exists }). The hand-added P0 list is empty
// until Finance's hand edits (#1245).
//
// Answers (always HTTP 200; the browser reads `success`):
//   { success: true, readAt, s0, tags: [{ id, name }], noProjectTag, projectName,
//     odooContractPrice, saleOrderFound, vatDivisor,
//     lines: [{ lineId, p0, supplier, p0State, product, quantity, sharePercent,
//               pesos, countedPesos, marks }],
//     expenses: [{ analyticLineId, date, description, account, accountCode, amount,
//                  group: "operation_admin" | "marketing" }] }
//   { success: false, refused: true, message }   caller is not Finance access or a Super Admin
//   { success: false, message }                  not signed in, bad S0, or Odoo did not answer
//
// Each report read logs one line, `opex_read_timing`, with how long each part took
// (sign-in check, settings, Odoo authenticate, rounds 1–4 and each call in them), so
// the function logs show where the ~3 s goes (#1266). No figures are logged.
//
// Speed (#1266): the Odoo sign-in is remembered while the function stays warm
// (authenticateOnce), and it starts together with the settings read, alongside the
// caller check instead of after it. Neither answer is used before the caller passes.
//
// Only a signed-in employee with Finance access or Super Admin may read. Deploy with
// JWT verification ON. Odoo credentials stay in function secrets.

import { callerEmail } from "../_shared/caller.ts";
import { authenticateOnce, corsHeaders, executeKw, isConfigured, jsonResponse, normalizePoNumber, normalizeReference } from "../_shared/odoo.ts";
import { readOpexReport } from "../_shared/odooOpexRead.ts";
import { createStepTimer, type StepTimer } from "../_shared/stepTimer.ts";

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.8";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

function logTiming(timer: StepTimer, s0: string, ok: boolean) {
  console.log(JSON.stringify({ event: "opex_read_timing", s0, ok, ...timer.summary() }));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ success: false, message: "Invalid request body." });
  }

  const timer = createStepTimer();
  const timed = timer.time;
  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // Started now, awaited only once the caller has passed. A failure is reported
  // where it is awaited; the empty catch only stops an early refusal from leaving
  // an unhandled rejection behind.
  const odooUidRead: Promise<number> | null = isConfigured() ? timed("authenticate", authenticateOnce) : null;
  odooUidRead?.catch(() => {});
  const settingsRead = timed("settings", async () =>
    await admin.from("costing_settings").select("vat_divisor").eq("id", 1).maybeSingle()
  );
  settingsRead.catch(() => {});

  const email = await timed("callerEmail", () => callerEmail(req));
  if (!email) return jsonResponse({ success: false, message: "Not signed in." }, 401);

  const { data: employee } = await timed("employee", async () =>
    await admin
      .from("employees")
      .select("id, is_super_admin, has_finance_flow, is_deleted")
      .eq("email", email)
      .maybeSingle()
  );
  if (!employee || employee.is_deleted || !(employee.is_super_admin || employee.has_finance_flow)) {
    return jsonResponse({ success: false, refused: true, message: "OPEX Reports are for Finance access and Super Admins." });
  }

  // Does this P0 exist in Odoo? Finance asks before adding one by hand.
  if (typeof body?.checkP0 === "string") {
    if (!odooUidRead) return jsonResponse({ success: false, message: "Odoo is not set up here, so the P0 could not be checked." });
    try {
      const name = normalizePoNumber(body.checkP0);
      const uid = await odooUidRead;
      const found = await executeKw(uid, "purchase.order", "search_read", [[["name", "=", name]], ["id"]], { limit: 1 });
      return jsonResponse({ success: true, p0: name, exists: found.length > 0 });
    } catch (e) {
      return jsonResponse({ success: false, message: `Odoo could not be read: ${(e as Error).message}` });
    }
  }

  const s0 = normalizeReference(body?.s0);
  if (!s0) return jsonResponse({ success: false, message: "That is not an S0 number." });
  const handP0s = Array.isArray(body?.handP0s) ? body.handP0s.map(String) : [];

  if (!odooUidRead) return jsonResponse({ success: false, message: "Odoo is not set up here, so nothing was read." });

  try {
    const [{ data: settings }, uid] = await Promise.all([settingsRead, odooUidRead]);
    const vatDivisor = Number(settings?.vat_divisor) || 1.12;
    const report = await timed("readOpexReport", () => readOpexReport(uid, { s0, handP0s, vatDivisor, timer }));
    logTiming(timer, s0, true);
    return jsonResponse({ success: true, readAt: new Date().toISOString(), vatDivisor, ...report });
  } catch (e) {
    logTiming(timer, s0, false);
    return jsonResponse({ success: false, message: `Odoo could not be read: ${(e as Error).message}` });
  }
});
