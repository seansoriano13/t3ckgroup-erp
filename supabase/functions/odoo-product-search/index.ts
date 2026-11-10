// Suggests Odoo products by name for "Replace a product" (#687), so Purchasing can pick product B
// from Odoo's product list and the app records its Odoo id beside the name.
//
// Read-only: one search_read over product.product, nothing is ever created or changed in Odoo. A
// product that is not in Odoo is simply typed in the app.
//
// Odoo credentials live only in function secrets (see ../_shared/odoo.ts). Deploy with the default
// JWT verification ON (do NOT pass --no-verify-jwt); supabase/config.toml registers it without
// `verify_jwt = false`.
//
// Same contract as odoo-supplier-search: no match is a 200 `{ success: true, products: [] }`; a
// transport or configuration failure is `{ success: false }`, which the caller reads as "no suggestions".

import {
  authenticate,
  corsHeaders,
  executeKw,
  isConfigured,
  jsonResponse,
} from "../_shared/odoo.ts";
import { containsPattern } from "../_shared/ilikePattern.ts";

const MIN_QUERY_LENGTH = 2;
const MAX_QUERY_LENGTH = 80;
const RESULT_LIMIT = 10;

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

  let query: unknown;
  try {
    ({ query } = await req.json());
  } catch {
    return jsonResponse({ success: false, message: "Invalid request body." });
  }

  const name = String(query ?? "").trim().slice(0, MAX_QUERY_LENGTH);
  if (name.length < MIN_QUERY_LENGTH) {
    return jsonResponse({ success: true, products: [] });
  }

  try {
    const uid = await authenticate();
    const rows = await executeKw(
      uid,
      "product.product",
      "search_read",
      [
        [
          // `=ilike` with an escaped pattern, so a % or _ the person typed matches itself.
          ["name", "=ilike", containsPattern(name)],
        ],
        ["id", "name", "default_code"],
      ],
      { limit: RESULT_LIMIT, order: "name asc" },
    );

    return jsonResponse({
      success: true,
      products: rows
        .slice(0, RESULT_LIMIT)
        .map((r: { id: number; name: string; default_code: string | false }) => ({
          id: r.id,
          name: r.name,
          code: r.default_code || null,
        })),
    });
  } catch (err) {
    console.error("odoo-product-search error:", err);
    return jsonResponse({
      success: false,
      message: err instanceof Error ? err.message : "Odoo product search failed.",
    });
  }
});
