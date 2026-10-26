// Looks up a sale.order in Odoo by its quotation number (the "Sales
// Reference" SOR captures, e.g. S01237) and returns its order lines and its
// customer, so SOR can pre-fill the Product List and the Company instead of
// either being retyped by hand.
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
  fetchCustomer,
  fetchProductStock,
  findOrder,
  isConfigured,
  isLocalStack,
  jsonResponse,
  normalizeReference,
} from "../_shared/odoo.ts";

// Local stack only, when Odoo is not configured: a made-up quotation so the
// Sales Reference fetch can be tried without live Odoo. Never reached in
// production or staging, which always have Odoo configured.
function localSampleLookup(ref) {
  return {
    success: true,
    found: true,
    order: { id: 0, name: ref, state: "sale" },
    customer: { company: "Local Sample Customer", company_id: null, contact: "" },
    items: [
      { odoo_line_id: 900001, odoo_product_id: null, product_name: "Sample Product A", description: "Local sample line", unit: "Unit", quantity: 2, unit_price: 1500 },
      { odoo_line_id: 900002, odoo_product_id: null, product_name: "Sample Product B", description: "Local sample line", unit: "Unit", quantity: 1, unit_price: 4200 },
    ],
    stock: null,
    message: "Local sample data: Odoo is not configured on this machine.",
  };
}

async function fetchOrderItems(uid, orderId) {
  const lines = await executeKw(
    uid,
    "sale.order.line",
    "search_read",
    [
      [["order_id", "=", orderId]],
      ["id", "product_id", "name", "product_uom_qty", "price_unit", "product_uom", "display_type"],
    ],
    { order: "sequence asc" },
  );

  return lines
    .filter((l) => !l.display_type) // section/note lines aren't products
    .map((l) => ({
      // The S0 line's own id (#677): the app keeps it so a line stays the same
      // line across reads, however its product, name or quantity change.
      odoo_line_id: Number.isInteger(l.id) ? l.id : null,
      // product_id comes back as [id, display_name]; issue #202 needs the id
      // kept so stock can be looked up without re-reading the quotation.
      odoo_product_id: (l.product_id && l.product_id[0]) || null,
      product_name: (l.product_id && l.product_id[1]) || l.name || "",
      // Issue #44: a bundled order's Inclusions live as free text in the
      // line's own description, not in the product name — kept as its own
      // field rather than folded into product_name so the existing Product
      // List mapping (and everything downstream of it) is untouched.
      description: l.name || "",
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

  if (!isConfigured() && !isLocalStack()) {
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

  if (!isConfigured()) return jsonResponse(localSampleLookup(ref));

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

    const [items, customer] = await Promise.all([
      fetchOrderItems(uid, order.id),
      fetchCustomer(uid, order),
    ]);

    // Stock rides along with every fetch (issue #202) so the Product List and
    // its availability badges are always as fresh as each other. A stock
    // read failure must not fail the whole lookup — the lines and customer
    // are still good — so it's swallowed here and comes back as null (never an
    // empty snapshot, which would overwrite good figures); the caller keeps
    // whatever snapshot it already had.
    const productIds = items
      .map((it) => it.odoo_product_id)
      .filter((id) => Number.isInteger(id));
    let stock = null;
    try {
      stock = await fetchProductStock(uid, productIds);
    } catch (err) {
      console.error("odoo-sor-lookup stock read error:", err);
    }

    // A quotation with no product lines is still a found quotation with a real
    // customer on it. Verifying the Company and pulling the Product List are
    // two jobs sharing one request, so an empty list reports itself in the
    // message rather than failing the whole lookup and discarding the Company.
    return jsonResponse({
      success: true,
      found: true,
      order: { id: order.id, name: order.name, state: order.state },
      customer,
      items,
      stock,
      message: items.length
        ? undefined
        : `${order.name} was found in Odoo but has no product lines yet.`,
    });
  } catch (err) {
    console.error("odoo-sor-lookup error:", err);
    return jsonResponse({
      success: false,
      message: err instanceof Error ? err.message : "Odoo lookup failed.",
    });
  }
});
