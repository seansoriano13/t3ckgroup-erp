// Which Odoo P0s to offer when Purchasing attaches one to a product line (#684).
//
// Pure functions over rows already read from Odoo, so the ranking is tested
// without Odoo. Odoo's own sale-line link on P0 lines is never filled, so the
// P0's Source Document text (purchase.order.origin) is the only link to an S0
// or a Direct request's PR number.

export type OdooP0Line = {
  /** Odoo's purchase.order.line id; what "Pick PO line…" stores in odoo_po_line_ids. */
  id?: number | null;
  product_id: number | null;
  product_name: string;
  quantity: number;
  received: number;
  price_unit?: number | null;
};

export type OdooP0 = {
  name: string;
  state: string;
  origin: string | null;
  date_order?: string | null;
  /** Odoo's Expected Arrival (YYYY-MM-DD); often only the order date, or not set. */
  date_planned?: string | null;
  /** The P0's currency in Odoo ("PHP", "USD"); its line prices are in it. */
  currency?: string | null;
  lines: OdooP0Line[];
};

// An S0 ("S01237") or a Purchase Request number ("PR_0042"), not glued to other
// letters or digits. A Source Document is free text, so it may hold several.
const REFERENCE_PATTERN = /(?<![A-Za-z0-9_])(S\d+|PR_\d+)(?![A-Za-z0-9_])/gi;

/** Every S0 or PR number a Source Document names, upper-cased. A typo names none. */
export function referencesIn(origin: string | null | undefined): string[] {
  const found = String(origin ?? "").match(REFERENCE_PATTERN) ?? [];
  return [...new Set(found.map((r) => r.toUpperCase()))];
}

/** Whether a P0's Source Document names `reference` (an S0 or PR number), among any others. */
export function namesReference(origin: string | null | undefined, reference: string): boolean {
  const wanted = String(reference ?? "").trim().toUpperCase();
  return !!wanted && referencesIn(origin).includes(wanted);
}

// A cancelled P0 is never offered; there is nothing to attach to.
const OFFERED = (p0: OdooP0) => p0.state !== "cancel";

// Newest first; the P0 number breaks a tie so the order never jumps about.
const newestFirst = (a: OdooP0, b: OdooP0) =>
  String(b.date_order ?? "").localeCompare(String(a.date_order ?? "")) || b.name.localeCompare(a.name);

/**
 * The P0s to offer for one line.
 *
 * Only P0s whose Source Document names `reference` are offered. Those with a
 * line for the same Odoo product as the product line (`productId`) are
 * `suggested`; the rest are `others` (a P0 for a different product than the
 * one asked). A line with no Odoo product has no suggestions.
 */
export function rankP0Suggestions(
  { reference, productId, p0s }: { reference: string; productId: number | null; p0s: OdooP0[] },
): { suggested: OdooP0[]; others: OdooP0[] } {
  const named = p0s.filter((p0) => OFFERED(p0) && namesReference(p0.origin, reference)).sort(newestFirst);
  const sameProduct = (p0: OdooP0) =>
    productId != null && p0.lines.some((line) => line.product_id === productId);
  return {
    suggested: named.filter(sameProduct),
    others: named.filter((p0) => !sameProduct(p0)),
  };
}

export type P0Facts = {
  state: "rfq" | "confirmed";
  bought_as: string | null;
  /** #688: the Odoo product id behind bought_as, to tell when a new S0 line is the same product. */
  bought_product_id: number | null;
  ordered: number;
  received: number;
  /** Odoo's Expected Arrival, or null when not set (#685). */
  eta: string | null;
};

// Odoo's states before the P0 is confirmed.
const RFQ_STATES = new Set(["draft", "sent", "to approve"]);

/**
 * The P0 lines that bought a product line. A P0 may list one product on several lines
 * (one per project, or free items at price 0), so the figures are summed over them:
 *  - the lines Purchasing picked ("Pick PO line…", `pickedLineIds`), when any are on this P0;
 *  - else every line for the line's own Odoo product;
 *  - else, when the line has no product (an Other request asked in words) or the P0 is for
 *    another product, the P0's lines when they are all one product;
 *  - else none: the P0 holds several other products and nobody picked one.
 */
export function boughtLines(p0: OdooP0, productId: number | null, pickedLineIds: number[] = []): OdooP0Line[] {
  const picked = p0.lines.filter((l) => l.id != null && pickedLineIds.includes(l.id));
  if (picked.length) return picked;
  const own = productId != null ? p0.lines.filter((l) => l.product_id === productId) : [];
  if (own.length) return own;
  const products = new Set(p0.lines.map((l) => l.product_id ?? l.product_name));
  return products.size === 1 ? p0.lines : [];
}

const sum = (lines: OdooP0Line[], key: "quantity" | "received") =>
  lines.reduce((total, l) => total + (Number(l[key]) || 0), 0);

/**
 * #790: a line is covered by what the item NEEDS, not by what the P0 happens to order. A P0 that
 * orders 2 of a needed 10 reads "2 of 10", never "2 of 2 / Received". With no bought line the figure
 * stays 0 (the line waits for Purchasing to pick it).
 */
function orderedFor(ordered: number, needed: number | null): number {
  const need = Number(needed);
  return ordered > 0 && need > ordered ? need : ordered;
}

/**
 * What the line takes from a P0 as it stands in Odoo, over the lines that bought it
 * (boughtLines). With none, ordered and received are 0, so the line stays Purchased until
 * Purchasing picks its line. Null for a cancelled P0, which cannot be attached.
 */
export function p0Facts(
  p0: OdooP0,
  productId: number | null,
  pickedLineIds: number[] = [],
  needed: number | null = null,
): P0Facts | null {
  if (p0.state === "cancel") return null;
  const lines = boughtLines(p0, productId, pickedLineIds);
  const names = [...new Set(lines.map((l) => l.product_name).filter(Boolean))];
  const productIds = [...new Set(lines.map((l) => l.product_id))];
  return {
    state: RFQ_STATES.has(p0.state) ? "rfq" : "confirmed",
    bought_as: names.join(", ") || null,
    bought_product_id: productIds.length === 1 ? productIds[0] ?? null : null,
    ordered: orderedFor(sum(lines, "quantity"), needed),
    received: sum(lines, "received"),
    eta: p0.date_planned ? String(p0.date_planned).slice(0, 10) : null,
  };
}

/** The status a line takes from a P0 (the rule of the spec: RFQ stays To purchase). */
export function statusFromP0(facts: P0Facts): "to_purchase" | "purchased" | "received" {
  if (facts.state === "rfq") return "to_purchase";
  return facts.ordered > 0 && facts.received >= facts.ordered ? "received" : "purchased";
}

/**
 * The unit price this product line was bought at (the Actual cost, #686), in the P0's own
 * currency, which may not be pesos: the database turns a foreign one into pesos. Over the same
 * lines as p0Facts, weighted by quantity, so free lines (price 0) lower it whatever their order.
 * The price is null when those lines have no price or no quantity; the currency is null when
 * Odoo did not say, and is never assumed to be PHP.
 */
export function p0UnitPrice(
  p0: OdooP0,
  productId: number | null,
  pickedLineIds: number[] = [],
): { price: number | null; currency: string | null } {
  const priced = boughtLines(p0, productId, pickedLineIds).filter(
    (l) => l.price_unit != null && Number.isFinite(Number(l.price_unit)),
  );
  const quantity = sum(priced, "quantity");
  return {
    price: quantity
      ? priced.reduce((total, l) => total + Number(l.price_unit) * (Number(l.quantity) || 0), 0) / quantity
      : null,
    currency: p0.currency ? String(p0.currency).trim().toUpperCase() || null : null,
  };
}
