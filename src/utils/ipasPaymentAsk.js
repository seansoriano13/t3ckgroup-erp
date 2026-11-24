import { IPAS_ASK_PRIORITIES, IPAS_ASK_PRIORITY_LABELS, IPAS_ASK_PURPOSE_LABELS } from "../constants/ipas";
import { formatAmount } from "./ipas";
import { formatPercent } from "./ipasPaymentPercent";

/** Where an ask sorts: Very High 0, High 1, Medium 2; anything else last. */
export const askPriorityRank = (priority) => {
  const index = IPAS_ASK_PRIORITIES.indexOf(priority);
  return index === -1 ? IPAS_ASK_PRIORITIES.length : index;
};

/** The Payment Forecast order: Very High first, then the oldest ask. Rows are list rows with `figures`. */
export function comparePaymentForecast(a, b) {
  const byPriority = askPriorityRank(a.figures?.paymentAsk?.priority) - askPriorityRank(b.figures?.paymentAsk?.priority);
  if (byPriority !== 0) return byPriority;
  const at = (row) => {
    const time = new Date(row.figures?.paymentAsk?.asked_at).getTime();
    return Number.isFinite(time) ? time : Infinity;
  };
  return at(a) - at(b);
}

/** "Down payment · €5,600.00 · 40% of the order · High priority (30% down)" for an open ask, or null. */
export function paymentAskHover(figures) {
  const ask = figures?.paymentAsk;
  if (!ask) return null;
  const amount = formatAmount(Number(ask.amount), figures.currency);
  const note = typeof ask.note === "string" && ask.note.trim() ? ` (${ask.note.trim()})` : "";
  const percent = formatPercent(ask.percent_of_order);
  const percentText = percent ? ` · ${percent}% of the order` : "";
  const priorityText = ask.priority ? ` · ${IPAS_ASK_PRIORITY_LABELS[ask.priority] ?? ask.priority} priority` : "";
  return `${IPAS_ASK_PURPOSE_LABELS[ask.purpose] ?? ask.purpose} · ${amount}${percentText}${priorityText}${note}`;
}
