import { MIN_CANVASS_OFFERS } from "../constants/canvass";
import { ITEM_STATUS } from "../constants/purchaseRequest";

/**
 * Why a product line cannot start a Canvass, or null when it can (#682). Cancelled and bought
 * lines, and a line already Still canvassing, are shut; every other open line may start one.
 */
export function canvassBlockedReason(item) {
  switch (item?.status) {
    case ITEM_STATUS.CANCELLED:
      return "This line is cancelled.";
    case ITEM_STATUS.PURCHASED:
    case ITEM_STATUS.RECEIVED:
      return "This line is already bought.";
    case ITEM_STATUS.STILL_CANVASSING:
      return "A Canvass is already running.";
    default:
      return null;
  }
}

/**
 * "Canvass CNV_0007 · 2 of 3 suppliers" for a line a supplier has quoted, else null. `canvass` is
 * what `purchaseRequestService.canvassesForItems` attaches: the request's Canvass number, how many
 * suppliers quoted this line (`supplierCount`) and who won it (`winnerName`). Once a winner is
 * picked the line also names who won: "· Winner Redleaf Inc.".
 */
export function canvassLine(canvass) {
  if (!canvass) return null;
  const head = canvass.number ? `Canvass ${canvass.number}` : "Canvass";
  const count = `${canvass.supplierCount ?? 0} of ${MIN_CANVASS_OFFERS} suppliers`;
  const winnerName = String(canvass.winnerName || "").trim();
  return winnerName ? `${head} · ${count} · Winner ${winnerName}` : `${head} · ${count}`;
}
