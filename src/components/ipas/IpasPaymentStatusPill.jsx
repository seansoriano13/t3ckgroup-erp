import StatusBadge from "../StatusBadge";
import { IPAS_PAYMENT_STATUS, IPAS_PAYMENT_STATUS_LABELS } from "../../constants/ipas";
import { paymentAskHover } from "../../utils/ipasPaymentAsk";
import { paidLeftText } from "../../utils/ipasFigures";

/**
 * The Payment status pill (ADR 0055), beside the IPAS Status and separate from it. Read from the IPAS figures
 * (`figures.paymentStatus`), never worked out here; a cancelled IPAS has none and no pill. While an ask is open the
 * hover says how much and what for, and the note when there is one.
 */
const THEME = {
  [IPAS_PAYMENT_STATUS.NOT_DUE_YET]: "mauve",
  [IPAS_PAYMENT_STATUS.FOR_PAYMENT]: "amber",
  [IPAS_PAYMENT_STATUS.DP_PAID]: "blue",
  [IPAS_PAYMENT_STATUS.PAID]: "green",
};

export default function IpasPaymentStatusPill({ figures, className = "" }) {
  const status = figures?.paymentStatus;
  if (!status) return null;
  const name = IPAS_PAYMENT_STATUS_LABELS[status] ?? status;
  // #1207: "DP paid · 70% paid, 30% left", from the amounts.
  const label = status === IPAS_PAYMENT_STATUS.DP_PAID ? `${name}${paidLeftText(figures) ? ` · ${paidLeftText(figures)}` : ""}` : name;
  const hover = paymentAskHover(figures);
  return (
    <span data-testid="ipas-payment-status-pill" data-payment-status={status} className="inline-flex max-w-full">
      <StatusBadge status={status} theme={THEME[status]} label={label} className={className} title={hover ? `${label}: ${hover}` : label} />
    </span>
  );
}
