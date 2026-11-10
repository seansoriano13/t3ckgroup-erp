import { odooService } from "../../../services/odooService";
import { opportunityService } from "../../../services/opportunityService";

/** One Odoo order line as a Product List row — the shape the items editor and `updateOpportunity` both take. */
export const toRow = (item) => ({
  // A stored line keeps its own id and its Odoo line id through an edit, so the save updates it in place (#677).
  ...(item.id ? { id: item.id } : {}),
  product_name: item.product_name || "",
  unit: item.unit || "",
  quantity: item.quantity ?? 1,
  unit_price: item.unit_price ?? "",
  odoo_product_id: item.odoo_product_id ?? null,
  odoo_line_id: item.odoo_line_id ?? null,
  removed_from_s0: item.removed_from_s0 ?? false,
});

/**
 * A Sales Reference's product lines from Odoo, read the one way all three
 * callers need: the auto-sync on open (#53), the edit form's Fetch Items, and
 * the Items tab's empty state (#301). "Odoo answered but there's nothing to
 * use" comes back as `problem`, a sentence for the person who asked, rather
 * than as a throw — the auto-sync ignores it silently while the two buttons
 * show it, and a stored Product List is never replaced with an empty one
 * either way. Only a failure to reach Odoo at all throws.
 */
export async function pullOdooLines(ref) {
  const result = await odooService.fetchOrderLines(ref);
  const quotation = result?.order?.name || ref;
  if (!result?.success) {
    return { problem: result?.message || "Could not fetch items from Odoo — enter them manually." };
  }
  if (!result.items.length) {
    return { problem: result.message || `${quotation} has no product lines yet — enter them manually.` };
  }
  return { problem: null, rows: result.items.map(toRow), stock: result.stock || null, quotation };
}

/**
 * Writes pulled lines, and the stock Odoo returned alongside them (#202), straight to the SOR.
 * `automatic` is the sync on open: nobody asked for it, so what it logs is the System's, not theirs.
 */
export async function saveOdooLines({ opportunity, rows, stock, actorId, automatic = false }) {
  await opportunityService.updateOpportunity(opportunity.id, { ...opportunity, items: rows }, actorId, {
    bySystem: automatic,
  });
  if (stock) await opportunityService.saveStockSnapshot(opportunity.id, stock, actorId);
}
