import { Check, ChevronRight } from "lucide-react";

import { cn } from "@/lib/utils";
import { TRANSMITTAL_STATE, TRANSMITTAL_STATE_LABELS } from "@/constants/transmittals";
import { stagesOf } from "@/utils/transmittals";

/** The stages the slip will go through once submitted, from its Checking ticks. */
function StagePath({ header }) {
  const stages = stagesOf({ checkWarehouse: header.checkWarehouse, checkTechnical: header.checkTechnical });
  if (stages.length === 0) return null;
  const steps = [...stages, TRANSMITTAL_STATE.AWAITING_CHECK].map((stage) => TRANSMITTAL_STATE_LABELS[stage]);
  return (
    <ol className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[13px]">
      {steps.map((label, index) => (
        <li key={label} className="flex items-center gap-1.5">
          {index > 0 && <ChevronRight size={13} aria-hidden="true" className="text-mauve-7" />}
          <span className={cn("font-semibold", index === 0 ? "text-foreground" : "text-muted-foreground")}>{label}</span>
        </li>
      ))}
    </ol>
  );
}

/**
 * Under the slip: everything still missing for Submit, all at once, or the
 * all-clear with the stages the slip will go through. `gaps` is slipGaps().
 */
export default function ReadinessStrip({ gaps, header }) {
  if (gaps.length === 0) {
    return (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-border bg-muted/40 px-4 py-3">
        <span className="flex items-center gap-1.5 text-[13px] font-bold text-foreground">
          <Check size={14} aria-hidden="true" /> Ready to submit
        </span>
        <StagePath header={header} />
      </div>
    );
  }
  return (
    <div role="status" className="rounded-xl border border-amber-6 bg-amber-2 px-4 py-3">
      <p className="text-[13px] font-bold text-amber-11">
        {gaps.length === 1 ? "One thing left before Submit" : `${gaps.length} things left before Submit`}
      </p>
      <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-[13px] text-amber-11">
        {gaps.map((gap) => (
          <li key={gap.key}>· {gap.text}</li>
        ))}
      </ul>
    </div>
  );
}
