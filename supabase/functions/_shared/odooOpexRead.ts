// Reads one OPEX Report from Odoo (#1244, spec #1241): the S0's Project tags,
// its P0 lines and its expenses. Read-only. The rules live in opexReadMath.ts.
//
// Speed: Odoo answers each call in a few hundred milliseconds, so the calls that
// do not need each other's answers go out together, in four rounds, instead of
// one after another (about 18 calls). The answer is the same either way.
// Each call and each round is timed (stepTimer.ts) so the function logs show
// which part is slow (#1266).

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
import { createStepTimer, type StepTimer } from "./stepTimer.ts";
import { onceUntilFailure } from "./onceUntilFailure.ts";

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

// Odoo lets through about 5 calls a second and queues the rest (#1266), so each
// call saved is about 0.2 s. The Projects plan and its analytic column do not
// change while a function is warm: look them up once. Every read in one function
// signs in as the same Odoo user (authenticateOnce), so the first caller's uid is used.
let projectsPlan: (() => Promise<{ planId: number | null; column: string | null }>) | null = null;
function projectsPlanOnce(uid: number) {
  projectsPlan ??= onceUntilFailure(async () => {
    const planId = await findProjectsPlanId(uid);
    return { planId, column: planId === null ? null : await analyticLinePlanColumn(uid, planId) };
  });
  return projectsPlan();
}

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
      // move_type is the bill's type, carried on its lines, so no second call is needed.
      ["purchase_line_id", "quantity", "balance", "move_type"],
    ]);
    for (const r of rows) {
      const lineId = idOf(r.purchase_line_id);
      if (lineId === null) continue;
      const sign = r.move_type === "in_refund" ? -1 : 1;
      const cur = billed.get(lineId) ?? { qty: 0, pesos: 0 };
      cur.qty += sign * Number(r.quantity || 0);
      cur.pesos += Number(r.balance || 0);
      billed.set(lineId, cur);
    }
  }
  return billed;
}

/** `column` is the analytic line's Projects column (x_plan5_id today), looked up by the caller. */
async function readExpenses(uid: number, tagIds: number[], column: string | null) {
  if (!column) throw new Error("Odoo has no analytic column for the Projects plan.");
  const analytic: Row[] = await executeKw(uid, "account.analytic.line", "search_read", [
    [[column, "in", tagIds]],
    ["id", "date", "name", "amount", "general_account_id", "move_line_id"],
  ]);

  // Each line's journal facts and each account's code do not need each other: read them together.
  const readFacts = async () => {
    const facts = new Map<number, MoveLineFacts>();
    for (const part of chunks(numbers(analytic.map((a) => idOf(a.move_line_id))))) {
      const mls: Row[] = await executeKw(uid, "account.move.line", "read", [part, ["purchase_line_id", "tax_line_id", "move_id"]]);
      const stock = new Map<number, boolean>();
      const moveParts = chunks([...new Set(numbers(mls.map((m) => idOf(m.move_id))))]);
      const moves = await Promise.all(moveParts.map((mp) => executeKw(uid, "account.move", "read", [mp, ["stock_move_id"]]) as Promise<Row[]>));
      for (const mv of moves.flat()) stock.set(mv.id as number, idOf(mv.stock_move_id) !== null);
      for (const m of mls) {
        facts.set(m.id as number, {
          fromPurchaseBill: idOf(m.purchase_line_id) !== null,
          taxLine: idOf(m.tax_line_id) !== null,
          stockValuation: stock.get(idOf(m.move_id) ?? -1) ?? false,
        });
      }
    }
    return facts;
  };
  const readCodes = async () => {
    const codes = new Map<number, string>();
    const accountIds = [...new Set(numbers(analytic.map((a) => idOf(a.general_account_id))))];
    if (accountIds.length) {
      for (const acc of (await executeKw(uid, "account.account", "read", [accountIds, ["code"]])) as Row[]) {
        codes.set(acc.id as number, String(acc.code ?? ""));
      }
    }
    return codes;
  };
  const [facts, codes] = await Promise.all([readFacts(), readCodes()]);

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

export async function readOpexReport(
  uid: number,
  args: { s0: string; handP0s: string[]; vatDivisor: number; timer?: StepTimer },
) {
  const { s0 } = args;
  const timed = (args.timer ?? createStepTimer()).time;
  const handNames = [...new Set(numbersOrNull(args.handP0s))];

  // Round 1: the Projects plan, the S0's own price, the P0s whose Source Document names it, the hand-added P0s.
  const [{ planId, column }, sales, sourceOrders, handOrders] = await timed("round1", () =>
    Promise.all([
      timed("r1.projectsPlan", () => projectsPlanOnce(uid)),
      timed("r1.saleOrder", () =>
        executeKw(uid, "sale.order", "search_read", [[["name", "=", s0]], ["id", "name", "amount_untaxed"]], { limit: 1 }) as Promise<Row[]>,
      ),
      timed("r1.sourceP0s", () => executeKw(uid, "purchase.order", "search_read", [[["origin", "ilike", s0]], ["id", "origin"]]) as Promise<Row[]>),
      handNames.length
        ? timed("r1.handP0s", () => executeKw(uid, "purchase.order", "search_read", [[["name", "in", handNames]], ["id"]]) as Promise<Row[]>)
        : Promise.resolve([] as Row[]),
    ]),
  );
  const odooContractPrice = sales.length ? Math.round(Number(sales[0].amount_untaxed) * args.vatDivisor * 100) / 100 : null;

  // Round 2: the S0's Project tags.
  const tags = await timed("round2", () => findProjectTags(uid, s0, planId));
  const tagIds = tags.map((t) => t.id);
  const onReportIds = new Set<number>([
    ...sourceOrders.filter((o) => mentionsS0(o.origin, s0)).map((o) => o.id as number),
    ...handOrders.map((o) => o.id as number),
  ]);

  // Round 3: P0 lines tagged to the S0, P0 lines on the P0s above, and the expenses.
  // Tried and taken back (#1266): reading the expenses alongside round 4 sent more
  // calls at once, Odoo started answering "try again in 1 second", and a 3 s read
  // took 6–9 s. Keep the expenses here unless Odoo's rate limit is known to allow more.
  const [taggedLines, reportOrderLines, expenses] = await timed("round3", () =>
    Promise.all([
      tagIds.length
        ? timed("r3.taggedLines", () =>
            executeKw(uid, "purchase.order.line", "search_read", [
              [["analytic_distribution", "in", tagIds], ["display_type", "=", false]],
              PO_LINE_FIELDS,
            ]) as Promise<Row[]>,
          )
        : Promise.resolve([] as Row[]),
      onReportIds.size
        ? timed("r3.reportLines", () =>
            executeKw(uid, "purchase.order.line", "search_read", [
              [["order_id", "in", [...onReportIds]], ["display_type", "=", false]],
              PO_LINE_FIELDS,
            ]) as Promise<Row[]>,
          )
        : Promise.resolve([] as Row[]),
      tagIds.length ? timed("r3.expenses", () => readExpenses(uid, tagIds, column)) : Promise.resolve([]),
    ]),
  );

  const byId = new Map<number, Row>();
  for (const l of [...taggedLines, ...reportOrderLines]) byId.set(l.id as number, l);
  const allLines = [...byId.values()];

  // Round 4: each line's P0, its tag shares and what was billed on it.
  const orderIds = [...new Set(numbers(allLines.map((l) => idOf(l.order_id))))];
  const [poRows, shares, billed] = await timed("round4", () =>
    Promise.all([
      orderIds.length
        ? timed("r4.p0s", () =>
            executeKw(uid, "purchase.order", "read", [orderIds, ["name", "state", "partner_id", "currency_rate"]]) as Promise<Row[]>,
          )
        : Promise.resolve([] as Row[]),
      timed("r4.shares", () => sharesForLines(uid, allLines as { id: number; analytic_distribution?: unknown }[])),
      timed("r4.billed", () => readBilled(uid, allLines.map((l) => l.id as number))),
    ]),
  );
  const poById = new Map(poRows.map((p) => [p.id as number, p]));

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
