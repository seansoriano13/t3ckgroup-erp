// Pure and runtime-agnostic: imported by the edge function (Deno) and by the
// frontend test runner. No Deno/Node/browser imports here.
//
// Which Retail Orders the sync re-reads Income Notes for, and how a re-read
// merges into what is stored. Adding a To-Do in Odoo does not change the
// order's change date, so the rolling "changed in the last 30 days" window
// alone never sees a late note (#455).

import { parseBuyerName, parseIncomeNote } from "./incomeNote.ts";

export interface StoredOrder {
  odoo_so_number: string;
  odoo_so_id: number | null;
  amount: number | string | null;
  order_income: number | string | null;
  marketplace_fee: number | string | null;
}

/**
 * Missing Income (no Order Income) or Suspect Income (income above the Order
 * Amount, or a Marketplace Fee at least the Order Amount). The same rule as
 * `incomeStatus` in src/utils/retailReport.js, which the sync cannot import;
 * a test holds the two together.
 */
export function needsNoteReread(order: Pick<StoredOrder, "amount" | "order_income" | "marketplace_fee">): boolean {
  if (order.order_income == null) return true;
  const amount = Number(order.amount) || 0;
  if (Number(order.order_income) > amount) return true;
  return order.marketplace_fee != null && Number(order.marketplace_fee) >= amount;
}

/**
 * The stored orders to re-read notes for: those still lacking a trustworthy
 * income (Missing or Suspect), and any whose notes Odoo says were touched
 * (`touchedOdooIds`), so an edited note on an otherwise OK order is caught. An
 * order with no Odoo id cannot be looked up, and `skipOdooIds` are the ones the
 * caller is already reading.
 */
export function selectRereadOrders<T extends StoredOrder>(
  stored: T[],
  touchedOdooIds: ReadonlySet<number> = new Set(),
  skipOdooIds: ReadonlySet<number> = new Set(),
): T[] {
  return stored.filter(
    (order) =>
      order.odoo_so_id != null &&
      !skipOdooIds.has(order.odoo_so_id) &&
      (touchedOdooIds.has(order.odoo_so_id) || needsNoteReread(order)),
  );
}

/** The columns an Income Note and its sibling notes fill in. */
export interface NoteValues {
  buyer_name: string | null;
  marketplace_order_id: string | null;
  marketplace_fee: number | null;
  order_income: number | null;
}

export interface ReadNoteFacts {
  buyer: string | null;
  marketplaceOrderId: string | null;
  marketplaceFee: number | null;
  orderIncome: number | null;
}

/**
 * Fold one note's text into an order's note facts, returning the new facts
 * (`facts` is `undefined` before any note was read; non-text content is skipped).
 *
 * The buyer is the first NAME found. Marketplace Order ID and fee are kept
 * whenever a note has them, with or without an Order Income, so a Missing order
 * can still be searched by ID and chased with its fee (#456). The first note that
 * yields an Order Income is authoritative for the fee: it supplies the income and
 * the fee it states (null if it states none), never one borrowed from another
 * note, so an OK order's figures are what they were. Its ID wins too, unless it
 * has none, in which case an earlier note's ID stands. Once an income is read,
 * later notes change nothing.
 */
export function foldNoteFacts(
  facts: ReadNoteFacts | undefined,
  content: unknown,
  orderAmount: number,
): ReadNoteFacts | undefined {
  if (typeof content !== "string") return facts;
  const next: ReadNoteFacts = {
    buyer: null,
    marketplaceOrderId: null,
    marketplaceFee: null,
    orderIncome: null,
    ...facts,
  };
  if (next.buyer === null) {
    const match = toPlainText(content).match(/NAME:?\s*([^\n]+)/i);
    if (match) next.buyer = match[1].trim();
  }
  if (next.orderIncome !== null) return next;
  const parsed = parseIncomeNote(content, orderAmount);
  if (parsed.orderIncome !== null) {
    next.orderIncome = parsed.orderIncome;
    next.marketplaceOrderId = parsed.marketplaceOrderId ?? next.marketplaceOrderId;
    next.marketplaceFee = parsed.marketplaceFee;
  } else {
    next.marketplaceOrderId ??= parsed.marketplaceOrderId;
    next.marketplaceFee ??= parsed.marketplaceFee;
  }
  return next;
}

/**
 * Keep what we already know: a value found once is not erased by a later read
 * whose notes have since changed. A newly read non-null value overwrites, which
 * is how a corrected note corrects the figure. A read zero is a value.
 */
export function keepKnownValues(
  prior: Partial<NoteValues> | null | undefined,
  fact: ReadNoteFacts | undefined,
): NoteValues {
  return {
    buyer_name: fact?.buyer ?? prior?.buyer_name ?? null,
    marketplace_order_id: fact?.marketplaceOrderId ?? prior?.marketplace_order_id ?? null,
    marketplace_fee: fact?.marketplaceFee ?? prior?.marketplace_fee ?? null,
    order_income: fact?.orderIncome ?? prior?.order_income ?? null,
  };
}

// Postgres hands a timestamptz back as "...+00:00" where the sync writes "...Z":
// the same instant, so compare instants, not spellings.
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

function sameValue(a: unknown, b: unknown): boolean {
  if (a == null || b == null) return a == null && b == null;
  if (typeof a === "string" && typeof b === "string") {
    if (TIMESTAMP.test(a) && TIMESTAMP.test(b)) return new Date(a).getTime() === new Date(b).getTime();
    return a === b;
  }
  if (typeof a === "object" || typeof b === "object") return JSON.stringify(a) === JSON.stringify(b);
  // numeric columns can arrive as numbers or as numeric strings
  return Number(a) === Number(b);
}

/**
 * What a write would change. `null` when the stored row already holds every
 * value, so the row is left alone (no churn, no change signal for the Retail
 * screen); the whole row when it is not stored yet; otherwise only the
 * differing columns.
 */
export function changedColumns<T extends Record<string, unknown>>(
  prior: T | null | undefined,
  next: T,
): Partial<T> | null {
  if (!prior) return next;
  const changed: Partial<T> = {};
  for (const key of Object.keys(next) as (keyof T)[]) {
    if (!sameValue(prior[key], next[key])) changed[key] = next[key];
  }
  return Object.keys(changed).length === 0 ? null : changed;
}
