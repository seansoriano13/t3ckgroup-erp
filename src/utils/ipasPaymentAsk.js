import { IPAS_ASK_PRIORITIES, IPAS_ASK_PRIORITY_LABELS, IPAS_ASK_PURPOSE_LABELS, IPAS_PAYMENT_KIND } from "../constants/ipas";
import { formatAmount } from "./ipas";
import { toCents } from "./landedCost";
import { formatPercent } from "./ipasPaymentPercent";

/** Where an ask sorts: Very High 0, High 1, Medium 2; anything else last. */
export const askPriorityRank = (priority) => {
  const index = IPAS_ASK_PRIORITIES.indexOf(priority);
  return index === -1 ? IPAS_ASK_PRIORITIES.length : index;
};

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

/** "Down payment · €5,600.00 · 40% of the order · High priority (30% down)" for one ask. */
export function askLine(ask, currency) {
  const amount = formatAmount(Number(ask.amount), currency);
  const note = typeof ask.note === "string" && ask.note.trim() ? ` (${ask.note.trim()})` : "";
  const percent = formatPercent(ask.percent_of_order);
  const percentText = percent ? ` · ${percent}% of the order` : "";
  const priorityText = ask.priority ? ` · ${IPAS_ASK_PRIORITY_LABELS[ask.priority] ?? ask.priority} priority` : "";
  return `${IPAS_ASK_PURPOSE_LABELS[ask.purpose] ?? ask.purpose} · ${amount}${percentText}${priorityText}${note}`;
}

/** The open asks a payment on this IPAS can pay: supplier side (not Freight), oldest first (#1224, #1225). */
export const payableAsks = (ipas) =>
  (ipas?.payment_asks ?? [])
    .filter((ask) => ask && !ask.closed_at && ask.purpose !== "freight")
    .slice()
    .sort((a, b) => askedTime(a) - askedTime(b));

/**
 * The kind "Record as paid" fills for an ask (#1225): Down payment fills Down payment; Balance fills Full payment
 * when the asked amount pays off what is left, otherwise Payment. Any of it can be changed before saving.
 */
export function paidKindForAsk(ask, remainingBalance) {
  if (ask?.purpose === "down_payment") return IPAS_PAYMENT_KIND.DOWN_PAYMENT;
  const left = Number(remainingBalance);
  if (ask?.purpose === "balance" && Number.isFinite(left) && left > 0 && toCents(Number(ask.amount)) >= toCents(left)) {
    return IPAS_PAYMENT_KIND.FULL_PAYMENT;
  }
  return IPAS_PAYMENT_KIND.PAYMENT;
}

/** One line per open ask, most urgent first, or null when none is open. */
export function paymentAskHover(figures) {
  const asks = openAsksOf(figures);
  if (asks.length === 0) return null;
  return asks.map((ask) => askLine(ask, figures.currency)).join("\n");
}
