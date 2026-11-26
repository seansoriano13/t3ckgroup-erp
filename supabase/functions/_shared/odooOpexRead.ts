// Reads one OPEX Report from Odoo (#1244, spec #1241): the S0's Project tags,
// its P0 lines and its expenses. Read-only. The rules live in opexReadMath.ts.

import { executeKw, normalizePoNumber } from "./odoo.ts";
import {
  analyticLinePlanColumn,
  findProjectsPlanId,
  findProjectTags,
  mentionsS0,
  sharesForLines,
} from "./odooProjectTags.ts";
import {
  costFromAnalyticAmount,
  countsAsExpense,
  expenseGroup,
  readP0Line,
  type MoveLineFacts,
} from "./opexReadMath.ts";

type Row = Record<string, unknown>;

const idOf = (v: unknown): number | null => (Array.isArray(v) ? (v[0] as number) : typeof v === "number" ? v : null);
const labelOf = (v: unknown): string => (Array.isArray(v) ? String(v[1] ?? "") : "");
const chunks = <T>(list: T[], size = 200): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
};
const numbers = (list: (number | null)[]): number[] => list.filter((v): v is number => v !== null);

const PO_LINE_FIELDS = ["id", "order_id", "name", "product_id", "product_qty", "price_unit", "analytic_distribution"];

/** "S06637 DRR Life Saving ..." -> "DRR Life Saving ..." */
export function projectNameFromTag(tag: string, s0: string): string {
  return tag.replace(new RegExp("^\\s*" + s0 + "\\s*[-:]?\\s*", "i"), "").trim() || tag;
}

async function readBilled(uid: number, lineIds: number[]) {
  const billed = new Map<number, { qty: number; pesos: number }>();
  for (const part of chunks(lineIds)) {
    const rows: Row[] = await executeKw(uid, "account.move.line", "search_read", [
      [
        ["purchase_line_id", "in", part],
        ["parent_state", "=", "posted"],
        ["move_id.move_type", "in", ["in_invoice", "in_refund"]],
      ],
      ["purchase_line_id", "quantity", "balance", "move_id"],
    ]);
    const moveTypes = new Map<number, string>();
    for (const mp of chunks([...new Set(numbers(rows.map((r) => idOf(r.move_id))))])) {
      for (const m of (await executeKw(uid, "account.move", "read", [mp, ["move_type"]])) as Row[]) {
        moveTypes.set(m.id as number, String(m.move_type));
      }
    }
    for (const r of rows) {
      const lineId = idOf(r.purchase_line_id);
      if (lineId === null) continue;
      const sign = moveTypes.get(idOf(r.move_id) ?? -1) === "in_refund" ? -1 : 1;
      const cur = billed.get(lineId) ?? { qty: 0, pesos: 0 };
      cur.qty += sign * Number(r.quantity || 0);
      cur.pesos += Number(r.balance || 0);
      billed.set(lineId, cur);
    }
  }
  return billed;
}

async function readExpenses(uid: number, tagIds: number[]) {
  const planId = await findProjectsPlanId(uid);
  const column = planId === null ? null : await analyticLinePlanColumn(uid, planId);
  if (!column) throw new Error("Odoo has no analytic column for the Projects plan.");
  const analytic: Row[] = await executeKw(uid, "account.analytic.line", "search_read", [
    [[column, "in", tagIds]],
    ["id", "date", "name", "amount", "general_account_id", "move_line_id"],
  ]);

  const facts = new Map<number, MoveLineFacts>();
  for (const part of chunks(numbers(analytic.map((a) => idOf(a.move_line_id))))) {
    const mls: Row[] = await executeKw(uid, "account.move.line", "read", [part, ["purchase_line_id", "tax_line_id", "move_id"]]);
    const stock = new Map<number, boolean>();
    for (const mp of chunks([...new Set(numbers(mls.map((m) => idOf(m.move_id))))])) {
      for (const mv of (await executeKw(uid, "account.move", "read", [mp, ["stock_move_id"]])) as Row[]) {
        stock.set(mv.id as number, idOf(mv.stock_move_id) !== null);
      }
    }
    for (const m of mls) {
      facts.set(m.id as number, {
        fromPurchaseBill: idOf(m.purchase_line_id) !== null,
        taxLine: idOf(m.tax_line_id) !== null,
        stockValuation: stock.get(idOf(m.move_id) ?? -1) ?? false,
      });
    }
  }

  const codes = new Map<number, string>();
  const accountIds = [...new Set(numbers(analytic.map((a) => idOf(a.general_account_id))))];
  if (accountIds.length) {
    for (const acc of (await executeKw(uid, "account.account", "read", [accountIds, ["code"]])) as Row[]) {
      codes.set(acc.id as number, String(acc.code ?? ""));
    }
  }

  return analytic
    .filter((a) => countsAsExpense(Number(a.amount), facts.get(idOf(a.move_line_id) ?? -1) ?? null))
    .map((a) => {
      const accountId = idOf(a.general_account_id);
      const code = accountId === null ? "" : codes.get(accountId) ?? "";
      return {
        analyticLineId: a.id as number,
        date: a.date ? String(a.date) : null,
        description: String(a.name ?? ""),
        account: labelOf(a.general_account_id),
        accountCode: code,
        amount: costFromAnalyticAmount(Number(a.amount)),
        group: expenseGroup(code),
      };
    })
    .sort((x, y) => String(x.date).localeCompare(String(y.date)) || x.analyticLineId - y.analyticLineId);
}

export async function readOpexReport(uid: number, args: { s0: string; handP0s: string[]; vatDivisor: number }) {
  const { s0 } = args;
  const handNames = [...new Set(numbersOrNull(args.handP0s))];

  const tags = await findProjectTags(uid, s0);
  const tagIds = tags.map((t) => t.id);

  // The S0's own price.
  const sales: Row[] = await executeKw(uid, "sale.order", "search_read", [[["name", "=", s0]], ["id", "name", "amount_untaxed"]], { limit: 1 });
  const odooContractPrice = sales.length ? Math.round(Number(sales[0].amount_untaxed) * args.vatDivisor * 100) / 100 : null;

  // P0 lines: tagged to the S0, on a P0 whose Source Document names it, or on a hand-added P0.
  const taggedLines: Row[] = tagIds.length
    ? await executeKw(uid, "purchase.order.line", "search_read", [
        [["analytic_distribution", "in", tagIds], ["display_type", "=", false]],
        PO_LINE_FIELDS,
      ])
    : [];
  const sourceOrders: Row[] = await executeKw(uid, "purchase.order", "search_read", [[["origin", "ilike", s0]], ["id", "origin"]]);
  const handOrders: Row[] = handNames.length
    ? await executeKw(uid, "purchase.order", "search_read", [[["name", "in", handNames]], ["id"]])
    : [];
  const onReportIds = new Set<number>([
    ...sourceOrders.filter((o) => mentionsS0(o.origin, s0)).map((o) => o.id as number),
    ...handOrders.map((o) => o.id as number),
  ]);
  const reportOrderLines: Row[] = onReportIds.size
    ? await executeKw(uid, "purchase.order.line", "search_read", [
        [["order_id", "in", [...onReportIds]], ["display_type", "=", false]],
        PO_LINE_FIELDS,
      ])
    : [];

  const byId = new Map<number, Row>();
  for (const l of [...taggedLines, ...reportOrderLines]) byId.set(l.id as number, l);
  const allLines = [...byId.values()];

  const orderIds = [...new Set(numbers(allLines.map((l) => idOf(l.order_id))))];
  const poRows: Row[] = orderIds.length
    ? await executeKw(uid, "purchase.order", "read", [orderIds, ["name", "state", "partner_id", "currency_rate"]])
    : [];
  const poById = new Map(poRows.map((p) => [p.id as number, p]));
  const shares = await sharesForLines(uid, allLines as { id: number; analytic_distribution?: unknown }[]);
  const billed = await readBilled(uid, allLines.map((l) => l.id as number));

  const lines = allLines
    .map((l) => {
      const orderId = idOf(l.order_id) ?? -1;
      const po = poById.get(orderId) ?? {};
      const lineShares = shares.get(l.id as number) ?? [];
      const b = billed.get(l.id as number) ?? { qty: 0, pesos: 0 };
      const read = readP0Line(
        {
          state: String(po.state ?? ""),
          shares: lineShares,
          onReport: onReportIds.has(orderId),
          quantity: Number(l.product_qty || 0),
          priceUnit: Number(l.price_unit || 0),
          billedQty: b.qty,
          billedPesos: b.pesos,
          currencyRate: Number(po.currency_rate) || 1,
        },
        s0,
      );
      return {
        lineId: l.id as number,
        p0: String(po.name ?? labelOf(l.order_id)),
        supplier: labelOf(po.partner_id),
        p0State: String(po.state ?? ""),
        product: labelOf(l.product_id) || String(l.name ?? ""),
        quantity: Number(l.product_qty || 0),
        sharePercent: read.sharePercent,
        pesos: read.pesos,
        countedPesos: read.countedPesos,
        marks: read.marks,
      };
    })
    .sort((a, b) => a.p0.localeCompare(b.p0) || a.lineId - b.lineId);

  const expenses = tagIds.length ? await readExpenses(uid, tagIds) : [];

  return {
    s0,
    tags,
    noProjectTag: tags.length === 0,
    projectName: tags.length ? projectNameFromTag(tags[0].name, s0) : null,
    odooContractPrice,
    saleOrderFound: sales.length > 0,
    lines,
    expenses,
  };
}

function numbersOrNull(names: string[]): string[] {
  return names.map((p) => normalizePoNumber(p)).filter((p): p is string => !!p);
}
