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
export async function findOrder(uid, ref, fields = ["id", "name", "state"]) {
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
 * Normalises and validates a Sales Reference, returning `null` when it isn't
 * one. Callers should reject before spending an Odoo round trip.
 */
export function normalizeReference(salesReference) {
  const ref = (salesReference || "").trim().toUpperCase();
  return SALES_REFERENCE_PATTERN.test(ref) ? ref : null;
}
