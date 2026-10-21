/**
 * Small pieces Order Monitoring's service, its Settings section and the SOR's
 * standing all share (#262-#265, spec #261). Pure: no network, no React.
 */

import { IPAS_SUPPLIER_ORIGIN_FIELDS } from "../constants/ipas";
import { TRANSMITTAL_STATE } from "../constants/transmittals";

/** What a refused ageing rule says, wherever the days were typed. */
export const INVALID_DAYS_MESSAGE = "Days must be a whole number above zero, or blank for no rule.";

/** A rule is a positive whole number of days, or null for no rule. */
export function isValidDays(days) {
  return days === null || (Number.isInteger(days) && days > 0);
}

/** The latest Supplier Origin date and its name ({ label, on }) in a row of IPAS columns, or null. */
export function latestSupplierOrigin(row) {
  let best = null;
  for (const { column, label } of IPAS_SUPPLIER_ORIGIN_FIELDS) {
    const on = row?.[column];
    if (on && (!best || on > best.on)) best = { label, on };
  }
  return best;
}

/** The slips that count (submitted, not cancelled): drafts are left out. */
export const submittedSlips = (slips = []) => slips.filter((slip) => slip.state !== TRANSMITTAL_STATE.DRAFT);

/**
 * The input `orderStanding` reads, built the one way for the list and the SOR.
 * `slips` are every Transmittal that names the IPAS, drafts included: drafts
 * only tell orderStanding a Transmittal has been started, they are not slips.
 * `origins` is any row carrying the Supplier Origin date columns.
 */
export function orderStandingInput({
  id,
  state,
  source,
  createdAt,
  updatedAt,
  computationStatus,
  costsCompletedAt,
  section3Approved,
  buyerTrack,
  proofPaidOn,
  arrivedInPhOn,
  origins,
  slips = [],
}) {
  const submitted = submittedSlips(slips);
  return {
    id,
    state,
    source,
    createdAt,
    updatedAt,
    computationStatus,
    costsCompletedAt: costsCompletedAt ?? null,
    section3Approved: section3Approved === true,
    buyerTrack,
    proofPaidOn: proofPaidOn ?? null,
    arrivedInPhOn: arrivedInPhOn ?? null,
    latestSupplierOrigin: latestSupplierOrigin(origins),
    slips: submitted,
    hasDraftTransmittal: submitted.length < slips.length,
  };
}
