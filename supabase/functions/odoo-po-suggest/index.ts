// The P0s Purchasing can attach to a product line (#684): P0s made by hand in
// Odoo whose Source Document names the S0 (or, for a Direct request, its PR
// number). The app never writes to Odoo; this only reads.
//
// Body: { reference: "S01237" | "PR_0042", productId: number | null }
// Reply: { success: true, suggested: [...], others: [...] }. A normal "none
// found" is a 200 with empty lists; success:false means Odoo did not answer.
//
// Deploy with the default JWT verification ON.

import { authenticate, corsHeaders, isConfigured, jsonResponse } from "../_shared/odoo.ts";
import { readP0s } from "../_shared/odooP0.ts";
import { rankP0Suggestions, referencesIn } from "../_shared/p0Suggestions.ts";

const shape = (p0: Awaited<ReturnType<typeof readP0s>>[number]) => ({
  id: p0.id,
  name: p0.name,
  state: p0.state,
  supplier: p0.supplier,
  ordered_on: p0.date_order,
  source: p0.origin,
  lines: p0.lines,
});

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ success: false, message: "Invalid request body." });
  }
  const [reference] = referencesIn(String(body.reference ?? ""));
  const productId = Number.isInteger(body.productId) ? (body.productId as number) : null;
  if (!reference) {
    return jsonResponse({ success: true, suggested: [], others: [], message: "No S0 or PR number to search for." });
  }
  if (!isConfigured()) {
    return jsonResponse({ success: false, message: "Odoo integration is not configured on the server." });
  }

  try {
    const uid = await authenticate();
    // `ilike` finds the text anywhere in the Source Document, several S0s included;
    // the ranking then keeps only P0s that name this reference exactly.
    const p0s = await readP0s(uid, [["origin", "ilike", reference]]);
    const { suggested, others } = rankP0Suggestions({ reference, productId, p0s });
    return jsonResponse({ success: true, suggested: suggested.map(shape), others: others.map(shape) });
  } catch (err) {
    console.error("odoo-po-suggest error:", err);
    return jsonResponse({ success: false, message: err instanceof Error ? err.message : "Odoo lookup failed." });
  }
});
