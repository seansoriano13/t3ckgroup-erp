// Which Odoo P0s to offer when Purchasing attaches one to a product line (#684).
//
// Pure functions over rows already read from Odoo, so the ranking is tested
// without Odoo. Odoo's own sale-line link on P0 lines is never filled, so the
// P0's Source Document text (purchase.order.origin) is the only link to an S0
// or a Direct request's PR number.

export type OdooP0Line = {
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
  ordered: number;
  received: number;
  /** Odoo's Expected Arrival, or null when not set (#685). */
  eta: string | null;
};

// Odoo's states before the P0 is confirmed.
const RFQ_STATES = new Set(["draft", "sent", "to approve"]);

/**
 * What the line takes from a P0 as it stands in Odoo. The P0 line for the
 * line's own product is used; when the P0 is for another product, its first
 * line is. Null for a cancelled P0, which cannot be attached.
 */
export function p0Facts(p0: OdooP0, productId: number | null): P0Facts | null {
  if (p0.state === "cancel") return null;
  const line =
    (productId != null ? p0.lines.find((l) => l.product_id === productId) : undefined) ?? p0.lines[0];
  return {
    state: RFQ_STATES.has(p0.state) ? "rfq" : "confirmed",
    bought_as: line?.product_name || null,
    ordered: Number(line?.quantity) || 0,
    received: Number(line?.received) || 0,
    eta: p0.date_planned ? String(p0.date_planned).slice(0, 10) : null,
  };
}

/** The status a line takes from a P0 (the rule of the spec: RFQ stays To purchase). */
export function statusFromP0(facts: P0Facts): "to_purchase" | "purchased" | "received" {
  if (facts.state === "rfq") return "to_purchase";
  return facts.ordered > 0 && facts.received >= facts.ordered ? "received" : "purchased";
}

/**
 * The unit price on the P0 line that bought this product line's product (the Actual cost, #686).
 * Same line choice as p0Facts. Null when the line has no price.
 */
export function p0UnitPrice(p0: OdooP0, productId: number | null): number | null {
  const line =
    (productId != null ? p0.lines.find((l) => l.product_id === productId) : undefined) ?? p0.lines[0];
  const price = line?.price_unit;
  return price == null || !Number.isFinite(Number(price)) ? null : Number(price);
}
