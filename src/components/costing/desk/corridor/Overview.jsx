import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "../../../ui/button";
import RecordHeader from "../../../record/RecordHeader";
import { costingMatrixService } from "../../../../services/costingMatrixService";
import { costingKeys } from "../../costingKeys";
import { pesos } from "../../gridFormat";
import { CostShares, SheetTable, Waterfall } from "./SheetParts";
import { buildSheet } from "./sheetModel";

/**
 * The S0 Evaluation's Overview (layout B, 2026-11-13), opened from the price corridor: the whole sheet with each
 * band's total in its header (Totals, or Unit + Total), and on the right, kept in view, `aside` (the Costing
 * Desk passes the full summary, with Planned vs Actual and Marketing), else the waterfall from the Final Offer to
 * Revenue and the cost shares. `below` sits under the sheet (the desk passes After buying: IPAS and Landed Cost).
 * The side panel gets 26rem beside the sheet on a wide screen and the full width under it otherwise, so its
 * words never squeeze. "Back" returns to the corridor.
 */
export default function Overview({ matrix, fall, opportunity, opportunityId, onBack, aside = null, below = null }) {
  const [units, setUnits] = useState(false);
  const sheet = useMemo(() => buildSheet(matrix), [matrix]);
  const { data: guide } = useQuery({
    queryKey: costingKeys.costGuide(opportunityId),
    queryFn: () => costingMatrixService.costGuide(opportunityId),
    retry: false,
    staleTime: 0,
    enabled: Boolean(opportunityId) && !aside,
  });
  const standalone = Boolean(opportunity?.standalone);

  return (
    <div className="space-y-4 pb-2" data-testid="costing-overview">
      <Button type="button" variant="outline" size="sm" onClick={onBack} data-testid="overview-back">
        <ChevronLeft size={14} aria-hidden="true" />
        Back to the S0 Evaluation
      </Button>
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-border pb-4">
        <RecordHeader
          className="min-w-0 flex-1"
          reference={standalone ? "No SOR" : (opportunity?.sor_code ?? "SOR")}
          name={opportunity?.project_title ?? "S0 Evaluation"}
          line={[opportunity?.sales_reference && `SO ${opportunity.sales_reference}`, opportunity?.client_name, `${matrix.tenderLines.length} S0 lines`].filter(Boolean).join(" · ")}
        />
        {fall?.revenue != null && (
          <div className="text-right">
            <div className="text-xs text-muted-foreground">Revenue</div>
            <div className={cn("font-mono text-lg font-semibold tabular-nums", fall.under ? "text-amber-11" : "text-green-11")}>
              {pesos(fall.revenue)} <span className="text-sm">· {fall.revenuePercent?.toFixed(2)}%</span>
            </div>
          </div>
        )}
      </div>
      <div className="grid items-start gap-5 2xl:grid-cols-[minmax(0,1fr)_26rem]">
        <div className="min-w-0 space-y-3">
          <div className="flex items-center justify-end gap-1" role="group" aria-label="Columns">
            <Button type="button" size="xs" variant={units ? "ghost" : "secondary"} aria-pressed={!units} onClick={() => setUnits(false)}>
              Totals
            </Button>
            <Button type="button" size="xs" variant={units ? "secondary" : "ghost"} aria-pressed={units} onClick={() => setUnits(true)}>
              Unit + Total
            </Button>
          </div>
          <SheetTable sheet={sheet} unitCols={units} totalsInHead footer={false} />
          {below}
        </div>
        <aside className="max-w-2xl space-y-4 2xl:sticky 2xl:top-2 2xl:max-w-none">
          {aside ?? (
            <>
              <Waterfall fall={fall} dense />
              <CostShares guide={guide} />
            </>
          )}
        </aside>
      </div>
    </div>
  );
}
