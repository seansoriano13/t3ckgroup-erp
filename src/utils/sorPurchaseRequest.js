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
 * The Requested Item for a Product List line, or null. Line ids change on
 * every save, so the match is by Odoo product, then by name among items that
 * were picked from a line without one. Only items picked from an SOR line
 * count. Several matches: an open one first, then the newest.
 */
export function requestedItemForLine(line, items) {
  if (!line || !items?.length) return null;
  const fromLines = items.filter((item) => item?.source === "sor_line");
  let matches = [];
  if (line.odoo_product_id != null) {
    matches = fromLines.filter((item) => item.odoo_product_id != null && item.odoo_product_id === line.odoo_product_id);
  }
  if (matches.length === 0) {
    const name = norm(line.product_name);
    if (name) matches = fromLines.filter((item) => item.odoo_product_id == null && norm(item.name) === name);
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
