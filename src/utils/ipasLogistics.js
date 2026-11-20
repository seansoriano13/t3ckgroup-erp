import { IPAS_STATUS } from "../constants/ipas";

/** True once the IPAS has reached the Delivered step (its day is set on the record, ADR 0054). */
export const hasDelivered = (ipas) => (ipas?.statusSteps ?? []).some((item) => item.step === IPAS_STATUS.DELIVERED);

/**
 * What an IPAS still lacks before Logistics can be signed (#713, #1154): an Item Location (its own, or one from
 * the TG03 Transmittals), a Transmittal carrying it, and the Delivered status, on a Local and an Import IPAS alike.
 * Mirrors `_ipas_logistics_missing` in the database, which refuses the sign-off.
 */
export function logisticsMissing(ipas) {
  const missing = [];
  if (!ipas?.item_location_id && !ipas?.itemLocation) missing.push("the Item Location");
  if (!(ipas?.slips ?? []).length) missing.push("a Transmittal");
  if (!hasDelivered(ipas)) missing.push("the Delivered status");
  return missing;
}
