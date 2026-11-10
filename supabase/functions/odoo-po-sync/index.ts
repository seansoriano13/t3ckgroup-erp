// Reads the P0s attached to a Purchase Request's lines from Odoo and sets each line's
// stored status and delivery figures from them (#685). Odoo is the truth for P0 facts;
// the app reads them (ADR 0044).
//
// Body: { requestId }
// Reply: { success: true, changed: <lines whose status changed> }, or
//        { success: false, message } when Odoo did not answer. In that case nothing is
//        written, so every line keeps its last stored values.
//
// The caller must be a member of the request; the database checks that. The browser
// never sends a P0 fact. Deploy with the default JWT verification ON.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.8";
import { callerEmail } from "../_shared/caller.ts";
import { readP0s } from "../_shared/odooP0.ts";
import { p0Facts, p0UnitPrice } from "../_shared/p0Suggestions.ts";
import { authenticate, corsHeaders, isConfigured, jsonResponse } from "../_shared/odoo.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ success: false, message: "Invalid request body." });
  }
  const requestId = String(body.requestId ?? "");
  if (!requestId) return jsonResponse({ success: false, message: "No request given." });

  const email = await callerEmail(req);
  if (!email) return jsonResponse({ success: false, message: "Sign in to refresh from Odoo." }, 401);
  if (!isConfigured()) return jsonResponse({ success: false, message: "Odoo integration is not configured on the server." });

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const { data: items, error: itemsError } = await admin
    .from("purchase_request_items")
    .select("id, po_number, odoo_product_id, odoo_po_line_ids, component_id, status, quantity")
    .eq("request_id", requestId)
    .not("po_number", "is", null)
    .neq("status", "cancelled");
  if (itemsError) return jsonResponse({ success: false, message: itemsError.message });
  if (!items?.length) return jsonResponse({ success: true, changed: 0 });

  try {
    const uid = await authenticate();
    const numbers = [...new Set(items.map((i) => String(i.po_number)))];
    const p0s = await readP0s(uid, [["name", "in", numbers]], numbers.length + 20);
    const byName = new Map(p0s.map((p0) => [p0.name.toUpperCase(), p0]));

    const facts = items.flatMap((item) => {
      const p0 = byName.get(String(item.po_number).toUpperCase());
      const f = p0 && p0Facts(p0, item.odoo_product_id ?? null, item.odoo_po_line_ids ?? [], item.quantity);
      return f ? [{ item_id: item.id, ...f }] : [];
    });
    if (!facts.length) return jsonResponse({ success: true, changed: 0 });

    const { data, error } = await admin.rpc("purchase_request_sync_po_facts", {
      p_actor_email: email,
      p_request_id: requestId,
      p_facts: facts,
    });
    if (error) return jsonResponse({ success: false, message: error.message.replace(/^[a-z_]+: /, "") });
    await syncActualCosts(admin, email, items, byName);
    return jsonResponse({ success: true, changed: data ?? 0 });
  } catch (err) {
    console.error("odoo-po-sync error:", err);
    // Odoo did not answer: nothing was written, the lines keep their last values.
    return jsonResponse({ success: false, message: err instanceof Error ? err.message : "Odoo lookup failed." });
  }
});

type SyncedItem = { id: string; po_number: string; odoo_product_id: number | null; odoo_po_line_ids: number[] | null; component_id: string | null };

// The Actual cost follows the P0 too, so a line picked after the attach (P0s that list a
// product on several lines) gets the price of its own lines. Only Purchasing may set it; for
// anyone else it keeps its last value until Purchasing opens the request. A miss is logged:
// the statuses already stand.
async function syncActualCosts(
  admin: ReturnType<typeof createClient>,
  email: string,
  items: SyncedItem[],
  byName: Map<string, Parameters<typeof p0UnitPrice>[0]>,
) {
  const linked = items.filter((i) => i.component_id);
  if (!linked.length) return;
  const { data: costs } = await admin
    .from("costing_component_costs")
    .select("component_id, p0_quoted_unit_price, p0_currency")
    .in("component_id", linked.map((i) => i.component_id));
  const stored = new Map(
    (costs ?? []).map((c) => [
      c.component_id,
      { price: c.p0_quoted_unit_price == null ? null : Number(c.p0_quoted_unit_price), currency: c.p0_currency ?? null },
    ]),
  );
  for (const item of linked) {
    const p0 = byName.get(String(item.po_number).toUpperCase());
    const was = stored.get(item.component_id);
    if (!p0 || !was) continue;
    const actual = p0UnitPrice(p0, item.odoo_product_id ?? null, item.odoo_po_line_ids ?? []);
    if (actual.price === was.price && actual.currency === was.currency) continue;
    const { error } = await admin.rpc("costing_set_p0_price", {
      p_actor_email: email,
      p_item_id: item.id,
      p_price: actual.price,
      p_currency: actual.currency,
    });
    if (error?.code === "42501") return; // not Purchasing on this request
    if (error) console.error("odoo-po-sync actual cost error:", error.message);
  }
}
