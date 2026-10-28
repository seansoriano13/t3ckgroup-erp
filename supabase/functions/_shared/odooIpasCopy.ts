// Reads one Odoo purchase order the way an IPAS stores it (#730 moved this out of
// odoo-po-ipas so odoo-po-verify raises an IPAS from the very same read).
//
// What the IPAS stores is this answer, so the shape is `ipas.odoo_copy`'s shape:
// { po, supplier, lines, receipts, bills }. The PO is matched by EXACT name only.
// "Could not check" (not configured, Odoo down, any thrown error) is the verdict
// `unavailable` and never `not_found`.

import {
  authenticate,
  executeKw,
  fetchCustomer,
  findPurchaseOrder,
  isConfigured,
  normalizePoNumber,
} from "./odoo.ts";

// The product's Brand. A Studio selection field on product.template, readable
// through product.product (related, not stored). Read from the live instance
// with `fields_get` on 2026-10-13: x_studio_brand, type "selection", string
// "Brand". If Odoo ever renames it, Brand comes back null and the IPAS still
// raises; the error is logged.
const BRAND_FIELD = "x_studio_brand";

type Row = Record<string, unknown>;

const pairId = (value: unknown) => (Array.isArray(value) ? (value[0] as number) : null);
const pairName = (value: unknown) => (Array.isArray(value) ? String(value[1] ?? "") : "");
const text = (value: unknown) => (typeof value === "string" ? value : "");

// Exact name only: an IPAS must never be raised against a different PO than the one typed.
const ORDER_FIELDS = [
  "id",
  "name",
  "state",
  "company_id",
  "currency_id",
  "origin",
  "partner_ref",
  "partner_id",
  "receipt_status",
  "picking_ids",
  "invoice_ids",
  // The PO's own money (#596): before tax, the tax, and the total Odoo states.
  "amount_untaxed",
  "amount_tax",
  "amount_total",
];

/** Odoo tax ids -> display names, read once for every line. */
async function taxNames(uid: number, ids: number[]) {
  const names = new Map<number, string>();
  if (!ids.length) return names;
  const taxes = await executeKw(uid, "account.tax", "read", [ids, ["name"]]);
  for (const t of taxes) names.set(t.id, String(t.name ?? ""));
  return names;
}

/**
 * `analytic_distribution` is `{ "<id>[,<id>...]": percent }`: a key may join
 * several analytic accounts, one per plan. Returns every account id mentioned.
 */
function analyticIds(distribution: unknown): number[] {
  if (!distribution || typeof distribution !== "object") return [];
  const ids = new Set<number>();
  for (const key of Object.keys(distribution as Row)) {
    for (const part of key.split(",")) {
      const id = Number(part);
      if (Number.isInteger(id) && id > 0) ids.add(id);
    }
  }
  return [...ids];
}

async function analyticNames(uid: number, ids: number[]) {
  const names = new Map<number, string>();
  if (!ids.length) return names;
  const accounts = await executeKw(uid, "account.analytic.account", "read", [ids, ["name"]]);
  for (const a of accounts) names.set(a.id, String(a.name ?? ""));
  return names;
}

/** product.product id -> Brand label, or an empty map when Brand can't be read. */
async function brandsByProduct(uid: number, productIds: number[]) {
  const brands = new Map<number, string>();
  if (!productIds.length) return brands;
  try {
    const products = await executeKw(uid, "product.product", "read", [productIds, [BRAND_FIELD]]);
    // A selection comes back as its key; show the label Odoo shows.
    const meta = await executeKw(uid, "product.template", "fields_get", [[BRAND_FIELD]], {
      attributes: ["selection"],
    });
    const labels = new Map<string, string>(
      ((meta?.[BRAND_FIELD]?.selection as [string, string][]) || []).map(([k, v]) => [k, v]),
    );
    for (const p of products) {
      const key = p[BRAND_FIELD];
      if (typeof key === "string" && key) brands.set(p.id, labels.get(key) || key);
    }
  } catch (err) {
    console.error("odoo-po-ipas: Brand could not be read:", err);
  }
  return brands;
}

async function fetchLines(uid: number, orderId: number) {
  const rows: Row[] = await executeKw(
    uid,
    "purchase.order.line",
    "search_read",
    [
      [["order_id", "=", orderId]],
      [
        "id",
        "display_type",
        "product_id",
        "name",
        "product_qty",
        "qty_received",
        "product_uom",
        "price_unit",
        "price_subtotal",
        "taxes_id",
        "analytic_distribution",
      ],
    ],
    { order: "sequence asc, id asc" },
  );

  // Section and note rows are layout, not items.
  const items = rows.filter((l) => !l.display_type);

  const [taxes, analytics, brands] = await Promise.all([
    taxNames(uid, [...new Set(items.flatMap((l) => (l.taxes_id as number[]) || []))]),
    analyticNames(uid, [...new Set(items.flatMap((l) => analyticIds(l.analytic_distribution)))]),
    brandsByProduct(uid, [...new Set(items.map((l) => pairId(l.product_id)).filter((id): id is number => id !== null))]),
  ]);

  return items.map((l) => {
    const productId = pairId(l.product_id);
    return {
      // purchase.order.line id — what a Requested Item picks (#312).
      line_id: l.id as number,
      product_id: productId,
      name: text(l.name) || pairName(l.product_id),
      quantity: Number(l.product_qty) || 0,
      // What Odoo's receipts have brought in so far (#726): read on every refresh.
      received: Number(l.qty_received) || 0,
      unit: pairName(l.product_uom),
      // Before VAT and withholding: the figure Landed Cost starts from.
      price_unit: Number(l.price_unit) || 0,
      price_subtotal: Number(l.price_subtotal) || 0,
      taxes: ((l.taxes_id as number[]) || []).map((id) => taxes.get(id)).filter(Boolean),
      analytic: analyticIds(l.analytic_distribution)
        .map((id) => analytics.get(id))
        .filter(Boolean),
      brand: productId !== null ? brands.get(productId) || null : null,
    };
  });
}

/** Done and total receipts: the PO's incoming pickings that aren't cancelled. */
async function fetchReceipts(uid: number, order: Row) {
  const ids = (order.picking_ids as number[]) || [];
  const pickings: Row[] = ids.length
    ? await executeKw(uid, "stock.picking", "read", [ids, ["state", "picking_type_code"]])
    : [];
  const receipts = pickings.filter((p) => p.picking_type_code === "incoming" && p.state !== "cancel");
  return {
    // pending | partial | full, or null for a PO with no receipts (services).
    status: typeof order.receipt_status === "string" ? order.receipt_status : null,
    done: receipts.filter((p) => p.state === "done").length,
    total: receipts.length,
  };
}

/**
 * Vendor bills that aren't cancelled, drafts included. `invoice_ids` also holds
 * credit notes and cancelled moves, so each is read for its type and state.
 */
async function fetchBills(uid: number, order: Row) {
  const ids = (order.invoice_ids as number[]) || [];
  const moves: Row[] = ids.length
    ? await executeKw(uid, "account.move", "read", [ids, ["state", "move_type"]])
    : [];
  const bills = moves.filter((m) => m.move_type === "in_invoice" && m.state !== "cancel");
  return {
    count: bills.length,
    draft: bills.filter((m) => m.state === "draft").length,
  };
}

export type Answer =
  | { verdict: "found"; copy: Row }
  | { verdict: "not_found"; message: string }
  | { verdict: "unavailable"; message: string };

/** Asks Odoo for one PO. Never throws: every outcome is a verdict. */
export async function readPo(poNumber: unknown): Promise<Answer> {
  if (!isConfigured()) {
    // Not an outage — the integration was never wired up. "Could not check",
    // never "not found".
    return { verdict: "unavailable", message: "Odoo integration is not configured on the server." };
  }

  const ref = normalizePoNumber(poNumber);
  if (!ref) {
    return {
      verdict: "not_found",
      message: 'Enter a valid PO Number — "P" followed by digits, e.g. P01234.',
    };
  }

  try {
    const uid = await authenticate();
    const order = (await findPurchaseOrder(uid, ref, ORDER_FIELDS)) as Row | null;

    if (!order) {
      return { verdict: "not_found", message: `Odoo has no purchase order named "${ref}".` };
    }

    const [lines, receipts, bills, supplier] = await Promise.all([
      fetchLines(uid, order.id as number),
      fetchReceipts(uid, order),
      fetchBills(uid, order),
      fetchCustomer(uid, order),
    ]);

    return {
      verdict: "found",
      copy: {
        po: {
          id: order.id,
          name: order.name,
          state: order.state,
          company: pairName(order.company_id),
          company_id: pairId(order.company_id),
          currency: pairName(order.currency_id),
          origin: text(order.origin) || null,
          partner_ref: text(order.partner_ref) || null,
          // Stored on the copy so the IPAS can compare it with the P.I/QT Amount
          // (#596). Copies stored before this have none and fall back to the
          // sum of their line subtotals, marked as before tax.
          amount_untaxed: Number(order.amount_untaxed) || 0,
          amount_tax: Number(order.amount_tax) || 0,
          amount_total: Number(order.amount_total) || 0,
        },
        supplier: {
          id: supplier.company_id,
          name: supplier.company || pairName(order.partner_id),
          contact: supplier.contact || null,
        },
        lines,
        receipts,
        bills,
      },
    };
  } catch (err) {
    console.error("odoo-po-ipas error:", err);
    // "Could not check" must never collapse into "not found": the IPAS shows
    // the two differently.
    return { verdict: "unavailable", message: err instanceof Error ? err.message : "Odoo lookup failed." };
  }
}
