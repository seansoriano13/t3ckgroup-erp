import { requestIdentity, requestStageLabel, sorClosedLabel } from "@/constants/purchaseRequest";
import { isRequestClosed } from "@/services/purchaseRequestService";
import { listAge, listDate } from "@/utils/listDates";

/**
 * What the Purchase Requests list shows, apart from the rendering: the State
 * column's states and their badge tones in one place, and the Excel export.
 */

export const REQUEST_STATE = { OPEN: "open", CLOSED: "closed", SOR_CLOSED: "sor_closed" };

/** State -> StatusBadge tone, the one place this list maps them. */
export const REQUEST_STATE_TONES = {
  [REQUEST_STATE.OPEN]: "amber",
  [REQUEST_STATE.CLOSED]: "green",
  [REQUEST_STATE.SOR_CLOSED]: "red",
};

/** A request's own state: Closed, its SOR's closed reason, or Open; `{ state, label }` for a StateCell. */
export function requestStateOf(row) {
  if (isRequestClosed(row)) return { state: REQUEST_STATE.CLOSED, label: "Closed" };
  const sorClosed = sorClosedLabel(row.sor_closed);
  if (sorClosed) return { state: REQUEST_STATE.SOR_CLOSED, label: sorClosed };
  return { state: REQUEST_STATE.OPEN, label: "Open" };
}

export const QUEUE_EXPORT_HEADER = [
  "Request",
  "Name",
  "Stage",
  "Items done",
  "Items",
  "Buyer",
  "Last activity",
  "Age",
  "State",
];

/** The rows shown, in the order shown, as the sheet's cells. */
export function queueExportRows(rows) {
  return rows.map((row) => {
    const { reference, title } = requestIdentity(row);
    return [
      reference,
      title || null,
      requestStageLabel(row) || null,
      row.item_count ? row.item_count - row.open_count : null,
      row.item_count || null,
      row.buyer_name || "Unassigned",
      listDate(row.last_activity_at || row.created_at) || null,
      listAge(row.created_at) || null,
      requestStateOf(row).label,
    ];
  });
}
