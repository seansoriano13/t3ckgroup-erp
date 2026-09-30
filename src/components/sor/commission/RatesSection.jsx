import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { Plus } from "lucide-react";
import { commissionService } from "../../../services/commissionService";
import { RATE_TYPES, RATE_TYPE_LABELS } from "../../../utils/commission";
import { Button } from "../../ui/button";
import { FieldBox } from "../../ui/FieldBox";
import { Input } from "../../ui/input";
import { SelectField } from "../../ui/SelectField";
import { TONE, rateTimeline } from "./commissionView";
import { Meter, Swatch, UsageRow, UsageSection } from "./parts";

const STATUS_LABEL = { current: "In force", scheduled: "Scheduled" };

/** A rate type's dated history: what took effect when. Read-only for everyone. */
function RateHistory({ timeline }) {
  return (
    <div className="space-y-1.5">
      {timeline.map((r, i) => (
        <div key={r.id ?? i} className="flex items-center justify-between gap-3 text-sm">
          <span className="text-muted-foreground">{`from ${r.effective_from}`}</span>
          <span className="flex items-center gap-3">
            {STATUS_LABEL[r.status] && (
              <span className={r.status === "current" ? "text-xs font-medium text-foreground" : "text-xs font-medium text-muted-foreground"}>{STATUS_LABEL[r.status]}</span>
            )}
            <span className="w-14 text-right font-medium tabular-nums text-foreground">{r.percent}%</span>
          </span>
        </div>
      ))}
    </div>
  );
}

/** The form a Super Admin fills to add a Commission Rate that takes effect on a date. */
function AddRateForm({ actorId, onDone }) {
  const queryClient = useQueryClient();
  const [rateType, setRateType] = useState(RATE_TYPES.POOL);
  const [percent, setPercent] = useState("");
  const [effectiveFrom, setEffectiveFrom] = useState("");

  const add = useMutation({
    mutationFn: () => commissionService.createRate({ rateType, percent: Number(percent), effectiveFrom }, actorId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["commissionRateHistory"] });
      queryClient.invalidateQueries({ queryKey: ["commissionDashboard"] });
      queryClient.invalidateQueries({ queryKey: ["commissionBreakdown"] });
      toast.success("Commission Rate added.");
      onDone();
    },
    onError: (err) => toast.error(err.message),
  });

  const ready = percent !== "" && Number(percent) >= 0 && Number(percent) <= 100 && !!effectiveFrom;

  return (
    <form
      className="flex flex-wrap items-end gap-3 bg-muted/30 px-4 py-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (ready) add.mutate();
      }}
    >
      <FieldBox label="Type" bare className="w-auto">
        <SelectField
          aria-label="Rate type"
          value={rateType}
          onChange={setRateType}
          options={Object.entries(RATE_TYPE_LABELS).map(([value, label]) => ({ value, label }))}
          size="sm"
        />
      </FieldBox>
      <FieldBox label="Percent" bare className="w-auto">
        <Input type="number" step="0.001" min={0} max={100} aria-label="Rate percent" value={percent} onChange={(e) => setPercent(e.target.value)} containerClassName="w-24" className="h-8" />
      </FieldBox>
      <FieldBox label="Effective from" bare className="w-auto">
        <Input type="date" aria-label="Effective from" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} className="h-8" />
      </FieldBox>
      <div className="ml-auto flex items-center gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onDone}>Cancel</Button>
        <Button type="submit" size="sm" disabled={!ready || add.isPending}>Save rate</Button>
      </div>
    </form>
  );
}

/**
 * The live Commission Rates, applied top to bottom. Each rate opens onto its
 * dated history; a Super Admin adds a new dated rate (an SOR keeps the rates in
 * force on its Contract Date, so a change never moves an already-priced SOR).
 */
export default function RatesSection({ rates, rateHistory, salesPercent, canEdit, actorId }) {
  const [adding, setAdding] = useState(false);
  const [open, setOpen] = useState({});

  const rows = [
    { type: RATE_TYPES.VAT, label: "VAT", sub: "Divided out of the contract value", tone: "tax", value: rates.vat, valueSub: `÷ ${(1 + rates.vat / 100).toFixed(2)}` },
    { type: RATE_TYPES.WITHHOLDING, label: "Withholding", sub: "Of the VAT-free amount", tone: "tax", value: rates.withholding, valueSub: "subtracted" },
    { type: RATE_TYPES.POOL, label: "Pool rate", sub: "Of Commissionable Revenue", tone: "pool", value: rates.pool, valueSub: "into the pool" },
  ];
  // Retention is optional and read only by Project Evaluation, so it shows once one has been set.
  if (rates.retention !== undefined || rateHistory.some((r) => r.rate_type === RATE_TYPES.RETENTION)) {
    rows.push({ type: RATE_TYPES.RETENTION, label: "Retention", sub: "Held back; read by Project Evaluation", tone: "tax", value: rates.retention ?? 0, valueSub: "held back" });
  }

  return (
    <UsageSection
      title="Formula"
      description="Live rates, applied top to bottom. A SOR keeps the rates in force on its Contract Date."
      action={canEdit && !adding && (
        <Button type="button" variant="outline" size="sm" onClick={() => setAdding(true)}>
          <Plus /> Add rate
        </Button>
      )}
    >
      {adding && <AddRateForm actorId={actorId} onDone={() => setAdding(false)} />}
      {rows.map((r) => {
        const timeline = rateTimeline(rateHistory, r.type);
        return (
          <UsageRow
            key={r.type}
            lead={<Swatch tone={r.tone} />}
            label={r.label}
            sub={r.sub}
            meter={<Meter value={r.value} max={25} color={TONE[r.tone].solid} />}
            value={`${r.value}%`}
            valueSub={r.valueSub}
            open={!!open[r.type]}
            onToggle={() => setOpen((o) => ({ ...o, [r.type]: !o[r.type] }))}
            detail={timeline.length > 0 ? <RateHistory timeline={timeline} /> : undefined}
          />
        );
      })}
      <UsageRow lead={<Swatch tone="sales" />} label="Sales share" sub="Of the pool, to the people on the SOR" meter={<Meter value={salesPercent} color={TONE.sales.solid} />} value={`${salesPercent}%`} valueSub="to Sales" />
    </UsageSection>
  );
}
