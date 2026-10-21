// One IPAS boiled down to what a summary needs: where the money stands, where
// each sign-off stands, and what is still open. The section rows, the drawer
// header and the decision card all read this, so they say the same thing.

import {
  IPAS_COMPUTATION_STATUS_LABELS,
  IPAS_EVENT_LABELS,
  IPAS_LANDED_COST_STATUS,
  IPAS_PART_NO,
  IPAS_PRIORITY_LABELS,
  IPAS_PURPOSE_LABELS,
  IPAS_SECTION_7_ROLES,
  IPAS_SOURCE_LABELS,
  IPAS_STATE,
  ipasSectionLabel,
} from "@/constants/ipas";
import { formatAmount } from "@/utils/ipas";
import { filingChecklist } from "@/utils/ipasDocuments";
import { FILING_STATUS, SIGNOFF_STATUS, isLandedCostFinal } from "@/utils/ipasSignoffs";
import { formatDay } from "@/utils/ipasPayments";
import { isLandedCostEstimate } from "@/utils/landedCost";
import { formatDate } from "@/utils/formatDate.js";
import { gatesFor } from "./gates";
import { STATE } from "@/components/record/statePalette";

/** A section's detail beside its state word, from its sign-offs. */
const SIGNOFF_DETAIL = {
  [SIGNOFF_STATUS.NOT_PREPARED]: "Not submitted",
  [SIGNOFF_STATUS.AWAITING_APPROVAL]: "Awaiting approval",
  [SIGNOFF_STATUS.APPROVED]: "Approved",
};

/** Section 4's detail beside its state word. */
const FILING_DETAIL = {
  [FILING_STATUS.WAITING]: `Opens once ${ipasSectionLabel("purchasing")}, ${ipasSectionLabel("finance")} and ${ipasSectionLabel("costing")} are approved`,
  [FILING_STATUS.READY]: "Ready to receive",
  [FILING_STATUS.IN_PROGRESS]: "In progress",
  [FILING_STATUS.FILED]: "Filed",
};

export const LANDED_BADGE = {
  [IPAS_LANDED_COST_STATUS.PROVISIONAL]: { label: "Provisional" },
  [IPAS_LANDED_COST_STATUS.FINAL]: { label: "Final" },
  [IPAS_LANDED_COST_STATUS.UNAVAILABLE]: { label: "Not available" },
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
    landedEstimate: isLandedCostEstimate(lc),
    // An estimate (a payment's pesos still blank) is said so wherever the figure shows (#604).
    landedFigureText: lc.totals ? pesos(lc.totals.landedPhp) : "Not available yet",
    landedText: lc.totals ? `${pesos(lc.totals.landedPhp)}${isLandedCostEstimate(lc) ? " (estimate)" : ""}` : "Not available yet",
    rateText: lc.rate ? `${lc.rate.rate.toFixed(4)} PHP per ${lc.currency}` : null,
  };

  // Sign-offs.
  const s1 = ipas.signoffSections[1];
  const s3 = ipas.signoffSections[3];
  const s6 = ipas.signoffSections[6];
  const s7 = ipas.signoffSections[7];
  const costsComplete = isLandedCostFinal(ipas.computationStatus);
  const given7 = IPAS_SECTION_7_ROLES.filter((role) => s7[role]).length;
  const purchasingLabel = ipasSectionLabel("purchasing");
  const financeLabel = ipasSectionLabel("finance");
  const costingLabel = ipasSectionLabel("costing");

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
      ipas.charges.length > 0
        ? `${plural(ipas.charges.length, "charge", "charges")}, ${pesos(sum.chargesPhp)}`
        : "no charges yet",
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
    costing: join([
      `Computation status: ${IPAS_COMPUTATION_STATUS_LABELS[ipas.computationStatus] ?? "not set"}`,
      s6.approved ? "approved" : s6.prepared ? "awaiting approval" : null,
    ]),
    filing: s7.opened
      ? join([`${given7} of 4 sign-offs`, `checklist ${docs.filingTicked + (costsComplete ? 1 : 0)} of ${docs.filingTotal + 1}`])
      : `Opens once ${purchasingLabel}, ${financeLabel} and ${costingLabel} are approved`,
    history: lastEvent
      ? join([
          plural(events.length, "change", "changes"),
          `latest: ${IPAS_EVENT_LABELS[lastEvent.kind] || lastEvent.kind}, ${formatDate(lastEvent.created_at)}`,
        ])
      : "Nothing recorded yet",
  };

  const digest = {
    open,
    filed,
    cancelled,
    money,
    s1,
    s3,
    s6,
    s7,
    given7,
    costsComplete,
    computationStatus: ipas.computationStatus,
    docs,
    track,
    lines,
    lastEvent,
  };
  // The seven gates and which one is Now: computed once here, read by the chain, the card and the rows.
  return { ...digest, gates: gatesFor(digest) };
}

/** A section's title as a person reads it: "1 · Purchasing", or a plain name for the unnumbered ones. */
export function sectionTitle(key) {
  return IPAS_PART_NO[key] !== undefined ? ipasSectionLabel(key) : PLAIN_TITLE[key];
}

/**
 * The sections in list order: money and sign-offs first, then (`secondary`)
 * everything else. `key` is what the drawer and `?open=` use. `inPlace` marks
 * the sections that expand under their row instead of opening the drawer:
 * every one of "Everything else". Money and sign-offs keep the drawer for now.
 */
export const SECTIONS = [
  { key: "purchasing" },
  { key: "finance" },
  { key: "costing" },
  { key: "filing" },
  { key: "header", secondary: true, inPlace: true },
  { key: "sales", secondary: true, inPlace: true },
  { key: "logistics", secondary: true, inPlace: true },
  { key: "status", secondary: true, inPlace: true },
  { key: "history", secondary: true, inPlace: true },
].map((section) => ({ ...section, title: sectionTitle(section.key) }));

/** The sections the drawer shows (J and K step through these); the in-place ones are skipped. */
export const DRAWER_SECTIONS = SECTIONS.filter((section) => !section.inPlace);

/** True for a section that expands under its row (`?open=` names it, no drawer). */
export function isInPlace(key) {
  return SECTIONS.some((section) => section.key === key && section.inPlace);
}

/**
 * A section's state for the state palette: its `state` (done, current or
 * waiting) and the `detail` beside its word. Null for a section with no state
 * of its own. The state comes from the section's gates, so a row and the chain
 * never disagree; section 4 reads its three gates together.
 */
export function sectionState(key, digest) {
  const gate = (gateKey) => digest.gates.find((g) => g.key === gateKey);
  if (key === "purchasing") return { state: gate("purchasing").state, detail: SIGNOFF_DETAIL[digest.s1.status] };
  if (key === "finance") return { state: gate("finance").state, detail: SIGNOFF_DETAIL[digest.s3.status] };
  // Its Landed Cost mark (Provisional, Final) is said once, in the section body beside Landed Cost.
  // The section is done when both its LC Odoo Done step and its sign-off are.
  if (key === "costing") {
    const parts = [gate("costs"), gate("costing-signoff")];
    const state = parts.every((g) => g.done)
      ? STATE.DONE
      : parts.some((g) => g.now)
        ? STATE.CURRENT
        : STATE.WAITING;
    return { state, detail: digest.costsComplete ? SIGNOFF_DETAIL[digest.s6.status] : null };
  }
  if (key === "filing") {
    const filing = digest.gates.filter((g) => g.part === "filing");
    const state = filing.every((g) => g.done)
      ? STATE.DONE
      : filing.some((g) => g.now)
        ? STATE.CURRENT
        : STATE.WAITING;
    return { state, detail: FILING_DETAIL[digest.s7.status] };
  }
  return null;
}

/**
 * What filing adds, for the Approve and file dialog: the Landed Cost it makes
 * final and the documents in hand it freezes. Read from the same digest as the rows.
 */
export function filingSummary(digest) {
  const { money, docs } = digest;
  const landed = money.landedPhp === null ? "Landed Cost is not available yet" : `Landed Cost becomes final at ${money.landedFigureText}`;
  return `${landed}. ${docs.ticked} of ${docs.total} documents in hand are frozen with it.`;
}
