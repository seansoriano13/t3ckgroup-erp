import { IPAS_ASK_PRIORITIES, IPAS_ASK_PRIORITY_LABELS, IPAS_ASK_PURPOSE_LABELS } from "../constants/ipas";
import { formatAmount } from "./ipas";
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

/** One line per open ask, most urgent first, or null when none is open. */
export function paymentAskHover(figures) {
  const asks = openAsksOf(figures);
  if (asks.length === 0) return null;
  return asks.map((ask) => askLine(ask, figures.currency)).join("\n");
}
