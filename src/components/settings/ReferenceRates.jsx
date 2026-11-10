import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";

import { Button } from "../ui/button";
import { FieldBox } from "../ui/FieldBox";
import { Input } from "../ui/input";
import { referenceRateService } from "../../services/referenceRateService";
import { referenceRateKeys } from "../../hooks/useReferenceRate";
import { formatRateNumber, formatReferenceRate } from "../../utils/referenceRate";
import { getCurrentLocalDate } from "../../utils/formatDate.js";

/**
 * Reference Rates (#317): the daily rate per currency, always shown with the day it is for.
 * Fetched once a day; a failed fetch leaves the last good day in place, so the newest row
 * here may be older than today. Purchasing sees them; a Super Admin may override a day, and
 * the override is recorded with what it replaced.
 */
export default function ReferenceRates({ isSuperAdmin = false }) {
  const today = getCurrentLocalDate();
  const { data: rates = [], isLoading } = useQuery({
    queryKey: referenceRateKeys.recent(),
    queryFn: () => referenceRateService.recent(),
  });

  return (
    <div className="space-y-4">
      <p className="text-xs leading-relaxed text-muted-foreground">
        The PHP value of one unit of each currency, fetched once a day from the European Central Bank. It suggests a
        Canvass Offer&apos;s comparison rate and is shown beside an IPAS payment&apos;s rate. It never sets what was
        paid.
      </p>
      {isSuperAdmin && <OverrideForm today={today} />}
      {isLoading ? null : rates.length === 0 ? (
        <p className="text-xs text-muted-foreground">No Reference Rates yet.</p>
      ) : (
        <ul className="divide-y divide-border rounded-xl border border-border text-[13px]">
          {rates.map((rate) => (
            <li
              key={`${rate.currency}-${rate.rate_date}`}
              data-testid="reference-rate-row"
              className="flex flex-wrap items-baseline justify-between gap-2 px-3 py-2"
            >
              <span className="font-medium tabular-nums text-foreground">{formatReferenceRate(rate, today)}</span>
              <span className="text-xs text-muted-foreground">{describeSource(rate)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function describeSource(rate) {
  if (!rate.overridden_at) return rate.source;
  const by = rate.overrider?.name ? ` by ${rate.overrider.name}` : "";
  const was = rate.replaced_php_per_unit != null ? `; was ₱${formatRateNumber(rate.replaced_php_per_unit)}` : "";
  return `Overridden${by}${was}`;
}

function OverrideForm({ today }) {
  const queryClient = useQueryClient();
  const [currency, setCurrency] = useState("");
  const [day, setDay] = useState(today);
  const [rate, setRate] = useState("");

  const code = currency.trim().toUpperCase();
  const ready = /^[A-Z]{3}$/.test(code) && code !== "PHP" && Boolean(day) && Number(rate) > 0;

  const save = useMutation({
    mutationFn: () => referenceRateService.override(code, day, rate),
    onSuccess: () => {
      toast.success(`${code} on ${day} is now ₱${formatRateNumber(rate)}.`);
      setRate("");
      queryClient.invalidateQueries({ queryKey: referenceRateKeys.all });
    },
    onError: (error) => toast.error(error?.message || "The rate couldn't be overridden."),
  });

  return (
    <form
      aria-label="Override a Reference Rate"
      className="flex flex-wrap items-end gap-2 rounded-xl border border-dashed border-border p-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (ready) save.mutate();
      }}
    >
      <FieldBox label="Currency" bare>
        <Input aria-label="Currency" value={currency} onChange={(e) => setCurrency(e.target.value)} placeholder="USD" className="w-20" />
      </FieldBox>
      <FieldBox label="Day" bare>
        <Input aria-label="Day" type="date" value={day} onChange={(e) => setDay(e.target.value)} />
      </FieldBox>
      <FieldBox label="PHP per unit" bare>
        <Input
          aria-label="PHP per unit"
          type="number"
          min="0"
          step="any"
          value={rate}
          onChange={(e) => setRate(e.target.value)}
          className="w-32"
        />
      </FieldBox>
      <Button type="submit" size="sm" disabled={!ready || save.isPending}>
        Override
      </Button>
    </form>
  );
}
