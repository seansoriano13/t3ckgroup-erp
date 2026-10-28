/**
 * What an IPAS still lacks before Logistics can be signed (#713): an Item Location (its own, or one from
 * the TG03 Transmittals), a Transmittal carrying it, and the date the goods were received at the
 * warehouse. Mirrors `_ipas_logistics_missing` in the database, which refuses the sign-off.
 */
export function logisticsMissing(ipas) {
  const missing = [];
  if (!ipas?.item_location_id && !ipas?.itemLocation) missing.push("the Item Location");
  if (!(ipas?.slips ?? []).length) missing.push("a Transmittal");
  if (!ipas?.arrived_in_whs_on) missing.push("the received date");
  return missing;
}
