// Resolves a Sales Reference (e.g. S04718) to the Odoo customer portal link
// for that quotation:
//
//   https://<odoo>/my/orders/<id>?access_token=<token>
//
// That page is `auth='public'` — the token is the whole credential, so anyone
// holding the URL sees the quotation. It renders LIVE from Odoo: editing the
// order changes what an already-sent recipient sees, and an expired quotation
// shows Odoo's "offer expired" banner. Both are accepted trade-offs.
//
// `access_token` is generated lazily by Odoo — it stays empty until someone
// clicks Share in the UI. `_portal_ensure_token()` is private and therefore
// unreachable over RPC, so when it is empty we write a uuid4 ourselves and
// read it back to confirm Odoo kept it.
//
// Deploy with the default JWT verification ON so only a signed-in employee can
// mint a customer link.

import {
  authenticate,
  corsHeaders,
  ensureAccessToken,
  findOrder,
  isConfigured,
  jsonResponse,
  NO_TOKEN_MESSAGE,
  normalizeReference,
  ODOO_URL,
  ORDER_TOKEN_FIELDS,
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
    const order = await findOrder(uid, ref, ORDER_TOKEN_FIELDS);

    if (!order) {
      return jsonResponse({
        success: false,
        found: false,
        message: `No Odoo quotation found matching "${ref}".`,
      });
    }

    const token = await ensureAccessToken(uid, order);
    if (!token) {
      return jsonResponse({
        success: false,
        found: true,
        message: `${order.name} ${NO_TOKEN_MESSAGE}`,
      });
    }

    const base = (ODOO_URL || "").replace(/\/+$/, "");

    return jsonResponse({
      success: true,
      found: true,
      order: { id: order.id, name: order.name, state: order.state },
      url: `${base}/my/orders/${order.id}?access_token=${token}`,
    });
  } catch (err) {
    console.error("odoo-quotation-link error:", err);
    return jsonResponse({
      success: false,
      message: err instanceof Error ? err.message : "Could not build the quotation link.",
    });
  }
});
