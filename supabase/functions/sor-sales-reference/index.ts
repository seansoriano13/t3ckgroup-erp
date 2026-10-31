// The one save step for an SOR's S0 (Sales Reference), spec #800 / ticket #815 (ADR 0050).
//
// The browser sends { opportunityId, salesReference, reason }; this function works out who the
// caller is from the session token and calls the service-role-only database function
// set_sales_reference as that person. The browser never sends Odoo facts.
//
// #816: this function asks Odoo about the S0 first (the same lookup odoo-sor-lookup uses) and passes
// the answer in: found (with the order's lines, pulled in the same step through the line-matching
// save), not_found (the save refuses: "Odoo has no S01237. Check the number.") or unreachable (the
// S0 is saved as Not checked). On the local stack with no Odoo, the sample quotation answers.
//
// A refusal (format, permission, lock, duplicate) comes back as a 200 with
// { success: false, refused: true, message, hint }, the odoo-po-verify contract.
//
// Deploy with JWT verification ON, so only a signed-in employee can call it.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.8";
import { callerEmail } from "../_shared/caller.ts";
import {
  authenticate,
  corsHeaders,
  findOrder,
  isConfigured,
  isLocalStack,
  jsonResponse,
} from "../_shared/odoo.ts";
import { fetchOrderItems, localSampleLookup } from "../_shared/odooS0Lines.ts";
import { normalizeS0, outcomeFromAnswer, type S0Answer } from "../_shared/salesReference.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

/** The database's refusal, without the function name it may lead with. */
const refusalText = (message: string) => message.replace(/^[a-z_]+: /, "");

/** Asks Odoo about the S0. Any failure to get an answer is "unreachable", never a refusal. */
async function askOdoo(ref: string): Promise<S0Answer> {
  if (!isConfigured()) {
    if (!isLocalStack()) return { kind: "unreachable" };
    const sample = localSampleLookup(ref);
    return { kind: "found", name: sample.order.name, items: sample.items };
  }
  try {
    const uid = await authenticate();
    const order = await findOrder(uid, ref);
    if (!order) return { kind: "not_found" };
    return { kind: "found", name: order.name, items: await fetchOrderItems(uid, order.id) };
  } catch (err) {
    console.error("sor-sales-reference Odoo error:", err);
    return { kind: "unreachable" };
  }
}

// ---- action "preview" (#818) -------------------------------------------------------------------
// What saving a different S0 would do to the products, shown before the save. Read-only. Kept apart
// from the save path below. No preview (null) when Odoo cannot answer or has no such S0: the save
// then decides.

async function previewChange(req: Request, opportunityId: string, salesReference: string | null) {
  const authHeader = req.headers.get("Authorization") || "";
  const asCaller = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY") || "", {
    global: { headers: { Authorization: authHeader } },
  });
  let newIds: string[] = [];
  if (salesReference) {
    const typed = normalizeS0(salesReference);
    if (!typed) return jsonResponse({ success: true, preview: null });
    const answer = await askOdoo(typed);
    if (answer.kind !== "found") return jsonResponse({ success: true, preview: null });
    newIds = answer.items
      .map((item: { odoo_line_id?: unknown }) => item.odoo_line_id)
      .filter((id: unknown) => id !== null && id !== undefined)
      .map(String);
  }
  const { data, error } = await asCaller.rpc("sales_reference_change_preview", {
    p_opportunity_id: opportunityId,
    p_new_odoo_line_ids: newIds,
  });
  if (error) return jsonResponse({ success: true, preview: null });
  return jsonResponse({ success: true, preview: data });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ success: false, message: "Invalid request body." });
  }

  const opportunityId = typeof body.opportunityId === "string" ? body.opportunityId : "";
  if (!opportunityId) {
    return jsonResponse({ success: false, refused: true, message: "Say which SOR to change." });
  }
  const salesReference = typeof body.salesReference === "string" ? body.salesReference : null;
  const reason = typeof body.reason === "string" ? body.reason : null;

  const email = await callerEmail(req);
  if (!email) {
    return jsonResponse({ success: false, refused: true, message: "Sign in to change the S0." }, 401);
  }

  if (body.action === "preview") {
    return await previewChange(req, opportunityId, salesReference);
  }

  // Clearing the S0, or a number that is not an S0 at all, needs no Odoo answer: the save step
  // clears it, or refuses the format.
  const typed = normalizeS0(salesReference);
  const outcome = typed
    ? outcomeFromAnswer(typed, await askOdoo(typed))
    : { odoo: "unreachable" as const, salesReference, items: null };

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  try {
    const { data, error } = await admin.rpc("set_sales_reference", {
      p_actor_email: email,
      p_opportunity_id: opportunityId,
      p_sales_reference: outcome.salesReference,
      p_reason: reason,
      p_odoo: outcome.odoo,
      p_items: outcome.items,
    });
    if (error) {
      return jsonResponse({
        success: false,
        refused: true,
        message: refusalText(error.message),
        ...(error.hint ? { hint: error.hint } : {}),
      });
    }
    return jsonResponse({ success: true, ...(data as Record<string, unknown>) });
  } catch (err) {
    console.error("sor-sales-reference error:", err);
    return jsonResponse({ success: false, message: err instanceof Error ? err.message : "The S0 could not be saved." });
  }
});
