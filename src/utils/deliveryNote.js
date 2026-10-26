import { ITEM_STATUS } from "../constants/purchaseRequest";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-11-12" -> "Nov 12". A date-only string is read as written, never shifted by a time zone (ADR 0039). */
export function formatEta(eta) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(eta ?? ""));
  if (!m) return null;
  return `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}`;
}

/**
 * The note shown next to Purchased (#685): how much has arrived, or when it is due.
 * Null for any other status, and for a full receipt (the line is Received then).
 * Odoo's Expected Arrival is often unset, so "no ETA set" is a normal answer.
 */
export function deliveryNote(item) {
  if (!item || item.status !== ITEM_STATUS.PURCHASED) return null;
  const of = Number(item.po_ordered) || 0;
  const received = Number(item.po_received) || 0;
  if (received > 0 && received < of) return `${received} of ${of} received`;
  if (of > 0 && received >= of) return null;
  const eta = formatEta(item.po_eta);
  return eta ? `Not received yet · ETA ${eta}` : "Not received yet · no ETA set";
}
