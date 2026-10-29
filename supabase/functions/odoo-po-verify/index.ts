// Confirms an Odoo purchase order exists and reports what it bought, so the PO
// number purchasing types against a procurement request is a verified fact
// rather than free text.
//
// Fires once per resolved request item — tens of invocations a month, not one
// per page view.
//
// Odoo credentials live only in function secrets (see ../_shared/odoo.ts) — the
// browser never talks to Odoo directly. Deploy with the default JWT
// verification ON (i.e. do NOT pass --no-verify-jwt) so only a signed-in
// employee's session can trigger a lookup.
//
// Follows odoo-sor-lookup's contract: a normal miss (bad format, no such order)
// comes back as a 200 with `found: false`, never an error. The caller
// distinguishes "Odoo says no" from "Odoo did not answer", because the first is
// a real answer and the second must not read as one.
//
// Two modes (#548):
//   - lookup (no `itemId`): the plain check above.
//   - save (`itemId`, `poNumber`, optional `action`, default "attach"): asks Odoo,
//     then calls the database as the signed-in caller. The browser never sends
//     a verdict or a P0 fact.
//       attach (#684): reads the P0 as it stands in Odoo and calls
//         purchase_request_item_attach_po (#724: with `orderEarly` and `orderEarlyReason` from
//         the body when buying has not opened yet), which sets the line from it (an RFQ
//         stays To purchase; a confirmed P0 is Purchased, or Received once
//         everything arrived). Odoo must answer; a P0 is never attached unseen.
//         #730: it then raises the P0's IPAS, or adds the line's SOR to the live one, and answers `ipas`.
//       ipas (#730): retries that step for a line whose Odoo did not answer ("IPAS to create").
//       correct (#549): purchase_request_item_apply_po_check swaps the P0 on a
//         Purchased line (verified / refused naming the PO / saved as not checked).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.8";
import { callerEmail } from "../_shared/caller.ts";
import { readPo } from "../_shared/odooIpasCopy.ts";
import { readP0s } from "../_shared/odooP0.ts";
import { p0Facts, p0UnitPrice } from "../_shared/p0Suggestions.ts";
import {
  authenticate,
  corsHeaders,
  executeKw,
  findPurchaseOrder,
  isConfigured,
  jsonResponse,
  normalizePoNumber,
} from "../_shared/odoo.ts";

// A typed number is confirmed with a fuzzy fallback (references get typed
// without their leading zeroes), and only the fields this function reports.
const ORDER_FIELDS = [
  "id",
  "name",
  "state",
  "partner_id",
  "date_order",
  "date_planned",
  "amount_total",
];
const findOrderByNumber = (uid: number, ref: string) =>
  findPurchaseOrder(uid, ref, ORDER_FIELDS, { fuzzy: true });

async function fetchOrderProducts(uid: number, orderId: number) {
  const lines = await executeKw(
    uid,
    "purchase.order.line",
    "search_read",
    [
      [["order_id", "=", orderId]],
      ["product_id", "name", "product_qty", "product_uom", "price_unit", "date_planned"],
    ],
    { order: "sequence asc" },
  );

  return lines
    .map((l: Record<string, unknown>) => ({
      // product_id comes back as [id, display_name]; the display name is the
      // canonical Odoo product name, which is exactly what sales needs to
      // search for once the record exists.
      id: Array.isArray(l.product_id) ? l.product_id[0] : null,
      name: Array.isArray(l.product_id) ? l.product_id[1] : l.name || "",
      quantity: l.product_qty || 0,
      unit: Array.isArray(l.product_uom) ? l.product_uom[1] : "",
      price_unit: Number(l.price_unit) || 0,
      date_planned: l.date_planned ? String(l.date_planned).slice(0, 10) : null,
    }))
    .filter((p: { name: string }) => p.name);
}

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

/**
 * What Odoo said about a PO, in the three words the database's server-only
 * path understands: 'found', 'not_found' (a real "no such order") or
 * 'unreachable' (not configured, down, rate-limited — Odoo did not answer).
 */
async function askOdoo(ref: string) {
  if (!isConfigured()) return { answer: "unreachable", message: "Odoo integration is not configured on the server." };
  try {
    const uid = await authenticate();
    const order = await findOrderByNumber(uid, ref);
    if (!order) return { answer: "not_found", message: `No Odoo purchase order found matching "${ref}".` };
    return { answer: "found", order, uid };
  } catch (err) {
    console.error("odoo-po-verify error:", err);
    return { answer: "unreachable", message: err instanceof Error ? err.message : "Odoo lookup failed." };
  }
}

/**
 * The actions that save a PO on an item. Each is a verdict the database makes
 * from Odoo's answer; the browser never names the verdict. "attach" (#684)
 * sets the line from the P0; "correct" (#549) swaps the PO on a Purchased item.
 */
const PO_ACTIONS = new Set(["attach", "correct", "ipas"]);

/**
 * #730: raises the IPAS of an attached P0, or adds the line's SOR to the live one. The server reads the PO
 * from Odoo itself (the same read as odoo-po-ipas) and the database decides: raised, SOR added, filed (nothing
 * added), or Odoo silent (the line is flagged "IPAS to create" for a retry). Never throws: the P0 stays attached
 * whatever happens here.
 */
async function autoIpas(admin: ReturnType<typeof createClient>, email: string, itemId: string, po: string) {
  try {
    // readPo never throws: Odoo not answering comes back as the verdict "unavailable", and the database
    // then flags the line "IPAS to create" itself. Only that case is a pending retry.
    const answer = await readPo(po);
    const { data, error } = await admin.rpc("purchase_request_item_auto_ipas", {
      p_actor_email: email,
      p_item_id: itemId,
      p_verdict: answer.verdict,
      p_odoo_copy: answer.verdict === "found" ? answer.copy : null,
    });
    if (error) {
      // A database refusal (not Purchasing, no verified P0, ...) is an error to show, not a pending flag.
      console.error("odoo-po-verify auto IPAS error:", error.message);
      return { result: "error", message: refusalText(error.message) };
    }
    return data as { result: string; message: string; ipas_number?: string | null };
  } catch (err) {
    console.error("odoo-po-verify auto IPAS error:", err);
    return { result: "error", message: "The IPAS could not be raised. The P0 stays attached; try again." };
  }
}

/** The database's refusal, without the function name it leads with. */
const refusalText = (message: string) => message.replace(/^[a-z_]+: /, "");

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ success: false, message: "Invalid request body." });
  }
  const { poNumber, itemId } = body;
  const ref = normalizePoNumber(poNumber);

  // Save mode (#548): an item is given, so the server checks the PO and makes
  // the move itself. Without an item this is the plain lookup below.
  if (itemId) {
    const action = String(body.action ?? "attach");
    if (!PO_ACTIONS.has(action)) {
      return jsonResponse({ success: false, refused: true, message: `${action} is not a PO action.` });
    }
    if (!ref) {
      return jsonResponse({
        success: false,
        refused: true,
        message: 'Enter a valid PO Number — "P" followed by digits, e.g. P01234.',
      });
    }
    const email = await callerEmail(req);
    if (!email) {
      return jsonResponse({ success: false, refused: true, message: "Sign in to change an item." }, 401);
    }

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // #730: retry "IPAS to create" for a line whose P0 is already attached. The P0 is the line's own.
    if (action === "ipas") {
      const { data: line } = await admin.from("purchase_request_items").select("po_number").eq("id", itemId).maybeSingle();
      if (!line?.po_number) return jsonResponse({ success: false, refused: true, message: "Attach a P0 to this line first." });
      const ipas = await autoIpas(admin, email, itemId as string, line.po_number);
      return jsonResponse({ success: ipas.result !== "unavailable" && ipas.result !== "error", ipas, message: ipas.message });
    }

    const odoo = await askOdoo(ref);

    if (action === "attach") {
      if (odoo.answer === "not_found") return jsonResponse({ success: false, refused: true, message: odoo.message });
      if (odoo.answer !== "found") {
        return jsonResponse({ success: false, message: `${odoo.message} The P0 was not attached; try again.` });
      }
      try {
        // Read the P0 as it stands now; its own number is the canonical one (a typed one may have lost zeroes).
        const seen = odoo as unknown as { uid: number; order: { id: number } };
        const [p0] = await readP0s(seen.uid, [["id", "=", seen.order.id]], 1);
        const { data: row } = await admin
          .from("purchase_request_items")
          .select("odoo_product_id, odoo_po_line_ids, quantity")
          .eq("id", itemId)
          .maybeSingle();
        const facts = p0 && p0Facts(p0, row?.odoo_product_id ?? null, row?.odoo_po_line_ids ?? [], row?.quantity ?? null);
        if (!facts) {
          return jsonResponse({ success: false, refused: true, message: `${ref} is cancelled in Odoo, so it can't be attached.` });
        }
        const { data, error } = await admin.rpc("purchase_request_item_attach_po", {
          p_actor_email: email,
          p_item_id: itemId,
          p_po_number: p0.name,
          p_facts: facts,
          // #724: Order early. The database decides whether the SOR's stage needs it.
          p_order_early: body.orderEarly === true,
          p_order_early_reason: typeof body.orderEarlyReason === "string" ? body.orderEarlyReason : null,
        });
        if (error) {
          // "Buying opens here" refusal: the screen offers Order early instead of just showing the text.
          // The database names it in the error's hint, the repo's refusal code.
          const code = error.hint === "buying_not_open" ? "buying_not_open" : undefined;
          return jsonResponse({ success: false, refused: true, message: refusalText(error.message), ...(code ? { code } : {}) });
        }
        // #688: remember the Odoo product on the P0 line, so a new S0 line for the same product can ask "Is this yours?".
        await admin.from("purchase_request_items").update({ bought_product_id: facts.bought_product_id }).eq("id", itemId);
        // The P0's price is the Component's Actual cost (#686), sent in its own currency: the database turns a
        // foreign one into pesos at the Canvass winner's rate. The attach already stands, so a miss here is logged, not fatal.
        const actual = p0UnitPrice(p0, row?.odoo_product_id ?? null, row?.odoo_po_line_ids ?? []);
        const { error: priceError } = await admin.rpc("costing_set_p0_price", {
          p_actor_email: email,
          p_item_id: itemId,
          p_price: actual.price,
          p_currency: actual.currency,
        });
        if (priceError) console.error("odoo-po-verify actual cost error:", priceError.message);
        // #730: the IPAS follows the attach. A miss here never undoes it.
        const ipas = await autoIpas(admin, email, itemId as string, p0.name);
        return jsonResponse({ success: true, verdict: "verified", item: { ...data, bought_product_id: facts.bought_product_id }, ipas });
      } catch (err) {
        console.error("odoo-po-verify attach error:", err);
        return jsonResponse({ success: false, message: err instanceof Error ? err.message : "Odoo lookup failed." });
      }
    }
    const { data, error } = await admin.rpc("purchase_request_item_apply_po_check", {
      p_actor_email: email,
      p_item_id: itemId,
      p_action: action,
      p_po_number: ref,
      p_odoo: odoo.answer,
    });
    if (error) {
      return jsonResponse({ success: false, refused: true, message: refusalText(error.message) });
    }
    return jsonResponse({
      success: true,
      verdict: odoo.answer === "found" ? "verified" : "not_checked",
      item: data,
      ...(odoo.answer === "unreachable" ? { message: odoo.message } : {}),
    });
  }

  if (!isConfigured()) {
    // Not an outage — the integration was never wired up. Same shape as a
    // transport failure so the caller parks the row rather than asserting the
    // PO does not exist.
    return jsonResponse({
      success: false,
      message: "Odoo integration is not configured on the server.",
    });
  }

  if (!ref) {
    return jsonResponse({
      success: true,
      found: false,
      message: 'Enter a valid PO Number — "P" followed by digits, e.g. P01234.',
    });
  }

  try {
    const uid = await authenticate();
    const order = await findOrderByNumber(uid, ref);

    if (!order) {
      return jsonResponse({
        success: true,
        found: false,
        message: `No Odoo purchase order found matching "${ref}".`,
      });
    }

    const products = await fetchOrderProducts(uid, order.id);

    return jsonResponse({
      success: true,
      found: true,
      order: {
        id: order.id,
        name: order.name,
        state: order.state,
        supplier: Array.isArray(order.partner_id) ? order.partner_id[1] : null,
        ordered_on: order.date_order || null,
        date_planned: order.date_planned ? String(order.date_planned).slice(0, 10) : null,
        amount_total: Number(order.amount_total) || 0,
      },
      products,
    });
  } catch (err) {
    console.error("odoo-po-verify error:", err);
    // success:false means "could not check", which the caller parks as
    // PENDING_VERIFICATION. It must never collapse into found:false.
    return jsonResponse({
      success: false,
      message: err instanceof Error ? err.message : "Odoo lookup failed.",
    });
  }
});
