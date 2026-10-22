import { useState } from "react";
import { Check, Gavel, RotateCcw, X } from "lucide-react";

import { Button } from "../ui/button";
import { APPROVE_CLASS } from "../ui/approveClass";
import { Textarea } from "../ui/textarea";
import StatusBadge from "../StatusBadge";
import { costingMatrixService } from "../../services/costingMatrixService";
import { BID_VERDICT, BID_VERDICT_LABEL, tierDecidesBid, tierReadsBidDecision } from "../../constants/costing";
import { formatDate } from "../../utils/formatDate";
import { pesos } from "./gridFormat";

/** The badge colour of each verdict: Go green, Revise amber, No-go red. */
const VERDICT_THEME = { [BID_VERDICT.GO]: "green", [BID_VERDICT.REVISE]: "amber", [BID_VERDICT.NO_GO]: "red" };

/** The three verdict buttons, in the order the boss reads them: big, each saying what it means. */
const CHOICES = [
  { verdict: BID_VERDICT.GO, icon: Check, words: "Bid at these Final Offers", className: APPROVE_CLASS },
  { verdict: BID_VERDICT.REVISE, icon: RotateCcw, words: "Send back to reprice", variant: "outline" },
  { verdict: BID_VERDICT.NO_GO, icon: X, words: "Do not bid", variant: "destructive" },
];

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
  const frame = {
    [BID_VERDICT.GO]: "border-green-8",
    [BID_VERDICT.NO_GO]: "border-red-8",
    [BID_VERDICT.REVISE]: "border-amber-8",
  }[bidDecision?.verdict];

  return (
    <section className={`space-y-4 rounded-2xl border-2 bg-card p-5 ${frame ?? "border-border"}`} aria-label="Bid Decision" data-testid="bid-decision">
      <h3 className="flex items-center gap-2 text-lg font-black tracking-tight text-foreground">
        <Gavel size={18} aria-hidden="true" />
        Bid Decision
      </h3>

      {bidDecision ? (
        <div className="space-y-1.5" data-testid="bid-decision-live">
          <p className="text-2xl font-black tracking-tight text-foreground">{BID_VERDICT_LABEL[bidDecision.verdict] ?? bidDecision.verdict}</p>
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
        <div className="space-y-3 border-t border-border/50 pt-3">
          <Textarea
            aria-label="Reason for the decision"
            placeholder={bidDecision ? "Decide again? Write why." : "Why? Write the reason in your own words."}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            disabled={!ready || writes.busy}
            className="min-h-[64px]"
          />
          <div className="grid gap-2">
            {CHOICES.map(({ verdict, icon: Icon, words, className, variant }) => (
              <Button
                key={verdict}
                size="lg"
                variant={variant}
                className={`h-14 justify-start gap-3 px-4 text-left ${className ?? ""}`}
                disabled={!ready || trimmed === "" || writes.busy}
                onClick={() => decide(verdict)}
                aria-label={BID_VERDICT_LABEL[verdict]}
              >
                <Icon size={22} aria-hidden="true" />
                <span className="flex flex-col">
                  <span className="text-base font-black">{BID_VERDICT_LABEL[verdict]}</span>
                  <span className="text-xs font-medium opacity-80">{words}</span>
                </span>
              </Button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">No-go and Revise tell the Deal Team. Nothing on the deal moves.</p>
        </div>
      )}
    </section>
  );
}
