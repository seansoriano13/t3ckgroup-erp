/**
 * The Costing Matrix's figures (#267, spec #266). Pure: no network, no React.
 * The service, the screen, the print and the Stage Condition evaluators all
 * read their numbers from here, so the matrix says one thing everywhere.
 *
 * No decimal library: money is carried as BigInt centavos, and a unit price or
 * a quantity is first read as a number scaled by 10^6, so the product of two
 * decimals is exact. A figure is rounded to the centavo only when it is
 * returned, half away from zero (what the PMS sheet's ROUND does). Figures
 * come back as numbers in pesos with two decimals.
 *
 * Blank is never zero. A figure with a blank input is null; the reason is
 * counted beside it (`missingOffer`, `missingAbc`), never hidden in a total.
 * An input the viewer's tier never received is blank too: the service leaves
 * the key off, and a missing key reads exactly like a null.
 */

const MICRO = 1_000_000n;
// micro-pesos x micro-units = 10^12; a centavo is 10^10 of them.
const CENTAVO = 10_000_000_000n;

/** A number scaled by 10^6 as a BigInt, or null when blank or not a number. */
function scaled(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(String(value).trim());
  if (!Number.isFinite(n)) return null;
  const text = Math.abs(n).toFixed(6);
  const [whole, fraction] = text.split(".");
  const big = BigInt(whole) * MICRO + BigInt(fraction);
  return n < 0 ? -big : big;
}

/** Integer division rounded half away from zero. `divisor` is positive. */
function roundDiv(numerator, divisor) {
  const negative = numerator < 0n;
  const magnitude = negative ? -numerator : numerator;
  const rounded = (magnitude * 2n + divisor) / (divisor * 2n);
  return negative ? -rounded : rounded;
}

/** `unit` per unit times `quantity`, in centavos, or null when either is blank. */
export function extendedCentavos(unit, quantity) {
  const u = scaled(unit);
  const q = scaled(quantity);
  if (u === null || q === null) return null;
  return roundDiv(u * q, CENTAVO);
}

/** Centavos back to pesos, or null. */
export function pesosFromCentavos(centavos) {
  return centavos === null || centavos === undefined ? null : Number(centavos) / 100;
}

/** unit price x quantity in pesos, rounded to the centavo; null when either is blank. */
export function extended(unit, quantity) {
  return pesosFromCentavos(extendedCentavos(unit, quantity));
}

/**
 * `part` as a percentage of `whole`, two decimals (93.13 for 2,980,000 of
 * 3,200,000); null when either is blank or the whole is zero.
 */
export function percentOf(part, whole) {
  const p = scaled(part);
  const w = scaled(whole);
  if (p === null || w === null || w === 0n) return null;
  // hundredths of a percent, rounded half away from zero
  return Number(roundDiv(p * 10_000n, w)) / 100;
}

/**
 * The sum of centavo amounts, or null when there is nothing to sum or any one of them is blank.
 * One blank cost makes the total unknown, not smaller: a missing Acquire must never read as zero.
 */
function sumUnlessBlank(amounts) {
  if (amounts.length === 0 || amounts.some((a) => a === null)) return null;
  return amounts.reduce((total, a) => total + a, 0n);
}

/**
 * A Component's (or a cost-only row's) totals: each unit cost times its quantity, null while that
 * unit cost is blank or the viewer's tier never received it. A bundle is priced as a whole, so a
 * bundle at 1 x 2,160,500 totals 2,160,500.
 */
export function componentTotals(component) {
  return {
    acquireTotal: pesosFromCentavos(extendedCentavos(component?.acquire_unit, component?.quantity)),
    odooTotal: pesosFromCentavos(extendedCentavos(component?.odoo_unit, component?.quantity)),
  };
}

/** Cost-only rows have the same two totals as a Component. */
export const costRowTotals = componentTotals;

/**
 * The totals of a set of cost-only rows (the rows below the Tender Lines): each total is null
 * unless every row has that cost. They are never part of a Tender Line's totals.
 */
export function costRowsTotals(rows) {
  const list = rows ?? [];
  return {
    acquireTotal: pesosFromCentavos(sumUnlessBlank(list.map((r) => extendedCentavos(r?.acquire_unit, r?.quantity)))),
    odooTotal: pesosFromCentavos(sumUnlessBlank(list.map((r) => extendedCentavos(r?.odoo_unit, r?.quantity)))),
  };
}

/**
 * The Final Acquire of a set of Components or cost-only rows added up (#270), or null when there are
 * none or any one has no Final Acquire. Closed Book only: no other tier is sent the figures.
 */
export function finalAcquireTotal(rows) {
  const list = rows ?? [];
  return pesosFromCentavos(sumUnlessBlank(list.map((r) => extendedCentavos(r?.final_acquire_unit, r?.quantity))));
}

/**
 * A Tender Line's totals. `tenderLine` carries `quantity`, and `abc_unit` and
 * `final_offer_unit` when the viewer's tier received them. `components` are the line's Components,
 * each with `quantity` and the unit costs the viewer's tier received (`acquire_unit`, `odoo_unit`).
 * Cost-only rows are not passed here: they stay out of a line's totals.
 *
 *   abcTotal, finalOfferTotal   unit x quantity, null while blank
 *   overAbc                     Final Offer total above ABC total (one centavo is enough)
 *   percentOfAbc                Final Offer total as a percentage of ABC total
 *   acquireTotal, odooTotal     the Components' totals added up; null when the line has no
 *                               Component, or any Component has that cost blank (never zero)
 */
export function lineTotals(tenderLine, components = []) {
  const abc = extendedCentavos(tenderLine?.abc_unit, tenderLine?.quantity);
  const offer = extendedCentavos(tenderLine?.final_offer_unit, tenderLine?.quantity);
  const list = components ?? [];
  return {
    abcTotal: pesosFromCentavos(abc),
    finalOfferTotal: pesosFromCentavos(offer),
    overAbc: abc !== null && offer !== null && offer > abc,
    percentOfAbc: abc !== null && offer !== null ? percentOf(pesosFromCentavos(offer), pesosFromCentavos(abc)) : null,
    acquireTotal: pesosFromCentavos(sumUnlessBlank(list.map((c) => extendedCentavos(c?.acquire_unit, c?.quantity)))),
    odooTotal: pesosFromCentavos(sumUnlessBlank(list.map((c) => extendedCentavos(c?.odoo_unit, c?.quantity)))),
  };
}

/**
 * The whole matrix's totals over its Tender Lines.
 *
 *   finalOfferTotal   the sum, null while any Tender Line has no Final Offer
 *   abcTotal          the sum, null unless every Tender Line has an ABC
 *                     (a government ceiling only means something when it covers every line)
 *   missingOffer      how many Tender Lines have no Final Offer
 *   missingAbc        how many have no ABC
 *   overAbc           the Final Offer total above the ABC total
 *   percentOfAbc      Final Offer as a percentage of ABC
 *
 * No Tender Lines gives nulls and zero counts.
 */
export function matrixTotals(tenderLines) {
  const lines = tenderLines ?? [];
  let abc = 0n;
  let offer = 0n;
  let missingAbc = 0;
  let missingOffer = 0;
  for (const line of lines) {
    const a = extendedCentavos(line?.abc_unit, line?.quantity);
    const o = extendedCentavos(line?.final_offer_unit, line?.quantity);
    if (a === null) missingAbc += 1;
    else abc += a;
    if (o === null) missingOffer += 1;
    else offer += o;
  }
  const abcTotal = lines.length > 0 && missingAbc === 0 ? abc : null;
  const finalOfferTotal = lines.length > 0 && missingOffer === 0 ? offer : null;
  const both = abcTotal !== null && finalOfferTotal !== null;
  return {
    abcTotal: pesosFromCentavos(abcTotal),
    finalOfferTotal: pesosFromCentavos(finalOfferTotal),
    missingAbc,
    missingOffer,
    overAbc: both && finalOfferTotal > abcTotal,
    percentOfAbc: both ? percentOf(pesosFromCentavos(finalOfferTotal), pesosFromCentavos(abcTotal)) : null,
  };
}

/**
 * The summary, copied from the PMS sheet (#270, #213). Closed Book (#319): the caller passes the
 * matrix as shaped from what the tier received, and only the Closed Book tier receives the Final
 * Acquire figures, so only it can compute this; every other tier is given no summary at all.
 *
 *   matrix.tenderLines   each with `quantity`, `final_offer_unit`, `abc_unit` and its `components`
 *                        (each with `quantity` and `final_acquire_unit`)
 *   matrix.costRows      the cost-only rows (`quantity`, `final_acquire_unit`)
 *   matrix.money         `{ marketing, opex }`, typed by Finance access or the Final Acquire list
 *   settings             `{ vatDivisor, taxRate, retentionRate, itrRate, itrAllowance }`
 *
 * Returns, in pesos to the centavo (each worked in exact decimals and rounded half away from zero
 * once, on return):
 *
 *   finalOfferTotal       the Tender Lines' Final Offers added up
 *   vatExclusive          Final Offer / VAT divisor (1.12)
 *   tax                   Final Offer x tax rate (6%), on the gross offer
 *   retention             Final Offer x retention rate (1%)
 *   collected             Final Offer - tax - retention
 *   operationalExpenses   the Final Acquire total (every Component and cost-only row)
 *   marketing, opex       as typed
 *   itr                   (Final Offer - allowance) x ITR rate (8%); negative below the allowance, as the sheet has it
 *   revenue               (Final Offer - Final Acquire total) - ITR
 *   abcTotal, percentOfAbc, overAbc   the ABC ceiling, only when every Tender Line has an ABC
 *
 * A figure that cannot be computed is null and says why in `incomplete`: `missingOffer` Tender Lines
 * have no Final Offer (every offer figure is null), `missingCost` Components and cost-only rows have
 * no Final Acquire (operational expenses and revenue are null). `noTenderLines` and `noCostRows`
 * say the matrix has nothing to add up yet, so an empty matrix never reads as zero cost.
 * A blank is never zero.
 */
export function summary(matrix, settings) {
  const lines = matrix?.tenderLines ?? [];
  const costed = [...lines.flatMap((line) => line?.components ?? []), ...(matrix?.costRows ?? [])];

  const offers = lines.map((line) => extendedCentavos(line?.final_offer_unit, line?.quantity));
  const missingOffer = offers.filter((o) => o === null).length;
  const offer = lines.length > 0 && missingOffer === 0 ? offers.reduce((sum, o) => sum + o, 0n) : null;

  const costs = costed.map((row) => extendedCentavos(row?.final_acquire_unit, row?.quantity));
  const missingCost = costs.filter((c) => c === null).length;
  const acquire = costed.length > 0 && missingCost === 0 ? costs.reduce((sum, c) => sum + c, 0n) : null;

  const divisor = scaled(settings?.vatDivisor);
  const taxRate = scaled(settings?.taxRate);
  const retentionRate = scaled(settings?.retentionRate);
  const itrRate = scaled(settings?.itrRate);
  const allowance = extendedCentavos(settings?.itrAllowance, 1);

  // Rates are scaled by 10^6, so a rate times a centavo amount divides back by 10^6 once.
  const byRate = (centavos, rate) => (centavos === null || rate === null ? null : roundDiv(centavos * rate, MICRO));

  const vatExclusive = offer === null || divisor === null || divisor <= 0n ? null : roundDiv(offer * MICRO, divisor);
  const tax = byRate(offer, taxRate);
  const retention = byRate(offer, retentionRate);
  const collected =
    offer === null || taxRate === null || retentionRate === null ? null : roundDiv(offer * (MICRO - taxRate - retentionRate), MICRO);
  const itr = offer === null || allowance === null || itrRate === null ? null : roundDiv((offer - allowance) * itrRate, MICRO);
  const revenue =
    offer === null || acquire === null || allowance === null || itrRate === null
      ? null
      : roundDiv((offer - acquire) * MICRO - (offer - allowance) * itrRate, MICRO);

  const ceiling = matrixTotals(lines);

  return {
    finalOfferTotal: pesosFromCentavos(offer),
    vatExclusive: pesosFromCentavos(vatExclusive),
    tax: pesosFromCentavos(tax),
    retention: pesosFromCentavos(retention),
    collected: pesosFromCentavos(collected),
    operationalExpenses: pesosFromCentavos(acquire),
    marketing: pesosFromCentavos(extendedCentavos(matrix?.money?.marketing, 1)),
    opex: pesosFromCentavos(extendedCentavos(matrix?.money?.opex, 1)),
    itr: pesosFromCentavos(itr),
    revenue: pesosFromCentavos(revenue),
    abcTotal: ceiling.abcTotal,
    percentOfAbc: ceiling.percentOfAbc,
    overAbc: ceiling.overAbc,
    incomplete: { missingCost, missingOffer, noTenderLines: lines.length === 0, noCostRows: costed.length === 0 },
  };
}

// ---------------------------------------------------------------------------
// Markup (#269)
// ---------------------------------------------------------------------------

/** A blank (null, undefined or empty) is not a number: it never counts as zero. */
const blank = (value) => value === null || value === undefined || value === "";

/**
 * Markup Price per unit: Acquire x factor, rounded half up to the centavo. Null while Acquire or the
 * factor is blank, never zero. The database computes the same figure for the price tier
 * (`costing_markup_price`); a policy test (80) holds the two to the same answers.
 */
export function markupPriceUnit(acquireUnit, factor) {
  const acquire = scaled(acquireUnit);
  const f = scaled(factor);
  if (acquire === null || f === null) return null;
  return pesosFromCentavos(roundDiv(acquire * f, CENTAVO));
}

/**
 * Markup Price for `quantity` units: the per-unit price (already rounded to the centavo, so the price
 * tier, which only receives that, adds up to the same total) times the quantity. Null while Acquire,
 * the factor or the quantity is blank.
 */
export function markupPrice(acquireUnit, quantity, factor) {
  const unit = markupPriceUnit(acquireUnit, factor);
  return unit === null ? null : extended(unit, quantity);
}

/**
 * The factor a row is priced at: its own override, else the matrix default; a cost-only row with no
 * override of its own is x1.00 (pass `costOnly`). Null while neither is known, which includes a viewer
 * whose tier never received the factor. Returns a number.
 */
export function effectiveFactor(row, defaultFactor, { costOnly = false } = {}) {
  const own = scaled(row?.markup_factor);
  if (own !== null) return Number(own) / 1_000_000;
  if (costOnly) return 1;
  const fallback = scaled(defaultFactor);
  return fallback === null ? null : Number(fallback) / 1_000_000;
}

/**
 * A Component's (or cost-only row's) markup figures:
 *
 *   factor       the factor it is priced at (see effectiveFactor), or null
 *   priceUnit    Markup Price per unit. A tier that received the server's figure
 *                (`markup_price_unit`, the price tier's only way in) uses it; otherwise it is worked out
 *                from Acquire and the factor, which only the Closed Book has.
 *   priceTotal   priceUnit x quantity
 *
 * Every figure is null while an input is blank or was never received.
 */
export function componentMarkup(row, defaultFactor, { costOnly = false } = {}) {
  const factor = effectiveFactor(row, defaultFactor, { costOnly });
  const priceUnit =
    row && "markup_price_unit" in row
      ? blank(row.markup_price_unit)
        ? null
        : pesosFromCentavos(extendedCentavos(row.markup_price_unit, 1))
      : markupPriceUnit(row?.acquire_unit, factor);
  return { factor, priceUnit, priceTotal: priceUnit === null ? null : extended(priceUnit, row?.quantity) };
}

/** Factors and ratios come back to four decimals, half up (what numeric(10,4) holds). */
function ratio(numeratorCentavos, denominatorCentavos) {
  if (numeratorCentavos === null || denominatorCentavos === null || denominatorCentavos <= 0n) return null;
  return Number(roundDiv(numeratorCentavos * 10_000n, denominatorCentavos)) / 10_000;
}

/** The one factor shared by every row, else the blend (Markup Price over Acquire); null when unknown. */
function targetOf(markups, priceCentavos, acquireCentavos) {
  if (markups.length === 0 || markups.some((m) => m.factor === null)) return null;
  const distinct = new Set(markups.map((m) => m.factor));
  if (distinct.size === 1) return markups[0].factor;
  return ratio(priceCentavos, acquireCentavos);
}

/**
 * A Tender Line's markup (cost-only rows are never part of it):
 *
 *   priceTotal       the Components' Markup Prices added up; null when the line has no Component or any
 *                    Component's Markup Price is blank
 *   targetFactor     the factor the Markup Price suggests: the one factor every Component shares, else
 *                    the blend (Markup Price total / Acquire total); null when unknown
 *   achievedFactor   Final Offer total / the Components' Acquire total, to four decimals; null while
 *                    either is blank, so only a tier that received both (the Closed Book) has it
 *
 * `tenderLine` carries `quantity` and `final_offer_unit` when the tier received it; `components` are the
 * line's Components with their costs merged in and their `markup` (componentMarkup) attached.
 */
export function lineMarkup(tenderLine, components, defaultFactor) {
  const list = (components ?? []).map((c) => c.markup ?? componentMarkup(c, defaultFactor));
  const price = sumUnlessBlank(list.map((m) => extendedCentavos(m.priceTotal, 1)));
  const acquire = sumUnlessBlank((components ?? []).map((c) => extendedCentavos(c?.acquire_unit, c?.quantity)));
  const offer = extendedCentavos(tenderLine?.final_offer_unit, tenderLine?.quantity);
  return {
    priceTotal: pesosFromCentavos(price),
    targetFactor: targetOf(list, price, acquire),
    achievedFactor: ratio(offer, acquire),
  };
}

/**
 * The whole matrix's markup, counting the cost-only rows (they carry cost and a x1.00 markup but no Final
 * Offer, so they pull the overall figure down and leave every line's alone):
 *
 *   achievedFactor   the Final Offer total / every Component's and cost-only row's Acquire total. Null
 *                    while any Tender Line has no Final Offer or no Component, or any Acquire is blank.
 *   targetFactor     see lineMarkup, over every Component and cost-only row
 *   priceTotal       the Markup Prices of the Tender Lines added up (null while any is blank)
 *
 * `tenderLines` carry their `components` (with `markup`); `costRows` carry `markup` too.
 */
export function matrixMarkup(tenderLines, costRows, defaultFactor) {
  const lines = tenderLines ?? [];
  const rows = costRows ?? [];
  const components = lines.flatMap((l) => l.components ?? []);
  const markups = [
    ...components.map((c) => c.markup ?? componentMarkup(c, defaultFactor)),
    ...rows.map((r) => r.markup ?? componentMarkup(r, defaultFactor, { costOnly: true })),
  ];
  const everyLineCosted = lines.length > 0 && lines.every((l) => (l.components ?? []).length > 0);
  const acquire = everyLineCosted
    ? sumUnlessBlank([...components, ...rows].map((c) => extendedCentavos(c?.acquire_unit, c?.quantity)))
    : null;
  const price = sumUnlessBlank(markups.map((m) => extendedCentavos(m.priceTotal, 1)));
  const offer = sumUnlessBlank(lines.map((l) => extendedCentavos(l?.final_offer_unit, l?.quantity)));
  const linesPrice = sumUnlessBlank(lines.map((l) => extendedCentavos(l?.markup?.priceTotal, 1)));
  return {
    priceTotal: pesosFromCentavos(linesPrice),
    targetFactor: everyLineCosted ? targetOf(markups, price, acquire) : null,
    achievedFactor: ratio(offer, acquire),
  };
}

/** A factor as the percentage over cost it stands for: 1.35 is 35, 0.9 is -10. */
export function percentOver(factor) {
  const f = scaled(factor);
  return f === null ? null : Number(roundDiv((f - MICRO) * 100n, 10_000n)) / 100;
}

/** The Markup Prices of rows that carry a `markup` (componentMarkup) added up; null when there are none or one is blank. */
export function markupPriceSum(rows) {
  return pesosFromCentavos(sumUnlessBlank((rows ?? []).map((r) => extendedCentavos(r?.markup?.priceTotal, 1))));
}
