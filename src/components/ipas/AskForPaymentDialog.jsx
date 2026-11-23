import { useState } from "react";

import { Button } from "@/components/ui/button";
import ModalShell from "@/components/ui/ModalShell";
import { FieldBox } from "@/components/ui/FieldBox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { SelectField } from "@/components/ui/SelectField";
import InlineError from "@/components/record/InlineError";
import { IPAS_ASK_PURPOSES, IPAS_ASK_PURPOSE_LABELS } from "@/constants/ipas";
import { ipasErrorMessage } from "@/utils/ipas";
import { parseAmountInput } from "@/utils/ipasPayments";
import { paymentAskHover } from "@/utils/ipasPaymentAsk";

const PURPOSE_OPTIONS = IPAS_ASK_PURPOSES.map((value) => ({ value, label: IPAS_ASK_PURPOSE_LABELS[value] }));

/**
 * "Ask for payment" (ADR 0055): Purchasing says how much, in the P0's currency, and what for, so the General Manager
 * sees the IPAS as For payment. While an ask is open the dialog shows it and offers to withdraw it instead (an IPAS
 * has one open ask at a time; recording a payment closes it). `onAsk({ amount, purpose, note })` and `onWithdraw()`
 * return promises; the dialog closes when they resolve and says why in itself when they fail. Mounted only while open.
 */
export default function AskForPaymentDialog({ open, onOpenChange, ...body }) {
  return open ? <Body {...body} onClose={() => onOpenChange(false)} /> : null;
}

function Body({ number, figures, onAsk, onWithdraw, onClose }) {
  const openAsk = figures?.paymentAsk ?? null;
  const [amount, setAmount] = useState("");
  const [purpose, setPurpose] = useState("down_payment");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState(null);

  const parsed = parseAmountInput(amount);
  const valid = parsed.ok && parsed.value !== null && parsed.value > 0;
  const currency = figures?.currency ? ` (${figures.currency})` : "";

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
          <Button disabled={saving || !valid} onClick={() => run(() => onAsk({ amount: parsed.value, purpose, note: note.trim() || null }))}>
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
          <FieldBox label={`Amount${currency}`} htmlFor="ask-amount" bare>
            <Input id="ask-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus />
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
