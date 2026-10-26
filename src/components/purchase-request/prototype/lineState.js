/**
 * REMOVE-BEFORE-PROD (ADR 0028): the rules of the Product status prototype,
 * as plain functions over example lines. No database, no network.
 *
 * One name per status. Four are set by a person; the rest are simulated here
 * but would come from Odoo or from a Canvass.
 */
import { STATUS_THEME } from "@/constants/statusTheme";

export const STATUS = {
  NOT_CHECKED: "Not checked",
  AVAILABLE: "Available",
  TO_PURCHASE: "To purchase",
  CANVASSING: "Still canvassing",
  PURCHASED: "Purchased",
  RECEIVED: "Received",
  CANNOT_SOURCE: "Cannot source",
  CANCELLED: "Cancelled",
};

// STATUS_THEME has no teal, but StatusBadge already draws it. Available takes
// it so it differs from Received (green); Received also carries a check icon.
export const STATUS_BADGE_THEME = {
  [STATUS.NOT_CHECKED]: STATUS_THEME.MAUVE,
  [STATUS.AVAILABLE]: "teal",
  [STATUS.TO_PURCHASE]: STATUS_THEME.AMBER,
  [STATUS.CANVASSING]: STATUS_THEME.VIOLET,
  [STATUS.PURCHASED]: STATUS_THEME.BLUE,
  [STATUS.RECEIVED]: STATUS_THEME.GREEN,
  [STATUS.CANNOT_SOURCE]: STATUS_THEME.RED,
  [STATUS.CANCELLED]: STATUS_THEME.MAUVE,
};

export const AUTOMATIC_REASON = {
  [STATUS.CANVASSING]: "Set automatically when a Canvass starts on this line.",
  [STATUS.PURCHASED]: "Set automatically from a confirmed P0 in Odoo.",
  [STATUS.RECEIVED]: "Set automatically from Odoo when everything has arrived.",
};

export const ROLE = { PURCHASING: "purchasing", SALES: "sales" };

/** Column widths, shared by the header row and every line so they line up. */
export const COLUMNS = "grid-cols-[2.25rem_8rem_10.5rem_4.75rem_14rem]";

export const peso = (n) => `₱${Number(n).toLocaleString("en-PH")}`;

const isDone = (line) => [STATUS.AVAILABLE, STATUS.RECEIVED, STATUS.CANCELLED].includes(line.status);

/**
 * A line with something Sales or Purchasing must act on, so it never folds away. "Removed from S0"
 * is only a record once the line is done, so it does not hold a finished line open.
 */
export const needsLook = (line) => Boolean(line.nowFree || line.s0StillLists || line.newOnS0);

/** Finished lines fold into the "N done" row, unless they carry a warning. */
export const isFolded = (line) => isDone(line) && !needsLook(line);

export function stockText(line) {
  if (line.free == null) return { text: "Not read yet", tone: "none" };
  if (line.free >= line.qty) return { text: `${line.free} free, enough`, tone: "enough" };
  if (line.free === 0) return { text: "0 free", tone: "none-left" };
  return { text: `${line.free} free of ${line.qty}`, tone: "some" };
}

/** The delivery note that always sits next to Purchased. */
export function deliveryNote(p0) {
  if (!p0) return null;
  if (p0.received > 0 && p0.received < p0.of) return `${p0.received} of ${p0.of} received`;
  if (p0.received >= p0.of) return null;
  return p0.eta ? `Not received yet · ETA ${p0.eta}` : "Not received yet · no ETA set";
}

/** Notes shown under the status. Each is `{ text, warn }`. */
export function lineNotes(line) {
  const notes = [];
  const { status, p0, canvass } = line;
  if (status === STATUS.TO_PURCHASE && p0?.state === "RFQ") notes.push({ text: `RFQ ${p0.number}` });
  if (status === STATUS.PURCHASED) {
    const delivery = deliveryNote(p0);
    if (delivery) notes.push({ text: delivery });
  }
  if (canvass && !canvass.winnerPrice && !canvass.stopped && status === STATUS.CANVASSING) {
    notes.push({ text: `Canvass ${canvass.code} · ${canvass.offers} of ${canvass.of} offers` });
  }
  if (canvass?.stopped) notes.push({ text: `Canvass ${canvass.code} · Stopped · replaced by ${line.replacedBy?.name}` });
  if (line.removedFromSor) notes.push({ text: "Removed from S0", warn: true });
  if (line.nowFree) notes.push({ text: `Now ${line.nowFree} free of ${line.qty}`, warn: true });
  if (line.s0StillLists) notes.push({ text: `S0 still lists ${line.name} · Sales to update the S0`, warn: true });
  if (status === STATUS.CANCELLED && line.replacedBy) {
    notes.push({ text: `Cancelled · Replaced by ${line.replacedBy.name} — ${line.replacedBy.reason}` });
  }
  if (status === STATUS.CANCELLED && line.closedNote) notes.push({ text: line.closedNote });
  return notes;
}

/** "Expected ₱25,000 · Actual ₱26,400 (+5.6%)", or one number when they match. */
export function priceText(line) {
  const actual = line.p0?.price;
  const expected = line.canvass?.winnerPrice;
  if (actual == null) return expected != null ? `${peso(expected)} (Canvass winner)` : null;
  if (expected == null || expected === actual) return peso(actual);
  const change = ((actual - expected) / expected) * 100;
  const sign = change > 0 ? "+" : "";
  return `Expected ${peso(expected)} · Actual ${peso(actual)} (${sign}${change.toFixed(1)}%)`;
}

/** Whether each Purchasing-only action makes sense for this line, and why not if it does not. */
export function actionState(line) {
  const closed = line.status === STATUS.CANCELLED;
  const arrived = line.status === STATUS.RECEIVED;
  return {
    canvass: closed
      ? "This line is cancelled."
      : [STATUS.PURCHASED, STATUS.RECEIVED].includes(line.status)
        ? "This line is already bought."
        : line.status === STATUS.CANVASSING
          ? "A Canvass is already running."
          : null,
    attach: closed || arrived ? "Nothing to attach to this line." : null,
    replace: closed ? "This line is already cancelled." : arrived ? "This line has already arrived." : null,
  };
}

/** Counts for the ready bar. Cancelled lines are not needs any more, so they are left out. */
export function summarize(lines) {
  const live = lines.filter((l) => l.status !== STATUS.CANCELLED);
  const pick = (...statuses) => live.filter((l) => statuses.includes(l.status));
  const ready = pick(STATUS.AVAILABLE, STATUS.RECEIVED);
  const purchased = pick(STATUS.PURCHASED);
  const sourcing = pick(STATUS.TO_PURCHASE, STATUS.CANVASSING);
  const notChecked = pick(STATUS.NOT_CHECKED);
  const cannot = pick(STATUS.CANNOT_SOURCE);

  const parts = [`${ready.length} ${ready.length === 1 ? "is" : "are"} in the warehouse.`];
  const need = sourcing.length + purchased.length;
  if (need > 0) {
    const bits = [];
    if (sourcing.length) bits.push(`${sourcing.length} still ${sourcing.length === 1 ? "needs" : "need"} a supplier`);
    if (purchased.length === 1) bits.push(`1 is on ${purchased[0].p0?.number ?? "a P0"} and not here yet`);
    else if (purchased.length > 1) bits.push(`${purchased.length} are on a P0 and not here yet`);
    parts.push(`${need} ${need === 1 ? "needs" : "need"} buying: ${bits.join(", ")}.`);
  }
  if (notChecked.length) parts.push(`${notChecked.length} ${notChecked.length === 1 ? "has" : "have"} not been checked yet.`);
  if (cannot.length) parts.push(`${cannot.length} cannot be sourced.`);

  return {
    total: live.length,
    ready: ready.length,
    segments: [
      { key: "ready", label: "Available or Received", count: ready.length, bar: "bg-green-9" },
      { key: "purchased", label: "Purchased, not received yet", count: purchased.length, bar: "bg-blue-9" },
      { key: "sourcing", label: "To purchase or Still canvassing", count: sourcing.length, bar: "bg-amber-9" },
      { key: "unchecked", label: "Not checked", count: notChecked.length, bar: "bg-mauve-7" },
      { key: "cannot", label: "Cannot source", count: cannot.length, bar: "bg-red-9" },
    ],
    sentence: parts.join(" "),
  };
}

const patch = (lines, id, change) => lines.map((l) => (l.id === id ? { ...l, ...change } : l));

/** A person picks Available, To purchase, Cannot source or Cancelled. */
export function setByHand(lines, id, status) {
  return patch(lines, id, { status, nowFree: null });
}

export function startCanvass(lines, id, code) {
  return patch(lines, id, {
    status: STATUS.CANVASSING,
    canvass: { code, offers: 0, of: 3 },
  });
}

/** What attaching a P0 does to a line: an RFQ stays To purchase; a confirmed P0 is Purchased, or Received once all arrived. */
export function attachP0(lines, id, p0) {
  const status = p0.state === "RFQ" ? STATUS.TO_PURCHASE : p0.received >= p0.of ? STATUS.RECEIVED : STATUS.PURCHASED;
  return patch(lines, id, { p0, status, nowFree: null });
}

/** Turns an Odoo P0 row into the shape a line carries. */
export const p0FromOdoo = (row) => ({
  number: row.number,
  state: row.state,
  product: row.product,
  price: row.price,
  eta: row.eta,
  received: 0,
  of: row.qty,
});

/**
 * Replace: A is cancelled with the reason, its open Canvass stops, and B
 * arrives as a new line in Other requests, carrying the status of its P0.
 */
export function replaceLine(lines, id, { newName, newCode, p0, reason, newId, by }) {
  const old = lines.find((l) => l.id === id);
  const stopped = old.canvass && !old.canvass.winnerPrice ? { ...old.canvass, stopped: true } : old.canvass;
  const next = patch(lines, id, {
    status: STATUS.CANCELLED,
    replacedBy: { name: newName, reason },
    canvass: stopped,
    s0StillLists: old.section === "sor",
  });
  const fresh = {
    id: newId,
    section: "other",
    name: newName,
    code: newCode,
    qty: old.qty,
    forWhat: old.forWhat ?? "For the client",
    askedBy: by,
    addedByPurchasing: by === "Purchasing",
    when: "just now",
    status: STATUS.NOT_CHECKED,
    replaces: old.name,
  };
  const withNew = [...next, fresh];
  return p0 ? attachP0(withNew, newId, p0) : withNew;
}

/** "Yes, same product": the request's P0 and delivery move onto the S0 line, and the request closes. */
export function mergeRequest(lines, sorId) {
  const sor = lines.find((l) => l.id === sorId);
  const request = lines.find((l) => l.id === sor.matchesRequest);
  return lines.map((l) => {
    if (l.id === sor.id) {
      return { ...l, p0: request.p0, status: request.status, newOnS0: false, matchesRequest: null, mergedFrom: request.name };
    }
    if (l.id === request.id) {
      return { ...l, status: STATUS.CANCELLED, closedNote: `Closed · ${request.p0.number} and its delivery moved onto ${sor.name}` };
    }
    return l;
  });
}

/** "No, they are different": the badge goes away and both lines stay as they are. */
export function keepSeparate(lines, sorId) {
  return patch(lines, sorId, { newOnS0: false, matchesRequest: null });
}

/** A fresh stock check: an Available line whose stock is no longer enough gets flagged. */
export function checkStock(lines) {
  let changed = 0;
  const next = lines.map((l) => {
    if (l.status === STATUS.AVAILABLE && l.recheckFree != null && l.recheckFree < l.qty && !l.nowFree) {
      changed += 1;
      return { ...l, free: l.recheckFree, nowFree: l.recheckFree };
    }
    return l;
  });
  return { lines: next, changed };
}

export function addAsked(lines, { id, text, qty, forWhat, photos, by }) {
  return [
    ...lines,
    {
      id,
      section: "other",
      name: text,
      qty,
      photo: photos[0] ?? null,
      forWhat,
      askedBy: by,
      addedByPurchasing: by === "Purchasing",
      when: "just now",
      status: STATUS.NOT_CHECKED,
    },
  ];
}
