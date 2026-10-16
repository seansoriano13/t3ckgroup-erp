import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";

import { Button } from "../../ui/button";
import { FieldBox } from "../../ui/FieldBox";
import { Input } from "../../ui/input";
import PageLoading from "../../ui/PageLoading";
import QueryError from "../../ui/QueryError";
import { costingMatrixService } from "../../../services/costingMatrixService";
import { costingKeys } from "../costingKeys";

/** 0.06 -> "6", 0.075 -> "7.5": the rates are typed as the percentages the sheet shows. */
const asPercent = (rate) => String(Number((Number(rate) * 100).toFixed(4)));
const asFraction = (percent) => Number((Number(percent) / 100).toFixed(6));

const toDrafts = (rates) => ({
  vatDivisor: String(rates.vatDivisor),
  taxRate: asPercent(rates.taxRate),
  retentionRate: asPercent(rates.retentionRate),
  itrRate: asPercent(rates.itrRate),
  itrAllowance: String(rates.itrAllowance),
});

const RATE_NAME = { taxRate: "tax", retentionRate: "retention", itrRate: "ITR" };

/** The typed drafts as the service takes them, or the sentence saying what is wrong with them. */
function parseDrafts(drafts) {
  const number = (text) => (String(text).trim() === "" ? NaN : Number(text));
  const vatDivisor = number(drafts.vatDivisor);
  const itrAllowance = number(drafts.itrAllowance);
  const percents = { taxRate: number(drafts.taxRate), retentionRate: number(drafts.retentionRate), itrRate: number(drafts.itrRate) };
  if (!Number.isFinite(vatDivisor) || vatDivisor < 1) return { error: "The VAT divisor is a number of 1 or more, like 1.12." };
  for (const [key, value] of Object.entries(percents)) {
    if (!Number.isFinite(value) || value < 0 || value > 100) return { error: `The ${RATE_NAME[key]} rate is a percentage from 0 to 100.` };
  }
  if (!Number.isFinite(itrAllowance) || itrAllowance < 0) return { error: "The ITR allowance is an amount of 0 or more." };
  return {
    fields: {
      vatDivisor,
      taxRate: asFraction(percents.taxRate),
      retentionRate: asFraction(percents.retentionRate),
      itrRate: asFraction(percents.itrRate),
      itrAllowance,
    },
  };
}

/**
 * The summary's rates (#270): the VAT divisor, the Tax, Retention and ITR percentages, and the
 * ITR allowance, copied from the PMS sheet. Finance access and Super Admins change them (the
 * database refuses anyone else); the summary on every Costing Matrix reads these, so a rate
 * change needs no rebuild and shows the next time a matrix is opened.
 */
export default function RatesSection({ canEdit = false }) {
  const queryClient = useQueryClient();
  const rates = useQuery({ queryKey: costingKeys.settings, queryFn: () => costingMatrixService.getSettings() });
  const [drafts, setDrafts] = useState(null);

  const save = useMutation({
    mutationFn: (fields) => costingMatrixService.setSettings(fields),
    onSuccess: (done) => {
      toast.success("Rates saved.");
      setDrafts(toDrafts(done));
      queryClient.invalidateQueries({ queryKey: ["costing"] });
    },
    onError: (error) => {
      toast.error(error?.message || "The rates could not be saved.");
      queryClient.invalidateQueries({ queryKey: costingKeys.settings });
    },
  });

  if (rates.isLoading) return <PageLoading label="rates" />;
  if (rates.isError || !rates.data) return <QueryError title="The rates could not be loaded." onRetry={rates.refetch} />;

  const shown = drafts ?? toDrafts(rates.data);
  const change = (key) => (event) => setDrafts({ ...shown, [key]: event.target.value });
  const dirty = JSON.stringify(shown) !== JSON.stringify(toDrafts(rates.data));

  const submit = (event) => {
    event.preventDefault();
    const parsed = parseDrafts(shown);
    if (parsed.error) return toast.error(parsed.error);
    save.mutate(parsed.fields);
  };

  const field = (key, label, hint) => (
    <FieldBox label={label} bare className="w-44">
      <Input inputMode="decimal" value={shown[key]} onChange={change(key)} disabled={!canEdit || save.isPending} aria-label={label} />
      <span className="mt-1 block text-xs text-muted-foreground">{hint}</span>
    </FieldBox>
  );

  return (
    <section className="rounded-xl border border-border bg-card p-4" data-testid="costing-rates">
      <h3 className="text-sm font-semibold text-foreground">Rates</h3>
      <p className="mt-0.5 text-xs text-muted-foreground">
        The figures the Costing Matrix summary is worked from, as the PMS sheet has them.{" "}
        {canEdit ? "A change applies the next time a matrix is opened." : "Finance access and Super Admins change them."}
      </p>
      <form className="mt-3 flex flex-wrap items-start gap-4" onSubmit={submit}>
        {field("vatDivisor", "VAT divisor", "Final Offer ÷ this gives the VAT-exclusive figure")}
        {field("taxRate", "Tax rate (%)", "of the gross Final Offer")}
        {field("retentionRate", "Retention rate (%)", "of the Final Offer")}
        {field("itrRate", "ITR rate (%)", "of the offer above the allowance")}
        {field("itrAllowance", "ITR allowance (₱)", "the offer is only taxed above this")}
        {canEdit && (
          <Button type="submit" variant="outline" className="self-end" disabled={save.isPending || !dirty}>
            Save rates
          </Button>
        )}
      </form>
    </section>
  );
}
