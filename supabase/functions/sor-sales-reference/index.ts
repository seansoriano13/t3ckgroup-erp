// The one save step for an SOR's S0 (Sales Reference), spec #800 / ticket #815 (ADR 0050).
//
// The browser sends { opportunityId, salesReference, reason }; this function works out who the
// caller is from the session token and calls the service-role-only database function
// set_sales_reference as that person. The browser never sends Odoo facts.
//
// #815: Odoo is not read yet, so the fact passed in is always "unreachable" and the S0 is saved as
// Not checked. #816 reads Odoo here (found / not_found plus the lines) and passes them in.
//
// A refusal (format, permission, lock, duplicate) comes back as a 200 with
// { success: false, refused: true, message, hint }, the odoo-po-verify contract.
//
// Deploy with JWT verification ON, so only a signed-in employee can call it.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.8";
import { callerEmail } from "../_shared/caller.ts";
import { corsHeaders, jsonResponse } from "../_shared/odoo.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

/** The database's refusal, without the function name it may lead with. */
const refusalText = (message: string) => message.replace(/^[a-z_]+: /, "");

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

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  try {
    const { data, error } = await admin.rpc("set_sales_reference", {
      p_actor_email: email,
      p_opportunity_id: opportunityId,
      p_sales_reference: salesReference,
      p_reason: reason,
      p_odoo: "unreachable",
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
