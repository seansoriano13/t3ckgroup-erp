import { useState } from "react";
import { Check, Gavel, Lock, RotateCcw, Unlock, X } from "lucide-react";

import { Button } from "../ui/button";
import { APPROVE_CLASS } from "../ui/approveClass";
import { Textarea } from "../ui/textarea";
import StatusBadge from "../StatusBadge";
import { costingMatrixService } from "../../services/costingMatrixService";
import {
  BID_VERDICT,
  BID_VERDICT_LABEL,
  tierDecidesBid,
  tierReads,
  tierReadsBidDecision,
} from "../../constants/costing";
import { formatDate } from "../../utils/formatDate";
import { pesos } from "./gridFormat";

/** The badge colour of each verdict: Go green, Revise amber, No-go red. */
const VERDICT_THEME = {
  [BID_VERDICT.GO]: "green",
  [BID_VERDICT.REVISE]: "amber",
  [BID_VERDICT.NO_GO]: "red",
};

/** The three verdict buttons, in the order the boss reads them: big, each saying what it means. */
const CHOICES = [
  {
    verdict: BID_VERDICT.GO,
    icon: Check,
    words: "Bid at these Final Offers, and lock the sheet",
    className: APPROVE_CLASS,
  },
  {
    verdict: BID_VERDICT.REVISE,
    icon: RotateCcw,
    words: "Send back to reprice",
    variant: "outline",
  },
  {
    verdict: BID_VERDICT.NO_GO,
    icon: X,
    words: "Do not bid",
    variant: "destructive",
  },
];

function Verdict({ verdict }) {
  return (
    <StatusBadge
      theme={VERDICT_THEME[verdict]}
      label={BID_VERDICT_LABEL[verdict] ?? verdict}
    />
  );
}

/**
 * The Bid Decision (#320) at the summary: whether this price wins this project. Go, No-go or Revise
 * with the reason in the decider's own words, who decided and when. Sales (the price tier) sees the
 * verdict and the reason and never the figures it was taken against; Closed Book also sees the Final
 * Offer total and ABC it was stamped with, and is the only side with the Go / Revise / No-go
 * controls (the Final Acquire list or a Super Admin: the database decides). A Go locks the sheet (#704):
 * the panel then shows who decided, the figures and "The sheet is locked", and an Unlock that takes its
 * own reason, is recorded, and clears the Go so it has to be taken again.
 *
 * A No-go or a Revise tells the Deal Team and moves nothing on the SOR; taking the deal to Closed
 * Lost stays the Deal Owner's move on the Sales Flow. This panel draws nothing for Purchasing or a
 * Stage Participant: the matrix read gives them no decision to show.
 */
export default function BidDecisionPanel({
  matrix,
  writes,
  nameOf = () => null,
}) {
  const {
    tier,
    bidDecision,
    bidDecisionHistory = [],
    totals,
    tenderLines,
  } = matrix;
  const [reason, setReason] = useState("");
  if (!tierReadsBidDecision(tier)) return null;

  const canDecide = tierDecidesBid(tier);
  const ready = tenderLines.length > 0 && totals.missingOffer === 0;
  const trimmed = reason.trim();
  const earlier = bidDecisionHistory[0] ?? null;
  const locked = bidDecision?.verdict === BID_VERDICT.GO;
  const showFigures = tierReads(tier, "final_offer_unit");

  const decide = (verdict) =>
    writes.run(async () => {
      await costingMatrixService.decideBid(matrix.matrixId, {
        verdict,
        reason: trimmed,
      });
      setReason("");
    });

  const unlock = () =>
    writes.run(async () => {
      await costingMatrixService.unlockBid(matrix.matrixId, {
        reason: trimmed,
      });
      setReason("");
    });

  const decider = bidDecision ? nameOf(bidDecision.decidedBy) : null;
  const frame = {
    [BID_VERDICT.GO]: "border-green-8",
    [BID_VERDICT.NO_GO]: "border-red-8",
    [BID_VERDICT.REVISE]: "border-amber-8",
  }[bidDecision?.verdict];

  return (
    <section
      className={`space-y-4 rounded-2xl border-2 bg-card p-5 ${frame ?? "border-border"}`}
      aria-label="Bid Decision"
      data-testid="bid-decision"
    >
      <h3 className="flex items-center gap-2 text-lg font-black tracking-tight text-foreground">
        <Gavel size={18} aria-hidden="true" />
        Bid Decision
      </h3>

      {bidDecision ? (
        <div className="space-y-1.5" data-testid="bid-decision-live">
          <p className="text-2xl font-black tracking-tight text-foreground">
            {BID_VERDICT_LABEL[bidDecision.verdict] ?? bidDecision.verdict}
          </p>
          <div className="flex items-center gap-2">
            <Verdict verdict={bidDecision.verdict} />
            <span className="text-xs text-muted-foreground">
              {decider ? `${decider}, ` : ""}
              {formatDate(bidDecision.decidedAt)}
            </span>
          </div>
          <p
            className="whitespace-pre-wrap text-sm text-foreground"
            data-testid="bid-decision-reason"
          >
            {bidDecision.reason}
          </p>
          {"finalOfferTotal" in bidDecision && (
            <p
              className="text-xs text-muted-foreground"
              data-testid="bid-decision-figures"
            >
              Taken against a Final Offer of{" "}
              {pesos(bidDecision.finalOfferTotal)}
              {bidDecision.abcTotal === null ||
              bidDecision.abcTotal === undefined
                ? ""
                : ` and an ABC of ${pesos(bidDecision.abcTotal)}`}
              .
            </p>
          )}
          {locked && (
            <p
              className="flex items-center gap-1.5 pt-1 text-sm font-semibold text-foreground"
              data-testid="bid-decision-locked"
            >
              <Lock size={14} aria-hidden="true" /> The sheet is locked. Nobody
              can change a number until it is unlocked.
            </p>
          )}
        </div>
      ) : (
        <div className="space-y-1">
          <p
            className="text-sm text-muted-foreground"
            data-testid="bid-decision-none"
          >
            {ready
              ? "No decision yet."
              : "No decision yet. It can be taken once every Tender Line has a Final Offer."}
          </p>
          {showFigures && ready && (
            <p
              className="text-xs text-muted-foreground"
              data-testid="bid-decision-will-be"
            >
              It will be taken against a Final Offer of{" "}
              {pesos(totals.finalOfferTotal)}
              {totals.abcTotal === null || totals.abcTotal === undefined
                ? ""
                : ` and an ABC of ${pesos(totals.abcTotal)}`}
              .
            </p>
          )}
        </div>
      )}

      {!bidDecision && earlier && (
        <p
          className="text-xs text-muted-foreground"
          data-testid="bid-decision-cleared"
        >
          The earlier decision (
          {BID_VERDICT_LABEL[earlier.verdict] ?? earlier.verdict}) was cleared:{" "}
          {earlier.clearedReason}.
        </p>
      )}

      {canDecide && (
        <div className="space-y-3 border-t border-border/50 pt-3">
          <Textarea
            aria-label={
              locked ? "Reason for unlocking" : "Reason for the decision"
            }
            placeholder={
              locked
                ? "Unlock? Write why. It is recorded."
                : bidDecision
                  ? "Decide again? Write why."
                  : "Why? Write the reason in your own words."
            }
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            disabled={!ready || writes.busy}
            className="min-h-[64px]"
          />
          {writes.notice && (
            <p className="text-sm font-semibold text-destructive" role="alert" data-testid="bid-decision-refusal">
              {writes.notice}
            </p>
          )}
          {locked ? (
            <Button
              size="lg"
              variant="outline"
              className="h-14 w-full justify-start gap-3 px-4 text-left"
              disabled={trimmed === "" || writes.busy}
              onClick={unlock}
              aria-label="Unlock"
            >
              <Unlock size={22} aria-hidden="true" />
              <span className="flex flex-col">
                <span className="text-base font-black">Unlock</span>
                <span className="text-xs font-medium opacity-80">
                  Opens the sheet again; the Go has to be taken again
                </span>
              </span>
            </Button>
          ) : (
            <div className="grid gap-2">
              {CHOICES.map(
                ({ verdict, icon: Icon, words, className, variant }) => (
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
                      <span className="text-base font-black">
                        {BID_VERDICT_LABEL[verdict]}
                      </span>
                      <span className="text-xs font-medium opacity-80">
                        {words}
                      </span>
                    </span>
                  </Button>
                ),
              )}
            </div>
          )}
          {!locked && (
            <p className="text-xs text-muted-foreground">
              No-go and Revise tell the Deal Team. Nothing on the deal moves.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
