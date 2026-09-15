// Re-reads Odoo free/on-hand/forecast stock for a set of products already on
// an SOR's Product List, without touching the lines themselves. Powers the
// "Refresh" control next to "Stock as of …" (issue #202) — a stock check must
// never re-sync the Product List, only odoo-sor-lookup does that.
//
// Odoo credentials live only in function secrets (see ../_shared/odoo.ts) —
// the browser never talks to Odoo directly. Deploy with the default JWT
// verification ON (i.e. do NOT pass --no-verify-jwt) so only a signed-in
// employee's session can trigger a lookup.
//
// Follows odoo-sor-lookup's contract: success:false means "could not check",
// not "nothing in stock" — a refresh failure must keep the caller's last
// figures rather than being read as a real zero.

import {
  authenticate,
  corsHeaders,
  fetchProductStock,
  isConfigured,
  jsonResponse,
} from "../_shared/odoo.ts";

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

  let productIds: unknown;
  try {
    ({ productIds } = await req.json());
  } catch {
    return jsonResponse({ success: false, message: "Invalid request body." });
  }

  const ids = Array.isArray(productIds)
    ? productIds.filter((id) => Number.isInteger(id))
    : [];
  if (!ids.length) {
    return jsonResponse({
      success: false,
      message: "No Odoo-linked products on this Product List to check.",
    });
  }

  try {
    const uid = await authenticate();
    const stock = await fetchProductStock(uid, ids);
    return jsonResponse({ success: true, stock });
  } catch (err) {
    console.error("odoo-product-stock error:", err);
    return jsonResponse({
      success: false,
      message: err instanceof Error ? err.message : "Odoo stock refresh failed.",
    });
  }
});
