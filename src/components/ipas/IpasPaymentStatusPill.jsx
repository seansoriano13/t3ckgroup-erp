import { Check } from "lucide-react";
import StatusBadge from "../StatusBadge";
import { IPAS_ASK_PRIORITY_LABELS, IPAS_PAYMENT_STATUS, IPAS_PAYMENT_STATUS_LABELS } from "../../constants/ipas";
import { askLine, askWhat } from "../../utils/ipasPaymentAsk";
import { formatAmount } from "../../utils/ipas";
import { paidLeftText } from "../../utils/ipasFigures";

/**
 * The Payment column and the record header's Payment (ADR 0055, #1228), read from the IPAS figures
 * (`figures.paymentStatus`), never worked out here. The Status pill tracks the goods; this stays quiet:
 *   - Not due yet: nothing;
 *   - DP paid: a small bar and "N% paid · M% left", muted;
 *   - Paid: a check and "Fully paid", muted;
 *   - For payment: the one amber pill, one line per open ask (amount in the ask's own currency when it has one,
 *     else the PO's) with what it is for and its priority as a muted note. Never a nested table.
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

function AskLines({ figures }) {
  const asks = figures.paymentAsks?.length ? figures.paymentAsks : figures.paymentAsk ? [figures.paymentAsk] : [];
  const label = IPAS_PAYMENT_STATUS_LABELS[IPAS_PAYMENT_STATUS.FOR_PAYMENT];
  if (asks.length === 0) return <StatusBadge status={IPAS_PAYMENT_STATUS.FOR_PAYMENT} theme="amber" label={label} />;
  return (
    <span className="flex max-w-full flex-col items-start gap-1" data-testid="ipas-payment-asks">
      {asks.map((ask, index) => {
        const currency = ask.currency ?? figures.currency;
        const amount = formatAmount(Number(ask.amount), currency);
        const note = [askWhat(ask), IPAS_ASK_PRIORITY_LABELS[ask.priority] ?? ask.priority]
          .filter(Boolean)
          .join(" · ");
        return (
          <span
            key={ask.id ?? index}
            data-testid="ipas-payment-ask"
            title={askLine(ask, currency)}
            className="flex max-w-full flex-wrap items-center gap-x-2 gap-y-0.5"
          >
            <StatusBadge status={IPAS_PAYMENT_STATUS.FOR_PAYMENT} theme="amber" label={`${label} · ${amount}`} />
            {note && <span className={`${muted} min-w-0 truncate`}>{note}</span>}
          </span>
        );
      })}
    </span>
  );
}

export default function IpasPaymentStatusPill({ figures }) {
  const status = figures?.paymentStatus;
  if (!status || status === IPAS_PAYMENT_STATUS.NOT_DUE_YET) return null;
  let body = null;
  if (status === IPAS_PAYMENT_STATUS.FOR_PAYMENT) body = <AskLines figures={figures} />;
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
