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
  fetchCustomer,
  fetchProductStock,
  findOrder,
  isConfigured,
  isLocalStack,
  jsonResponse,
  normalizeReference,
} from "../_shared/odoo.ts";
import { fetchOrderItems, localSampleLookup } from "../_shared/odooS0Lines.ts";

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
