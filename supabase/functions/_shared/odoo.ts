// Shared Odoo JSON-RPC plumbing for the edge functions that talk to
// t3ckgrouponline.odoo.com. Credentials live only in function secrets — the
// browser never talks to Odoo directly.
//
// Required secrets (see `supabase secrets set`):
//   ODOO_URL       e.g. https://t3ckgrouponline.odoo.com
//   ODOO_DB        the Odoo database name
//   ODOO_USERNAME  login of a service/integration user
//   ODOO_API_KEY   API key for that user (Settings > Users > Account Security)
//
// Note: the API key authenticates RPC only. Odoo gates /web/session/authenticate
// to passwords (`interactive: true`), so there is no way to reach the
// `auth='user'` report routes with this key — see the portal access_token route
// used by odoo-quotation-link instead.

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

export const ODOO_URL = Deno.env.get("ODOO_URL");
export const ODOO_DB = Deno.env.get("ODOO_DB");
export const ODOO_USERNAME = Deno.env.get("ODOO_USERNAME");
export const ODOO_API_KEY = Deno.env.get("ODOO_API_KEY");

export const SALES_REFERENCE_PATTERN = /^S\d+$/;

export function isConfigured() {
  return !!(ODOO_URL && ODOO_DB && ODOO_USERNAME && ODOO_API_KEY);
}

export function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

export async function odooCall(service, method, args) {
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

export async function authenticate() {
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

export function executeKw(uid, model, method, args, kwargs = {}) {
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

/**
 * Finds a quotation by its number (the "Sales Reference" SOR captures). Falls
 * back to a fuzzy match, since references are sometimes typed without their
 * leading zeroes.
 */
export async function findOrder(
  uid,
  ref,
  fields = ["id", "name", "state", "partner_id"],
) {
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

export const ORDER_TOKEN_FIELDS = ["id", "name", "state", "access_token"];

/**
 * Returns the order's portal token, minting one when Odoo hasn't yet.
 * `access_token` is generated lazily — it stays empty until someone clicks
 * Share — and `_portal_ensure_token()` is private, so unreachable over RPC.
 *
 * Reads the value back rather than trusting the write: if `access_token` ever
 * became read-only, a silent no-op would hand out links that 403 for the
 * customer.
 */
export async function ensureAccessToken(uid, order) {
  if (order.access_token) return order.access_token;

  const token = crypto.randomUUID();
  await executeKw(uid, "sale.order", "write", [
    [order.id],
    { access_token: token },
  ]);

  const [confirmed] = await executeKw(
    uid,
    "sale.order",
    "read",
    [[order.id], ["access_token"]],
  );
  return confirmed?.access_token || null;
}

export const NO_TOKEN_MESSAGE =
  "has no share token and Odoo would not accept a new one. " +
  "Open the quotation in Odoo and click Share once, then try again.";

/**
 * Splits an order's customer into the two fields SOR keeps apart.
 *
 * `sale.order` carries only `partner_id`, which may be either an organisation
 * or a contact record beneath one — `commercial_partner_id` is a field on
 * `res.partner`, NOT on the order, so the company has to be reached by
 * reading the partner. Keeping the two apart is the whole point of this
 * lookup: it is what stops the Company and the Contact Person being mixed up.
 *
 * The contact's name comes from `res.partner.name` rather than from the
 * `partner_id` pair, because that pair carries Odoo's *display* name, which
 * for a child contact is prefixed with its parent ("Makati City Government,
 * Erika Duenas"). Writing that into Contact Person would reintroduce the very
 * company-inside-the-contact-field shape being corrected.
 *
 * When the partner IS its own commercial partner the order has no named
 * contact, so `contact` comes back empty rather than repeating the company.
 */
export async function fetchCustomer(uid, order) {
  const partner = order?.partner_id || null;
  const empty = { company: "", company_id: null, contact: "" };
  if (!partner) return empty;

  const [record] = await executeKw(uid, "res.partner", "read", [
    [partner[0]],
    ["name", "commercial_partner_id"],
  ]);
  if (!record) return empty;

  const commercial = record.commercial_partner_id || null;
  const isOwnCompany = !commercial || commercial[0] === partner[0];

  if (isOwnCompany) {
    return { company: record.name || "", company_id: partner[0], contact: "" };
  }

  // The commercial partner is a company, so it has no parent to prefix its
  // display name — but read `name` anyway rather than trusting the pair's
  // second element, which is a display name by definition.
  const [company] = await executeKw(uid, "res.partner", "read", [
    [commercial[0]],
    ["name"],
  ]);

  return {
    company: company?.name || commercial[1] || "",
    company_id: commercial[0],
    contact: record.name || "",
  };
}

/**
 * Normalises and validates a Sales Reference, returning `null` when it isn't
 * one. Callers should reject before spending an Odoo round trip.
 */
export function normalizeReference(salesReference) {
  const ref = (salesReference || "").trim().toUpperCase();
  return SALES_REFERENCE_PATTERN.test(ref) ? ref : null;
}

/**
 * Reads free/on-hand/forecast stock for a set of products, both totalled
 * across every warehouse and broken down per warehouse (issue #202).
 *
 * `product.product` already returns `free_qty`/`qty_available`/
 * `virtual_available` scoped to whatever `warehouse` sits in the read
 * context, so the per-warehouse breakdown is the same `read` call repeated
 * once per warehouse rather than a separate `stock.quant` query. Warehouses
 * are few (single digits for this instance), so the call count stays small.
 *
 * Returns `{ warehouses, products }` shaped to drop straight into
 * `sor_stock_snapshots.data` — see that migration's header comment.
 */
export async function fetchProductStock(uid, productIds) {
  const ids = (productIds || []).filter((id) => Number.isInteger(id));
  if (!ids.length) return { warehouses: [], products: {} };

  const fields = ["type", "free_qty", "qty_available", "virtual_available"];

  const [warehouses, totals] = await Promise.all([
    executeKw(uid, "stock.warehouse", "search_read", [[], ["id", "name"]]),
    executeKw(uid, "product.product", "read", [ids, fields]),
  ]);

  const products = {};
  for (const p of totals) {
    products[p.id] = {
      type: p.type || "product",
      free: Number(p.free_qty) || 0,
      onHand: Number(p.qty_available) || 0,
      forecast: Number(p.virtual_available) || 0,
      byWarehouse: {},
    };
  }

  const perWarehouse = await Promise.all(
    warehouses.map((w) =>
      executeKw(uid, "product.product", "read", [ids, fields], {
        context: { warehouse: w.id },
      }),
    ),
  );

  perWarehouse.forEach((rows, i) => {
    const warehouseId = warehouses[i].id;
    for (const p of rows) {
      if (!products[p.id]) continue;
      products[p.id].byWarehouse[warehouseId] = {
        free: Number(p.free_qty) || 0,
        onHand: Number(p.qty_available) || 0,
        forecast: Number(p.virtual_available) || 0,
      };
    }
  });

  return {
    warehouses: warehouses.map((w) => ({ id: w.id, name: w.name })),
    products,
  };
}
