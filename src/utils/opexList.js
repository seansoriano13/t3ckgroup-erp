import { listAgeDays, listDate } from "./listDates";

/**
 * The OPEX list and the OPEX Report window's small rules (spec #1241, redesign
 * 2026-11-26). Pure: the list rows from their saved snapshots, the state each
 * report is in, the list's filters and totals, and what a read needs Finance to
 * look at.
 */

/** A report's state, worked from its Revenue: the badge and the list's pills. */
export const OPEX_HEALTH = {
  ON_TARGET: "on_target",
  BELOW: "below",
  LOSS: "loss",
  UNREAD: "unread",
};

export const OPEX_HEALTH_LOOK = {
  [OPEX_HEALTH.ON_TARGET]: { label: "On target", theme: "green" },
  [OPEX_HEALTH.BELOW]: { label: "Below go line", theme: "amber" },
  [OPEX_HEALTH.LOSS]: { label: "Loss", theme: "red" },
  [OPEX_HEALTH.UNREAD]: { label: "Not read yet", theme: "mauve" },
};

const num = (v) => (v === null || v === undefined || v === "" ? null : Number(v));

/** On target at or above the go line, below it under, a loss below zero; not read without a figure. */
export function opexHealth(revenue, revenuePercent, goLinePercent = 20) {
  if (revenuePercent === null || revenuePercent === undefined) return OPEX_HEALTH.UNREAD;
  if (revenue !== null && revenue !== undefined && revenue < 0) return OPEX_HEALTH.LOSS;
  return revenuePercent < Number(goLinePercent) ? OPEX_HEALTH.BELOW : OPEX_HEALTH.ON_TARGET;
}

/** One list row from a report and its saved snapshot. Never calls Odoo. */
export function opexListRow(row, goLinePercent = 20) {
  const s = row.snapshot ?? {};
  const revenue = num(s.revenue);
  const pct = num(s.revenue_percent);
  return {
    id: row.id,
    s0: row.s0_number,
    project: s.project_name ?? null,
    contract: num(s.contract_price),
    product: num(s.product_cost),
    opsAdmin: num(s.operation_admin),
    marketing: num(s.marketing),
    actualOpex: num(s.actual_opex),
    revenue,
    pct,
    readAt: s.read_at ?? null,
    health: opexHealth(revenue, pct, goLinePercent),
  };
}

export const OPEX_STATE_FILTER = { ALL: "all", BELOW: "below", ON_TARGET: "on_target" };
export const OPEX_READ_FILTER = { WEEK: "week", STALE: "stale" };

/** Search (S0 or project) and the Last read filter; the state pills count within this. */
export function filterOpexRows(rows, { search = "", readWhen = null } = {}, now = new Date()) {
  const q = search.trim().toLowerCase();
  return rows.filter((r) => {
    if (q && !`${r.s0} ${r.project ?? ""}`.toLowerCase().includes(q)) return false;
    const age = listAgeDays(r.readAt, now);
    if (readWhen === OPEX_READ_FILTER.WEEK && (age === null || age > 7)) return false;
    if (readWhen === OPEX_READ_FILTER.STALE && age !== null && age < 30) return false;
    return true;
  });
}

/** The state pill's slice: Below go line takes losses too. */
export function inOpexState(row, state) {
  if (!state || state === OPEX_STATE_FILTER.ALL) return true;
  if (state === OPEX_STATE_FILTER.BELOW) return row.health === OPEX_HEALTH.BELOW || row.health === OPEX_HEALTH.LOSS;
  return row.health === state;
}

const sum = (rows, key) => {
  const vals = rows.map((r) => r[key]).filter((v) => v !== null && v !== undefined);
  if (vals.length === 0) return null;
  return vals.reduce((total, v) => total + Math.round(v * 100), 0) / 100;
};

/** Totals of the rows shown (every page), and Revenue as a share of the contract prices. */
export function opexTotals(rows) {
  const contract = sum(rows, "contract");
  const revenue = sum(rows, "revenue");
  return {
    count: rows.length,
    contract,
    actualOpex: sum(rows, "actualOpex"),
    revenue,
    pct: contract ? Math.round((revenue / contract) * 10000) / 100 : null,
  };
}

export const OPEX_EXPORT_HEADER = [
  "S0",
  "Project",
  "Contract price",
  "Product cost",
  "Operation & Admin",
  "Marketing",
  "Actual OPEX",
  "Revenue",
  "Revenue %",
  "Last read",
];

export const opexExportRows = (rows) =>
  rows.map((r) => [r.s0, r.project ?? "", r.contract, r.product, r.opsAdmin, r.marketing, r.actualOpex, r.revenue, r.pct, r.readAt ? listDate(r.readAt) : ""]);

/** A P0's state as Odoo's screen names it. */
export const P0_STATE_WORDS = {
  draft: "Draft",
  sent: "RFQ sent",
  "to approve": "To approve",
  purchase: "Purchase order",
  done: "Locked",
  cancel: "Cancelled",
};

/** Lines grouped by P0 in read order, each with its supplier and state. */
export function p0Groups(lines = []) {
  const groups = new Map();
  for (const line of lines) {
    if (!groups.has(line.p0)) groups.set(line.p0, { p0: line.p0, supplier: line.supplier, state: line.p0State, lines: [] });
    groups.get(line.p0).lines.push(line);
  }
  return [...groups.values()];
}

/** Greyed: on a draft or cancelled P0, or tagged to another project only. Shown, never counted. */
export const isGreyedLine = (line) => line.marks.includes("draft/cancelled") || line.marks.includes("other project");

/** The one badge a P0 line shows: the mark that matters most. */
export function lineBadge(line) {
  const marks = line.marks;
  if (marks.includes("typed")) return { label: "Typed price", theme: "blue" };
  if (marks.includes("zero price")) return { label: "Zero price", theme: "amber" };
  if (marks.includes("draft/cancelled")) return { label: "Not counted", theme: "mauve" };
  if (marks.includes("other project")) return { label: "Other project", theme: "mauve" };
  if (marks.includes("no tag")) return { label: "No tag", theme: "amber" };
  return null;
}

/**
 * What needs Finance's eye on a read with its edits: zero-price lines with no typed price,
 * P0s counted with no Project tag, hand-added P0s Odoo no longer has, and edits pointing at
 * lines Odoo no longer has.
 */
export function opexIssues(view) {
  if (!view) return { zeroPrice: [], noTag: [], missingP0s: [], orphans: 0, total: 0 };
  const zeroPrice = view.lines.filter((l) => l.marks.includes("zero price"));
  const noTag = [...new Set(view.lines.filter((l) => l.marks.includes("no tag")).map((l) => l.p0))];
  const missingP0s = (view.handP0s ?? []).filter((h) => h.missing);
  const orphans = (view.orphans?.linePrices.length ?? 0) + (view.orphans?.leftOut.length ?? 0);
  return { zeroPrice, noTag, missingP0s, orphans, total: zeroPrice.length + noTag.length + missingP0s.length + orphans };
}
