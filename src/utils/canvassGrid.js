import { DEFAULT_CURRENCY, MIN_CANVASS_OFFERS } from "../constants/canvass";
import { ITEM_STATUS } from "../constants/purchaseRequest";
import { canvassState, lineLocked, lineState, suppliersCovered, CANVASS_STATE, CANVASS_STATE_LABEL } from "./canvassStatus";
import { offerCurrency } from "./canvassMath";
import { extended } from "./costingMath";

/**
 * What the Canvass grid draws (#970, spec #956): the Purchase Request's lines down, the Canvass's
 * suppliers across, and in each place where they meet the supplier's answer on that line. Pure: no
 * network, no React. `items` are the request's lines, `canvass` is what `canvassService.get` reads
 * (or null when no supplier has been added yet), `unlockedIds` the lines a Super Admin unlocked.
 *
 * Money follows the service: for a reader who may not see it the quotes and suppliers carry no
 * price keys at all, so the totals, the PHP figures and the cheapest mark are simply not worked
 * out (`canReadMoney` false). Nothing here asks who the reader is.
 *
 * Every figure that depends on a price comes from utils/canvassMath and costingMath, so the grid,
 * the print and the list agree. The comparison currency is PHP: the cheapest quote on a line is
 * the lowest PHP figure, which for a foreign supplier is its price times its comparison rate.
 */

const hasKey = (row, key) => Object.prototype.hasOwnProperty.call(row ?? {}, key);

const blank = (value) => value === null || value === undefined || value === "";

/** The lines the grid shows, in the order given: a cancelled line has no Canvass, so it is left out. */
export const gridItems = (items = []) => (Array.isArray(items) ? items : []).filter((i) => i?.status !== ITEM_STATUS.CANCELLED);

/** A supplier's column: what its header says. `rate` and `rateMissing` exist only where money is visible. */
function supplierColumn(supplier, canReadMoney) {
  const currency = offerCurrency(supplier);
  const foreign = currency !== DEFAULT_CURRENCY;
  const column = {
    id: supplier.id,
    name: supplier.supplier_name || "Unnamed supplier",
    currency,
    foreign,
    validUntil: supplier.valid_until ?? null,
    expired: Boolean(supplier.expired),
    leadTime: supplier.lead_time ?? null,
    qualityNote: supplier.quality_note ?? null,
    odooSupplierId: supplier.odoo_supplier_id ?? null,
    rate: null,
    rateMissing: false,
  };
  if (canReadMoney && foreign) {
    column.rate = hasKey(supplier, "comparison_rate") ? supplier.comparison_rate : null;
    column.rateMissing = blank(column.rate);
  }
  return column;
}

/** One place of the grid: the supplier's answer on one line, or an empty cell (it did not quote). */
function gridCell({ supplier, quote, item, canReadMoney }) {
  const cell = {
    supplierId: supplier.id,
    quote: quote ?? null,
    quoted: Boolean(quote),
    unitPrice: null,
    total: null,
    phpFigure: null,
    cheapest: false,
    winner: false,
  };
  if (!quote || !canReadMoney) return cell;
  cell.unitPrice = hasKey(quote, "unit_price") ? quote.unit_price : null;
  cell.total = blank(cell.unitPrice) ? null : extended(cell.unitPrice, item.quantity);
  cell.phpFigure = hasKey(quote, "php_figure") ? quote.php_figure : null;
  return cell;
}

/**
 * The lowest PHP figure on a line, marked on every quote that has it. Needs two priced quotes: a
 * lone quote is not "cheaper" than anything.
 */
function markCheapest(cells) {
  const priced = cells.filter((c) => c.phpFigure !== null && c.phpFigure !== undefined);
  if (priced.length < 2) return;
  const lowest = Math.min(...priced.map((c) => Number(c.phpFigure)));
  for (const cell of priced) cell.cheapest = Number(cell.phpFigure) === lowest;
}

/**
 * The grid for a request: `{ suppliers, lines, strip, covered, canReadMoney, state }`.
 *
 *   suppliers   one column per supplier, in the Canvass's order
 *   lines       one row per open line: `{ item, id, state, locked, cells, winner, quotedCount }`,
 *               where `winner` is `{ supplier, reason, chosenAt }` or null, and each cell is
 *               `{ supplierId, quote, quoted, unitPrice, total, phpFigure, cheapest, winner }`
 *   strip       the header strip: `{ suppliersText, linesText, supplierCount, winnerCount,
 *               lineCount, note }`, where `note` is the "No other supplier" row or null
 *   covered     whether a winner may be picked (three suppliers, or a note)
 */
export function buildCanvassGrid({ items = [], canvass = null, unlockedIds = new Set() } = {}) {
  const canReadMoney = Boolean(canvass?.canReadMoney);
  const suppliersRaw = canvass?.suppliers ?? [];
  const quotes = canvass?.quotes ?? [];
  const winners = canvass?.winners ?? [];
  const note = canvass?.noOtherSupplier ?? null;
  const unlocked = unlockedIds instanceof Set ? unlockedIds : new Set(unlockedIds);

  const suppliers = suppliersRaw.map((s) => supplierColumn(s, canReadMoney));
  const covered = suppliersCovered(suppliers.length, Boolean(note));
  const quoteOf = new Map(quotes.map((q) => [`${q.supplier_id}:${q.item_id}`, q]));
  const winnerOf = new Map(winners.map((w) => [w.item_id, w]));
  const supplierById = new Map(suppliers.map((s) => [s.id, s]));

  const lines = gridItems(items).map((item) => {
    const cells = suppliers.map((supplier) =>
      gridCell({ supplier, quote: quoteOf.get(`${supplier.id}:${item.id}`), item, canReadMoney }),
    );
    markCheapest(cells);

    const row = winnerOf.get(item.id) ?? null;
    const winnerSupplier = row ? supplierById.get(row.supplier_id) ?? null : null;
    for (const cell of cells) cell.winner = Boolean(row) && cell.supplierId === row.supplier_id;

    const isUnlocked = unlocked.has(item.id);
    return {
      item,
      id: item.id,
      state: lineState({ item, winner: row, covered, unlocked: isUnlocked }),
      locked: lineLocked(item, isUnlocked),
      unlocked: isUnlocked,
      quotedCount: cells.filter((c) => c.quoted).length,
      cells,
      winner: row ? { supplier: winnerSupplier, supplierId: row.supplier_id, reason: row.reason ?? "", chosenAt: row.chosen_at ?? null } : null,
    };
  });

  const winnerCount = lines.filter((l) => l.winner).length;
  const state = canvassState({
    lines: lines.map((l) => ({ item: l.item, winner: l.winner, unlocked: l.unlocked })),
    covered,
  });

  return {
    suppliers,
    lines,
    covered,
    canReadMoney,
    state,
    stateLabel: CANVASS_STATE_LABEL[state],
    strip: {
      supplierCount: suppliers.length,
      lineCount: lines.length,
      winnerCount,
      suppliersText: `${suppliers.length} of ${MIN_CANVASS_OFFERS} suppliers`,
      linesText: `${winnerCount} of ${lines.length} ${lines.length === 1 ? "line has" : "lines have"} a winner`,
      note,
    },
  };
}

/**
 * Why a winner can't be picked on this line from this cell, or null when it can. The database
 * enforces all of it; this only says it before the click.
 */
export function pickBlockedReason(grid, line, cell) {
  if (line.state === CANVASS_STATE.CANCELLED) return "This line is cancelled.";
  if (line.locked) return "This line is Purchased, so its winner can't change. A Super Admin can unlock it.";
  if (!cell?.quoted) return "This supplier did not quote this line.";
  if (!grid.covered) {
    return grid.suppliers.length === 0
      ? "Add a supplier first."
      : `A winner needs ${MIN_CANVASS_OFFERS} suppliers, or a "No other supplier" note.`;
  }
  return null;
}

/** Why "this supplier wins every line" is off for a supplier, or null. */
export function pickAllBlockedReason(grid, supplierId) {
  if (!grid.covered) {
    return `A winner needs ${MIN_CANVASS_OFFERS} suppliers, or a "No other supplier" note.`;
  }
  const quotesPickable = grid.lines.some((l) => !l.locked && l.cells.some((c) => c.supplierId === supplierId && c.quoted));
  return quotesPickable ? null : "This supplier has no line it can win.";
}

/** The Super Admin's unlock applies only to a line locked by being Purchased. */
export const canUnlockLine = (line, isSuperAdmin) => Boolean(isSuperAdmin) && line.locked;

/** The theme a line's state badge takes (a `StatusBadge` theme). */
export const LINE_STATE_THEME = {
  [CANVASS_STATE.NEEDS_SUPPLIERS]: "amber",
  [CANVASS_STATE.NEEDS_WINNER]: "blue",
  [CANVASS_STATE.WINNER_PICKED]: "green",
  [CANVASS_STATE.LOCKED]: "gray",
  [CANVASS_STATE.CANCELLED]: "mauve",
};

/** A quoted amount in its own currency: the peso sign for PHP, the code for the rest. A blank is a dash, never zero. */
export function formatAmount(value, currency = DEFAULT_CURRENCY) {
  if (blank(value) || Number.isNaN(Number(value))) return "—";
  const code = String(currency).toUpperCase();
  const amount = Number(value).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return code === DEFAULT_CURRENCY ? `₱${amount}` : `${code} ${amount}`;
}

/** A cell's one-line summary for the liner: "Redleaf · Folding". Pure text from what was typed. */
export function cellLiner(cell) {
  const q = cell?.quote;
  if (!q) return "";
  return [q.brand, q.description, q.remarks].map((v) => String(v ?? "").trim()).filter(Boolean).join(" · ");
}
