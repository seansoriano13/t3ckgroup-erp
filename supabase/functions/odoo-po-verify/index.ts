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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
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

  let poNumber: unknown;
  try {
    ({ poNumber } = await req.json());
  } catch {
    return jsonResponse({ success: false, message: "Invalid request body." });
  }

  const ref = normalizePoNumber(poNumber);
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
