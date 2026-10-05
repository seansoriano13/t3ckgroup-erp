// Pure and runtime-agnostic: imported by the edge function (Deno) and by the
// frontend test runner. No Deno/Node/browser imports here.
//
// Which Retail Orders the sync re-reads Income Notes for, and how a re-read
// merges into what is stored. Adding a To-Do in Odoo does not change the
// order's change date, so the rolling "changed in the last 30 days" window
// alone never sees a late note (#455).

export interface StoredOrder {
  odoo_so_number: string;
  odoo_so_id: number | null;
  amount: number | string | null;
  order_income: number | string | null;
  marketplace_fee: number | string | null;
  /** Odoo's `sale.order.state`; absent or null on an order stored before it was recorded. */
  odoo_state?: string | null;
}

// Orders Odoo has abandoned. The Retail report counts only `sale` and `done`,
// and a quotation that is later confirmed changes the order's change date, so
// the rolling window reads it again then; nothing is gained re-reading their
// notes every run (#457).
const DEAD_STATES: ReadonlySet<string> = new Set(["cancel", "draft"]);

export function isDeadOrder(order: Pick<StoredOrder, "odoo_state">): boolean {
  return order.odoo_state != null && DEAD_STATES.has(order.odoo_state);
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
 * caller is already reading. Cancelled and draft orders are never re-read.
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
      !isDeadOrder(order) &&
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
