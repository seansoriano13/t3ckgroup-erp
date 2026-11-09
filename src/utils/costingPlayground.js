/**
 * The markup playground (Costing Desk): what the matrix would offer at a markup factor nobody has saved
 * yet. Every Component is priced at its own factor when it has one, else at the factor being tried; a
 * line's Final Offer per unit is its Components' Markup Prices over its quantity, kept at its ABC when
 * asked. Only the Closed Book has the Acquires this needs; for anyone else every figure is blank.
 *
 * Figures are in pesos to the centavo, worked in centavos like costingMath. A blank is never zero.
 */
import { effectiveFactor, extended, extendedCentavos, markupPrice, pesosFromCentavos, percentOf } from "./costingMath";

const centavos = (pesos) => extendedCentavos(pesos, 1);

/** Half away from zero, to the centavo. */
const roundToCentavo = (value) => Math.round(value * 100) / 100;

/**
 * One line at `factor`: `{ priceTotal, offerUnit, capped }`. `priceTotal` is the Components' Markup Prices
 * added up (null when the line has no Component or any Acquire is blank); `offerUnit` is that over the
 * line's quantity, at most the ABC per unit when `capAtAbc` and the ABC is known; `capped` says the ABC won.
 * `ignoreOwn` prices every Component at `factor`, its own factor or not.
 */
export function linePlay(line, factor, { capAtAbc = true, ignoreOwn = false } = {}) {
  const components = line?.components ?? [];
  if (components.length === 0) return { priceTotal: null, offerUnit: null, capped: false };
  let total = 0n;
  for (const c of components) {
    const price = markupPrice(c?.acquire_unit, c?.quantity, effectiveFactor(ignoreOwn ? { ...c, markup_factor: null } : c, factor));
    if (price === null) return { priceTotal: null, offerUnit: null, capped: false };
    total += centavos(price);
  }
  const priceTotal = pesosFromCentavos(total);
  const quantity = Number(line?.quantity);
  if (!(quantity > 0)) return { priceTotal, offerUnit: null, capped: false };
  const unit = roundToCentavo(priceTotal / quantity);
  const abc = line?.abc_unit == null ? null : Number(line.abc_unit);
  if (capAtAbc && abc !== null && unit > abc) return { priceTotal, offerUnit: abc, capped: true };
  return { priceTotal, offerUnit: unit, capped: false };
}

/**
 * The whole matrix at `factor`:
 *
 *   lines          `{ id, offerUnit, capped }` per Tender Line (offerUnit null when it cannot be priced)
 *   offerTotal     the lines' offers added up; null while any line cannot be priced
 *   unpriced       how many lines cannot be priced (no Component, or an Acquire is blank)
 *   capped         how many lines were kept at their ABC
 *   cost           every Component's and cost-only row's Acquire added up; null while any is blank
 *   margin         offerTotal - cost; null while either is
 *   marginPercent  margin as a percentage of offerTotal
 *   percentOfAbc   offerTotal as a percentage of the ABC total (only when every line has an ABC)
 */
export function matrixPlay(matrix, factor, { capAtAbc = true, ignoreOwn = false } = {}) {
  const tenderLines = matrix?.tenderLines ?? [];
  const lines = tenderLines.map((line) => ({ id: line.id, ...linePlay(line, factor, { capAtAbc, ignoreOwn }) }));
  const unpriced = lines.filter((l) => l.offerUnit === null).length;
  const capped = lines.filter((l) => l.capped).length;

  let offer = 0n;
  tenderLines.forEach((line, i) => {
    if (lines[i].offerUnit !== null) offer += extendedCentavos(lines[i].offerUnit, line.quantity);
  });
  const offerTotal = tenderLines.length > 0 && unpriced === 0 ? pesosFromCentavos(offer) : null;

  const costed = [...tenderLines.flatMap((l) => l.components ?? []), ...(matrix?.costRows ?? [])];
  let cost = 0n;
  let costKnown = tenderLines.length > 0 && tenderLines.every((l) => (l.components ?? []).length > 0);
  for (const row of costed) {
    const c = extendedCentavos(row?.acquire_unit, row?.quantity);
    if (c === null) costKnown = false;
    else cost += c;
  }
  const costTotal = costKnown ? pesosFromCentavos(cost) : null;
  const margin = offerTotal !== null && costTotal !== null ? extended(offerTotal - costTotal, 1) : null;

  const abc = tenderLines.length > 0 && tenderLines.every((l) => l.abc_unit != null)
    ? pesosFromCentavos(tenderLines.reduce((sum, l) => sum + extendedCentavos(l.abc_unit, l.quantity), 0n))
    : null;

  return {
    lines,
    offerTotal,
    unpriced,
    capped,
    cost: costTotal,
    margin,
    marginPercent: margin !== null && offerTotal ? percentOf(margin, offerTotal) : null,
    percentOfAbc: offerTotal !== null && abc ? percentOf(offerTotal, abc) : null,
  };
}

/**
 * One line of the Lines table while a markup is being tried (#931): what it would be offered at and,
 * when that is not a change, why. `played` is the line's `matrixPlay` entry. Returns
 * `{ offerUnit, changes, reason }`; `reason` is one of
 *
 *   "no-acquire"   a part has no Acquire yet (or the line has no part), so it is left as it is
 *   "no-quantity"  the line has no quantity to share the price over, so it is left as it is
 *   "at-abc"       the price is kept at the line's ABC (with a change, it says why it stops there)
 *   "own-markup"   every part keeps a markup of its own, so the factor being tried does not reach it
 *   "same"         it is offered at this price already
 *
 * and null for a plain change.
 */
export function linePreview(line, played, { ignoreOwn = false } = {}) {
  if (!played || played.offerUnit === null) {
    return { offerUnit: null, changes: false, reason: played?.priceTotal == null ? "no-acquire" : "no-quantity" };
  }
  const stored = line?.final_offer_unit == null ? null : Number(line.final_offer_unit);
  const changes = stored === null || Number(played.offerUnit) !== stored;
  if (played.capped) return { offerUnit: played.offerUnit, changes, reason: "at-abc" };
  if (changes) return { offerUnit: played.offerUnit, changes, reason: null };
  const components = line?.components ?? [];
  const allOwn = !ignoreOwn && components.length > 0 && components.every((c) => c?.markup_factor != null);
  return { offerUnit: played.offerUnit, changes, reason: allOwn ? "own-markup" : "same" };
}
