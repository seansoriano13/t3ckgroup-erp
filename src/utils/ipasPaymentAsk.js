import { IPAS_ASK_PRIORITIES, IPAS_ASK_PRIORITY_LABELS, IPAS_ASK_PURPOSE_LABELS, IPAS_PAYMENT_KIND } from "../constants/ipas";
import { formatAmount } from "./ipas";
import { isPhpCurrency, toCents } from "./landedCost";
import { formatPercent } from "./ipasPaymentPercent";

/** Where an ask sorts: Very High 0, High 1, Medium 2; anything else last. */
export const askPriorityRank = (priority) => {
  const index = IPAS_ASK_PRIORITIES.indexOf(priority);
  return index === -1 ? IPAS_ASK_PRIORITIES.length : index;
};

/** "Very High", "High", "Medium" for an ask's priority; an unknown value shows as it is. */
export const askPriorityLabel = (priority) => IPAS_ASK_PRIORITY_LABELS[priority] ?? priority;

/** The priority choices for a select, most urgent first. */
export const askPriorityOptions = () => IPAS_ASK_PRIORITIES.map((value) => ({ value, label: IPAS_ASK_PRIORITY_LABELS[value] }));

/** Every open ask of a list row's figures (an IPAS may have several, #1224), else the single `paymentAsk`. */
const openAsksOf = (figures) => (figures?.paymentAsks?.length ? figures.paymentAsks : figures?.paymentAsk ? [figures.paymentAsk] : []);

const askedTime = (ask) => {
  const time = new Date(ask?.asked_at).getTime();
  return Number.isFinite(time) ? time : Infinity;
};

/**
 * The Payment Forecast order: an IPAS shows once and sorts by its most urgent open ask (Very High first), then by
 * its oldest open ask. Rows are list rows with `figures`.
 */
export function comparePaymentForecast(a, b) {
  const priorityOf = (row) => Math.min(Infinity, ...openAsksOf(row.figures).map((ask) => askPriorityRank(ask.priority)));
  const oldestOf = (row) => Math.min(Infinity, ...openAsksOf(row.figures).map(askedTime));
  const byPriority = priorityOf(a) - priorityOf(b);
  if (byPriority !== 0 && Number.isFinite(byPriority)) return byPriority;
  const byAge = oldestOf(a) - oldestOf(b);
  return Number.isFinite(byAge) ? byAge : 0;
}

/** What an ask is for in words: a Charge ask by its kind ("Freight"), the others by their purpose. */
export const askWhat = (ask) =>
  ask?.purpose === "charge"
    ? (ask.charge_kind?.label ?? IPAS_ASK_PURPOSE_LABELS.charge)
    : (IPAS_ASK_PURPOSE_LABELS[ask?.purpose] ?? ask?.purpose);

/** A Charge ask is billed in its own currency (#1227); a supplier ask in PHP says so (#1277); the rest use the P0's. */
export const askCurrency = (ask, fallback) => (ask?.currency ? ask.currency : fallback);

/** "Down payment · €5,600.00 · 40% of the order · High priority (30% down)" for one ask. */
export function askLine(ask, currency) {
  const amount = formatAmount(Number(ask.amount), askCurrency(ask, currency));
  const note = typeof ask.note === "string" && ask.note.trim() ? ` (${ask.note.trim()})` : "";
  const percent = formatPercent(ask.percent_of_order);
  const percentText = percent ? ` · ${percent}% of the order` : "";
  const priorityText = ask.priority ? ` · ${askPriorityLabel(ask.priority)} priority` : "";
  return `${askWhat(ask)} · ${amount}${percentText}${priorityText}${note}`;
}

const openAsksByAge = (ipas, wanted) =>
  (ipas?.payment_asks ?? [])
    .filter((ask) => ask && !ask.closed_at && wanted(ask))
    .slice()
    .sort((a, b) => askedTime(a) - askedTime(b));

/** The open asks a payment on this IPAS can pay: supplier side (never a Charge ask), oldest first (#1224, #1225). */
export const payableAsks = (ipas) => openAsksByAge(ipas, (ask) => ask.purpose !== "charge");

/** The open Charge asks (#1227): only a charge can pay them, never a payment. Oldest first. */
export const chargeAsks = (ipas) => openAsksByAge(ipas, (ask) => ask.purpose === "charge");

/**
 * The kind "Record as paid" fills for an ask (#1225): Down payment fills Down payment; Balance fills Full payment
 * when the asked amount pays off what is left, otherwise Payment. A Balance asked in pesos is never compared with the
 * PO-currency balance left: it starts on Payment (#1277). Any of it can be changed before saving.
 */
export function paidKindForAsk(ask, remainingBalance) {
  if (ask?.purpose === "down_payment") return IPAS_PAYMENT_KIND.DOWN_PAYMENT;
  if (ask?.purpose === "full_payment") return IPAS_PAYMENT_KIND.FULL_PAYMENT;
  const left = Number(remainingBalance);
  if (ask?.purpose === "balance" && !isPhpCurrency(ask.currency) && Number.isFinite(left) && left > 0 && toCents(Number(ask.amount)) >= toCents(left)) {
    return IPAS_PAYMENT_KIND.FULL_PAYMENT;
  }
  return IPAS_PAYMENT_KIND.PAYMENT;
}

export const FULL_PAYMENT_TAKEN_NOTE = "There's already a payment or an open request. Use Balance for the rest.";
export const FULL_PAYMENT_ASKED_NOTE = "A Full payment is already asked.";

/**
 * Which "What for" choices are greyed out on a new request (#1280), each with its note, else null:
 *   Full payment   once the IPAS has any recorded payment or any open or paid supplier request.
 *   Down payment / Balance   while a Full payment request is open or paid.
 * Withdrawn requests and Charge requests count for nothing. The database refuses the same.
 */
export function askPurposeLocks(ipas) {
  const asks = (ipas?.payment_asks ?? []).filter((ask) => ask && ask.purpose !== "charge" && ask.closed_reason !== "withdrawn");
  const anyPayment = (ipas?.payments ?? []).length > 0;
  const fullAsked = asks.some((ask) => ask.purpose === "full_payment");
  return {
    full_payment: anyPayment || asks.length > 0 ? FULL_PAYMENT_TAKEN_NOTE : null,
    down_payment: fullAsked ? FULL_PAYMENT_ASKED_NOTE : null,
    balance: fullAsked ? FULL_PAYMENT_ASKED_NOTE : null,
  };
}

/**
 * One line per lock note, naming the greyed choices first, so the note never seems to be about the one picked:
 * "Full payment: There's already a payment or an open request. Use Balance for the rest."
 * "Down payment and Balance: A Full payment is already asked."
 */
export function lockNoteLines(purposes, locks) {
  const byNote = new Map();
  for (const value of purposes) {
    const note = locks?.[value];
    if (note) byNote.set(note, [...(byNote.get(note) ?? []), IPAS_ASK_PURPOSE_LABELS[value] ?? value]);
  }
  return [...byNote].map(([note, names]) => `${names.join(" and ")}: ${note}`);
}

/** The first of `purposes` that `locks` leaves open, so a new request never starts on a greyed choice; null when all are locked. */
export const firstOpenPurpose = (purposes, locks) => purposes.find((value) => !locks?.[value]) ?? null;

/** One line per open ask, most urgent first, or null when none is open. */
export function paymentAskHover(figures) {
  const asks = openAsksOf(figures);
  if (asks.length === 0) return null;
  return asks.map((ask) => askLine(ask, figures.currency)).join("\n");
}
