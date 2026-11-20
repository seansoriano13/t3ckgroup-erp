import { IPAS_STATUS, IPAS_STATUS_LABELS } from "../constants/ipas";

/**
 * Status dates out of order (#1151 follow-up). Dates are never refused: a step dated before an earlier step
 * only gets a warning on the record. Order-Draft is left out, since it is the day the IPAS was entered and a
 * late entry often comes after the real order date.
 *
 *   steps   the source's steps in order (ipasStatusesFor)
 *   dated   [{ step, on }] the reached steps
 *
 * Returns Map(step -> { label, on }) of the latest earlier step each out-of-order step falls before.
 */
export function statusDatesOutOfOrder(steps, dated) {
  const on = new Map((dated ?? []).filter((d) => d?.on).map((d) => [d.step, d.on]));
  const warnings = new Map();
  let latest = null;
  for (const step of steps) {
    if (step === IPAS_STATUS.ORDER_DRAFT) continue;
    const day = on.get(step);
    if (!day) continue;
    if (latest && day < latest.on) warnings.set(step, { label: IPAS_STATUS_LABELS[latest.step], on: latest.on });
    if (!latest || day >= latest.on) latest = { step, on: day };
  }
  return warnings;
}
