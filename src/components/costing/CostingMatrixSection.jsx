import { useLocation, useNavigate } from "react-router";
import { Calculator, Maximize2 } from "lucide-react";

import { Button } from "../ui/button";
import SectionHeader from "../ui/SectionHeader";
import StatusBadge from "../StatusBadge";
import NumbersStrip from "../record/NumbersStrip";
import { BID_VERDICT_LABEL, tierReads } from "../../constants/costing";
import { useCostingMatrix } from "./useCostingMatrix";
import { pesos } from "./gridFormat";
import PrintButton from "./desk/PrintButton";

const VERDICT_THEME = { go: "green", revise: "amber", no_go: "red" };

/**
 * The Costing Matrix on the SOR's PMS tab (#267): its headline numbers and a way into the Costing Desk,
 * the matrix's own record window. The matrix is worked there, not here. Before "Open Costing Matrix"
 * runs (#462) there is no matrix yet: one plain line, no error.
 */
export default function CostingMatrixSection({ opportunityId, opportunity }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { data: matrix, isSuccess } = useCostingMatrix(opportunityId);
  if (!matrix) {
    if (!isSuccess) return null;
    return (
      <p className="rounded-xl border border-border/70 bg-card/50 px-4 py-3 text-sm text-muted-foreground" data-testid="no-costing-matrix">
        No S0 Evaluation yet. It opens when the flow&apos;s &quot;Open S0 Evaluation&quot; step runs.
      </p>
    );
  }

  const { totals, tenderLines, bidDecision } = matrix;
  const open = () => navigate(`/costing-matrix/${opportunityId}`, { state: { returnTo: { path: location.pathname, sorId: opportunityId } } });
  const stats = [{ key: "lines", label: "Lines", value: String(tenderLines.length) }];
  if (tierReads(matrix.tier, "abc_unit")) stats.push({ key: "abc", label: "ABC", value: pesos(totals.abcTotal), sub: totals.missingAbc ? `${totals.missingAbc} without one` : undefined });
  if (tierReads(matrix.tier, "final_offer_unit"))
    stats.push({
      key: "offer",
      label: "Final Offer",
      value: pesos(totals.finalOfferTotal),
      sub: totals.missingOffer ? `${totals.missingOffer} without one` : totals.percentOfAbc == null ? undefined : `${totals.percentOfAbc.toFixed(1)}% of the ABC`,
    });

  return (
    <section className="space-y-3" aria-label="S0 Evaluation" data-testid="costing-matrix-card">
      <SectionHeader
        title={
          <>
            <Calculator size={16} aria-hidden="true" />
            S0 Evaluation
          </>
        }
        description="What the client asked for, what we supply and pay, and the bid decision."
        className="pb-2"
      >
        <PrintButton opportunityId={opportunityId} opportunity={opportunity} />
        <Button type="button" size="sm" variant="outline" onClick={open}>
          <Maximize2 size={14} aria-hidden="true" />
          Open S0 Evaluation
        </Button>
      </SectionHeader>
      <div className="rounded-xl border border-border/70 bg-card p-4">
        <NumbersStrip stats={stats} />
        {bidDecision && (
          <p className="mt-3 flex items-center gap-2 text-sm" data-testid="costing-card-decision">
            Bid decision
            <StatusBadge theme={VERDICT_THEME[bidDecision.verdict]} label={BID_VERDICT_LABEL[bidDecision.verdict] ?? bidDecision.verdict} />
          </p>
        )}
      </div>
    </section>
  );
}
