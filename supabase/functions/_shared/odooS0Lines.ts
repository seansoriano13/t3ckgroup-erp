// An S0's product lines in Odoo, and the local-stack sample used when Odoo is not configured.
// Shared by odoo-sor-lookup (the browser's lookup) and sor-sales-reference (the S0 save, #816).

import { executeKw } from "./odoo.ts";

// Local stack only, when Odoo is not configured: a made-up quotation so the
// Sales Reference fetch can be tried without live Odoo. Never reached in
// production or staging, which always have Odoo configured.
export function localSampleLookup(ref: string) {
  return {
    success: true,
    found: true,
    order: { id: 0, name: ref, state: "sale" },
    customer: { company: "Local Sample Customer", company_id: null, contact: "" },
    items: [
      { odoo_line_id: 900001, odoo_product_id: null, product_name: "Sample Product A", description: "Local sample line", unit: "Unit", quantity: 2, unit_price: 1500 },
      { odoo_line_id: 900002, odoo_product_id: null, product_name: "Sample Product B", description: "Local sample line", unit: "Unit", quantity: 1, unit_price: 4200 },
    ],
    stock: null,
    message: "Local sample data: Odoo is not configured on this machine.",
  };
}

export async function fetchOrderItems(uid, orderId) {
  const lines = await executeKw(
    uid,
    "sale.order.line",
    "search_read",
    [
      [["order_id", "=", orderId]],
      ["id", "product_id", "name", "product_uom_qty", "price_unit", "product_uom", "display_type"],
    ],
    { order: "sequence asc" },
  );

  return lines
    .filter((l) => !l.display_type) // section/note lines aren't products
    .map((l) => ({
      // The S0 line's own id (#677): the app keeps it so a line stays the same
      // line across reads, however its product, name or quantity change.
      odoo_line_id: Number.isInteger(l.id) ? l.id : null,
      // product_id comes back as [id, display_name]; issue #202 needs the id
      // kept so stock can be looked up without re-reading the quotation.
      odoo_product_id: (l.product_id && l.product_id[0]) || null,
      product_name: (l.product_id && l.product_id[1]) || l.name || "",
      // Issue #44: a bundled order's Inclusions live as free text in the
      // line's own description, not in the product name — kept as its own
      // field rather than folded into product_name so the existing Product
      // List mapping (and everything downstream of it) is untouched.
      description: l.name || "",
      unit: (l.product_uom && l.product_uom[1]) || "",
      quantity: l.product_uom_qty || 0,
      unit_price: l.price_unit || 0,
    }))
    .filter((it) => it.product_name);
}
