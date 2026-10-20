// Confirms an Odoo purchase order exists and reports what it bought, so the PO
// number purchasing types against a procurement request is a verified fact
// rather than free text.
//
// Fires once per resolved request item — tens of invocations a month, not one
// per page view.
//
// Odoo credentials live only in function secrets (see ../_shared/odoo.ts) — the
// browser never talks to Odoo directly. Deploy with the default JWT
// verification ON (i.e. do NOT pass --no-verify-jwt) so only a signed-in
// employee's session can trigger a lookup.
//
// Follows odoo-sor-lookup's contract: a normal miss (bad format, no such order)
// comes back as a 200 with `found: false`, never an error. The caller
// distinguishes "Odoo says no" from "Odoo did not answer", because the first is
// a real answer and the second must not read as one.
//
// Two modes (#548):
//   - lookup (no `itemId`): the plain check above.
//   - save (`itemId`, `poNumber`, optional `action`, default "order"): asks Odoo,
//     then calls the database's service-role-only
//     purchase_request_item_apply_po_check as the signed-in caller, which makes
//     the verdict (verified / refused naming the PO / saved as not checked) and
//     the item status move. The browser never sends a verdict.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.8";
import {
  authenticate,
  corsHeaders,
  executeKw,
  isConfigured,
  jsonResponse,
} from "../_shared/odoo.ts";

// Odoo numbers a confirmed purchase.order P0####, mirroring the S0#### it gives
// a sale.order. Kept permissive on width, matching SALES_REFERENCE_PATTERN.
const PO_NUMBER_PATTERN = /^P\d+$/;

function normalizePoNumber(value: unknown) {
  const ref = String(value ?? "").trim().toUpperCase();
  return PO_NUMBER_PATTERN.test(ref) ? ref : null;
}

/**
 * Finds a purchase order by number. Falls back to a fuzzy match for the same
 * reason findOrder does: references get typed without their leading zeroes.
 */
async function findPurchaseOrder(uid: number, ref: string) {
  const fields = [
    "id",
    "name",
    "state",
    "partner_id",
    "date_order",
    "date_planned",
    "amount_total",
  ];

  const exact = await executeKw(
    uid,
    "purchase.order",
    "search_read",
    [[["name", "=", ref]], fields],
    { limit: 1 },
  );
  if (exact.length) return exact[0];

  const fuzzy = await executeKw(
    uid,
    "purchase.order",
    "search_read",
    [[["name", "ilike", ref]], fields],
    { limit: 1 },
  );
  return fuzzy[0] || null;
}

async function fetchOrderProducts(uid: number, orderId: number) {
  const lines = await executeKw(
    uid,
    "purchase.order.line",
    "search_read",
    [
      [["order_id", "=", orderId]],
      ["product_id", "name", "product_qty", "product_uom", "price_unit", "date_planned"],
    ],
    { order: "sequence asc" },
  );

  return lines
    .map((l: Record<string, unknown>) => ({
      // product_id comes back as [id, display_name]; the display name is the
      // canonical Odoo product name, which is exactly what sales needs to
      // search for once the record exists.
      id: Array.isArray(l.product_id) ? l.product_id[0] : null,
      name: Array.isArray(l.product_id) ? l.product_id[1] : l.name || "",
      quantity: l.product_qty || 0,
      unit: Array.isArray(l.product_uom) ? l.product_uom[1] : "",
      price_unit: Number(l.price_unit) || 0,
      date_planned: l.date_planned ? String(l.date_planned).slice(0, 10) : null,
    }))
    .filter((p: { name: string }) => p.name);
}

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

/**
 * What Odoo said about a PO, in the three words the database's server-only
 * path understands: 'found', 'not_found' (a real "no such order") or
 * 'unreachable' (not configured, down, rate-limited — Odoo did not answer).
 */
async function askOdoo(ref: string) {
  if (!isConfigured()) return { answer: "unreachable", message: "Odoo integration is not configured on the server." };
  try {
    const uid = await authenticate();
    const order = await findPurchaseOrder(uid, ref);
    if (!order) return { answer: "not_found", message: `No Odoo purchase order found matching "${ref}".` };
    return { answer: "found", order, uid };
  } catch (err) {
    console.error("odoo-po-verify error:", err);
    return { answer: "unreachable", message: err instanceof Error ? err.message : "Odoo lookup failed." };
  }
}

/**
 * The actions that save a PO on an item. Each is a verdict the database makes
 * from Odoo's answer (purchase_request_item_apply_po_check); the browser never
 * names the verdict. "Correct PO" (#549) is one more entry here.
 */
const PO_ACTIONS = new Set(["order"]);

/** The database's refusal, without the function name it leads with. */
const refusalText = (message: string) => message.replace(/^[a-z_]+: /, "");

/** The signed-in caller's email, from the JWT the request carried; null if it is not a session. */
async function callerEmail(req: Request) {
  const authorization = req.headers.get("Authorization") || "";
  const token = authorization.replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  const { data, error } = await client.auth.getUser(token);
  if (error || !data?.user?.email) return null;
  return data.user.email;
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
  const { poNumber, itemId } = body;
  const ref = normalizePoNumber(poNumber);

  // Save mode (#548): an item is given, so the server checks the PO and makes
  // the move itself. Without an item this is the plain lookup below.
  if (itemId) {
    const action = String(body.action ?? "order");
    if (!PO_ACTIONS.has(action)) {
      return jsonResponse({ success: false, refused: true, message: `${action} is not a PO action.` });
    }
    if (!ref) {
      return jsonResponse({
        success: false,
        refused: true,
        message: 'Enter a valid PO Number — "P" followed by digits, e.g. P01234.',
      });
    }
    const email = await callerEmail(req);
    if (!email) {
      return jsonResponse({ success: false, refused: true, message: "Sign in to change an item." }, 401);
    }

    const odoo = await askOdoo(ref);
    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { data, error } = await admin.rpc("purchase_request_item_apply_po_check", {
      p_actor_email: email,
      p_item_id: itemId,
      p_action: action,
      p_po_number: ref,
      p_odoo: odoo.answer,
    });
    if (error) {
      return jsonResponse({ success: false, refused: true, message: refusalText(error.message) });
    }
    return jsonResponse({
      success: true,
      verdict: odoo.answer === "found" ? "verified" : "not_checked",
      item: data,
      ...(odoo.answer === "unreachable" ? { message: odoo.message } : {}),
    });
  }

  if (!isConfigured()) {
    // Not an outage — the integration was never wired up. Same shape as a
    // transport failure so the caller parks the row rather than asserting the
    // PO does not exist.
    return jsonResponse({
      success: false,
      message: "Odoo integration is not configured on the server.",
    });
  }

  if (!ref) {
    return jsonResponse({
      success: true,
      found: false,
      message: 'Enter a valid PO Number — "P" followed by digits, e.g. P01234.',
    });
  }

  try {
    const uid = await authenticate();
    const order = await findPurchaseOrder(uid, ref);

    if (!order) {
      return jsonResponse({
        success: true,
        found: false,
        message: `No Odoo purchase order found matching "${ref}".`,
      });
    }

    const products = await fetchOrderProducts(uid, order.id);

    return jsonResponse({
      success: true,
      found: true,
      order: {
        id: order.id,
        name: order.name,
        state: order.state,
        supplier: Array.isArray(order.partner_id) ? order.partner_id[1] : null,
        ordered_on: order.date_order || null,
        date_planned: order.date_planned ? String(order.date_planned).slice(0, 10) : null,
        amount_total: Number(order.amount_total) || 0,
      },
      products,
    });
  } catch (err) {
    console.error("odoo-po-verify error:", err);
    // success:false means "could not check", which the caller parks as
    // PENDING_VERIFICATION. It must never collapse into found:false.
    return jsonResponse({
      success: false,
      message: err instanceof Error ? err.message : "Odoo lookup failed.",
    });
  }
});
