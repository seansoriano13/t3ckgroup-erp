/**
 * The item road: where one Component of the S0 Evaluation is on its way from plan to warehouse.
 *
 *   planned → go → requested → ordered → paying → costed → received
 *
 * planned    still being priced; no Go yet and nothing asked for
 * go         the Bid Decision is Go (the sheet is locked) and nothing is asked for yet
 * requested  a Purchase Request item buys for it, with no P0 yet
 * ordered    a P0 is on it (an item is Purchased, or a PO number is known), with no IPAS yet
 * paying     its P0 has an IPAS
 * costed     the IPAS's Landed Cost for it is final (only a tier that reads Landed Cost sees this step)
 * received   every live item for it is Received
 *
 * `fromStock` marks a Component the warehouse already holds (an Available item), which skips buying;
 * `stuck` marks one whose only items cannot be sourced. Cancelled items count for nothing.
 *
 * Reads what the S0 Evaluation already loads (`component.purchases`, `component.landed_cost`), so it
 * asks the database nothing. Which items buy for which Component is the database's rule
 * (`_costing_item_components`), not this module's.
 */

export const ROAD_STEPS = ["planned", "go", "requested", "ordered", "paying", "costed", "received"];

/** The badge colour of each step: grey while planning, blue while buying, green once it is in. */
export const ROAD_THEMES = { planned: "mauve", go: "indigo", requested: "blue", ordered: "blue", paying: "violet", costed: "teal", received: "green" };

export const ROAD_LABELS = {
  planned: "Planned",
  go: "Go",
  requested: "Requested",
  ordered: "Ordered",
  paying: "Paying",
  costed: "Cost final",
  received: "Received",
};

const DEAD = new Set(["cancelled", "cannot_source"]);

/** One Component's step: `{ step, label, index, fromStock, stuck, ipas, poNumbers }`. */
export function componentRoad(component, { locked = false } = {}) {
  const purchases = component?.purchases ?? { requests: [], ipas: [], poNumbers: [] };
  const all = purchases.requests ?? [];
  const live = all.filter((r) => !DEAD.has(r.status));
  const ipas = (purchases.ipas ?? []).filter((i) => i.ipasId);
  const poNumbers = purchases.poNumbers ?? [];
  const stuck = all.length > 0 && live.length === 0 && all.some((r) => r.status === "cannot_source");
  const fromStock = live.length > 0 && live.every((r) => r.status === "available");

  let step = locked ? "go" : "planned";
  if (live.length > 0) step = "requested";
  if (live.some((r) => r.status === "purchased" || r.status === "received" || r.poNumber) || poNumbers.length > 0) step = "ordered";
  if (ipas.length > 0) step = "paying";
  if (component?.landed_cost?.mark === "final") step = "costed";
  if (live.length > 0 && live.every((r) => r.status === "received")) step = "received";
  if (fromStock) step = "received";

  return { step, label: fromStock ? "From stock" : ROAD_LABELS[step], index: ROAD_STEPS.indexOf(step), fromStock, stuck, ipas, poNumbers };
}

/**
 * A Tender Line's step: its slowest Component, since the line is only as far along as its last part.
 * A line with no Component is planned (or go, once locked).
 */
export function lineRoad(line, { locked = false } = {}) {
  const roads = (line?.components ?? []).map((c) => componentRoad(c, { locked }));
  if (roads.length === 0) {
    const step = locked ? "go" : "planned";
    return { step, label: ROAD_LABELS[step], index: ROAD_STEPS.indexOf(step), stuck: false, parts: 0 };
  }
  const slowest = roads.reduce((a, b) => (b.index < a.index ? b : a));
  return { ...slowest, stuck: roads.some((r) => r.stuck), parts: roads.length };
}
