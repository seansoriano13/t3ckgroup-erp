// Suggests Odoo suppliers by name for the Canvass Offer's supplier field (#277), so a known
// supplier is named the same way every time and its Odoo id is recorded beside the name.
//
// Read-only: one search_read over res.partner, nothing is ever created or changed in Odoo. A
// supplier that is not in Odoo yet is simply typed in the app.
//
// Odoo credentials live only in function secrets (see ../_shared/odoo.ts). Deploy with the default
// JWT verification ON (do NOT pass --no-verify-jwt), so only a signed-in employee's session can
// search; supabase/config.toml registers it without `verify_jwt = false`.
//
// Same contract as odoo-po-verify: no match is a 200 `{ success: true, suppliers: [] }`; a transport
// or configuration failure is `{ success: false }`, which the caller reads as "no suggestions".

import {
  authenticate,
  corsHeaders,
  executeKw,
  isConfigured,
  jsonResponse,
} from "../_shared/odoo.ts";

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
    return jsonResponse({ success: true, suppliers: [] });
  }

  try {
    const uid = await authenticate();
    const rows = await executeKw(
      uid,
      "res.partner",
      "search_read",
      [
        [
          ["name", "ilike", name],
          ["is_company", "=", true],
          ["supplier_rank", ">", 0],
        ],
        ["id", "name"],
      ],
      { limit: RESULT_LIMIT, order: "name asc" },
    );

    return jsonResponse({
      success: true,
      suppliers: rows
        .slice(0, RESULT_LIMIT)
        .map((r: { id: number; name: string }) => ({ id: r.id, name: r.name })),
    });
  } catch (err) {
    console.error("odoo-supplier-search error:", err);
    return jsonResponse({
      success: false,
      message: err instanceof Error ? err.message : "Odoo supplier search failed.",
    });
  }
});
