// Looks up a sale.order in Odoo by its quotation number (the "Sales
// Reference" SOR captures, e.g. S01237) and returns its order lines, so SOR
// can pre-fill the Product List instead of it being retyped by hand.
//
// Odoo credentials live only here, as function secrets — the browser never
// talks to Odoo directly. Deploy with the default JWT verification ON
// (i.e. do NOT pass --no-verify-jwt) so only a signed-in employee's session
// can trigger a lookup; the platform gateway rejects unauthenticated calls
// before this code runs.
//
// Required secrets (see `supabase secrets set`):
//   ODOO_URL       e.g. https://t3ckgrouponline.odoo.com
//   ODOO_DB        the Odoo database name
//   ODOO_USERNAME  login of a service/integration user
//   ODOO_API_KEY   API key for that user (Settings > Users > Account Security)

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const ODOO_URL = Deno.env.get("ODOO_URL");
const ODOO_DB = Deno.env.get("ODOO_DB");
const ODOO_USERNAME = Deno.env.get("ODOO_USERNAME");
const ODOO_API_KEY = Deno.env.get("ODOO_API_KEY");

const SALES_REFERENCE_PATTERN = /^S\d+$/;

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function odooCall(service, method, args) {
  const res = await fetch(`${ODOO_URL}/jsonrpc`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      method: "call",
      params: { service, method, args },
      id: Date.now(),
    }),
  });
  const json = await res.json();
  if (json.error) {
    const message =
      json.error.data?.message || json.error.message || "Odoo API error.";
    throw new Error(message);
  }
  return json.result;
}

async function authenticate() {
  const uid = await odooCall("common", "authenticate", [
    ODOO_DB,
    ODOO_USERNAME,
    ODOO_API_KEY,
    {},
  ]);
  if (!uid) {
    throw new Error(
      "Odoo authentication failed — check ODOO_USERNAME/ODOO_API_KEY.",
    );
  }
  return uid;
}

function executeKw(uid, model, method, args, kwargs = {}) {
  return odooCall("object", "execute_kw", [
    ODOO_DB,
    uid,
    ODOO_API_KEY,
    model,
    method,
    args,
    kwargs,
  ]);
}

async function findOrder(uid, ref) {
  const fields = ["id", "name", "state"];
  const exact = await executeKw(
    uid,
    "sale.order",
    "search_read",
    [[["name", "=", ref]], fields],
    { limit: 1 },
  );
  if (exact.length) return exact[0];

  const fuzzy = await executeKw(
    uid,
    "sale.order",
    "search_read",
    [[["name", "ilike", ref]], fields],
    { limit: 1 },
  );
  return fuzzy[0] || null;
}

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

  if (!ODOO_URL || !ODOO_DB || !ODOO_USERNAME || !ODOO_API_KEY) {
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

  const ref = (salesReference || "").trim().toUpperCase();
  if (!SALES_REFERENCE_PATTERN.test(ref)) {
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
