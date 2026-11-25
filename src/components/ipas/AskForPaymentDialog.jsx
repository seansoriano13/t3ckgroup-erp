import { useState } from "react";

import { Button } from "@/components/ui/button";
import ModalShell from "@/components/ui/ModalShell";
import { FieldBox } from "@/components/ui/FieldBox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { SelectField } from "@/components/ui/SelectField";
import InlineError from "@/components/record/InlineError";
import {
  IPAS_ASK_DEFAULT_PRIORITY,
  IPAS_ASK_PURPOSES,
  IPAS_ASK_PURPOSE_LABELS,
} from "@/constants/ipas";
import { ipasErrorMessage } from "@/utils/ipas";
import { parseAmountInput } from "@/utils/ipasPayments";
import { askLine, askPriorityOptions } from "@/utils/ipasPaymentAsk";
import { amountFromPercent, parsePercentInput, percentBase, PERCENT_ERROR } from "@/utils/ipasPaymentPercent";

// A Charge ask is made from Charges (#1227), with its kind and currency.
const PURPOSE_OPTIONS = IPAS_ASK_PURPOSES.filter((value) => value !== "charge").map((value) => ({ value, label: IPAS_ASK_PURPOSE_LABELS[value] }));
const PRIORITY_OPTIONS = askPriorityOptions();

/**
 * "Ask for payment" (ADR 0055): Purchasing, Finance or a Super Admin says how much, in the P0's currency, and what
 * for, so the Payers see the IPAS as For payment. An IPAS may have several asks open at once (#1224): each is listed
 * with Edit and Withdraw, and a payment saved as paying it is what closes it. `initial` ({ purpose, amount })
 * pre-fills a new ask (#1209). `onAsk({ amount, purpose, note, priority, percent })`, `onEdit(askId, { amount,
 * priority, note, percent })` and `onWithdraw(askId)` return promises; the dialog closes when they resolve and says
 * why in itself when they fail. Mounted only while open.
 */
export default function AskForPaymentDialog({ open, onOpenChange, ...body }) {
  return open ? <Body {...body} onClose={() => onOpenChange(false)} /> : null;
}

function Body({ number, figures, initial, only, onAsk, onEdit, onWithdraw, onClose }) {
  // `only` (#1225): opened from an ask's grey row to change just that ask. Cancel and Save both close it.
  const openAsks = only ? [] : (figures?.paymentAsks ?? []);
  const [editing, setEditing] = useState(only ?? null); // the open ask being changed, or null for a new one
  const owed = Number(initial?.amount);
  const [amount, setAmount] = useState(only ? String(only.amount) : Number.isFinite(owed) && owed > 0 ? String(owed) : "");
  const [purpose, setPurpose] = useState(initial?.purpose ?? "down_payment");
  const [note, setNote] = useState(only?.note ?? "");
  const [priority, setPriority] = useState(only?.priority ?? IPAS_ASK_DEFAULT_PRIORITY);
  const [percent, setPercent] = useState(only?.percent_of_order ? String(Number(only.percent_of_order)) : "");
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState(null);

  // A Charge ask has no % of order (it applies to a supplier ask only).
  const isCharge = editing?.purpose === "charge";
  const parsed = parseAmountInput(amount);
  const percentRead = parsePercentInput(percent);
  const valid = parsed.ok && parsed.value !== null && parsed.value > 0 && (isCharge || percentRead.ok) && Boolean(priority);
  const askCurrency = editing?.currency ?? figures?.currency;
  const currency = askCurrency ? ` (${askCurrency})` : "";
  // The same base as a payment's percent: the P.I/QT Amount, else the P0 total.
  const base = percentBase({ piQtAmount: figures?.piAmount, poTotal: figures?.poTotal });

  // Typing a percent fills the amount; typing the amount by hand clears the percent (it would be a wrong label).
  const typePercent = (text) => {
    setPercent(text);
    const read = parsePercentInput(text);
    if (read.ok && read.value !== null) {
      const filled = amountFromPercent(read.value, base);
      if (filled !== null) setAmount(String(filled));
    }
  };
  const typeAmount = (text) => {
    setAmount(text);
    const filled = percentRead.ok && percentRead.value !== null ? amountFromPercent(percentRead.value, base) : null;
    const typed = parseAmountInput(text);
    if (!(typed.ok && filled !== null && typed.value === filled)) setPercent("");
  };

  const startEdit = (ask) => {
    setEditing(ask);
    setAmount(String(ask.amount));
    setPriority(ask.priority ?? IPAS_ASK_DEFAULT_PRIORITY);
    setNote(ask.note ?? "");
    setPercent(ask.percent_of_order ? String(Number(ask.percent_of_order)) : "");
    setFailure(null);
  };

  const run = async (action) => {
    setSaving(true);
    setFailure(null);
    try {
      await action();
      onClose();
    } catch (error) {
      setFailure(ipasErrorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  const values = { amount: parsed.value, note: note.trim() || null, priority, percent: isCharge ? null : percentRead.value };
  const title = only ? `Change the ask on ${number}` : openAsks.length > 0 ? `Payment asks on ${number}` : `Ask for payment on ${number}`;
  return (
    <ModalShell
      open
      onOpenChange={(next) => !next && onClose()}
      crumbs={["IPAS", title]}
      title={title}
      actions={
        editing ? (
          <>
            {/* Opened for one ask, the shell's own Cancel closes it (#1236); from the list of asks, this goes back to it. */}
            {!only && (
              <Button disabled={saving} variant="outline" onClick={() => setEditing(null)}>
                Back
              </Button>
            )}
            <Button disabled={saving || !valid} onClick={() => run(() => onEdit(editing.id, values))}>
              {saving ? "Saving…" : "Save changes"}
            </Button>
          </>
        ) : (
          <Button disabled={saving || !valid} onClick={() => run(() => onAsk({ ...values, purpose }))}>
            {saving ? "Saving…" : "Ask for payment"}
          </Button>
        )
      }
    >
      {openAsks.length > 0 && (
        <ul className="space-y-2" data-testid="payment-asks-open">
          {openAsks.map((ask) => (
            <li
              key={ask.id}
              data-testid="payment-ask-open"
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-muted/40 p-3 text-sm text-foreground"
            >
              <span className="min-w-0 flex-1">{askLine(ask, figures?.currency)}</span>
              <span className="flex shrink-0 gap-2">
                <Button size="sm" variant="outline" disabled={saving} onClick={() => startEdit(ask)}>
                  Edit
                </Button>
                <Button size="sm" variant="outline" disabled={saving} onClick={() => run(() => onWithdraw(ask.id))}>
                  Withdraw
                </Button>
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="text-sm text-muted-foreground">
        {editing
          ? "Changing this ask. Its purpose stays as it is."
          : openAsks.length > 0
            ? "Add another ask below. Each one closes when a payment saved as paying it is recorded, or when you withdraw it."
            : "The Payers see this IPAS as For payment until the payment that pays it is recorded or you withdraw the ask."}
      </p>
      {!isCharge && (
        <FieldBox label={base ? `% of order (optional, of the ${base.label})` : "% of order (optional)"} htmlFor="ask-percent" bare>
          <Input id="ask-percent" inputMode="decimal" value={percent} onChange={(e) => typePercent(e.target.value)} placeholder="e.g. 40" />
        </FieldBox>
      )}
      {!isCharge && !percentRead.ok && (
        <p role="alert" className="text-xs text-red-11">
          {PERCENT_ERROR}
        </p>
      )}
      <FieldBox label={`Amount${currency}`} htmlFor="ask-amount" required bare>
        <Input id="ask-amount" inputMode="decimal" value={amount} onChange={(e) => typeAmount(e.target.value)} />
      </FieldBox>
      <FieldBox label="Priority" htmlFor="ask-priority" required bare>
        <SelectField id="ask-priority" size="sm" options={PRIORITY_OPTIONS} value={priority} onChange={setPriority} className="h-10 w-full" />
      </FieldBox>
      {!editing && (
        <FieldBox label="What for" htmlFor="ask-purpose" required bare>
          <SelectField id="ask-purpose" size="sm" options={PURPOSE_OPTIONS} value={purpose} onChange={setPurpose} className="h-10 w-full" />
        </FieldBox>
      )}
      <FieldBox label="Note (optional)" bare>
        <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={300} />
      </FieldBox>
      {failure && <InlineError message={failure} busy={saving} onDismiss={() => setFailure(null)} />}
    </ModalShell>
  );
}
