/**
 * Small pieces Order Monitoring's service, its Settings section and the SOR's
 * standing all share (#262-#265, spec #261). Pure: no network, no React.
 */

import { TRANSMITTAL_STATE } from "../constants/transmittals";

/** What a refused ageing rule says, wherever the days were typed. */
export const INVALID_DAYS_MESSAGE = "Days must be a whole number above zero, or blank for no rule.";

/** A rule is a positive whole number of days, or null for no rule. */
export function isValidDays(days) {
  return days === null || (Number.isInteger(days) && days > 0);
}

/** The slips that count (submitted, not cancelled): drafts are left out. */
export const submittedSlips = (slips = []) => slips.filter((slip) => slip.state !== TRANSMITTAL_STATE.DRAFT);

/**
 * The input `orderStanding` reads, built the one way for the list and the SOR.
 * `slips` are every Transmittal that names the IPAS, drafts included: drafts
 * only tell orderStanding a Transmittal has been started, they are not slips.
 * `status` is the stored IPAS Status key and `statusSteps` its reached steps, `[{ step, on }]`.
 */
export function orderStandingInput({
  id,
  state,
  source,
  createdAt,
  updatedAt,
  computationStatus,
  costsCompletedAt,
  section3Submitted,
  section3Approved,
  buyerTrack,
  status,
  statusSteps,
  slips = [],
  onHold = false,
  directDelivery = false,
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
    section3Submitted: section3Submitted === true,
    section3Approved: section3Approved === true,
    buyerTrack,
    status: status ?? null,
    statusSteps: Array.isArray(statusSteps) ? statusSteps : [],
    slips: submitted,
    hasDraftTransmittal: submitted.length < slips.length,
    onHold: onHold === true,
    directDelivery: directDelivery === true,
  };
}
