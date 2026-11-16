import { useState } from "react";

import ModalShell from "@/components/ui/ModalShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SelectField } from "@/components/ui/SelectField";
import { CAPTION_BASE } from "@/lib/captionStyle";
import { RequiredMark } from "@/components/ipas/record/FormFields";
import CanvassSupplierField from "../CanvassSupplierField";
import { CANVASS_CURRENCIES, DEFAULT_CURRENCY } from "../../constants/canvass";
import { useReferenceRate } from "../../hooks/useReferenceRate";
import { formatReferenceRate } from "../../utils/referenceRate";
import { getCurrentLocalDate } from "../../utils/formatDate.js";
import { refusal } from "./requestHooks";

const BOX = "h-9 rounded-lg px-3 text-sm";

/** A caption over a field; the red asterisk marks a required one. */
function Caption({ children, required }) {
  return (
    <span className={`${CAPTION_BASE} tracking-wider text-muted-foreground`}>
      {children}
      {required && <RequiredMark />}
    </span>
  );
}

/**
 * Adding a supplier to the request's Canvass, once (#970, ADR 0053): who it is, its currency and the
 * rate it is compared at, how long the quote holds, the lead time and a note on quality. What it
 * charges per line is typed in the grid afterwards. The same form edits a supplier already there
 * (`supplier` given). `canReadMoney` false hides the rate: a reader outside the money tiers never
 * sees or sets one. `onSubmit(values)` may throw; the refusal shows under the form.
 *
 * Required (red asterisk): the supplier, the currency, and the rate of a foreign supplier. The rest
 * may be left until the quote says it. The rate starts from today's Reference Rate and stays
 * whatever is typed over it.
 */
export default function CanvassSupplierDialog({ open, onOpenChange, supplier = null, canReadMoney, onSubmit }) {
  const editing = Boolean(supplier);
  const [name, setName] = useState(supplier?.name ?? "");
  const [odooSupplierId, setOdooSupplierId] = useState(supplier?.odooSupplierId ?? null);
  const [currency, setCurrency] = useState(supplier?.currency ?? DEFAULT_CURRENCY);
  // null = untouched, so the Reference Rate suggestion shows; a typed value (even blank) wins over it.
  const [typedRate, setTypedRate] = useState(null);
  const [validUntil, setValidUntil] = useState(supplier?.validUntil ? String(supplier.validUntil).slice(0, 10) : "");
  const [leadTime, setLeadTime] = useState(supplier?.leadTime ?? "");
  const [qualityNote, setQualityNote] = useState(supplier?.qualityNote ?? "");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const foreign = currency !== DEFAULT_CURRENCY;
  const showRate = canReadMoney && foreign;
  const today = getCurrentLocalDate();
  const { data: referenceRate, isFetched: referenceChecked, isError: referenceFailed } = useReferenceRate(currency, today, { enabled: showRate });

  const savedRate = supplier?.currency === currency && supplier?.rate != null ? String(supplier.rate) : "";
  const suggested = referenceRate ? String(referenceRate.php_per_unit) : "";
  const rate = typedRate ?? (savedRate || suggested);
  const rateOk = !showRate || (rate !== "" && Number(rate) > 0);
  const canSubmit = Boolean(name.trim()) && rateOk && !busy;

  const submit = async (event) => {
    event?.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      await onSubmit({
        supplierName: name.trim(),
        odooSupplierId,
        currency,
        ...(canReadMoney ? { comparisonRate: foreign ? Number(rate) : null } : {}),
        validUntil: validUntil || null,
        leadTime: leadTime.trim() || null,
        qualityNote: qualityNote.trim() || null,
      });
      onOpenChange(false);
    } catch (err) {
      setError(refusal(err));
    } finally {
      setBusy(false);
    }
  };

  const heading = editing ? `Edit ${supplier.name}` : "Add a supplier";

  return (
    <ModalShell
      open={open}
      onOpenChange={onOpenChange}
      crumbs={["Canvass", heading]}
      title={heading}
      onSubmit={submit}
      className="z-[90]"
      actions={
        <Button type="submit" size="sm" disabled={!canSubmit}>
          {busy ? "Saving…" : editing ? "Save supplier" : "Add supplier"}
        </Button>
      }
    >
      <p className="text-sm text-muted-foreground">
        {editing
          ? "These apply to everything this supplier quotes on the request."
          : "Add each supplier once. What it charges for each line is typed in the grid afterwards."}
      </p>

      <div className="space-y-1.5">
        <Caption required>Supplier</Caption>
        <CanvassSupplierField
          value={name}
          onTyped={(value) => {
            setName(value);
            setOdooSupplierId(null);
          }}
          onPicked={(picked) => {
            setName(picked.name);
            setOdooSupplierId(picked.id);
          }}
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Caption required>Currency</Caption>
          <SelectField
            aria-label="Currency"
            size="sm"
            options={CANVASS_CURRENCIES.map((code) => ({ value: code, label: code }))}
            value={currency}
            onChange={(next) => {
              setCurrency(next || DEFAULT_CURRENCY);
              setTypedRate(null);
            }}
          />
        </div>
        {showRate && (
          <div className="space-y-1.5">
            <Caption required>{`Comparison rate (PHP per ${currency})`}</Caption>
            <Input
              type="number"
              min="0"
              step="any"
              aria-label="Comparison rate"
              aria-required="true"
              value={rate}
              onChange={(e) => setTypedRate(e.target.value)}
              className={BOX}
            />
          </div>
        )}
      </div>
      {showRate && (
        <p className="text-xs text-muted-foreground" data-testid="supplier-rate-hint">
          {referenceChecked && !referenceFailed && referenceRate
            ? `Reference Rate: ${formatReferenceRate(referenceRate, today)}. `
            : referenceChecked
              ? `No Reference Rate for ${currency} yet. Type the rate you compared at. `
              : ""}
          The comparison rate reads the quote in PHP. It is not the rate that will be paid.
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Caption>Quote holds until</Caption>
          <Input type="date" aria-label="Quote holds until" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} className={BOX} />
        </div>
        <div className="space-y-1.5">
          <Caption>Lead time</Caption>
          <Input aria-label="Lead time" value={leadTime} onChange={(e) => setLeadTime(e.target.value)} placeholder="e.g. 14 days" className={BOX} />
        </div>
      </div>
      <div className="space-y-1.5">
        <Caption>Quality note</Caption>
        <Input aria-label="Quality note" value={qualityNote} onChange={(e) => setQualityNote(e.target.value)} className={BOX} />
      </div>

      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </ModalShell>
  );
}
