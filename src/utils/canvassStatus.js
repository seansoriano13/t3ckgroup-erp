import { MIN_CANVASS_OFFERS } from "../constants/canvass";
import { ITEM_STATUS } from "../constants/purchaseRequest";

/**
 * What a line and a Canvass show (#969, spec #956). Pure: no network, no React. The database owns
 * the rules (three suppliers or a "No other supplier" note, a winner with a reason, the lock on a
 * Purchased line); this only names the state the rows are in, so the grid, the list and the print
 * say one thing.
 */

export const CANVASS_STATE = {
  NEEDS_SUPPLIERS: "needs_suppliers",
  NEEDS_WINNER: "needs_winner",
  WINNER_PICKED: "winner_picked",
  LOCKED: "locked",
  CANCELLED: "cancelled",
};

export const CANVASS_STATE_LABEL = {
  [CANVASS_STATE.NEEDS_SUPPLIERS]: "Needs suppliers",
  [CANVASS_STATE.NEEDS_WINNER]: "Needs a winner",
  [CANVASS_STATE.WINNER_PICKED]: "Winner picked",
  [CANVASS_STATE.LOCKED]: "Locked",
  [CANVASS_STATE.CANCELLED]: "Cancelled",
};

/**
 * Whether a winner may be picked on any line: three suppliers, or at least one supplier and a "No
 * other supplier" note for the missing ones. The first supplier can't be explained away.
 */
export function suppliersCovered(supplierCount, hasNote = false) {
  const count = Number(supplierCount) || 0;
  return count >= MIN_CANVASS_OFFERS || (count >= 1 && Boolean(hasNote));
}

/** A Purchased (or Received) line is locked, unless a Super Admin lifted it (`unlocked`). */
export const lineLocked = (item, unlocked = false) =>
  !unlocked && (item?.status === ITEM_STATUS.PURCHASED || item?.status === ITEM_STATUS.RECEIVED);

/**
 * The state of one line: cancelled, locked, winner picked, needs a winner (the Canvass is covered)
 * or needs suppliers (it isn't). `winner` is the line's winner row or null.
 */
export function lineState({ item, winner = null, covered = false, unlocked = false } = {}) {
  if (item?.status === ITEM_STATUS.CANCELLED) return CANVASS_STATE.CANCELLED;
  if (lineLocked(item, unlocked)) return CANVASS_STATE.LOCKED;
  if (winner) return CANVASS_STATE.WINNER_PICKED;
  return covered ? CANVASS_STATE.NEEDS_WINNER : CANVASS_STATE.NEEDS_SUPPLIERS;
}

/**
 * The state of the whole Canvass, from its lines (`[{ item, winner, unlocked }]`) and whether its
 * suppliers are covered. Cancelled lines don't count. Locked when every counted line is locked;
 * needs suppliers until covered; winner picked when every open line has one; otherwise needs a winner.
 */
export function canvassState({ lines = [], covered = false } = {}) {
  const counted = (Array.isArray(lines) ? lines : []).filter((l) => l?.item?.status !== ITEM_STATUS.CANCELLED);
  if (counted.length > 0 && counted.every((l) => lineLocked(l.item, l.unlocked))) return CANVASS_STATE.LOCKED;
  if (!covered) return CANVASS_STATE.NEEDS_SUPPLIERS;
  const open = counted.filter((l) => !lineLocked(l.item, l.unlocked));
  if (open.length > 0 && open.every((l) => l.winner)) return CANVASS_STATE.WINNER_PICKED;
  return CANVASS_STATE.NEEDS_WINNER;
}
