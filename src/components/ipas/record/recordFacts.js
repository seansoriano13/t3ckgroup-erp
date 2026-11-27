// What the IPAS record window says about the IPAS above its sections: the one
// quiet line under the title and the headline pills. Pure, so the window and
// its tests read the same words.

import {
  IPAS_PRIORITY_LABELS,
  IPAS_PURPOSE_LABELS,
  IPAS_SOURCE_LABELS,
  IPAS_STATE_LABELS,
  IPAS_STATUS_LABELS,
} from "@/constants/ipas";
import { askMoneyPart, joinMoneyPart } from "@/utils/ipasPaymentAsk";
import { formatDate } from "@/utils/formatDate.js";

/** The one state badge: Open, Filed or Cancelled. */
export function ipasBadge(ipas) {
  return { label: IPAS_STATE_LABELS[ipas.state] ?? ipas.state, status: ipas.state };
}

/** "<PO> · raised 21 Oct 2026 by Ana Cruz" */
export function ipasLine(ipas) {
  const raised = `raised ${formatDate(ipas.created_at)}${ipas.creator?.name ? ` by ${ipas.creator.name}` : ""}`;
  return [ipas.po_number, raised].filter(Boolean).join(" · ");
}

/** The Status pill's words: the step, with "On-Hold ·" in front while the order is held (as on the list). */
const statusFact = (figures) => {
  const step = IPAS_STATUS_LABELS[figures?.status] ?? figures?.status ?? null;
  const goods = step && figures?.onHold ? `On-Hold · ${step}` : step;
  const money = askMoneyPart(figures);
  return joinMoneyPart(goods, money);
};

/**
 * The headline pills, in order. A fact with no value is left out by PropertyPills. `status` is merged
 * into the Status pill: the picker's options, onChange, footer and the guide beside it.
 */
export function ipasPills(ipas, figures, status = {}) {
  return [
    { key: "entity", label: "Entity", value: ipas.entity },
    { key: "priority", label: "Priority", value: IPAS_PRIORITY_LABELS[ipas.priority] },
    { key: "source", label: "Source", value: IPAS_SOURCE_LABELS[ipas.source] },
    { key: "purpose", label: "Purpose", value: IPAS_PURPOSE_LABELS[ipas.purpose] },
    { key: "status", label: "Status", value: statusFact(figures), ...status },
    { key: "sor", label: "SOR", value: (ipas.sors ?? []).map((sor) => sor.salesReference).join(", ") },
  ];
}
