/**
 * What the SOR modal shows of its Purchase Request (#310): the Now card's
 * counts, each Product List line's Requested Item, and the items raised on a
 * visit. Pure: the data is `sor_purchase_request_overview`'s row, shaped by
 * `purchaseRequestService.getSorOverview`.
 */
import { isClosedStatus } from "../constants/purchaseRequest";

const norm = (value) => String(value ?? "").trim().toLowerCase();
const time = (value) => (value ? new Date(value).getTime() : null);

/** The items still open (not in a closed status). */
export const openItems = (items) => (items ?? []).filter((item) => !isClosedStatus(item?.status));

/**
 * The Requested Item for a Product List line, or null. An item remembers the
 * line it was picked from by the line's fixed id (#677), and that id is the
 * match. An item with no line id yet (picked before that) falls back to Odoo
 * product, then to name among items picked from a line without one. Only items
 * picked from an SOR line count. Several matches: an open one first, then the
 * newest.
 */
export function requestedItemForLine(line, items) {
  if (!line || !items?.length) return null;
  const fromLines = items.filter((item) => item?.source === "sor_line");
  let matches = line.id ? fromLines.filter((item) => item.sor_item_id != null && item.sor_item_id === line.id) : [];
  if (matches.length === 0 && line.odoo_product_id != null) {
    matches = fromLines.filter((item) => item.sor_item_id == null && item.odoo_product_id != null && item.odoo_product_id === line.odoo_product_id);
  }
  if (matches.length === 0) {
    const name = norm(line.product_name);
    if (name) matches = fromLines.filter((item) => item.sor_item_id == null && item.odoo_product_id == null && norm(item.name) === name);
  }
  if (matches.length === 0) return null;
  const newest = (a, b) => (time(b.created_at) ?? 0) - (time(a.created_at) ?? 0);
  const open = matches.filter((item) => !isClosedStatus(item.status)).sort(newest);
  return open[0] ?? [...matches].sort(newest)[0];
}

/**
 * The items raised during a visit. Items carry no visit id, so a visit owns
 * those created between it being entered and left (still open: from entry).
 */
export function itemsForVisit(items, visit) {
  if (!visit || !items?.length) return [];
  const from = time(visit.enteredAt ?? visit.entered_at);
  const to = time(visit.leftAt ?? visit.left_at);
  if (from == null) return [];
  return items.filter((item) => {
    const at = time(item.created_at);
    return at != null && at >= from && (to == null || at < to);
  });
}

/**
 * `sor_purchase_request_overview`'s row in the shape the SOR modal reads:
 * `{ requestId, openedVisitId, createdAt, buyer: {id, name, avatarPath} | null,
 * items }`. No row (no request, or none the caller may read) is null.
 */
export function shapeSorOverview(row) {
  if (!row) return null;
  return {
    requestId: row.request_id,
    openedVisitId: row.opened_visit_id ?? null,
    createdAt: row.created_at,
    buyer: row.buyer_id ? { id: row.buyer_id, name: row.buyer_name, avatarPath: row.buyer_avatar_path ?? null } : null,
    items: Array.isArray(row.items) ? row.items : [],
  };
}

/**
 * The P0 to show on a Product List line (#747): the Requested Item P0 once the line is bought.
 * An RFQ is not bought yet, so it shows nothing. odooPoId is the Odoo order id when the IPAS
 * knows it, else null (the P0 shows without a link). No money here.
 */
export function p0ForLine(line, items) {
  const item = requestedItemForLine(line, items);
  if (!item?.po_number || item.po_state === "rfq") return null;
  return { poNumber: item.po_number, odooPoId: item.odoo_po_id ?? null };
}
