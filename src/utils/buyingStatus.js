import { ITEM_STATUS, ITEM_STATUSES, ITEM_STATUS_LABELS, ITEM_STATUS_THEME } from "../constants/purchaseRequest";

/**
 * The status of the buying for a Component or a Tender Line, in the Purchase Request's own words
 * ("To purchase", "Purchased", ...), so the costing screen and the Purchase Request never disagree.
 * It reads what the S0 Evaluation already loads (`component.purchases.requests`).
 *
 * Returns null when nothing has been requested. One status when every item shares it, otherwise
 * "k of n <furthest status>". A status that ends the road (Cannot source, Cancelled) only shows when
 * no live item is left.
 */
const DEAD = new Set([ITEM_STATUS.CANCELLED, ITEM_STATUS.CANNOT_SOURCE]);

export function buyingStatus(requests) {
  const all = requests ?? [];
  if (all.length === 0) return null;
  const live = all.filter((r) => !DEAD.has(r.status));
  if (live.length === 0) {
    const status = all.some((r) => r.status === ITEM_STATUS.CANNOT_SOURCE) ? ITEM_STATUS.CANNOT_SOURCE : ITEM_STATUS.CANCELLED;
    return { status, label: ITEM_STATUS_LABELS[status], theme: ITEM_STATUS_THEME[status], count: all.length, total: all.length, mixed: false };
  }
  const furthest = live.reduce((a, b) => (ITEM_STATUSES.indexOf(b.status) > ITEM_STATUSES.indexOf(a.status) ? b : a)).status;
  const count = live.filter((r) => r.status === furthest).length;
  const mixed = count < live.length;
  const label = ITEM_STATUS_LABELS[furthest];
  return { status: furthest, label: mixed ? `${count} of ${live.length} ${label}` : label, theme: ITEM_STATUS_THEME[furthest], count, total: live.length, mixed };
}

/** The status for a whole line: every item of every part, counted together. */
export function lineBuyingStatus(line) {
  return buyingStatus((line?.components ?? []).flatMap((c) => c?.purchases?.requests ?? []));
}
