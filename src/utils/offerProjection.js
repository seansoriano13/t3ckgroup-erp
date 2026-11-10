/**
 * Offer Projection (#321): what a Component's costing would become if a given Offer won. Pure: no
 * network, no React, and nothing stored. It is a look at the live matrix, not a copy of it.
 *
 * The database serves each Offer's Acquire (PHP) and Markup Price (`canvass_offer_projection`), to
 * the Closed Book and Purchasing only, so the factor behind the price never reaches the browser of
 * a Purchasing reader. The Closed Book also holds the full matrix, and from it this works out the
 * Tender Line's margin and the summary with the same arithmetic the matrix uses (`lineTotals`,
 * `summary`): one implementation, not two. A viewer whose matrix carries no `summary` gets neither.
 *
 * If the Offer won, the Component would be taken at the Offer's Acquire. The summary reads Final
 * Acquire, so the projected summary takes the Component's Final Acquire at that same figure too.
 */

import { lineTotals, percentOf, summary } from "./costingMath";

const blank = (value) => value === null || value === undefined || value === "";

/** A peso difference to the centavo, or null while either side is blank. */
const minus = (a, b) => (blank(a) || blank(b) ? null : Math.round((a - b) * 100) / 100);

/** The margin of a Tender Line: Final Offer total less the Components' Acquire total, and as a share of the offer. */
function lineMargin(tenderLine, components) {
  const totals = lineTotals(tenderLine, components);
  const amount = minus(totals.finalOfferTotal, totals.acquireTotal);
  return { amount, percent: amount === null ? null : percentOf(amount, totals.finalOfferTotal) };
}

const swapAcquire = (component, acquire) => ({ ...component, acquire_unit: acquire, final_acquire_unit: acquire });

/**
 * `projection` is one entry of `canvass_offer_projection` (`acquire_unit`, `markup_price_unit`).
 * Returns null when there is nothing to show: the database served nothing, or the Offer has no
 * Acquire (a foreign Offer with no comparison rate, or no price) — never a wrong figure.
 *
 *   acquireUnit, markupPriceUnit   as served
 *   margin    { current, projected } each { amount, percent } for the Component's Tender Line, or null
 *   summary   { operationalExpenses, revenue } each { from, to }, or null (Closed Book only)
 */
export function projectOffer({ projection, componentId, matrix }) {
  if (!projection || blank(projection.acquire_unit)) return null;

  const base = {
    acquireUnit: Number(projection.acquire_unit),
    markupPriceUnit: blank(projection.markup_price_unit) ? null : Number(projection.markup_price_unit),
    margin: null,
    summary: null,
  };
  if (!matrix?.summary) return base;

  const lines = matrix.tenderLines ?? [];
  const line = lines.find((l) => (l.components ?? []).some((c) => c.id === componentId));
  if (!line) return base;

  const swapComponents = (components) => components.map((c) => (c.id === componentId ? swapAcquire(c, base.acquireUnit) : c));
  const projectedLine = { ...line, components: swapComponents(line.components) };

  const projectedSummary = summary(
    { ...matrix, tenderLines: lines.map((l) => (l === line ? projectedLine : l)) },
    matrix.rates,
  );

  return {
    ...base,
    margin: {
      current: lineMargin(line, line.components),
      projected: lineMargin(projectedLine, projectedLine.components),
    },
    summary: {
      operationalExpenses: { from: matrix.summary.operationalExpenses, to: projectedSummary.operationalExpenses },
      revenue: { from: matrix.summary.revenue, to: projectedSummary.revenue },
    },
  };
}
