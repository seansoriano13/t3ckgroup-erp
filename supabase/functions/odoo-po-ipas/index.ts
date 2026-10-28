// Reads one Odoo purchase order for an IPAS: the PO header, its item lines
// (pre-tax price, taxes, analytic account names, Brand), the receipts and the
// bills that are not cancelled. Read-only over the existing `execute_kw`.
//
// What the IPAS stores is this answer, so the shape below is the stored copy's
// shape (`ipas.odoo_copy`): { po, supplier, lines, receipts, bills }. `po` carries
// the PO's untaxed amount, tax and total (#596).
//
// A second mode, `{ action: "raise", poNumber, priority, source, purpose, sorIds,
// remarks }`, raises the IPAS (#550): this function asks Odoo itself and calls
// the service-role-only `ipas_raise_from_odoo` for the caller named by their JWT,
// with its own verdict (found / not_found / unavailable). The browser never
// sends a copy.
//
// A third mode, `{ action: "refresh", ipasId }` (refresh-on-open, #550): the
// function reads the IPAS's own PO from Odoo and records it through the
// service-role-only `ipas_refresh_from_odoo` as the caller named by their JWT
// email. The browser never sends a copy to be stored.
//
// The read itself lives in ../_shared/odooIpasCopy.ts (odoo-po-verify raises an IPAS from it too, #730).
//
// Odoo credentials live only in function secrets (see ../_shared/odoo.ts) — the
// browser never talks to Odoo directly. Deploy with the default JWT
// verification ON (i.e. do NOT pass --no-verify-jwt) so only a signed-in
// employee's session can trigger a read.
//
// Follows odoo-po-verify's contract, with one difference that matters here:
//   - a miss (bad format, no such order) is a 200 `{ success: true, found: false }`;
//   - "could not check" (not configured, Odoo down, rate-limited, any thrown
//     error) is `{ success: false, message }` and never `found: false`;
//   - the PO is matched by EXACT name only. odoo-po-verify falls back to a fuzzy
//     `ilike`, which is fine for confirming a typed number exists but would let
//     an IPAS be raised against a different PO than the one typed.

import { callerEmail } from "../_shared/caller.ts";
import { corsHeaders, jsonResponse } from "../_shared/odoo.ts";
import { readPo } from "../_shared/odooIpasCopy.ts";

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.8";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

type Row = Record<string, unknown>;

/**
 * Raises an IPAS. The server asks Odoo itself and hands the database its own
 * verdict and copy; nothing the browser sends is stored. The caller is resolved
 * from their own JWT, and the database checks they are Purchasing.
 */
async function raiseIpas(req: Request, body: Row) {
  const email = await callerEmail(req);
  if (!email) return jsonResponse({ success: false, message: "Not signed in." }, 401);

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const { data: employee } = await admin.from("employees").select("id").eq("email", email).maybeSingle();
  if (!employee?.id) return jsonResponse({ success: false, message: "Not signed in." }, 401);
  const actorId = employee.id;

  const answer = await readPo(body.poNumber);

  const { data, error } = await admin.rpc("ipas_raise_from_odoo", {
    p_actor: actorId,
    p_po_number: String(body.poNumber ?? ""),
    p_priority: body.priority ?? null,
    p_source: body.source ?? null,
    p_purpose: body.purpose ?? null,
    p_sor_ids: Array.isArray(body.sorIds) ? body.sorIds : [],
    p_remarks: typeof body.remarks === "string" ? body.remarks : null,
    p_verdict: answer.verdict,
    p_odoo_copy: answer.verdict === "found" ? answer.copy : null,
  });
  if (error) {
    // The database's refusal, with its code, so the screen can word it.
    return jsonResponse({
      success: false,
      refused: true,
      code: error.code,
      hint: error.hint ?? null,
      message: error.message,
    });
  }
  return jsonResponse({ success: true, ipas: data });
}

/**
 * Refresh-on-open (#550): the server reads the IPAS's own PO from Odoo and
 * records it for the signed-in reader. The browser names the IPAS, never a copy.
 * Answers:
 *   { success: true, refreshed: true, result }   recorded (result is the database's answer)
 *   { success: true, skipped: true }             cancelled IPAS: nothing to refresh
 *   { success: true, found: false, message }     Odoo has no such PO; the last copy stands
 *   { success: false, message }                  Odoo did not answer; the last copy stands
 *   { success: false, refused: true, code, message }  the database refused (not a reader, ...)
 */
async function refreshIpas(req: Request, body: Row) {
  const email = await callerEmail(req);
  if (!email) return jsonResponse({ success: false, message: "Not signed in." }, 401);

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const { data: row, error: readError } = await admin
    .from("ipas")
    .select("id, po_number, state")
    .eq("id", String(body.ipasId ?? ""))
    .maybeSingle();
  if (readError || !row) {
    return jsonResponse({ success: false, refused: true, code: "22023", message: "That IPAS isn't there." });
  }
  if (row.state === "cancelled") return jsonResponse({ success: true, skipped: true });

  const answer = await readPo(row.po_number);
  if (answer.verdict === "not_found") return jsonResponse({ success: true, found: false, message: answer.message });
  if (answer.verdict === "unavailable") return jsonResponse({ success: false, message: answer.message });

  const { data, error } = await admin.rpc("ipas_refresh_from_odoo", {
    p_actor_email: email,
    p_ipas_id: row.id,
    p_odoo_copy: answer.copy,
  });
  if (error) {
    return jsonResponse({ success: false, refused: true, code: error.code, message: error.message });
  }
  return jsonResponse({ success: true, refreshed: true, result: data });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  let body: Row;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ success: false, message: "Invalid request body." });
  }

  if (body?.action === "raise") return await raiseIpas(req, body);
  if (body?.action === "refresh") return await refreshIpas(req, body);

  // Read one PO (the raise dialog's preview). Nothing is stored.
  const answer = await readPo(body?.poNumber);
  if (answer.verdict === "found") return jsonResponse({ success: true, found: true, ...answer.copy });
  if (answer.verdict === "not_found") return jsonResponse({ success: true, found: false, message: answer.message });
  return jsonResponse({ success: false, message: answer.message });
});
