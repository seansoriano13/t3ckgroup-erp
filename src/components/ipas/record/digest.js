// One IPAS boiled down to what a summary needs: where the money stands, where
// each sign-off stands, and what is still open. The section rows, the drawer
// header and the decision card all read this, so they say the same thing.

import {
  IPAS_COMPUTATION_STATUS,
  IPAS_COMPUTATION_STATUS_LABELS,
  IPAS_EVENT_LABELS,
  IPAS_LANDED_COST_STATUS,
  IPAS_PART_NO,
  IPAS_PRIORITY_LABELS,
  IPAS_PURPOSE_LABELS,
  IPAS_SECTION_7_ROLES,
  IPAS_SIGNOFF_ROLE,
  IPAS_SOURCE_LABELS,
  IPAS_STATE,
  ipasSectionLabel,
} from "@/constants/ipas";
import { formatAmount } from "@/utils/ipas";
import { filingChecklist } from "@/utils/ipasDocuments";
import { FILING_STATUS, SIGNOFF_STATUS, isCostsComplete } from "@/utils/ipasSignoffs";
import { formatDay } from "@/utils/ipasPayments";
import { formatDate } from "@/utils/formatDate.js";

export const SECTION_BADGE = {
  [SIGNOFF_STATUS.NOT_PREPARED]: { theme: "mauve", label: "Not prepared" },
  [SIGNOFF_STATUS.AWAITING_APPROVAL]: { theme: "amber", label: "Awaiting approval" },
  [SIGNOFF_STATUS.APPROVED]: { theme: "green", label: "Approved" },
};

export const FILING_BADGE = {
  [FILING_STATUS.WAITING]: {
    theme: "mauve",
    label: `Waiting for ${ipasSectionLabel("purchasing")} and ${ipasSectionLabel("finance")}`,
  },
  [FILING_STATUS.READY]: { theme: "amber", label: "Ready to receive" },
  [FILING_STATUS.IN_PROGRESS]: { theme: "amber", label: "In progress" },
  [FILING_STATUS.FILED]: { theme: "green", label: "Filed" },
};

export const LANDED_BADGE = {
  [IPAS_LANDED_COST_STATUS.PROVISIONAL]: { theme: "amber", label: "Provisional" },
  [IPAS_LANDED_COST_STATUS.FINAL]: { theme: "green", label: "Final" },
  [IPAS_LANDED_COST_STATUS.UNAVAILABLE]: { theme: "mauve", label: "Not available" },
};

/** Who a section-4 step waits on, by role (never "Section N signer"). */
const FILING_OWNER = {
  [IPAS_SIGNOFF_ROLE.RECEIVED]: "Finance",
  [IPAS_SIGNOFF_ROLE.NOTED]: "whoever notes it",
  [IPAS_SIGNOFF_ROLE.CHECKED]: "whoever checks it",
  [IPAS_SIGNOFF_ROLE.APPROVED]: "the filing approvers",
};

const PLAIN_TITLE = { header: "Header", history: "History" };

const pesos = (value) => formatAmount(value, "PHP");
const plural = (count, one, many) => `${count} ${count === 1 ? one : many}`;
const join = (parts) => parts.filter(Boolean).join(" · ");

export function digestIpas(ipas) {
  const open = ipas.state === IPAS_STATE.OPEN;
  const filed = ipas.state === IPAS_STATE.FILED;
  const cancelled = ipas.state === IPAS_STATE.CANCELLED;

  // Money. Headline amounts live in the figures only; rows say what their section holds.
  const sum = ipas.paymentSummary;
  const lc = ipas.landedCost;
  const poTotal = ipas.lines.reduce((total, line) => total + (Number(line.price_subtotal) || 0), 0);
  const money = {
    currency: ipas.currency,
    isForeign: lc.isForeign,
    lineCount: ipas.lines.length,
    poTotal,
    poTotalText: formatAmount(poTotal, ipas.currency),
    paid: sum.paid,
    paidText: sum.count > 0 ? formatAmount(sum.paid, ipas.currency) : "—",
    paymentCount: sum.count,
    debitedPhpText: sum.count > 0 ? pesos(sum.totalDebitedPhp) : "—",
    chargeCount: ipas.charges.length,
    chargesPhpText: ipas.charges.length > 0 ? pesos(sum.chargesPhp) : "—",
    missingPhp: sum.missingPhp,
    landedStatus: lc.status,
    landedPhp: lc.totals?.landedPhp ?? null,
    landedText: lc.totals ? pesos(lc.totals.landedPhp) : "Not available yet",
    rateText: lc.rate ? `${lc.rate.rate.toFixed(4)} PHP per ${lc.currency}` : null,
  };

  // Sign-offs.
  const s1 = ipas.signoffSections[1];
  const s3 = ipas.signoffSections[3];
  const s7 = ipas.signoffSections[7];
  const costsComplete = isCostsComplete(ipas.computationStatus);
  const given7 = IPAS_SECTION_7_ROLES.filter((role) => s7[role]).length;
  const purchasingLabel = ipasSectionLabel("purchasing");
  const financeLabel = ipasSectionLabel("finance");

  // What is still open, in the order it has to happen. `owner` names who it waits on.
  const todo = [];
  if (open) {
    if (!s1.prepared) todo.push({ key: "s1p", owner: "Purchasing" });
    else if (!s1.approved) todo.push({ key: "s1a", owner: `the approvers of ${purchasingLabel}` });
    if (!s3.prepared) todo.push({ key: "s3p", owner: "Purchasing" });
    else if (!s3.approved) todo.push({ key: "s3a", owner: `the approvers of ${financeLabel}` });
    if (!costsComplete) todo.push({ key: "costs", owner: "Purchasing" });
    if (s7.opened) {
      for (const role of s7.next) todo.push({ key: `s7${role}`, owner: FILING_OWNER[role] });
    }
  }

  // Paperwork and tracking.
  const documents = ipas.documents ?? [];
  const checklist = filingChecklist(documents);
  const docs = {
    total: documents.length,
    purchasing: documents.filter((d) => d.purchasingHas).length,
    finance: documents.filter((d) => d.financeHas).length,
    ticked: documents.filter((d) => d.ticked).length,
    attached: documents.filter((d) => d.attachmentUrl).length,
    filingTotal: checklist.length,
    filingTicked: checklist.filter((d) => d.ticked).length,
    missingRequired: (ipas.filingWarnings ?? []).length,
  };
  const trackItems = ipas.buyerTrack ?? [];
  const track = {
    items: trackItems,
    done: trackItems.filter((item) => item.ticked).length,
    total: trackItems.length,
    last: [...trackItems].reverse().find((item) => item.ticked) ?? null,
  };

  const events = ipas.events ?? [];
  const lastEvent = events[events.length - 1] ?? null;

  // One line per section: what it holds, never the headline totals.
  const lines = {
    header: join([
      ipas.entity,
      `${IPAS_PRIORITY_LABELS[ipas.priority]} priority`,
      IPAS_SOURCE_LABELS[ipas.source],
      IPAS_PURPOSE_LABELS[ipas.purpose],
      `raised ${formatDate(ipas.created_at)}${ipas.creator?.name ? ` by ${ipas.creator.name}` : ""}`,
    ]),
    purchasing: join([
      plural(money.lineCount, "line", "lines"),
      sum.count > 0 ? plural(sum.count, "payment", "payments") : "no payments yet",
    ]),
    sales: join([
      ipas.sors.length > 0 ? ipas.sors.map((sor) => sor.salesReference).join(", ") : "No SOR",
      ipas.googleSheet ? "Googlesheet ticked" : null,
      ipas.ganttChart ? "Gantt Chart ticked" : null,
    ]),
    finance: join([
      ipas.charges.length > 0 ? plural(ipas.charges.length, "charge", "charges") : "no charges yet",
      `documents ${docs.ticked} of ${docs.total} in hand`,
      ipas.canReadBankDetails
        ? ipas.bankDetails
          ? ipas.bankDetails.flagged
            ? "account # changed"
            : "bank details typed"
          : "no bank details"
        : null,
    ]),
    logistics: ipas.itemLocation?.label ?? "Item Location not set",
    status: join([
      `${track.done} of ${track.total} on the buyer track`,
      track.last ? `latest: ${track.last.label}${track.last.on ? ` ${formatDay(track.last.on)}` : ""}` : null,
    ]),
    costing: `Computation status: ${IPAS_COMPUTATION_STATUS_LABELS[ipas.computationStatus] ?? "not set"}`,
    filing: s7.opened
      ? join([`${given7} of 4 sign-offs`, `checklist ${docs.filingTicked + (costsComplete ? 1 : 0)} of ${docs.filingTotal + 1}`])
      : `Opens once ${purchasingLabel} and ${financeLabel} are approved`,
    history: lastEvent
      ? join([
          plural(events.length, "change", "changes"),
          `latest: ${IPAS_EVENT_LABELS[lastEvent.kind] || lastEvent.kind}, ${formatDate(lastEvent.created_at)}`,
        ])
      : "Nothing recorded yet",
  };

  return {
    open,
    filed,
    cancelled,
    money,
    s1,
    s3,
    s7,
    given7,
    costsComplete,
    computationStatus: ipas.computationStatus,
    todo,
    docs,
    track,
    lines,
    lastEvent,
  };
}

/** A section's title as a person reads it: "1 · Purchasing", or a plain name for the unnumbered ones. */
export function sectionTitle(key) {
  return IPAS_PART_NO[key] !== undefined ? ipasSectionLabel(key) : PLAIN_TITLE[key];
}

/**
 * The sections in list order: money and sign-offs first, then (`secondary`)
 * everything else. `key` is what the drawer and `?open=` use.
 */
export const SECTIONS = [
  { key: "purchasing" },
  { key: "finance" },
  { key: "costing" },
  { key: "filing" },
  { key: "header", secondary: true },
  { key: "sales", secondary: true },
  { key: "logistics", secondary: true },
  { key: "status", secondary: true },
  { key: "history", secondary: true },
].map((section) => ({ ...section, title: sectionTitle(section.key) }));

/**
 * A section's state dot: "done" (green), "waiting" (amber, someone has to act)
 * or "idle" (grey, not started). Null for a section with no state of its own.
 */
export function sectionDot(key, digest) {
  const signoff = (state) =>
    state.status === SIGNOFF_STATUS.APPROVED
      ? "done"
      : state.status === SIGNOFF_STATUS.AWAITING_APPROVAL
        ? "waiting"
        : "idle";
  if (key === "purchasing") return signoff(digest.s1);
  if (key === "finance") return signoff(digest.s3);
  if (key === "costing") {
    if (digest.costsComplete) return "done";
    return digest.computationStatus === IPAS_COMPUTATION_STATUS.ENCODING ? "idle" : "waiting";
  }
  if (key === "filing") {
    if (digest.s7.status === FILING_STATUS.FILED) return "done";
    return digest.s7.status === FILING_STATUS.WAITING ? "idle" : "waiting";
  }
  return null;
}

/** The badge a section's row shows, or null when it has no state of its own. */
export function sectionBadge(key, digest, ipas) {
  if (key === "purchasing") return SECTION_BADGE[digest.s1.status];
  if (key === "finance") return SECTION_BADGE[digest.s3.status];
  if (key === "filing") return FILING_BADGE[digest.s7.status];
  if (key === "costing") return LANDED_BADGE[ipas.landedCost.status];
  return null;
}
