/**
 * The IPAS summary an SOR shows (#249, spec #241): pure helpers, no network,
 * no React. `ipas_summaries_for_sor` returns one row per Project IPAS naming
 * the SOR, with no money or bank columns; this reads it the way the card does.
 *
 * Whatever the row holds, nothing here throws: a missing or odd value reads as
 * "not ticked".
 */

import {
  IPAS_BUYER_TRACK_LABELS,
  IPAS_COMPUTATION_STATUS,
  IPAS_COMPUTATION_STATUS_LABELS,
  IPAS_STATE,
  ipasSectionName,
} from "../constants/ipas";

/**
 * The columns `ipas_summaries_for_sor` returns, and nothing else. A test holds
 * the database to exactly this set: it must never grow a payment or bank column.
 * The one money pair is Landed Cost's total and mark (#283), filled only for the
 * Costing Matrix's money tier and null for everyone else.
 */
export const IPAS_SUMMARY_KEYS = [
  "buyer_track",
  "computation_status",
  "ipas_id",
  "landed_cost_mark",
  "landed_cost_total_php",
  "number",
  "po_number",
  "purpose",
  "signoffs",
  "state",
  "supplier",
];

/** The roles shown for each section's progress, in the order they are given. */
const SECTION_STEPS = {
  1: [
    { role: "prepared", label: "Submitted" },
    { role: "approved", label: "Approved" },
  ],
  3: [
    { role: "prepared", label: "Submitted" },
    { role: "approved", label: "Approved" },
  ],
  6: [
    { role: "prepared", label: "Submitted" },
    { role: "approved", label: "Approved" },
  ],
  7: [
    { role: "received", label: "Received" },
    { role: "noted", label: "Noted" },
    { role: "checked", label: "Checked" },
    { role: "approved", label: "Filed" },
  ],
};

const asObject = (value) => (value && typeof value === "object" && !Array.isArray(value) ? value : {});

/** The buyer track's ticks with their names, in the order the database gives them. */
function shapeTrack(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item) => item && typeof item === "object" && typeof item.key === "string")
    .map((item) => ({
      key: item.key,
      label: IPAS_BUYER_TRACK_LABELS[item.key] ?? item.key,
      ticked: item.ticked === true,
      partial: item.partial === true,
    }));
}

/**
 * The sign-off progress by section: `{ section, name, steps: [{ role, label,
 * done }], done, total }`, for stored sections 1, 3, 6 and 7.
 */
export function signoffProgress(signoffs) {
  const given = asObject(signoffs);
  return Object.entries(SECTION_STEPS).map(([section, steps]) => {
    const live = asObject(given[section]);
    const shaped = steps.map(({ role, label }) => ({ role, label, done: live[role] === true }));
    return {
      section: Number(section),
      name: ipasSectionName(section) || `Section ${section}`,
      steps: shaped,
      done: shaped.filter((step) => step.done).length,
      total: shaped.length,
    };
  });
}

/** One `ipas_summaries_for_sor` row as the SOR's IPAS section reads it, or null. */
export function shapeIpasSummary(row) {
  if (!row || typeof row !== "object" || !row.ipas_id) return null;
  const buyerTrack = shapeTrack(row.buyer_track);
  return {
    id: row.ipas_id,
    number: row.number ?? "",
    poNumber: row.po_number ?? "",
    supplier: row.supplier || null,
    purpose: row.purpose ?? null,
    state: row.state ?? null,
    buyerTrack,
    trackDone: buyerTrack.filter((item) => item.ticked).length,
    trackTotal: buyerTrack.length,
    computationStatus: row.computation_status ?? null,
    computationLabel:
      IPAS_COMPUTATION_STATUS_LABELS[row.computation_status] ??
      IPAS_COMPUTATION_STATUS_LABELS[IPAS_COMPUTATION_STATUS.ENCODING],
    signoffs: signoffProgress(row.signoffs),
    // #283: null for a reader outside the matrix's money tier.
    landedCost:
      row.landed_cost_mark && row.landed_cost_mark !== "unavailable" && row.landed_cost_total_php !== null && row.landed_cost_total_php !== undefined
        ? { total: Number(row.landed_cost_total_php), mark: row.landed_cost_mark }
        : row.landed_cost_mark === "unavailable"
          ? { total: null, mark: "unavailable" }
          : null,
    isFiled: row.state === IPAS_STATE.FILED,
    isCancelled: row.state === IPAS_STATE.CANCELLED,
  };
}

/** The summaries of a result, in the database's order, leaving out anything unusable. */
export function shapeIpasSummaries(rows) {
  return (Array.isArray(rows) ? rows : []).map(shapeIpasSummary).filter(Boolean);
}
