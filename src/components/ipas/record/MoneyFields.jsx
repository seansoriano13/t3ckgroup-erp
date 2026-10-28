// The IPAS edit form's money, typed in place (#581): freight and payments in
// section 1, charges, documents and bank details in section 3, and the status
// and spread of section 4. They replace the payment, charge, document and bank
// dialogs; the same service calls store them when the form saves.
//
// Rows (payments, charges, documents) are drafts held by the form. A new row
// has no `id`: "Add" puts one in, scrolls it into view and eases it in; removing
// it just drops it. Removing a saved row goes through `onRemoveSaved`, which
// asks first, as before.

import { useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";
import { ListPlus, Paperclip, Plus, Trash2, TriangleAlert, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ExternalLink } from "@/components/ui/external-link";
import { FieldBox } from "@/components/ui/FieldBox";
import { FileInput } from "@/components/ui/FileInput";
import Spinner from "@/components/ui/Spinner";
import StatusBadge from "@/components/StatusBadge";
import { IpasCostingSection } from "@/components/ipas/IpasMoneySections";
import { uploadDocumentFile } from "@/components/ipas/uploadDocumentFile";
import { useReferenceRate } from "@/hooks/useReferenceRate";
import { storageService } from "@/services/storageService";
import { cn } from "@/lib/utils";
import {
  IPAS_COMPUTATION_STATUSES,
  IPAS_DOCUMENT_APPLIES_TO_LABELS,
  IPAS_OPTION_LIST,
  IPAS_PAYMENT_KINDS,
  IPAS_PAYMENT_KIND_LABELS,
  IPAS_TICK_SIDE_LABELS,
  IPAS_TICK_SIDE,
  ipasSectionLabel,
} from "@/constants/ipas";
import { ALLOWED_EXTENSIONS_STRING, MAX_ATTACHMENT_BYTES, formatBytes, isAllowedAttachment } from "@/utils/attachments";
import { formatAmount } from "@/utils/ipas";
import { kindsToAdd } from "@/utils/ipasDocuments";
import { formatDay, isIsoDate, optionsForPicker, parseAmountInput } from "@/utils/ipasPayments";
import { pesosFromRate } from "@/utils/landedCost";
import { formatRateDay, formatRateNumber, rateDivergence } from "@/utils/referenceRate";
import { Field, GroupTitle, PickField, ReadValue } from "./FormFields";
import { GRID, reducedMotion, scrollIntoViewGently } from "./formHelpers";
import { BY_HAND, newChargeDraft, newDocumentDraft, newPaymentDraft } from "./editFormModel";

const KIND_OPTIONS = IPAS_PAYMENT_KINDS.map((value) => ({ value, label: IPAS_PAYMENT_KIND_LABELS[value] }));

const asOption = (option) => ({ value: option.id, label: option.active ? option.label : `${option.label} (deactivated)` });

/** A row's card. A row just added scrolls into view, takes the cursor at `focusId` and eases in. */
function DraftRow({ label, fresh, focusId, header, testId, children }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!fresh) return;
    scrollIntoViewGently(ref.current);
    document.getElementById(focusId)?.focus({ preventScroll: true });
    // Only when the row first appears.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div
      ref={ref}
      role="group"
      aria-label={label}
      data-testid={testId}
      className={cn(
        "scroll-mt-40 space-y-3 rounded-xl border border-border bg-muted/20 p-4",
        fresh && !reducedMotion() && "motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-top-2 motion-safe:duration-300",
      )}
    >
      {header}
      {children}
    </div>
  );
}

function RowHeader({ title, badge, removeLabel, onRemove, canRemove }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-sm font-semibold text-foreground">{title}</span>
      {badge}
      {canRemove && (
        <Button type="button" variant="ghost" size="icon" className="ml-auto text-muted-foreground hover:text-red-11" aria-label={removeLabel} onClick={onRemove}>
          <Trash2 />
        </Button>
      )}
    </div>
  );
}

function EmptyNote({ children }) {
  return <p className="text-[13px] text-muted-foreground">{children}</p>;
}

function Titled({ title, action, children }) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <GroupTitle>{title}</GroupTitle>
        {action}
      </div>
      {children}
    </div>
  );
}

function AddButton({ onClick, children, icon: Icon = Plus }) {
  return (
    <Button type="button" size="sm" variant="outline" className="gap-1.5" onClick={onClick}>
      <Icon size={14} />
      {children}
    </Button>
  );
}

// ── Section 1: freight and payments ─────────────────────────────────────────

/** A file attached to a freight or charge row: shows the link, or an Attach button (#709). */
function AttachFile({ label, url, disabled, onChange }) {
  const [uploading, setUploading] = useState(false);
  const attach = async ([file]) => {
    setUploading(true);
    try {
      const link = await uploadDocumentFile(file);
      if (link) onChange(link);
    } finally {
      setUploading(false);
    }
  };
  return (
    <div className="min-w-0">
      <FieldBox label={label} />
      <div className="mt-1.5 flex flex-wrap items-center gap-2">
        {url ? (
          <>
            <ExternalLink href={url} className="inline-flex items-center gap-1.5 text-[13px] font-medium text-foreground underline underline-offset-2">
              <Paperclip size={13} aria-hidden="true" />
              View file
            </ExternalLink>
            {!disabled && (
              <Button type="button" variant="ghost" size="xs" className="gap-1 text-muted-foreground" onClick={() => onChange("")}>
                <X size={12} />
                Remove
              </Button>
            )}
          </>
        ) : disabled ? (
          <span className="text-sm text-muted-foreground">—</span>
        ) : (
          <FileInput accept={ALLOWED_EXTENSIONS_STRING} disabled={uploading} onFiles={attach} size="sm" className="gap-1.5">
            {uploading ? <Spinner size="sm" /> : <Paperclip size={13} aria-hidden="true" />}
            {uploading ? "Uploading…" : "Attach file"}
          </FileInput>
        )}
      </div>
    </div>
  );
}

/**
 * Freight (#709): the one freight service, its own amount and currency, the mark that the supplier
 * billed it (so it is not counted twice) and its file.
 */
export function FreightField({ ipas, form, set, disabled }) {
  const options = optionsForPicker(ipas.options ?? [], IPAS_OPTION_LIST.FREIGHT_SERVICE, ipas.freight_service_id).map(asOption);
  const amount = parseAmountInput(form.freightAmount);
  return (
    <>
      <PickField id="f-freight" label="Freight service" emptyLabel="None" options={options} value={form.freight} disabled={disabled} onChange={(v) => set("freight", v)} />
      <Field
        id="f-freightAmount"
        label="Freight amount"
        kind="amount"
        value={form.freightAmount}
        disabled={disabled}
        error={form.freightAmount !== "" && !amount.ok ? "Not a number" : undefined}
        onChange={(v) => set("freightAmount", v)}
      />
      <Field id="f-freightCurrency" label="Freight currency" placeholder={ipas.currency || "PHP"} value={form.freightCurrency} disabled={disabled} onChange={(v) => set("freightCurrency", v.toUpperCase())} />
      <FieldBox inline className="gap-1.5 self-end pb-2 text-sm text-foreground">
        <Checkbox
          tone="neutral"
          checked={form.freightBilled}
          disabled={disabled}
          aria-label="Freight billed by the supplier"
          onCheckedChange={(checked) => set("freightBilled", checked === true)}
        />
        Billed by the supplier
      </FieldBox>
      <AttachFile label="Freight file" url={form.freightUrl} disabled={disabled} onChange={(v) => set("freightUrl", v)} />
    </>
  );
}

/** The one-line explanation under "Forex rate paid" (#708). */
const RATE_HINT = "Pre-filled with the Reference Rate of the payment date. Change it to the rate you actually paid; a payment from a dollar account takes the rate those dollars were bought at.";

function RateNote({ ipas, row }) {
  const currency = ipas.currency;
  const amount = parseAmountInput(row.amount);
  const rate = parseAmountInput(row.forexRate);
  const { data: referenceRate, isFetched, isError } = useReferenceRate(currency, row.paidOn, { enabled: isIsoDate(row.paidOn) });
  const typedRate = amount.ok && rate.ok && amount.value > 0 && rate.value > 0 ? rate.value : null;
  const divergence = rateDivergence(typedRate, referenceRate);
  if (!isFetched) return null;
  return (
    <p className="text-xs text-muted-foreground sm:col-span-2" data-testid="payment-reference-rate">
      {isError ? (
        "The Reference Rate couldn't be loaded."
      ) : referenceRate ? (
        <>
          reference: ₱{formatRateNumber(referenceRate.php_per_unit)} on {formatRateDay(referenceRate.rate_date)}
          {referenceRate.rate_date < row.paidOn && " (the latest before this date)"}
          {typedRate !== null && <> — you typed ₱{formatRateNumber(typedRate)}</>}
        </>
      ) : (
        `No Reference Rate for ${currency} on or before this date.`
      )}
      {divergence?.flagged && (
        <span className="mt-0.5 block font-medium text-amber-700 dark:text-amber-400" data-testid="payment-rate-divergence">
          That is {divergence.pct.toFixed(1)}% away from the reference. Check the rate against the remittance advice.
        </span>
      )}
    </p>
  );
}

function ProofField({ row, disabled, onPatch }) {
  const [uploading, setUploading] = useState(false);
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
      onPatch({ proofUrl: uploaded.url });
    } catch (error) {
      toast.error(error?.message || "The proof of payment couldn't be uploaded.");
    } finally {
      setUploading(false);
    }
  };
  return (
    <div className="min-w-0">
      <FieldBox label="Proof of payment" />
      <div className="mt-1.5 flex flex-wrap items-center gap-2">
        {row.proofUrl ? (
          <>
            <ExternalLink href={row.proofUrl} className="inline-flex items-center gap-1.5 text-[13px] font-medium text-foreground underline underline-offset-2">
              <Paperclip size={13} aria-hidden="true" />
              Proof of payment
            </ExternalLink>
            {!disabled && (
              <Button type="button" variant="ghost" size="xs" className="gap-1 text-muted-foreground" onClick={() => onPatch({ proofUrl: "" })}>
                <X size={12} />
                Remove
              </Button>
            )}
          </>
        ) : disabled ? (
          <span className="text-sm text-muted-foreground">—</span>
        ) : (
          <FileInput accept={ALLOWED_EXTENSIONS_STRING} disabled={uploading} onFiles={attach} size="sm" className="gap-1.5">
            {uploading ? <Spinner size="sm" /> : <Paperclip size={13} aria-hidden="true" />}
            {uploading ? "Uploading…" : "Attach proof"}
          </FileInput>
        )}
      </div>
      <p className="mt-1 text-xs text-muted-foreground">Optional. With P.O.P shows on the IPAS while any payment has one.</p>
    </div>
  );
}

function PaymentRow({ ipas, form, row, index, saved, fresh, disabled, onPatch, onRemove }) {
  const { isPhp } = form;
  const currency = ipas.currency || "Odoo PO currency";
  const methods = optionsForPicker(ipas.options ?? [], IPAS_OPTION_LIST.PAYMENT_METHOD, saved?.method_id ?? null).map(asOption);
  const id = (name) => `pay-${row.key}-${name}`;
  const amount = parseAmountInput(row.amount);
  const rate = parseAmountInput(row.forexRate);
  const fee = parseAmountInput(row.chargeFeePhp);
  const stamp = parseAmountInput(row.docStampPhp);
  const misc = parseAmountInput(row.miscFeePhp);
  const inPesos = !isPhp && amount.ok && rate.ok && amount.value > 0 && rate.value > 0 ? pesosFromRate(amount.value, rate.value) : null;
  const { data: referenceRate } = useReferenceRate(ipas.currency, row.paidOn, { enabled: !isPhp && !saved && isIsoDate(row.paidOn) });
  // A new payment starts at the day's Reference Rate (#708); once typed over, it is left alone.
  useEffect(() => {
    if (!isPhp && !saved && row.forexRate === "" && referenceRate?.php_per_unit) {
      onPatch({ forexRate: String(referenceRate.php_per_unit) });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when the reference rate arrives
  }, [referenceRate?.php_per_unit]);
  const kindLabel = IPAS_PAYMENT_KIND_LABELS[saved?.kind] ?? "payment";
  return (
    <DraftRow
      label={`Payment ${index + 1}`}
      testId={saved ? "ipas-payment-row" : undefined}
      fresh={fresh}
      focusId={id("amount")}
      header={
        <RowHeader
          title={saved ? `Payment ${index + 1}` : `Payment ${index + 1} (not saved yet)`}
          badge={saved?.paid_before_approval ? <StatusBadge theme="amber" label="Paid before approval" /> : null}
          canRemove={!disabled}
          removeLabel={saved ? `Remove ${kindLabel} of ${formatDay(saved.paid_on)}` : `Remove payment ${index + 1}`}
          onRemove={onRemove}
        />
      }
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <PickField id={id("kind")} label="Kind" options={KIND_OPTIONS} value={row.kind} disabled={disabled} onChange={(v) => onPatch({ kind: v })} />
        <Field id={id("paidOn")} label="Date" kind="date" required value={row.paidOn} disabled={disabled} onChange={(v) => onPatch({ paidOn: v })} />
        <Field
          id={id("amount")}
          label={isPhp ? "Amount (PHP)" : `Amount (${currency})`}
          kind="amount"
          prefix={isPhp ? "PHP" : currency}
          required
          value={row.amount}
          disabled={disabled}
          error={row.amount !== "" && !amount.ok ? "Not a number" : undefined}
          onChange={(v) => onPatch({ amount: v })}
        />
        {!isPhp && (
          <div className="min-w-0">
            <Field
              id={id("forexRate")}
              label="Forex rate paid"
              kind="amount"
              prefix="PHP"
              value={row.forexRate}
              disabled={disabled}
              error={row.forexRate !== "" && !rate.ok ? "Not a number" : undefined}
              onChange={(v) => onPatch({ forexRate: v })}
            />
            <p className="mt-1 pl-1 text-xs text-muted-foreground" data-testid="payment-pesos-hint">
              {RATE_HINT}
            </p>
          </div>
        )}
        {!isPhp && <ReadValue label="In pesos">{inPesos === null ? null : formatAmount(inPesos, "PHP")}</ReadValue>}
        {!isPhp && <RateNote ipas={ipas} row={row} />}
        <Field
          id={id("chargeFeePhp")}
          label="Bank charge (PHP)"
          kind="amount"
          prefix="PHP"
          value={row.chargeFeePhp}
          disabled={disabled}
          error={row.chargeFeePhp !== "" && !fee.ok ? "Not a number" : undefined}
          onChange={(v) => onPatch({ chargeFeePhp: v })}
        />
        <Field
          id={id("docStampPhp")}
          label="Doc stamp (PHP)"
          kind="amount"
          prefix="PHP"
          value={row.docStampPhp}
          disabled={disabled}
          error={row.docStampPhp !== "" && !stamp.ok ? "Not a number" : undefined}
          onChange={(v) => onPatch({ docStampPhp: v })}
        />
        <Field
          id={id("miscFeePhp")}
          label="Misc fee (PHP)"
          kind="amount"
          prefix="PHP"
          value={row.miscFeePhp}
          disabled={disabled}
          error={row.miscFeePhp !== "" && !misc.ok ? "Not a number" : undefined}
          onChange={(v) => onPatch({ miscFeePhp: v })}
        />
        <PickField id={id("methodId")} label="Method" required placeholder="Pick a method" options={methods} value={row.methodId} disabled={disabled} onChange={(v) => onPatch({ methodId: v })} />
        <Field id={id("checkNo")} label="Check No." placeholder="When paid by check" value={row.checkNo} disabled={disabled} onChange={(v) => onPatch({ checkNo: v })} />
      </div>
      <ProofField row={row} disabled={disabled} onPatch={onPatch} />
    </DraftRow>
  );
}

/** Section 1's payments: DP and FP read off the saved rows, then one inline form per payment. */
export function PaymentsFields({ ipas, form, rows, fresh, canRecord, onRemoveSaved }) {
  const sum = ipas.paymentSummary;
  const currency = ipas.currency;
  const savedById = new Map((ipas.payments ?? []).map((payment) => [payment.id, payment]));
  return (
    <Titled title="Payments" action={canRecord && <AddButton onClick={() => rows.add("payments", newPaymentDraft())}>Add payment</AddButton>}>
      <div className={GRID}>
        <ReadValue label="DP">{sum.downPayment > 0 ? formatAmount(sum.downPayment, currency) : null}</ReadValue>
        <ReadValue label="FP">{sum.fullPayment > 0 ? formatAmount(sum.fullPayment, currency) : null}</ReadValue>
        <ReadValue label="Total debited">
          {sum.count > 0 ? `${formatAmount(sum.totalDebitedPhp, "PHP")}${sum.missingPhp > 0 ? " (pesos missing)" : ""}` : null}
        </ReadValue>
      </div>
      {form.payments.length === 0 ? (
        <EmptyNote>
          No payments recorded yet.
          {canRecord && " Add payment starts one here."}
          {!form.isPhp && " A foreign-currency Odoo PO needs a payment before Landed Cost can be worked out."}
        </EmptyNote>
      ) : (
        form.payments.map((row, index) => (
          <PaymentRow
            key={row.key}
            ipas={ipas}
            form={form}
            row={row}
            index={index}
            saved={savedById.get(row.id) ?? null}
            fresh={fresh === row.key}
            disabled={!canRecord}
            onPatch={(patch) => rows.patch("payments", row.key, patch)}
            onRemove={() => (row.id ? onRemoveSaved("payment", savedById.get(row.id)) : rows.drop("payments", row.key))}
          />
        ))
      )}
    </Titled>
  );
}

// ── Section 3: charges, documents, bank details ─────────────────────────────

function ChargeRow({ ipas, row, index, saved, fresh, disabled, onPatch, onRemove }) {
  const kinds = optionsForPicker(ipas.options ?? [], IPAS_OPTION_LIST.CHARGE_KIND, saved?.kind_id ?? null).map(asOption);
  const id = (name) => `chg-${row.key}-${name}`;
  const amount = parseAmountInput(row.amountPhp);
  return (
    <DraftRow
      label={`Charge ${index + 1}`}
      testId={saved ? "ipas-charge-row" : undefined}
      fresh={fresh}
      focusId={id("amountPhp")}
      header={
        <RowHeader
          title={saved ? `Charge ${index + 1}` : `Charge ${index + 1} (not saved yet)`}
          canRemove={!disabled}
          removeLabel={saved ? `Remove ${saved.kindLabel ?? "charge"} of ${formatDay(saved.charged_on)}` : `Remove charge ${index + 1}`}
          onRemove={onRemove}
        />
      }
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <PickField id={id("kindId")} label="Kind" required placeholder="Pick a kind" options={kinds} value={row.kindId} disabled={disabled} onChange={(v) => onPatch({ kindId: v })} />
        <Field id={id("chargedOn")} label="Date" kind="date" required={!saved} value={row.chargedOn} disabled={disabled} onChange={(v) => onPatch({ chargedOn: v })} />
        <Field
          id={id("amountPhp")}
          label="Amount (PHP)"
          kind="amount"
          prefix="PHP"
          required={!saved}
          value={row.amountPhp}
          disabled={disabled}
          error={row.amountPhp !== "" && !amount.ok ? "Not a number" : undefined}
          onChange={(v) => onPatch({ amountPhp: v })}
        />
      </div>
      <div className="mt-3">
        <AttachFile label="File" url={row.attachmentUrl} disabled={disabled} onChange={(v) => onPatch({ attachmentUrl: v })} />
        {saved && row.amountPhp === "" && <p className="mt-1 text-xs text-amber-11">Fill the amount or remove this charge. Section 3 waits for it.</p>}
      </div>
    </DraftRow>
  );
}

/** Section 3's importation charges, in pesos. */
export function ChargesFields({ ipas, form, rows, fresh, canRecord, onRemoveSaved }) {
  const savedById = new Map((ipas.charges ?? []).map((charge) => [charge.id, charge]));
  return (
    <Titled title="Importation charges" action={canRecord && <AddButton onClick={() => rows.add("charges", newChargeDraft())}>Add charge</AddButton>}>
      {form.charges.length === 0 ? (
        <EmptyNote>No charges recorded yet. A charge covering several Odoo POs is recorded as this IPAS&apos;s own share.</EmptyNote>
      ) : (
        <>
          {form.charges.map((row, index) => (
            <ChargeRow
              key={row.key}
              ipas={ipas}
              row={row}
              index={index}
              saved={savedById.get(row.id) ?? null}
              fresh={fresh === row.key}
              disabled={!canRecord}
              onPatch={(patch) => rows.patch("charges", row.key, patch)}
              onRemove={() => (row.id ? onRemoveSaved("charge", savedById.get(row.id)) : rows.drop("charges", row.key))}
            />
          ))}
          <p className="pl-1 text-xs text-muted-foreground">
            Total charges saved: <span className="font-mono font-semibold tabular-nums">{formatAmount(ipas.paymentSummary.chargesPhp, "PHP")}</span>
          </p>
        </>
      )}
    </Titled>
  );
}

function AttachmentField({ document, row, disabled, onPatch }) {
  const [uploading, setUploading] = useState(false);
  const attach = async ([file]) => {
    setUploading(true);
    try {
      const url = await uploadDocumentFile(file);
      if (url) onPatch({ attachmentUrl: url });
    } finally {
      setUploading(false);
    }
  };
  if (row.attachmentUrl) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs">
        <ExternalLink href={row.attachmentUrl} className="inline-flex items-center gap-1 font-medium text-foreground underline underline-offset-2">
          <Paperclip size={12} aria-hidden="true" />
          View
        </ExternalLink>
        {!disabled && (
          <Button type="button" variant="ghost" size="icon-xs" className="text-muted-foreground" aria-label={`Remove the attachment of ${document.label}`} onClick={() => onPatch({ attachmentUrl: "" })}>
            <X />
          </Button>
        )}
      </span>
    );
  }
  if (disabled) return <span className="text-xs text-muted-foreground">—</span>;
  return (
    <FileInput accept={ALLOWED_EXTENSIONS_STRING} disabled={uploading} onFiles={attach} size="xs" className="gap-1" aria-label={`Attach a file to ${document.label}`}>
      {uploading ? <Spinner size="sm" /> : <Paperclip size={12} aria-hidden="true" />}
      {uploading ? "Uploading…" : "Attach"}
    </FileInput>
  );
}

function SavedDocumentRow({ document, row, canChange, canTickFinance, onPatch, onRemove }) {
  return (
    <div role="group" aria-label={document.label} data-testid="ipas-document-row" className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-border bg-muted/20 px-4 py-3">
      <div className="min-w-[10rem] flex-1">
        <span className="text-sm font-medium text-foreground">{document.label}</span>
        <span className="mt-0.5 flex flex-wrap items-center gap-1.5">
          {document.byHand ? (
            <span className="text-xs text-muted-foreground">Added by hand</span>
          ) : (
            <>
              <span className="text-xs text-muted-foreground">{IPAS_DOCUMENT_APPLIES_TO_LABELS[document.appliesTo] ?? ""}</span>
              {document.isFiling && <StatusBadge theme="blue" label="Filing item" />}
            </>
          )}
        </span>
      </div>
      <AttachmentField document={document} row={row} disabled={!canChange} onPatch={onPatch} />
      <FieldBox inline className="gap-1.5 text-xs text-foreground">
        <Checkbox
          tone="neutral"
          checked={row.purchasingHas}
          disabled={!canChange}
          aria-label={`${IPAS_TICK_SIDE_LABELS[IPAS_TICK_SIDE.PURCHASING]}: ${document.label}`}
          onCheckedChange={(value) => onPatch({ purchasingHas: Boolean(value) })}
        />
        {IPAS_TICK_SIDE_LABELS[IPAS_TICK_SIDE.PURCHASING]}
      </FieldBox>
      <FieldBox inline className="gap-1.5 text-xs text-foreground">
        <Checkbox
          tone="neutral"
          checked={row.financeHas}
          disabled={!canTickFinance}
          aria-label={`${IPAS_TICK_SIDE_LABELS[IPAS_TICK_SIDE.FINANCE]}: ${document.label}`}
          onCheckedChange={(value) => onPatch({ financeHas: Boolean(value) })}
        />
        {IPAS_TICK_SIDE_LABELS[IPAS_TICK_SIDE.FINANCE]}
      </FieldBox>
      {/* Only a document added by hand can be removed; a suggested one is ticked or left. */}
      {canChange && document.byHand && (
        <Button type="button" variant="ghost" size="icon-xs" className="text-muted-foreground hover:text-red-11" aria-label={`Remove ${document.label}`} onClick={onRemove}>
          <Trash2 />
        </Button>
      )}
    </div>
  );
}

function NewDocumentRow({ ipas, form, row, index, fresh, onPatch, onRemove }) {
  const kinds = kindsToAdd(ipas.options ?? [], ipas.documents ?? []).filter(
    (kind) => kind.id === row.choice || !form.documents.some((d) => d.id === null && d.key !== row.key && d.choice === kind.id),
  );
  const options = [...kinds.map((kind) => ({ value: kind.id, label: kind.label })), { value: BY_HAND, label: "Something else — I'll type its name" }];
  const id = (name) => `doc-${row.key}-${name}`;
  return (
    <DraftRow
      label={`New document ${index + 1}`}
      fresh={fresh}
      focusId={id("choice")}
      header={<RowHeader title="New document (not saved yet)" canRemove removeLabel={`Remove new document ${index + 1}`} onRemove={onRemove} />}
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <PickField id={id("choice")} label="Document" required placeholder="Pick a document" options={options} value={row.choice} onChange={(v) => onPatch({ choice: v })} />
        {row.choice === BY_HAND && (
          <Field id={id("label")} label="Name" required placeholder="e.g. Warranty card" value={row.label} onChange={(v) => onPatch({ label: v })} />
        )}
      </div>
      <p className="text-xs text-muted-foreground">Both ticks start empty.</p>
    </DraftRow>
  );
}

/** Section 3's documents: a row each with its attachment and two ticks, and new rows to fill in. */
export function DocumentsFields({ ipas, form, rows, fresh, canChange, canTickFinance, onRemoveSaved, onSuggest }) {
  const savedById = new Map((ipas.documents ?? []).map((document) => [document.id, document]));
  const suggested = ipas.suggestedDocuments ?? [];
  const hasKinds = kindsToAdd(ipas.options ?? [], ipas.documents ?? []).length > 0;
  return (
    <div data-testid="ipas-documents">
      <Titled
        title="Documents"
        action={
          canChange && (
            <div className="flex flex-wrap gap-2">
              {suggested.length > 0 && (
                <AddButton icon={ListPlus} onClick={onSuggest}>
                  Add {suggested.length} suggested
                </AddButton>
              )}
              <AddButton onClick={() => rows.add("documents", newDocumentDraft(hasKinds))}>Add document</AddButton>
            </div>
          )
        }
      >
        {form.documents.length === 0 ? (
          <EmptyNote>No documents on this IPAS yet.{canChange ? " Add the ones this purchase asks for." : ""}</EmptyNote>
        ) : (
          form.documents.map((row) => {
            const document = savedById.get(row.id);
            return document ? (
              <SavedDocumentRow
                key={row.key}
                document={document}
                row={row}
                canChange={canChange}
                canTickFinance={canTickFinance}
                onPatch={(patch) => rows.patch("documents", row.key, patch)}
                onRemove={() => onRemoveSaved(document)}
              />
            ) : (
              <NewDocumentRow
                key={row.key}
                ipas={ipas}
                form={form}
                row={row}
                index={form.documents.filter((d) => !d.id).indexOf(row)}
                fresh={fresh === row.key}
                onPatch={(patch) => rows.patch("documents", row.key, patch)}
                onRemove={() => rows.drop("documents", row.key)}
              />
            );
          })
        )}
        <p className="text-xs text-muted-foreground">Each department ticks its own box. A filing item ticked here is already ticked at Filing.</p>
      </Titled>
    </div>
  );
}

/** The supplier's bank details. Shown only to people the database lets read them; Purchasing types them. */
export function BankFields({ ipas, form, set, canChange }) {
  if (!ipas.canReadBankDetails) return null;
  const flagged = Boolean(ipas.bankDetails?.flagged);
  return (
    <div data-testid="ipas-bank-details">
      <Titled title="Bank details">
        {flagged && (
          <div role="alert" className="flex items-start gap-2 rounded-xl border border-red-7 bg-red-3/40 p-3 text-sm text-red-11">
            <TriangleAlert size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
            <div>
              <p className="font-semibold">Account # changed</p>
              <p className="mt-0.5 text-xs opacity-90">
                It differs from this supplier&apos;s last IPAS. Confirm it with the supplier before anyone approves or pays. Any approval given on section{" "}
                {ipasSectionLabel(3)} was cleared.
              </p>
            </div>
          </div>
        )}
        {canChange && (
          <p className="text-xs text-muted-foreground">
            A changed Account # is how payment fraud usually gets in. If it differs from this supplier&apos;s last IPAS it is flagged and the section {ipasSectionLabel(3)} approval
            given so far is cleared. Spaces and dashes don&apos;t count as a difference.
          </p>
        )}
        <div className="grid gap-4 sm:grid-cols-3">
          <Field id="f-bankName" label="Bank Name" value={form.bankName} disabled={!canChange} onChange={(v) => set("bankName", v)} />
          <Field id="f-accountName" label="Account Name" value={form.accountName} disabled={!canChange} onChange={(v) => set("accountName", v)} />
          <Field id="f-accountNumber" label="Account #" value={form.accountNumber} disabled={!canChange} onChange={(v) => set("accountNumber", v)} />
        </div>
        {flagged && <StatusBadge theme="red" label="Changed account" />}
      </Titled>
    </div>
  );
}

// ── Section 4: status and spread ────────────────────────────────────────────

/**
 * The computation status and the spread, typed here and stored with the rest. The
 * steps jump to any step either way, and only Purchasing gives them; Landed Cost
 * below is worked out from what is stored.
 */
export function CostingFields({ ipas, form, set, canChange, canSetStatus }) {
  const stored = ipas.computationStatus;
  const shown = { ...ipas, computationStatus: form.computationStatus, landedCostSplit: form.split };
  const mayGive = (from, to) => {
    if (to === stored) return true;
    return canSetStatus ? canSetStatus(stored, to) : canChange;
  };
  return (
    <div className="space-y-2">
      <IpasCostingSection
        ipas={shown}
        canChange={canChange}
        canSetStatus={mayGive}
        onSetStatus={(status) => set("computationStatus", status)}
        onSetSplit={(value) => set("split", value)}
      />
      <p className="pl-1 text-xs text-muted-foreground">Landed Cost is worked out again after Save all.</p>
    </div>
  );
}
