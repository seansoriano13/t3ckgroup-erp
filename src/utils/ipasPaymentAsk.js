import { IPAS_ASK_PURPOSE_LABELS } from "../constants/ipas";
import { formatAmount } from "./ipas";

/** "Down payment · €5,600.00 (30% down)" for an open ask, or null. */
export function paymentAskHover(figures) {
  const ask = figures?.paymentAsk;
  if (!ask) return null;
  const amount = formatAmount(Number(ask.amount), figures.currency);
  const note = typeof ask.note === "string" && ask.note.trim() ? ` (${ask.note.trim()})` : "";
  return `${IPAS_ASK_PURPOSE_LABELS[ask.purpose] ?? ask.purpose} · ${amount}${note}`;
}
