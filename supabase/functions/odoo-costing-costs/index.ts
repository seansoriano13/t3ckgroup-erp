// Fills a Costing Matrix from Odoo (Costing Desk). For every Component of the
// SOR's matrix that has an Odoo product it reads the product in Odoo: its Sales
// Price (`list_price`, the Odoo SRP, #961) is written as the Odoo figure every
// time, and its cost (`standard_price`) into a blank Acquire. A cost someone typed or a Canvass filled is
// never overwritten, and nothing the browser sends becomes a cost: the
// database is handed only what this function read from Odoo itself.
//
// Odoo credentials live only in function secrets (see ../_shared/odoo.ts).
// Deploy with JWT verification ON, so only a signed-in employee's session can
// call it; the database checks they are Sales or Purchasing on that SOR.
//
// success:false means "could not check", never "no cost": the screen says the
// costs could not be read and leaves them for typing.

import { authenticate, corsHeaders, executeKw, isConfigured, jsonResponse } from "../_shared/odoo.ts";
import { callerEmail } from "../_shared/caller.ts";

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.8";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (!isConfigured()) {
    return jsonResponse({ success: false, message: "Odoo integration is not configured on the server." });
  }

  let opportunityId: unknown;
  try {
    ({ opportunityId } = await req.json());
  } catch {
    return jsonResponse({ success: false, message: "Invalid request body." });
  }
  if (typeof opportunityId !== "string" || !opportunityId) {
    return jsonResponse({ success: false, message: "Which SOR's matrix?" });
  }

  const email = await callerEmail(req);
  if (!email) return jsonResponse({ success: false, message: "Not signed in." }, 401);

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const { data: employee } = await admin.from("employees").select("id").eq("email", email).maybeSingle();
  if (!employee?.id) return jsonResponse({ success: false, message: "Not signed in." }, 401);

  const { data: targets, error: targetError } = await admin.rpc("costing_odoo_cost_targets", {
    p_actor: employee.id,
    p_opportunity_id: opportunityId,
  });
  if (targetError) {
    return jsonResponse({ success: false, refused: true, code: targetError.code, message: targetError.message });
  }
  const productIds = [...new Set((targets || []).map((t: { odoo_product_id: number }) => t.odoo_product_id))].filter((id) =>
    Number.isInteger(id),
  );
  if (!productIds.length) return jsonResponse({ success: true, filled: 0, unpriced: 0 });

  try {
    const uid = await authenticate();
    const products = await executeKw(uid, "product.product", "read", [productIds, ["standard_price", "list_price"]]);
    const costs: Record<string, number> = {};
    const srps: Record<string, number> = {};
    for (const p of products || []) {
      const price = Number(p.standard_price);
      if (Number.isFinite(price) && price > 0) costs[String(p.id)] = price;
      const srp = Number(p.list_price);
      if (Number.isFinite(srp) && srp > 0) srps[String(p.id)] = srp;
    }
    const { data: filled, error } = await admin.rpc("costing_fill_odoo_costs", {
      p_actor: employee.id,
      p_opportunity_id: opportunityId,
      p_costs: costs,
      p_srps: srps,
    });
    if (error) return jsonResponse({ success: false, refused: true, code: error.code, message: error.message });
    return jsonResponse({ success: true, filled: filled ?? 0, unpriced: productIds.filter((id) => !(String(id) in costs) && !(String(id) in srps)).length });
  } catch (err) {
    console.error("odoo-costing-costs error:", err);
    return jsonResponse({ success: false, message: err instanceof Error ? err.message : "Odoo cost lookup failed." });
  }
});
