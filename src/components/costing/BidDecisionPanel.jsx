import { useState } from "react";
import { Gavel } from "lucide-react";

import { Button } from "../ui/button";
import { Textarea } from "../ui/textarea";
import StatusBadge from "../StatusBadge";
import { costingMatrixService } from "../../services/costingMatrixService";
import { BID_VERDICT, BID_VERDICT_LABEL, tierDecidesBid, tierReadsBidDecision } from "../../constants/costing";
import { formatDate } from "../../utils/formatDate";
import { pesos } from "./gridFormat";

/** The badge colour of each verdict: Go green, Revise amber, No-go red. */
const VERDICT_THEME = { [BID_VERDICT.GO]: "green", [BID_VERDICT.REVISE]: "amber", [BID_VERDICT.NO_GO]: "red" };

/** The three verdict buttons, in the order the boss reads them. */
const CHOICES = [BID_VERDICT.GO, BID_VERDICT.REVISE, BID_VERDICT.NO_GO];

function Verdict({ verdict }) {
  return <StatusBadge theme={VERDICT_THEME[verdict]} label={BID_VERDICT_LABEL[verdict] ?? verdict} />;
}

/**
 * The Bid Decision (#320) at the summary: whether this price wins this project. Go, No-go or Revise
 * with the reason in the decider's own words, who decided and when. Sales (the price tier) sees the
 * verdict and the reason and never the figures it was taken against; Closed Book also sees the Final
 * Offer total and ABC it was stamped with, and is the only side with the Go / Revise / No-go
 * controls (the Final Acquire list or a Super Admin: the database decides). Any later change to a
 * Final Offer or a Final Acquire clears the decision, and this says so in words.
 *
 * A No-go or a Revise tells the Deal Team and moves nothing on the SOR; taking the deal to Closed
 * Lost stays the Deal Owner's move on the Sales Flow. This panel draws nothing for Purchasing or a
 * Stage Participant: the matrix read gives them no decision to show.
 */
export default function BidDecisionPanel({ matrix, writes, nameOf = () => null }) {
  const { tier, bidDecision, bidDecisionHistory = [], totals, tenderLines } = matrix;
  const [reason, setReason] = useState("");
  if (!tierReadsBidDecision(tier)) return null;

  const canDecide = tierDecidesBid(tier);
  const ready = tenderLines.length > 0 && totals.missingOffer === 0;
  const trimmed = reason.trim();
  const earlier = bidDecisionHistory[0] ?? null;

  const decide = (verdict) =>
    writes.run(async () => {
      await costingMatrixService.decideBid(matrix.matrixId, { verdict, reason: trimmed });
      setReason("");
    });

  const decider = bidDecision ? nameOf(bidDecision.decidedBy) : null;

  return (
    <section className="max-w-xl space-y-3 rounded-xl border border-border/70 bg-card p-4" aria-label="Bid Decision" data-testid="bid-decision">
      <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
        <Gavel size={14} aria-hidden="true" />
        Bid Decision
      </h3>

      {bidDecision ? (
        <div className="space-y-1.5" data-testid="bid-decision-live">
          <div className="flex items-center gap-2">
            <Verdict verdict={bidDecision.verdict} />
            <span className="text-xs text-muted-foreground">
              {decider ? `${decider}, ` : ""}
              {formatDate(bidDecision.decidedAt)}
            </span>
          </div>
          <p className="whitespace-pre-wrap text-sm text-foreground" data-testid="bid-decision-reason">
            {bidDecision.reason}
          </p>
          {"finalOfferTotal" in bidDecision && (
            <p className="text-xs text-muted-foreground" data-testid="bid-decision-figures">
              Taken against a Final Offer of {pesos(bidDecision.finalOfferTotal)}
              {bidDecision.abcTotal === null || bidDecision.abcTotal === undefined ? "" : ` and an ABC of ${pesos(bidDecision.abcTotal)}`}.
            </p>
          )}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground" data-testid="bid-decision-none">
          {ready ? "No decision yet." : "No decision yet. It can be taken once every Tender Line has a Final Offer."}
        </p>
      )}

      {!bidDecision && earlier && (
        <p className="text-xs text-muted-foreground" data-testid="bid-decision-cleared">
          The earlier decision ({BID_VERDICT_LABEL[earlier.verdict] ?? earlier.verdict}) was cleared: {earlier.clearedReason}.
        </p>
      )}

      {canDecide && (
        <div className="space-y-2 border-t border-border/50 pt-3">
          <Textarea
            aria-label="Reason for the decision"
            placeholder="Why? Write the reason in your own words."
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            disabled={!ready || writes.busy}
            className="min-h-[64px]"
          />
          <div className="flex flex-wrap items-center gap-2">
            {CHOICES.map((verdict) => (
              <Button
                key={verdict}
                size="sm"
                variant={verdict === BID_VERDICT.GO ? "default" : "outline"}
                disabled={!ready || trimmed === "" || writes.busy}
                onClick={() => decide(verdict)}
              >
                {BID_VERDICT_LABEL[verdict]}
              </Button>
            ))}
            <span className="text-xs text-muted-foreground">No-go and Revise tell the Deal Team. Nothing on the deal moves.</span>
          </div>
        </div>
      )}
    </section>
  );
}
