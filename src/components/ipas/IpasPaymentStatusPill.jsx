import { Check } from "lucide-react";
import { IPAS_PAYMENT_STATUS, IPAS_PAYMENT_STATUS_LABELS } from "../../constants/ipas";
import { askCurrency, askLine, askPriorityLabel, askWhat } from "../../utils/ipasPaymentAsk";
import { formatAmount } from "../../utils/ipas";
import { paidLeftText } from "../../utils/ipasFigures";

/**
 * The Payment column and the record header's Payment (ADR 0055, #1228), read from the IPAS figures
 * (`figures.paymentStatus`), never worked out here. This stays quiet:
 *   - Not due yet: nothing;
 *   - DP paid: a small bar and "N% paid · M% left", muted;
 *   - Paid: a check and "Fully paid", muted;
 *   - For payment: plain text, one line per open ask: the amount (in the ask's own currency when it has one,
 *     else the PO's) and what it is for, muted. No chip: the Status says "For Payment" once (2026-11-27). The
 *     list has its own Priority column; the record header passes `withPriority` to add it. Never a nested table.
 * A cancelled IPAS has none.
 */
const muted = "text-xs text-muted-foreground";

const shown = (value) => Number(Number(value).toFixed(1));

function PaidBar({ figures }) {
  const paid = Math.min(100, Math.max(0, Number(figures.paidPercent) || 0));
  const text = paidLeftText(figures);
  return (
    <span className="inline-flex max-w-full items-center gap-2" data-testid="ipas-payment-progress">
      <span aria-hidden="true" className="h-1.5 w-12 shrink-0 overflow-hidden rounded-full bg-muted">
        <span className="block h-full rounded-full bg-muted-foreground/60" style={{ width: `${paid}%` }} />
      </span>
      <span className={muted}>{text ? text.replace(", ", " · ") : `${shown(paid)}% paid`}</span>
    </span>
  );
}

function AskLines({ figures, withPriority }) {
  const asks = figures.paymentAsks?.length ? figures.paymentAsks : figures.paymentAsk ? [figures.paymentAsk] : [];
  if (asks.length === 0) return <span className={muted}>{IPAS_PAYMENT_STATUS_LABELS[IPAS_PAYMENT_STATUS.FOR_PAYMENT]}</span>;
  return (
    <span className="flex max-w-full flex-col items-start gap-0.5" data-testid="ipas-payment-asks">
      {asks.map((ask, index) => {
        const currency = askCurrency(ask, figures.currency);
        const amount = formatAmount(Number(ask.amount), currency);
        const note = [askWhat(ask), withPriority ? askPriorityLabel(ask.priority) : null].filter(Boolean).join(" · ");
        return (
          <span
            key={ask.id ?? index}
            data-testid="ipas-payment-ask"
            title={askLine(ask, currency)}
            className="flex max-w-full items-baseline gap-x-1.5 whitespace-nowrap text-xs"
          >
            <span className="font-medium tabular-nums text-foreground">{amount}</span>
            {note && <span className="min-w-0 truncate text-muted-foreground">· {note}</span>}
          </span>
        );
      })}
    </span>
  );
}

export default function IpasPaymentStatusPill({ figures, withPriority = false }) {
  const status = figures?.paymentStatus;
  if (!status || status === IPAS_PAYMENT_STATUS.NOT_DUE_YET) return null;
  let body = null;
  if (status === IPAS_PAYMENT_STATUS.FOR_PAYMENT) body = <AskLines figures={figures} withPriority={withPriority} />;
  else if (status === IPAS_PAYMENT_STATUS.DP_PAID) body = <PaidBar figures={figures} />;
  else if (status === IPAS_PAYMENT_STATUS.PAID)
    body = (
      <span className="inline-flex items-center gap-1">
        <Check aria-hidden="true" className="size-3.5 text-muted-foreground" />
        <span className={muted}>Fully paid</span>
      </span>
    );
  return (
    <span data-testid="ipas-payment-status-pill" data-payment-status={status} className="inline-flex max-w-full">
      {body}
    </span>
  );
}
