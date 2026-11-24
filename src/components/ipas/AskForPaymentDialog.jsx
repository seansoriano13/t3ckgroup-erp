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
  IPAS_ASK_PRIORITIES,
  IPAS_ASK_PRIORITY_LABELS,
  IPAS_ASK_PURPOSES,
  IPAS_ASK_PURPOSE_LABELS,
} from "@/constants/ipas";
import { ipasErrorMessage } from "@/utils/ipas";
import { parseAmountInput } from "@/utils/ipasPayments";
import { paymentAskHover } from "@/utils/ipasPaymentAsk";
import { amountFromPercent, parsePercentInput, percentBase, PERCENT_ERROR } from "@/utils/ipasPaymentPercent";

const PURPOSE_OPTIONS = IPAS_ASK_PURPOSES.map((value) => ({ value, label: IPAS_ASK_PURPOSE_LABELS[value] }));
const PRIORITY_OPTIONS = IPAS_ASK_PRIORITIES.map((value) => ({ value, label: IPAS_ASK_PRIORITY_LABELS[value] }));

/**
 * "Ask for payment" (ADR 0055): Purchasing says how much, in the P0's currency, and what for, so the General Manager
 * sees the IPAS as For payment. While an ask is open the dialog shows it and offers to withdraw it instead (an IPAS
 * has one open ask at a time; recording a payment closes it). `initial` ({ purpose, amount }) pre-fills a new ask (#1209). `onAsk({ amount, purpose, note, priority, percent })` and `onWithdraw()`
 * return promises; the dialog closes when they resolve and says why in itself when they fail. Mounted only while open.
 */
export default function AskForPaymentDialog({ open, onOpenChange, ...body }) {
  return open ? <Body {...body} onClose={() => onOpenChange(false)} /> : null;
}

function Body({ number, figures, initial, onAsk, onWithdraw, onClose }) {
  const openAsk = figures?.paymentAsk ?? null;
  const owed = Number(initial?.amount);
  const [amount, setAmount] = useState(Number.isFinite(owed) && owed > 0 ? String(owed) : "");
  const [purpose, setPurpose] = useState(initial?.purpose ?? "down_payment");
  const [note, setNote] = useState("");
  const [priority, setPriority] = useState(IPAS_ASK_DEFAULT_PRIORITY);
  const [percent, setPercent] = useState("");
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState(null);

  const parsed = parseAmountInput(amount);
  const percentRead = parsePercentInput(percent);
  const valid = parsed.ok && parsed.value !== null && parsed.value > 0 && percentRead.ok && Boolean(priority);
  const currency = figures?.currency ? ` (${figures.currency})` : "";
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

  const title = openAsk ? `Payment asked on ${number}` : `Ask for payment on ${number}`;
  return (
    <ModalShell
      open
      onOpenChange={(next) => !next && onClose()}
      crumbs={["IPAS", title]}
      title={title}
      actions={
        openAsk ? (
          <Button disabled={saving} variant="outline" onClick={() => run(() => onWithdraw())}>
            {saving ? "Saving…" : "Withdraw ask"}
          </Button>
        ) : (
          <Button disabled={saving || !valid} onClick={() => run(() => onAsk({ amount: parsed.value, purpose, note: note.trim() || null, priority, percent: percentRead.value }))}>
            {saving ? "Saving…" : "Ask for payment"}
          </Button>
        )
      }
    >
      {openAsk ? (
        <p className="rounded-lg border border-border bg-muted/40 p-3 text-sm text-foreground" data-testid="payment-ask-open">
          {paymentAskHover(figures)}. Recording a payment closes this ask. Withdraw it if it was a mistake.
        </p>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            The General Manager sees this IPAS as For payment until the payment is recorded or you withdraw the ask.
          </p>
          <FieldBox label={base ? `% of order (optional, of the ${base.label})` : "% of order (optional)"} htmlFor="ask-percent" bare>
            <Input id="ask-percent" inputMode="decimal" value={percent} onChange={(e) => typePercent(e.target.value)} placeholder="e.g. 40" />
          </FieldBox>
          {!percentRead.ok && (
            <p role="alert" className="text-xs text-red-11">
              {PERCENT_ERROR}
            </p>
          )}
          <FieldBox label={`Amount${currency}`} htmlFor="ask-amount" bare>
            <Input id="ask-amount" inputMode="decimal" value={amount} onChange={(e) => typeAmount(e.target.value)} autoFocus />
          </FieldBox>
          <FieldBox label="Priority" htmlFor="ask-priority" required bare>
            <SelectField id="ask-priority" size="sm" options={PRIORITY_OPTIONS} value={priority} onChange={setPriority} className="h-10 w-full" />
          </FieldBox>
          <FieldBox label="What for" htmlFor="ask-purpose" bare>
            <SelectField id="ask-purpose" size="sm" options={PURPOSE_OPTIONS} value={purpose} onChange={setPurpose} className="h-10 w-full" />
          </FieldBox>
          <FieldBox label="Note (optional)" bare>
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={300} />
          </FieldBox>
        </>
      )}
      {failure && <InlineError message={failure} busy={saving} onDismiss={() => setFailure(null)} />}
    </ModalShell>
  );
}
