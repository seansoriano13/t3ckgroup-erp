/**
 * Pure derivations of what the IPAS reads from its Transmittals (#256, spec
 * #251): section 5's slip list, Item Location, Delivered and Actual Checking.
 * No network, no React. The database holds the rules (the hand-stamp trigger);
 * these only read the submitted, uncancelled slips the service hands over.
 *
 * A slip is `{ id, number, prepared_on, created_at, priority, state,
 * check_warehouse, check_technical, item_location_id, stages: [{ stage,
 * completed_at }], lines: [{ wh_rating, tech_rating }] }`.
 */

import { TRANSMITTAL_STATE } from "../constants/transmittals";
import { checkingStageOf, firstStageOf, stageRowOf, transmittalStateLabel } from "./transmittals";

/** Where the derived values come from. */
export const IPAS_TRANSMITTAL_VIA = "transmittals";

/** The shaped stage flags of a raw slip row (forIpas returns snake_case columns). */
const flagsOf = (slip) => ({ checkWarehouse: slip?.check_warehouse, checkTechnical: slip?.check_technical });

const completedAt = (slip, stage) => stageRowOf(slip, stage)?.completed_at ?? null;

/** Date order: prepared date, then created time, then number. */
export function inDateOrder(slips) {
  return [...slips].sort((a, b) => {
    const byDate = String(a.prepared_on ?? "").localeCompare(String(b.prepared_on ?? ""));
    if (byDate !== 0) return byDate;
    const byCreated = String(a.created_at ?? "").localeCompare(String(b.created_at ?? ""));
    if (byCreated !== 0) return byCreated;
    return String(a.number ?? "").localeCompare(String(b.number ?? ""));
  });
}

/** The slip's NA count: lines rated NA on either the Warehouse or the Technical rating. */
export function naCountOf(slip) {
  return (slip?.lines ?? []).filter((line) => line.wh_rating === "na" || line.tech_rating === "na").length;
}

/**
 * Section 5's rows: the slips in date order, with the number, date, priority,
 * the current stage or state, and the NA count.
 */
export function section5Rows(slips = []) {
  return inDateOrder(slips).map((slip) => ({
    id: slip.id,
    number: slip.number,
    date: slip.prepared_on ?? null,
    priority: slip.priority ?? null,
    state: slip.state,
    stateLabel: transmittalStateLabel(slip.state),
    naCount: naCountOf(slip),
  }));
}

/**
 * Item Location from the slips: the Item Location of the most recent slip whose
 * first stage is completed. Null when none has.
 */
export function derivedItemLocationId(slips = []) {
  let found = null;
  for (const slip of inDateOrder(slips)) {
    if (completedAt(slip, firstStageOf(flagsOf(slip)))) found = slip.item_location_id ?? null;
  }
  return found;
}

/**
 * Delivered from the slips: the earliest first-stage completion over them.
 * `{ on, stamped }`, or null when no slip's first stage is complete.
 */
export function derivedDelivered(slips = []) {
  let earliest = null;
  for (const slip of slips) {
    const at = completedAt(slip, firstStageOf(flagsOf(slip)));
    if (at && (earliest === null || at < earliest)) earliest = at;
  }
  return earliest ? { on: earliest, stamped: true } : null;
}

/**
 * Actual Checking from the slips.
 *   none     no slip: the hand stamp (ipas.actual_checking_*) applies
 *   pending  some slip hasn't completed its checking stage: `done` of `total`
 *   stamped  every slip has: `at` is the latest completion
 */
export function derivedActualChecking(slips = []) {
  if (slips.length === 0) return { status: "none" };
  const completions = slips.map((slip) => completedAt(slip, checkingStageOf(flagsOf(slip))));
  const done = completions.filter(Boolean).length;
  if (done < slips.length) return { status: "pending", done, total: slips.length };
  const at = completions.reduce((latest, value) => (value > latest ? value : latest), completions[0]);
  return { status: "stamped", done, total: slips.length, at };
}

/**
 * All of it at once. `typed` is the IPAS's own columns: `itemLocationId`,
 * `deliveredOn` (typed date), `actualCheckingBy`/`actualCheckingAt` (hand stamp).
 * Each derived value says where it came from in `source`: "typed", "transmittals"
 * or null.
 */
export function deriveTransmittalTrack(slips = [], typed = {}) {
  const itemLocationDerived = derivedItemLocationId(slips);
  const hasTypedLocation = Boolean(typed.itemLocationId);
  const delivered = derivedDelivered(slips);
  const checking = derivedActualChecking(slips);

  return {
    transmittals: section5Rows(slips),
    itemLocation: {
      id: hasTypedLocation ? typed.itemLocationId : itemLocationDerived,
      source: hasTypedLocation ? "typed" : itemLocationDerived ? IPAS_TRANSMITTAL_VIA : null,
    },
    delivered: typed.deliveredOn
      ? { on: typed.deliveredOn, stamped: false, source: "typed" }
      : delivered
        ? { on: delivered.on, stamped: true, source: IPAS_TRANSMITTAL_VIA }
        : { on: null, stamped: false, source: "typed" },
    actualChecking: checking,
    // True once any slip governs Actual Checking: the hand stamp is then refused.
    governed: slips.length > 0,
  };
}

/** Exported for the screens and tests: whether a slip is in a state the IPAS counts (submitted, not cancelled). */
export function countsForIpas(slip) {
  return Boolean(slip) && slip.state !== TRANSMITTAL_STATE.DRAFT && slip.state !== TRANSMITTAL_STATE.CANCELLED;
}
