import { useQuery } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";

import { costingMatrixService } from "../../../services/costingMatrixService";
import { costingKeys } from "../costingKeys";
import { pesos } from "../gridFormat";
import StatusBadge from "../../StatusBadge";

/** A percent as the sheet writes it: 72.5 -> "72.5%", 8 -> "8%". */
const pctLabel = (value) => (value === null || value === undefined ? "—" : `${Number(Number(value).toFixed(2))}%`);

const STATUS_LABEL = { below: "Below range", above: "Above range" };

/**
 * The cost guide (#723): each cost category's share of the Final Offer beside the guide's range. A share
 * outside its range is flagged; that is a warning and never stops a Go. The rows are the database's
 * (`costing_cost_guide`), so the screen only draws them.
 */
export function CostGuideView({ guide }) {
  const { categories, uncategorised, finalOfferTotal, missingOffer, missingCost } = guide;
  const outside = categories.filter((c) => c.status === "below" || c.status === "above");
  const showUncategorised = (uncategorised.total ?? 0) > 0;

  return (
    <section className="space-y-3" aria-label="Cost guide" data-testid="cost-guide">
      <div className="max-w-prose">
        <h3 className="text-sm font-semibold text-foreground">Cost guide</h3>
        <p className="text-xs text-muted-foreground">
          Each cost as a share of the Final Offer, beside the range the company expects. A share outside its range is a warning only; it never blocks the S0 Evaluation.
        </p>
      </div>

      {finalOfferTotal === null && (
        <p className="rounded-lg border border-dashed border-border px-4 py-3 text-sm text-muted-foreground" data-testid="cost-guide-no-offer">
          {missingOffer > 0 ? "Type a Final Offer on every line to see each share." : "Add a line with a Final Offer to see each share."}
        </p>
      )}

      <ul className="divide-y divide-border/70 overflow-hidden rounded-xl border border-border/70 bg-card">
        {categories.map((c) => (
          <li
            key={c.key}
            className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 px-4 py-2.5 sm:grid-cols-[minmax(0,1fr)_7rem_7rem_8rem]"
            data-testid="cost-guide-row"
            data-category={c.key}
            data-status={c.status ?? "unknown"}
          >
            <span className="min-w-0 text-sm text-foreground">{c.label}</span>
            <span className="text-right text-sm tabular-nums text-muted-foreground" data-testid="cost-guide-range">
              {pctLabel(c.lowPct)} to {pctLabel(c.highPct)}
            </span>
            <span className={`text-right text-sm tabular-nums ${c.status === "within" || c.status === null ? "text-foreground" : "font-semibold text-amber-12"}`} data-testid="cost-guide-share">
              {pctLabel(c.sharePct)}
            </span>
            <span className="justify-self-end sm:justify-self-start">
              {(c.status === "below" || c.status === "above") && <StatusBadge theme="amber" label={STATUS_LABEL[c.status]} />}
              {c.status === "within" && <span className="text-xs text-muted-foreground">In range</span>}
            </span>
          </li>
        ))}
        {showUncategorised && (
          <li className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 px-4 py-2.5 sm:grid-cols-[minmax(0,1fr)_7rem_7rem_8rem]" data-testid="cost-guide-uncategorised">
            <span className="text-sm text-muted-foreground">Uncategorised</span>
            <span className="hidden sm:block" />
            <span className="text-right text-sm tabular-nums text-foreground">{pctLabel(uncategorised.sharePct)}</span>
            <span className="text-xs text-muted-foreground">{pesos(uncategorised.total)}</span>
          </li>
        )}
      </ul>

      {outside.length > 0 && (
        <p className="flex items-start gap-2 text-xs text-amber-12" role="status" data-testid="cost-guide-warning">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
          {outside.map((c) => c.label).join(", ")} {outside.length === 1 ? "is" : "are"} outside the guide. Check the deal before Go; it is not blocked.
        </p>
      )}
      {missingCost > 0 && (
        <p className="text-xs text-muted-foreground" data-testid="cost-guide-missing-cost">
          {missingCost} {missingCost === 1 ? "cost has" : "costs have"} no Final Acquire yet, so the shares may read low.
        </p>
      )}
    </section>
  );
}

/**
 * Loads the guide for the SOR and draws it. The database sends it only to a tier that reads both the Final Offer
 * and Final Acquire; for any other caller it is null and nothing is drawn, not even a heading.
 */
export default function CostGuide({ opportunityId }) {
  const { data: guide } = useQuery({
    queryKey: costingKeys.costGuide(opportunityId),
    queryFn: () => costingMatrixService.costGuide(opportunityId),
    retry: false,
    staleTime: 0,
    ...(opportunityId ? {} : { enabled: false }),
  });
  if (!guide) return null;
  return <CostGuideView guide={guide} />;
}
