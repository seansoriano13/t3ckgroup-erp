// Looks up a sale.order in Odoo by its quotation number (the "Sales
// Reference" SOR captures, e.g. S01237) and returns its order lines, so SOR
// can pre-fill the Product List instead of it being retyped by hand.
//
// Odoo credentials live only in function secrets (see ../_shared/odoo.ts) —
// the browser never talks to Odoo directly. Deploy with the default JWT
// verification ON (i.e. do NOT pass --no-verify-jwt) so only a signed-in
// employee's session can trigger a lookup; the platform gateway rejects
// unauthenticated calls before this code runs.

import {
  authenticate,
  corsHeaders,
  executeKw,
  findOrder,
  isConfigured,
  jsonResponse,
  normalizeReference,
} from "../_shared/odoo.ts";

async function fetchOrderItems(uid, orderId) {
  const lines = await executeKw(
    uid,
    "sale.order.line",
    "search_read",
    [
      [["order_id", "=", orderId]],
      ["product_id", "name", "product_uom_qty", "price_unit", "product_uom", "display_type"],
    ],
    { order: "sequence asc" },
  );

  return lines
    .filter((l) => !l.display_type) // section/note lines aren't products
    .map((l) => ({
      product_name: (l.product_id && l.product_id[1]) || l.name || "",
      unit: (l.product_uom && l.product_uom[1]) || "",
      quantity: l.product_uom_qty || 0,
      unit_price: l.price_unit || 0,
    }))
    .filter((it) => it.product_name);
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

  let salesReference;
  try {
    ({ salesReference } = await req.json());
  } catch {
    return jsonResponse({ success: false, message: "Invalid request body." });
  }

  const ref = normalizeReference(salesReference);
  if (!ref) {
    return jsonResponse({
      success: false,
      message: 'Enter a valid Sales Reference first — "S" followed by digits, e.g. S01237.',
    });
  }

  try {
    const uid = await authenticate();
    const order = await findOrder(uid, ref);

    if (!order) {
      return jsonResponse({
        success: false,
        found: false,
        message: `No Odoo quotation found matching "${ref}".`,
      });
    }

    const items = await fetchOrderItems(uid, order.id);

    if (!items.length) {
      return jsonResponse({
        success: false,
        found: true,
        message: `${order.name} was found in Odoo but has no product lines yet.`,
      });
    }

    return jsonResponse({
      success: true,
      found: true,
      order: { id: order.id, name: order.name, state: order.state },
      items,
    });
  } catch (err) {
    console.error("odoo-sor-lookup error:", err);
    return jsonResponse({
      success: false,
      message: err instanceof Error ? err.message : "Odoo lookup failed.",
    });
  }
});
