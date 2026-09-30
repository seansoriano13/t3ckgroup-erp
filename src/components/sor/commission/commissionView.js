// Pure helpers for the Commission Dashboard screens: period presets, the
// colour legend, the formula walked step by step, and the ledger CSV. No
// React here, so every screen file only exports components.

import { calculateCommissionableRevenue, calculateCommissionPool } from "../../../utils/commission";
import { getCurrentLocalDate } from "../../../utils/formatDate";

/** What Privacy Masking shows in place of an amount the viewer may not see. */
export const MASK = "••••••";

export const DATE_PRESETS = [
  { value: "ALL", label: "All time" },
  { value: "THIS_MONTH", label: "This month" },
  { value: "LAST_MONTH", label: "Last month" },
  { value: "Q1", label: "Q1 (Jan – Mar)" },
  { value: "Q2", label: "Q2 (Apr – Jun)" },
  { value: "Q3", label: "Q3 (Jul – Sep)" },
  { value: "Q4", label: "Q4 (Oct – Dec)" },
  { value: "YTD", label: "Year to date" },
];

export function getPresetDateRange(preset, now = new Date()) {
  const y = now.getFullYear();
  const iso = (d) => d.toISOString().slice(0, 10);
  const quarter = { Q1: ["01-01", "03-31"], Q2: ["04-01", "06-30"], Q3: ["07-01", "09-30"], Q4: ["10-01", "12-31"] }[preset];
  if (quarter) return { startDate: `${y}-${quarter[0]}`, endDate: `${y}-${quarter[1]}` };
  if (preset === "THIS_MONTH") return { startDate: iso(new Date(y, now.getMonth(), 1)), endDate: iso(new Date(y, now.getMonth() + 1, 0)) };
  if (preset === "LAST_MONTH") return { startDate: iso(new Date(y, now.getMonth() - 1, 1)), endDate: iso(new Date(y, now.getMonth(), 0)) };
  if (preset === "YTD") return { startDate: `${y}-01-01`, endDate: iso(now) };
  return null;
}

/**
 * One Commission Rate type's dated history, newest first, each row marked
 * `current` (the rate in force today: the newest one that has taken effect),
 * `scheduled` (takes effect later) or `past`. A row with no date counts as
 * already in force.
 */
export function rateTimeline(history = [], rateType, today = getCurrentLocalDate()) {
  const rows = history
    .filter((r) => r.rate_type === rateType)
    .sort((a, b) => String(b.effective_from ?? "").localeCompare(String(a.effective_from ?? "")));
  let currentFound = false;
  return rows.map((r) => {
    if (r.effective_from && r.effective_from > today) return { ...r, status: "scheduled" };
    if (currentFound) return { ...r, status: "past" };
    currentFound = true;
    return { ...r, status: "current" };
  });
}

/** One colour = one meaning on every Commission screen. Radix steps 9 (solid) / 3 (wash) / 11 (ink). */
const scale = (name) => ({ solid: `var(--${name}-9)`, wash: `var(--${name}-3)`, ink: `var(--${name}-11)` });
export const TONE = {
  tax: scale("amber"),
  pool: scale("blue"),
  sales: scale("indigo"),
  deal_owner: scale("violet"),
  closing_salesperson: scale("cyan"),
  supporting_salesperson: scale("jade"),
  sales_director: scale("orange"),
};

/** Sales keeps indigo; every other Commission Department gets its own hue, in allocation order. */
const OTHER_DEPARTMENT_SCALES = ["teal", "pink", "gold", "sky", "brown", "lime", "plum"];

export function colourDepartments(departmentTotals = []) {
  const sorted = [...departmentTotals].sort(
    (a, b) => Number(b.isSales) - Number(a.isSales) || b.allocationPercent - a.allocationPercent,
  );
  let i = 0;
  return sorted.map((d) => ({
    ...d,
    color: d.isSales ? TONE.sales.solid : `var(--${OTHER_DEPARTMENT_SCALES[i++ % OTHER_DEPARTMENT_SCALES.length]}-9)`,
  }));
}

export const SHARE_ROLES = [
  { key: "deal_owner", label: "Deal Owner" },
  { key: "closing_salesperson", label: "Closing Salesperson" },
  { key: "supporting_salesperson", label: "Supporting Sales" },
  { key: "sales_director", label: "Sales Director" },
];
export const shareRoleLabel = (key) => SHARE_ROLES.find((r) => r.key === key)?.label ?? key;

/** The Project Types that carry a Commission Split, in the order the screens show them. */
export const SPLIT_PROJECT_TYPES = [
  { value: "SSP", label: "Single", long: "Single Salesperson Project", blurb: "One salesperson carries the deal", roles: ["deal_owner", "sales_director"] },
  { value: "CP", label: "Collaborative", long: "Collaborative Project", blurb: "Deal Owner plus a supporting team", roles: ["deal_owner", "supporting_salesperson", "sales_director"] },
  { value: "STRATEGIC", label: "Strategic", long: "Strategic Project", blurb: "Originator, closer and support all named", roles: ["deal_owner", "closing_salesperson", "supporting_salesperson", "sales_director"] },
];
export const projectTypeInfo = (value) => SPLIT_PROJECT_TYPES.find((p) => p.value === value);

/** Split rows for a Project Type in a stable role order, zero rows dropped. */
export function splitRows(splits = [], projectType) {
  const roles = projectTypeInfo(projectType)?.roles ?? SHARE_ROLES.map((r) => r.key);
  return roles
    .map((role) => ({ role, label: shareRoleLabel(role), percent: Number(splits.find((s) => s.shareRole === role)?.percent) || 0 }))
    .filter((r) => r.percent > 0);
}

/**
 * The formula walked step by step, for display. Commissionable Revenue comes
 * from the real calculation in utils/commission.js; the VAT and Withholding
 * amounts are just the two differences along the way.
 */
export function walkFormula({ contractValue, vatPercent, withholdingPercent, poolPercent, salesPercent, splits = [] }) {
  const contract = Number(contractValue) || 0;
  const exVat = contract / (1 + vatPercent / 100);
  const commissionable = calculateCommissionableRevenue(contract, { vatPercent, withholdingPercent });
  const pool = calculateCommissionPool(commissionable, poolPercent);
  const sales = (pool * salesPercent) / 100;
  return {
    contract,
    vatAmount: contract - exVat,
    withholdingAmount: exVat - commissionable,
    commissionable,
    pool,
    sales,
    roles: splits.map((s) => ({ ...s, amount: (sales * s.percent) / 100 })),
  };
}

/** Pool per month, oldest first. */
export function monthlyPool(ledger = []) {
  const months = {};
  for (const deal of ledger) {
    const key = (deal.contractDate || deal.createdAt || "").slice(0, 7);
    if (!key) continue;
    months[key] ??= {
      key,
      label: new Date(`${key}-01T00:00:00`).toLocaleDateString("en-US", { month: "short", year: "2-digit" }),
      pool: 0,
      count: 0,
    };
    months[key].pool += deal.commissionPool || 0;
    months[key].count += 1;
  }
  return Object.values(months).sort((a, b) => a.key.localeCompare(b.key));
}

/** ₱1.25M / ₱84.2k — for summary figures where the full amount would crowd. */
export function compactPHP(n) {
  const v = Number(n) || 0;
  const a = Math.abs(v);
  if (a >= 1e6) return `₱${(v / 1e6).toFixed(a >= 1e7 ? 1 : 2)}M`;
  if (a >= 1e3) return `₱${(v / 1e3).toFixed(a >= 1e5 ? 0 : 1)}k`;
  return `₱${v.toFixed(0)}`;
}

export function formatContractDate(iso) {
  if (!iso) return null;
  return new Date(`${iso.slice(0, 10)}T00:00:00`).toLocaleDateString("en-PH", { day: "numeric", month: "short", year: "numeric" });
}

/** Downloads the ledger as an audit-ready CSV. */
export function downloadLedgerCsv(ledger = [], filename = "commission_ledger.csv") {
  const headers = [
    "SOR Number", "Company", "Project Title", "Stage", "Project Type", "Contract Date", "Created Date",
    "Contract Value (PHP)", "VAT Percent", "Withholding Percent", "Commissionable Revenue (PHP)",
    "Pool Percent", "Commission Pool (PHP)", "Sales Share (PHP)",
    "Deal Owner", "Deal Owner Share (PHP)", "Closing Salesperson", "Closing Salesperson Share (PHP)",
    "Support Sales 1", "Support Sales 2", "Support Sales Total (PHP)",
    "Sales Director", "Sales Director Share (PHP)", "Unattributed Sales (PHP)",
  ];
  const esc = (v) => (v === null || v === undefined ? '""' : `"${String(v).replace(/"/g, '""')}"`);
  const share = (deal, role) => deal.salesRoleShares.filter((s) => s.role === role).reduce((sum, s) => sum + s.amount, 0);

  const rows = ledger.map((deal) =>
    [
      esc(deal.opportunityNo), esc(deal.clientName), esc(deal.projectTitle), esc(deal.status), esc(deal.projectType),
      esc(deal.contractDate || "—"), esc(deal.createdAt ? deal.createdAt.slice(0, 10) : "—"),
      (deal.contractValue || 0).toFixed(2), deal.rates?.vatPercent ?? "", deal.rates?.withholdingPercent ?? "",
      (deal.commissionableRevenue || 0).toFixed(2), deal.rates?.poolPercent ?? "",
      (deal.commissionPool || 0).toFixed(2), (deal.salesShareAmount || 0).toFixed(2),
      esc(deal.participants?.dealOwner?.name || "Unassigned"), share(deal, "deal_owner").toFixed(2),
      esc(deal.participants?.closingSales?.name || ""), share(deal, "closing_salesperson").toFixed(2),
      esc(deal.participants?.support1?.name || ""), esc(deal.participants?.support2?.name || ""),
      share(deal, "supporting_salesperson").toFixed(2),
      esc(deal.participants?.salesDirector?.name || ""), share(deal, "sales_director").toFixed(2),
      (deal.unattributedSalesAmount || 0).toFixed(2),
    ].join(","),
  );

  const blob = new Blob(["﻿" + [headers.join(","), ...rows].join("\r\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.setAttribute("href", url);
  link.setAttribute("download", filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
