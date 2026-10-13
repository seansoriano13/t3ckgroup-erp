import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { Paperclip, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FieldBox } from "@/components/ui/FieldBox";
import { FileInput } from "@/components/ui/FileInput";
import { Input } from "@/components/ui/input";
import { SelectField } from "@/components/ui/SelectField";
import { ExternalLink } from "@/components/ui/external-link";
import Spinner from "@/components/ui/Spinner";
import { ipasService } from "../../services/ipasService";
import { storageService } from "../../services/storageService";
import {
  IPAS_OPTION_LIST,
  IPAS_PAYMENT_KIND,
  IPAS_PAYMENT_KINDS,
  IPAS_PAYMENT_KIND_LABELS,
} from "../../constants/ipas";
import { MAX_ATTACHMENT_BYTES, formatBytes, isAllowedAttachment } from "../../utils/attachments";
import { getCurrentLocalDate } from "../../utils/formatDate.js";
import { ipasErrorMessage } from "../../utils/ipas";
import { isIsoDate, optionsForPicker, parseAmountInput } from "../../utils/ipasPayments";
import { isPhpCurrency } from "../../utils/landedCost";
import { ipasKey, ipasListKey } from "./ipasKeys";

const KIND_OPTIONS = IPAS_PAYMENT_KINDS.map((value) => ({ value, label: IPAS_PAYMENT_KIND_LABELS[value] }));

const asText = (value) => (value === null || value === undefined ? "" : String(value));

/**
 * Record or edit one payment on an IPAS (#244). Purchasing and Finance.
 *
 * The amount is in the PO's currency; on a foreign-currency PO the PHP
 * actually debited is required (it is what makes the rate real), and the
 * charge fee is always PHP. Numbers are typed as text and read tolerantly, so
 * a half-typed value only keeps Save disabled; it never throws.
 *
 * Mounted only while open, so the form starts from the payment as it stands.
 * `payment` null adds one. A deactivated method already on the payment stays
 * pickable; new payments only offer active ones.
 */
export default function PaymentDialog({ open, onOpenChange, ipas, payment = null }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open && <Body ipas={ipas} payment={payment} onClose={() => onOpenChange(false)} />}
    </Dialog>
  );
}

function Body({ ipas, payment, onClose }) {
  const queryClient = useQueryClient();
  const editing = Boolean(payment);
  const isPhpPo = isPhpCurrency(ipas.currency);
  const currency = ipas.currency || "PO currency";

  const [form, setForm] = useState({
    kind: payment?.kind ?? IPAS_PAYMENT_KIND.PAYMENT,
    paidOn: payment?.paid_on ?? getCurrentLocalDate(),
    amount: asText(payment?.amount),
    phpDebited: asText(payment?.php_debited),
    chargeFeePhp: payment && payment.charge_fee_php ? asText(payment.charge_fee_php) : "",
    methodId: payment?.method_id ?? "",
    checkNo: payment?.check_no ?? "",
  });
  const [proofUrl, setProofUrl] = useState(payment?.proof_url ?? "");
  const [proofName, setProofName] = useState("");
  const [uploading, setUploading] = useState(false);

  const methods = optionsForPicker(ipas.options ?? [], IPAS_OPTION_LIST.PAYMENT_METHOD, payment?.method_id).map(
    (option) => ({ value: option.id, label: option.active ? option.label : `${option.label} (deactivated)` }),
  );

  const set = (field) => (value) => setForm((prev) => ({ ...prev, [field]: value }));

  const amount = parseAmountInput(form.amount);
  const php = parseAmountInput(form.phpDebited);
  const fee = parseAmountInput(form.chargeFeePhp);

  const problems = [];
  if (!isIsoDate(form.paidOn)) problems.push("Give the date of the payment.");
  if (!amount.ok || amount.value === null || amount.value <= 0) problems.push("Amount must be a number more than zero.");
  if (!isPhpPo && (!php.ok || php.value === null || php.value <= 0)) {
    problems.push("PHP debited is required on a foreign-currency PO.");
  }
  if (!fee.ok) problems.push("Charge fee must be a number.");
  if (!form.methodId) problems.push("Pick the payment method.");
  const ready = problems.length === 0;

  const save = useMutation({
    mutationFn: () => {
      const values = {
        kind: form.kind,
        paidOn: form.paidOn,
        amount: form.amount,
        phpDebited: form.phpDebited,
        chargeFeePhp: form.chargeFeePhp,
        methodId: form.methodId,
        checkNo: form.checkNo,
        proofUrl,
      };
      return editing
        ? ipasService.updatePayment(payment.id, values, { isPhpPo })
        : ipasService.addPayment(ipas.id, values, { isPhpPo });
    },
    onSuccess: () => {
      toast.success(editing ? "Payment updated." : "Payment recorded.");
      queryClient.invalidateQueries({ queryKey: ipasKey(ipas.id) });
      queryClient.invalidateQueries({ queryKey: ipasListKey });
      onClose();
    },
    onError: (error) => toast.error(ipasErrorMessage(error)),
  });

  const attach = async ([file]) => {
    if (!file) return;
    if (!isAllowedAttachment(file)) {
      toast.error(`${file.name} is not a supported file type.`);
      return;
    }
    if (file.size > MAX_ATTACHMENT_BYTES) {
      toast.error(`${file.name} is too large (max ${formatBytes(MAX_ATTACHMENT_BYTES)}).`);
      return;
    }
    setUploading(true);
    try {
      const uploaded = await storageService.uploadFileToCloudinary(file);
      setProofUrl(uploaded.url);
      setProofName(uploaded.name || file.name);
    } catch (error) {
      toast.error(error?.message || "The proof of payment couldn't be uploaded.");
    } finally {
      setUploading(false);
    }
  };

  return (
    <DialogContent className="sm:max-w-lg">
      <DialogHeader className="shrink-0 pr-10">
        <DialogTitle>{editing ? "Edit payment" : "Record a payment"}</DialogTitle>
        <DialogDescription>
          {isPhpPo
            ? `${ipas.number} is in pesos, so the amount is the PHP paid.`
            : `${ipas.number} is in ${currency}. Give the amount in ${currency} and the PHP actually debited, so Landed Cost uses the rate really paid.`}
        </DialogDescription>
      </DialogHeader>

      <div className="-mx-1 max-h-[62vh] space-y-4 overflow-y-auto px-1">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <FieldBox label="Kind" bare>
            <SelectField options={KIND_OPTIONS} value={form.kind} onChange={set("kind")} />
          </FieldBox>
          <FieldBox label="Date" bare>
            <Input type="date" value={form.paidOn} onChange={(e) => set("paidOn")(e.target.value)} />
          </FieldBox>
          <FieldBox label={isPhpPo ? "Amount (PHP)" : `Amount (${currency})`} bare>
            <Input
              inputMode="decimal"
              value={form.amount}
              onChange={(e) => set("amount")(e.target.value)}
              placeholder="0.00"
              error={form.amount !== "" && !amount.ok ? "Not a number" : undefined}
            />
          </FieldBox>
          {!isPhpPo && (
            <FieldBox label="PHP debited" bare>
              <Input
                inputMode="decimal"
                value={form.phpDebited}
                onChange={(e) => set("phpDebited")(e.target.value)}
                placeholder="0.00"
                error={form.phpDebited !== "" && !php.ok ? "Not a number" : undefined}
              />
            </FieldBox>
          )}
          <FieldBox label="Charge fee (PHP)" bare>
            <Input
              inputMode="decimal"
              value={form.chargeFeePhp}
              onChange={(e) => set("chargeFeePhp")(e.target.value)}
              placeholder="0.00"
              error={form.chargeFeePhp !== "" && !fee.ok ? "Not a number" : undefined}
            />
          </FieldBox>
          <FieldBox label="Method" bare>
            <SelectField
              options={methods}
              value={form.methodId}
              onChange={set("methodId")}
              placeholder="Pick a method"
            />
          </FieldBox>
          <FieldBox label="Check No." bare>
            <Input
              value={form.checkNo}
              onChange={(e) => set("checkNo")(e.target.value)}
              placeholder="When paid by check"
            />
          </FieldBox>
        </div>

        <div>
          <FieldBox label="Proof of payment" />
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            {proofUrl ? (
              <>
                <ExternalLink
                  href={proofUrl}
                  className="inline-flex items-center gap-1.5 text-[13px] font-medium text-foreground underline underline-offset-2"
                >
                  <Paperclip size={13} aria-hidden="true" />
                  {proofName || "Proof of payment"}
                </ExternalLink>
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  className="gap-1 text-muted-foreground"
                  onClick={() => {
                    setProofUrl("");
                    setProofName("");
                  }}
                >
                  <X size={12} />
                  Remove
                </Button>
              </>
            ) : (
              <FileInput
                accept="image/*,application/pdf"
                disabled={uploading}
                onFiles={attach}
                size="sm"
                className="gap-1.5"
              >
                {uploading ? <Spinner size="sm" /> : <Paperclip size={13} aria-hidden="true" />}
                {uploading ? "Uploading…" : "Attach proof"}
              </FileInput>
            )}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">Optional. With P.O.P shows on the IPAS while any payment has one.</p>
        </div>

        {!ready && (
          <ul className="space-y-0.5 text-xs text-muted-foreground" aria-label="Still to fix">
            {problems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        )}
      </div>

      <DialogFooter>
        <Button variant="outline" size="lg" onClick={onClose}>
          Cancel
        </Button>
        <Button size="lg" disabled={!ready || save.isPending || uploading} onClick={() => save.mutate()}>
          {save.isPending ? "Saving…" : editing ? "Save payment" : "Record payment"}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
