// The "For payment" pieces of the record's money rows (#1225), written so Charges reuse them (#1227):
//   PaidOrAskChoice  the required "Paid already / For payment (not paid yet)" pick on a new row
//   AskDraftFields   the ask's own boxes: % of order, amount, what for, priority, note
//   AskLiners        the open asks as grey one-line rows above the rows being edited, with Record as paid, Edit, Withdraw
// The grey row inside the read-only table is `IpasAskTableRow` (../IpasPaymentsTable.jsx); both read an ask with askLine.

import { Pencil, Undo2, WalletCards } from "lucide-react";

import StatusBadge from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { FieldBox } from "@/components/ui/FieldBox";
import { RequiredMark } from "@/components/ui/RequiredMark";
import { IPAS_ASK_PRIORITIES, IPAS_ASK_PRIORITY_LABELS, IPAS_ASK_PURPOSE_LABELS } from "@/constants/ipas";
import { cn } from "@/lib/utils";
import { askLine, askWhat } from "@/utils/ipasPaymentAsk";
import { afterPercentEdit, parsePercentInput } from "@/utils/ipasPaymentPercent";
import { parseAmountInput } from "@/utils/ipasPayments";
import { Field, NeededTag, PickField } from "./FormFields";
import { blank } from "./formHelpers";

const OPTIONS = [
  { value: "paid", label: "Paid already", help: "The money has gone out. Add the date, method and proof." },
  { value: "ask", label: "For payment (not paid yet)", help: "Asks the Payers to pay it. No date, method or proof needed." },
];

/** "Paid already" or "For payment (not paid yet)": nothing is picked until the user picks, and it is required. */
export function PaidOrAskChoice({ id, value, disabled, onChange }) {
  const needed = blank(value);
  return (
    <div className="min-w-0" data-testid="payment-mode-choice">
      <FieldBox label={<>Is it paid yet?<RequiredMark />{needed && <NeededTag />}</>} bare>
        <div id={id} role="radiogroup" aria-label="Paid already or for payment" aria-required="true" className="grid gap-2 sm:grid-cols-2">
          {OPTIONS.map((option) => {
            const checked = value === option.value;
            return (
              <Button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={checked}
                disabled={disabled}
                variant="outline"
                onClick={() => onChange(option.value)}
                className={cn(
                  "h-auto flex-col items-start gap-0 whitespace-normal px-3 py-2 text-left",
                  needed && "border-amber-7 bg-amber-a1",
                  checked && "border-foreground bg-muted",
                )}
              >
                <span className="text-sm font-semibold">{option.label}</span>
                <span className="text-xs font-normal text-muted-foreground">{option.help}</span>
              </Button>
            );
          })}
        </div>
      </FieldBox>
    </div>
  );
}

/**
 * What an ask takes (#1225). `row` holds `amount`, `percentOfOrder`, `askPurpose`, `askPriority`, `askNote`;
 * `purposes` are the "what for" values on offer; `base` is where a % is taken from (null: the % cannot fill the amount).
 */
export function AskDraftFields({ id, row, purposes, currencyLabel, prefix, base, disabled, onPatch }) {
  const amount = parseAmountInput(row.amount);
  const percent = parsePercentInput(row.percentOfOrder);
  const purposeOptions = purposes.map((value) => ({ value, label: IPAS_ASK_PURPOSE_LABELS[value] }));
  const priorityOptions = IPAS_ASK_PRIORITIES.map((value) => ({ value, label: IPAS_ASK_PRIORITY_LABELS[value] }));
  return (
    <div className="space-y-3" data-testid="payment-ask-fields">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <PickField id={id("askPurpose")} label="What for" options={purposeOptions} value={row.askPurpose} disabled={disabled} onChange={(v) => onPatch({ askPurpose: v })} />
        <div className="min-w-0">
          <Field
            id={id("percentOfOrder")}
            label="% of order"
            placeholder="e.g. 30"
            value={row.percentOfOrder}
            disabled={disabled}
            error={row.percentOfOrder !== "" && !percent.ok ? "Not a percent" : undefined}
            onChange={(v) => onPatch(afterPercentEdit(row, { field: "percent", value: v, base }))}
          />
          <p className="mt-1 pl-1 text-xs text-muted-foreground">
            {base ? `Worked out from the ${base.label}. Type a different amount and the % is cleared.` : "No P.I/QT Amount or PO total yet, so the % can't fill the amount."}
          </p>
        </div>
        <Field
          id={id("amount")}
          label={currencyLabel}
          kind="amount"
          prefix={prefix}
          required
          value={row.amount}
          disabled={disabled}
          error={row.amount !== "" && !amount.ok ? "Not a number" : undefined}
          onChange={(v) => onPatch(afterPercentEdit(row, { field: "amount", value: v, base }))}
        />
        <PickField id={id("askPriority")} label="Priority" required options={priorityOptions} value={row.askPriority} disabled={disabled} onChange={(v) => onPatch({ askPriority: v })} />
        <div className="min-w-0 sm:col-span-2">
          <Field id={id("askNote")} label="Note (optional)" value={row.askNote} disabled={disabled} onChange={(v) => onPatch({ askNote: v })} />
        </div>
      </div>
      <p className="text-xs text-muted-foreground">Nothing counts as paid. The Payers see this IPAS as For payment until the payment that pays it is recorded or you withdraw it.</p>
    </div>
  );
}

/**
 * The open asks as grey one-line rows: "Not paid yet", then the ask in one line (what for, amount, % of order,
 * priority, note). `canRecord` shows Record as paid, Edit and Withdraw; `recording` is the ids of asks a new payment
 * below already pays (their Record as paid waits).
 */
export function AskLiners({ asks, currency, canRecord, recording = [], onRecord, onEdit, onWithdraw }) {
  if (asks.length === 0) return null;
  return (
    <ul className="space-y-2" data-testid="payment-ask-liners" aria-label="Asked for payment, not paid yet">
      {asks.map((ask) => (
        <li
          key={ask.id}
          data-testid="payment-ask-liner"
          className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-dashed border-mauve-7 bg-mauve-2 px-3 py-2.5 text-[13px] text-muted-foreground"
        >
          <StatusBadge theme="mauve" label="Not paid yet" />
          <span className="min-w-0 flex-1 basis-60 text-foreground/80">{askLine(ask, currency)}</span>
          {canRecord && (
            <span className="flex shrink-0 flex-wrap gap-1.5">
              <Button type="button" size="sm" variant="outline" className="gap-1.5" disabled={recording.includes(ask.id)} onClick={() => onRecord(ask)}>
                <WalletCards size={14} aria-hidden="true" />
                Record as paid
              </Button>
              <Button type="button" size="sm" variant="ghost" className="gap-1.5" aria-label={`Edit ${askWhat(ask)}`} onClick={() => onEdit(ask)}>
                <Pencil size={13} aria-hidden="true" />
                Edit
              </Button>
              <Button type="button" size="sm" variant="ghost" className="gap-1.5 text-muted-foreground hover:text-red-11" aria-label={`Withdraw ${askWhat(ask)}`} onClick={() => onWithdraw(ask)}>
                <Undo2 size={13} aria-hidden="true" />
                Withdraw
              </Button>
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}

/**
 * A Charge ask's boxes (#1227): which charge, the currency it is billed in (PHP to start), the amount in that
 * currency, the priority and a note. `row` is a charge draft (`kindId`, `amountPhp`, `askCurrency`, `askPriority`,
 * `askNote`); `kinds` are the charge-kind options on offer.
 */
export function ChargeAskFields({ id, row, kinds, disabled, onPatch }) {
  const amount = parseAmountInput(row.amountPhp);
  const currency = (row.askCurrency ?? "").trim().toUpperCase();
  const priorityOptions = IPAS_ASK_PRIORITIES.map((value) => ({ value, label: IPAS_ASK_PRIORITY_LABELS[value] }));
  return (
    <div className="space-y-3" data-testid="charge-ask-fields">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <PickField id={id("kindId")} label="Kind" required placeholder="Pick a kind" options={kinds} value={row.kindId} disabled={disabled} onChange={(v) => onPatch({ kindId: v })} />
        <Field
          id={id("askCurrency")}
          label="Billed in (currency)"
          required
          placeholder="PHP"
          value={row.askCurrency}
          disabled={disabled}
          error={currency !== "" && !/^[A-Z]{3}$/.test(currency) ? "Three letters, like PHP" : undefined}
          onChange={(v) => onPatch({ askCurrency: v.toUpperCase() })}
        />
        <Field
          id={id("amountPhp")}
          label={`Amount${currency ? ` (${currency})` : ""}`}
          kind="amount"
          prefix={currency || undefined}
          required
          value={row.amountPhp}
          disabled={disabled}
          error={row.amountPhp !== "" && !amount.ok ? "Not a number" : undefined}
          onChange={(v) => onPatch({ amountPhp: v })}
        />
        <PickField id={id("askPriority")} label="Priority" required options={priorityOptions} value={row.askPriority} disabled={disabled} onChange={(v) => onPatch({ askPriority: v })} />
        <div className="min-w-0 sm:col-span-2 lg:col-span-4">
          <Field id={id("askNote")} label="Note (optional)" value={row.askNote} disabled={disabled} onChange={(v) => onPatch({ askNote: v })} />
        </div>
      </div>
      <p className="text-xs text-muted-foreground">Nothing counts as a charge yet. The Payers see this IPAS as For payment until the charge that pays it is recorded or you withdraw it.</p>
    </div>
  );
}
