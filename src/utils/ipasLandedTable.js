// The numbers behind the IPAS "Landed cost" table (spec #699, ticket #710, layout M1).
// Landed Cost itself is worked out once, in the database. This only lays its lines out: it splits each
// line's spread into duties, freight and other per unit, and prices an Inventory IPAS (retail,
// wholesale, income after VAT). Nothing here changes a landed figure.

import { blendedRate, finiteNumber, paymentRate, sumPesos } from "./landedCost";

export const DEFAULT_WHOLESALE_DISCOUNT = 30;
const VAT = 1.12;

const cents = (n) => Math.round(n * 100) / 100;
const isDuty = (charge) => /dut/i.test(String(charge?.kindLabel ?? ""));

/**
 * @param ipas the shaped IPAS (landedCost, charges, payments)
 * @returns the table's rows, totals and note, or null while Landed Cost has no lines
 */
export function landedTable(ipas) {
  const lc = ipas?.landedCost;
  if (!lc || !Array.isArray(lc.lines) || lc.lines.length === 0) return null;

  const spreadTotal = sumPesos(lc.lines.map((line) => finiteNumber(line.spreadPhp) ?? 0));
  const freight = finiteNumber(lc.totals?.freightPhp) ?? 0;
  const duties = Math.min(
    spreadTotal,
    sumPesos((ipas.charges ?? []).filter(isDuty).map((charge) => finiteNumber(charge.amount_php) ?? 0)),
  );
  const freightShare = spreadTotal > 0 ? Math.min(freight, spreadTotal - duties) / spreadTotal : 0;
  const dutyShare = spreadTotal > 0 ? duties / spreadTotal : 0;

  const multiplier = finiteNumber(ipas.retail_multiplier);
  const discount = finiteNumber(ipas.wholesale_discount_pct) ?? DEFAULT_WHOLESALE_DISCOUNT;
  const pricing = ipas.purpose === "inventory";

  const goods = finiteNumber(lc.totals?.goodsPhp) ?? 0;
  const rows = lc.lines.map((line, index) => {
    const quantity = finiteNumber(line.quantity) ?? 0;
    const spread = finiteNumber(line.spreadPhp) ?? 0;
    const perUnit = (part) => (quantity > 0 ? cents((spread * part) / quantity) : null);
    const dutiesUnit = perUnit(dutyShare);
    const freightUnit = perUnit(freightShare);
    const otherUnit = quantity > 0 ? cents(spread / quantity - (dutiesUnit ?? 0) - (freightUnit ?? 0)) : null;
    const unitPrice = finiteNumber(line.unitPricePhp);
    const landed = finiteNumber(line.landedPerUnitPhp);
    const retail = pricing && multiplier !== null && unitPrice !== null ? cents(unitPrice * multiplier) : null;
    const wholesale = retail === null ? null : cents(retail * (1 - discount / 100));
    return {
      key: line.lineId ?? index,
      name: line.name,
      quantity,
      unit: line.unit,
      unitPriceForeign: line.unitPriceForeign,
      unitPrice,
      share: goods > 0 ? ((finiteNumber(line.goodsPhp) ?? 0) / goods) * 100 : null,
      duties: dutiesUnit,
      freight: freightUnit,
      other: otherUnit,
      landed,
      retail,
      wholesale,
      income: wholesale === null || landed === null ? null : cents(wholesale / VAT - landed),
    };
  });

  // How far one rate (the first payment's, as the old sheet did) would have been off.
  const payments = ipas.payments ?? [];
  const average = blendedRate(payments);
  const first = paymentRate(payments[0]);
  const goodsForeign = sumPesos(
    lc.lines.map((line) => (finiteNumber(line.unitPriceForeign) ?? 0) * (finiteNumber(line.quantity) ?? 0)),
  );
  const off = lc.isForeign && average !== null && first !== null ? cents(Math.abs(average - first) * goodsForeign) : null;

  return {
    rows,
    pricing,
    multiplier,
    discount,
    totals: {
      units: rows.reduce((sum, row) => sum + row.quantity, 0),
      goodsForeign,
      goodsPhp: goods,
      landedPhp: finiteNumber(lc.totals?.landedPhp),
    },
    note: lc.isForeign && average !== null ? { average, off } : null,
  };
}
