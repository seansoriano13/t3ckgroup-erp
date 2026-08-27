// Reads every Odoo purchase order whose Source Document (purchase.order.origin)
// names a sale order, plus any explicitly requested by number — the total one
// project's purchasing spawns, which today only exists by opening each PO in
// Odoo one at a time and adding the totals by hand (issue #49).
//
// Purchasing already types the sale order number into each PO's Source
// Document field, specifically because searching Analytic Distribution is
// impractical — so the link already exists in Odoo and must not be re-keyed
// into the ERP. Because that field is filled in by hand it is sometimes
// missed, which is what `additionalPoNumbers` is for: the caller passes the
// PO numbers it has on file as manual attaches (sor_purchase_order_links,
// migration 0062), and this function looks those up by number directly so
// their totals are real Odoo figures, not a placeholder.
//
// Odoo credentials live only in function secrets (see ../_shared/odoo.ts) —
// the browser never talks to Odoo directly. Deploy with the default JWT
// verification ON.
//
// Follows odoo-sor-lookup/odoo-po-verify's contract: a normal "nothing found"
// comes back as a 200 with `success: true, orders: []`, never an error. The
// caller distinguishes "Odoo says there are none" from "Odoo did not answer",
// because the first is a real answer and the second must not read as one.

import {
  authenticate,
  corsHeaders,
  executeKw,
  isConfigured,
  jsonResponse,
  normalizeReference,
} from "../_shared/odoo.ts";

const PO_NUMBER_PATTERN = /^P\d+$/;

function normalizePoNumber(value: unknown) {
  const ref = String(value ?? "").trim().toUpperCase();
  return PO_NUMBER_PATTERN.test(ref) ? ref : null;
}

const FIELDS = [
  "id",
  "name",
  "state",
  "partner_id",
  "date_order",
  "amount_untaxed",
  "amount_total",
];

function shapeOrder(order: Record<string, unknown>, matchedBy: "origin" | "number") {
  return {
    id: order.id,
    name: order.name,
    state: order.state,
    supplier: Array.isArray(order.partner_id) ? order.partner_id[1] : null,
    ordered_on: order.date_order || null,
    // Tax-exclusive on both sides (issue #49) — amount_total is VAT-inclusive
    // in Odoo, and mixing it with untaxed sale-order figures misstates every
    // margin, the same reasoning the SOR rollup already applies elsewhere.
    amount_untaxed: Number(order.amount_untaxed) || 0,
    amount_total: Number(order.amount_total) || 0,
    matched_by: matchedBy,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (!isConfigured()) {
    return jsonResponse({
      success: false,
      message: "Odoo integration is not configured on the server.",
    });
  }

  let saleOrderRef: unknown;
  let additionalPoNumbers: unknown;
  try {
    ({ saleOrderRef, additionalPoNumbers } = await req.json());
  } catch {
    return jsonResponse({ success: false, message: "Invalid request body." });
  }

  const ref = normalizeReference(String(saleOrderRef ?? ""));
  if (!ref) {
    return jsonResponse({
      success: true,
      orders: [],
      message: "Not a valid Sales Reference — nothing to roll up yet.",
    });
  }

  const extraNumbers = Array.from(
    new Set(
      (Array.isArray(additionalPoNumbers) ? additionalPoNumbers : [])
        .map(normalizePoNumber)
        .filter((n): n is string => Boolean(n)),
    ),
  );

  try {
    const uid = await authenticate();

    const byOrigin = await executeKw(
      uid,
      "purchase.order",
      "search_read",
      [[["origin", "=", ref]], FIELDS],
      { order: "date_order asc" },
    );

    let byNumber: Record<string, unknown>[] = [];
    if (extraNumbers.length) {
      byNumber = await executeKw(
        uid,
        "purchase.order",
        "search_read",
        [[["name", "in", extraNumbers]], FIELDS],
      );
    }

    const originIds = new Set(byOrigin.map((o: Record<string, unknown>) => o.id));
    const seen = new Set<unknown>();
    const orders = [];
    for (const order of [...byOrigin, ...byNumber]) {
      if (seen.has(order.id)) continue;
      seen.add(order.id);
      orders.push(shapeOrder(order, originIds.has(order.id) ? "origin" : "number"));
    }

    return jsonResponse({ success: true, orders });
  } catch (err) {
    console.error("odoo-po-rollup error:", err);
    // success:false means "could not check" — it must never collapse into an
    // empty result, or a purchaser reads an outage as "nothing was spent."
    return jsonResponse({
      success: false,
      message: err instanceof Error ? err.message : "Odoo lookup failed.",
    });
  }
});
