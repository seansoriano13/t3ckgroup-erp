/**
 * The printed Canvass (spec #956, issue #971): one sheet per Purchase Request, laid out like the
 * PMS 3 CANVASS MATRIX tab. Lines go down the page (number, brand and description asked for,
 * quantity, unit), suppliers go across, three to a page. A fourth supplier and beyond continue on
 * the next page with the line column repeated.
 *
 * A pure view model over a Canvass as `canvassService.get` returns it, plus the request's lines,
 * with no I/O, so the paging, the skipped lines and the no-money sheet are unit-tested without the
 * network. The document (canvassDocument.js) draws it; the printer (canvassPrinter.js) fetches it.
 *
 *   Header      the CNV number, the request, the client or project, the date, "Canvassed by"
 *   Pages       the suppliers cut into groups of SUPPLIERS_PER_PAGE; each page carries the whole
 *               line column and, per supplier, that supplier's heading and one cell per line
 *   Reasons     under the grid: each line's winner and why, or that it has none / nobody quoted it
 *   Note        the "No other supplier" note when the Canvass has one
 *   Signature   Canvassed by only
 *
 * Money: a reader who may not see it (`canReadMoney` false) gets cells and headings with no price,
 * rate or total keys at all. A blank price is a dash, never zero.
 *
 * Strings are raw text. The composer escapes them.
 */

import { moreOffersWarning, offerCurrency } from '../../utils/canvassMath';
import { DEFAULT_CURRENCY } from '../../constants/canvass';
import { extended } from '../../utils/costingMath';
import { printAmount, printDate } from './ipasViewModel';

const BLANK = '—';

/** How many suppliers sit across one printed page. */
export const SUPPLIERS_PER_PAGE = 3;

const text = (value) => {
  const out = typeof value === 'string' ? value.trim() : '';
  return out === '' ? null : out;
};

const isBlank = (value) => value === null || value === undefined || value === '';

/** The comparison rate as written, without trailing zeros or grouping: "56.5625". */
const rateText = (rate) =>
  new Intl.NumberFormat('en-PH', { minimumFractionDigits: 0, maximumFractionDigits: 6, useGrouping: false }).format(Number(rate));

const quantityText = (value) => {
  if (isBlank(value)) return BLANK;
  const n = Number(value);
  return Number.isFinite(n) ? new Intl.NumberFormat('en-PH', { maximumFractionDigits: 2 }).format(n) : BLANK;
};

/** Every reader may print the sheet; a reader without the money tier gets it without prices. */
export const canPrintCanvass = (canvass) => Boolean(canvass);

/** One signature block in the shape `sigBlock` draws: "Canvassed by" with the name, or still waiting. */
export function signatureBlock(role, title, { who = null, at = null, signaturePath = null, verb = 'signed' } = {}) {
  const name = text(who);
  if (!name) return { role, title, who: '', state: 'awaiting', signaturePath: null };
  const when = printDate(at);
  const base = `${verb}${when ? ` ${when}` : ''}`;
  return {
    role,
    title,
    who: name,
    state: 'signed',
    signaturePath: text(signaturePath),
    stamp: signaturePath ? base : `${base} · name only, no signature on file`,
  };
}

/** The supplier's heading: name, currency (and rate, for a money reader), how long it holds, lead time. */
function supplierHeading(supplier, money) {
  const currency = offerCurrency(supplier);
  const heading = {
    id: supplier.id,
    name: text(supplier.supplier_name) ?? BLANK,
    currency,
    holds: supplier.valid_until ? `Valid to ${printDate(supplier.valid_until) ?? BLANK}` : BLANK,
    leadTime: text(supplier.lead_time) ?? BLANK,
  };
  if (money && currency !== DEFAULT_CURRENCY) {
    heading.rate = isBlank(supplier.comparison_rate) ? 'no rate recorded' : `1 ${currency} = PHP ${rateText(supplier.comparison_rate)}`;
  }
  return heading;
}

/** One supplier's answer on one line, or `{ state: 'none' }` when it did not quote the line. */
function quoteCell(quote, supplier, line, isWinner, money) {
  if (!quote) return { state: 'none', winner: false };
  const cell = {
    state: 'quoted',
    winner: isWinner,
    brand: text(quote.brand),
    description: text(quote.description),
    remarks: text(quote.remarks),
  };
  if (money) {
    const currency = offerCurrency(supplier);
    cell.price = isBlank(quote.unit_price) ? BLANK : printAmount(quote.unit_price, currency);
    const total = isBlank(quote.unit_price) ? null : extended(quote.unit_price, line.quantity);
    cell.total = total === null ? BLANK : printAmount(total, currency);
  }
  return cell;
}

const chunk = (list, size) => {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
};

/**
 * The Canvass as the paper prints it.
 *
 *   canvass   `canvassService.get`'s result: `suppliers`, `quotes`, `winners`, `noOtherSupplier`,
 *             `canReadMoney`
 *   request   `{ number, title, client, project, sor }`, whatever the request has
 *   lines     the request's lines in order: `{ id, name, brand, description, quantity, unit }`
 *   people    `{ creator }`, `{ name, signaturePath? }` (the printer hands the Canvasser over)
 */
export function buildCanvassViewModel({ canvass, request = {}, lines = [], people = {} }, { printedAt = null, printedBy = null } = {}) {
  const money = Boolean(canvass.canReadMoney);
  const suppliers = Array.isArray(canvass.suppliers) ? canvass.suppliers : [];
  const quotes = Array.isArray(canvass.quotes) ? canvass.quotes : [];
  const winners = Array.isArray(canvass.winners) ? canvass.winners : [];
  const note = canvass.noOtherSupplier ?? null;

  const quoteAt = new Map(quotes.map((q) => [`${q.supplier_id}:${q.item_id}`, q]));
  const winnerAt = new Map(winners.map((w) => [w.item_id, w]));
  const supplierById = new Map(suppliers.map((s) => [s.id, s]));

  const lineRows = lines.map((line, index) => {
    const winner = winnerAt.get(line.id) ?? null;
    const winnerSupplier = winner ? supplierById.get(winner.supplier_id) : null;
    const quoted = suppliers.some((s) => quoteAt.has(`${s.id}:${line.id}`));
    return {
      id: line.id,
      no: index + 1,
      brand: text(line.brand),
      description: [text(line.name), text(line.description)].filter(Boolean).join(' — ') || BLANK,
      quantity: quantityText(line.quantity),
      unit: text(line.unit) ?? BLANK,
      // 'won' | 'no-winner' (quoted, none chosen) | 'unquoted' (nobody quoted it)
      outcome: winnerSupplier ? 'won' : quoted ? 'no-winner' : 'unquoted',
      winnerSupplier: winnerSupplier ? (text(winnerSupplier.supplier_name) ?? BLANK) : null,
      reason: winner ? text(winner.reason) : null,
    };
  });

  // No supplier yet still prints the line column, once.
  const groups = suppliers.length === 0 ? [[]] : chunk(suppliers, SUPPLIERS_PER_PAGE);
  const pages = groups.map((group, index) => ({
    number: index + 1,
    of: groups.length,
    suppliers: group.map((s) => supplierHeading(s, money)),
    rows: lineRows.map((row, i) => ({
      ...row,
      cells: group.map((s) =>
        quoteCell(quoteAt.get(`${s.id}:${row.id}`), s, lines[i], winnerAt.get(row.id)?.supplier_id === s.id, money),
      ),
    })),
  }));

  const when = printDate(note?.created_at);
  return {
    number: text(canvass.number) ?? BLANK,
    money,
    header: {
      request: [text(request.number), text(request.title)].filter(Boolean).join(' · ') || BLANK,
      client: text(request.client),
      project: text(request.project),
      sor: text(request.sor),
      date: printDate(canvass.created_at),
      lineCount: lineRows.length,
      supplierCount: suppliers.length,
    },
    pages,
    // Under the grid: every line's outcome, in line order.
    reasons: lineRows.map((row) => ({
      no: row.no,
      outcome: row.outcome,
      supplier: row.winnerSupplier,
      reason: row.reason,
    })),
    noOtherSupplier: note
      ? { reason: text(note.reason) ?? BLANK, by: [text(note.actor?.name), when].filter(Boolean).join(' · ') || null }
      : null,
    warning: note ? null : moreOffersWarning(suppliers, []),
    // Only "Canvassed by" signs (#728, ADR 0047); there is no Check-by block.
    signatures: [
      signatureBlock('Canvassed by', 'Purchasing', {
        who: people.creator?.name,
        at: canvass.created_at,
        signaturePath: people.creator?.signaturePath,
        verb: 'canvassed',
      }),
    ],
    printedOn: printDate(printedAt),
    printedBy: text(printedBy),
  };
}
