/**
 * The client's delivery deadline on an order (#467, spec #461 Q5 and Q15).
 * Pure: no network, no React. The due date itself comes from the engine's
 * `deadline` condition (`sor_delivery_deadlines`); this only decides how an
 * order stands against it. It marks, it never blocks or notifies.
 */

import { daysBetweenManila } from "./orderStanding";

/** Days before the deadline at which an unreceived order is marked near, until Purchasing sets one. */
export const DEFAULT_NEAR_DAYS = 5;

export const DEADLINE_MARK = { NONE: "none", OK: "ok", NEAR: "near", LATE: "late" };

export const INVALID_NEAR_DAYS_MESSAGE = "Days must be a whole number above zero.";

export const isValidNearDays = (days) => Number.isInteger(days) && days > 0;

/**
 * Where an order stands against its SOR's delivery deadline, counted in
 * Asia/Manila days. `mark` is:
 *   none   the SOR has no deadline, or the order is already Received in Odoo
 *   ok     more than `nearDays` days left
 *   near   `nearDays` days or fewer left, including the due date itself
 *   late   past the due date
 * `daysLeft` is negative once late, and null with no deadline.
 */
export function deadlineMark({ dueAt, receivedInOdoo = false, nearDays = DEFAULT_NEAR_DAYS, today = new Date() } = {}) {
  if (!dueAt) return { mark: DEADLINE_MARK.NONE, dueAt: null, daysLeft: null };
  const ahead = daysBetweenManila(today, dueAt);
  const behind = daysBetweenManila(dueAt, today);
  const daysLeft = behind > 0 ? -behind : ahead;
  if (receivedInOdoo) return { mark: DEADLINE_MARK.NONE, dueAt, daysLeft };
  if (daysLeft < 0) return { mark: DEADLINE_MARK.LATE, dueAt, daysLeft };
  if (daysLeft <= nearDays) return { mark: DEADLINE_MARK.NEAR, dueAt, daysLeft };
  return { mark: DEADLINE_MARK.OK, dueAt, daysLeft };
}

/** The earliest due date among an order's SORs (a map of SOR id to { dueAt }), or null. */
export function earliestDueAt(sorIds = [], deadlines = new Map()) {
  let best = null;
  for (const id of sorIds) {
    const dueAt = deadlines.get(id)?.dueAt;
    if (dueAt && (!best || new Date(dueAt) < new Date(best))) best = dueAt;
  }
  return best;
}
