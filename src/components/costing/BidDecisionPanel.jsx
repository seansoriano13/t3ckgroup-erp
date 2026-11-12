import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, CircleX, Gavel, Lock, RotateCcw, Unlock, X } from "lucide-react";

import { Button } from "../ui/button";
import ConfirmDialog from "../ui/ConfirmDialog";
import { APPROVE_CLASS } from "../ui/approveClass";
import { Textarea } from "../ui/textarea";
import StatusBadge from "../StatusBadge";
import MarkLostDialogHost from "../sor/MarkLostDialogHost";
import { useAuth } from "../../context/AuthContext";
import { lostStagesOfFlow } from "../../constants/salesFlow";
import { LOST_REASON_OTHER } from "../../constants/sor";
import { salesFlowService } from "../../services/salesFlowService";
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
import { offerVsAbc } from "../../utils/costingMath";

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

/**
 * #941: next to a live No-go, the Deal Owner's "Move to Closed Lost". It opens the normal Mark as Lost
 * picker (the same database rules and confirmation as a manual move) with the No-go reason pre-filled as
 * the loss note. Other people are told who can close it. Nothing here moves a deal by itself, and it
 * draws nothing when the flow has no Closed Lost stage.
 */
export function MoveToClosedLost({ opportunity, reason, nameOf }) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const { data: canvas } = useQuery({
    queryKey: ["salesFlow", opportunity?.sale_type_id],
    queryFn: () => salesFlowService.getFlow(opportunity.sale_type_id),
    enabled: Boolean(opportunity?.sale_type_id),
  });
  const lostStages = canvas ? lostStagesOfFlow(canvas.stages, canvas.flow?.won_stage_id) : [];
  if (lostStages.length === 0) return null;
  // Already closed: nothing left to move.
  const current = canvas.stages.find((stage) => stage.id === opportunity.flow_stage_id);
  if (current?.is_terminal) return null;

  const ownerId = opportunity.deal_owner_id ?? null;
  const isOwner = Boolean(ownerId) && user?.id === ownerId;
  if (!isOwner) {
    const owner = ownerId ? nameOf(ownerId) : null;
    return (
      <p className="text-sm font-semibold text-foreground" data-testid="bid-decision-close-owner-only">
        Only the Deal Owner{owner ? ` (${owner})` : ""} can move this deal to Closed Lost.
      </p>
    );
  }
  return (
    <>
      <Button
        type="button"
        variant="outline"
        className="w-full justify-start gap-2"
        onClick={() => setOpen(true)}
        data-testid="bid-decision-move-closed-lost"
      >
        <CircleX size={16} aria-hidden="true" />
        Move to Closed Lost
      </Button>
      {open && (
        <MarkLostDialogHost
          opportunity={opportunity}
          lostStages={lostStages}
          isOpen
          onClose={() => setOpen(false)}
          initialReasonCode={LOST_REASON_OTHER}
          initialNote={reason ?? ""}
        />
      )}
    </>
  );
}

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
 * A No-go or a Revise tells the Deal Team and moves nothing on the SOR. After a No-go the Deal
 * Owner gets a "Move to Closed Lost" button (#941): a click, never automatic. This panel draws nothing for Purchasing or a
 * Stage Participant: the matrix read gives them no decision to show.
 */
export default function BidDecisionPanel({
  matrix,
  writes,
  nameOf = () => null,
  opportunity = null,
}) {
  const {
    tier,
    bidDecision,
    bidDecisionHistory = [],
    totals,
    tenderLines,
    evaluation,
  } = matrix;
  const [reason, setReason] = useState("");
  const [confirmingGo, setConfirmingGo] = useState(false);
  const [confirmingUnlock, setConfirmingUnlock] = useState(false);
  if (!tierReadsBidDecision(tier)) return null;

  const canDecide = tierDecidesBid(tier);
  const ready = tenderLines.length > 0 && totals.missingOffer === 0;
  // #881: a Go waits for the Evaluation of Specification to be approved. No-go and Revise do not.
  const evaluated = Boolean(evaluation?.approved);
  const trimmed = reason.trim();
  const earlier = bidDecisionHistory[0] ?? null;
  const locked = bidDecision?.verdict === BID_VERDICT.GO;
  const showFigures = tierReads(tier, "final_offer_unit");
  // #880: the planned revenue the Go would be taken against. A loss needs a Super Admin or the decider list.
  const revenue = matrix.summary?.revenue ?? null;
  const losing = revenue !== null && Number(revenue) < 0;
  const blockedLoss = losing && !matrix.canDecideLoss;
  // #899: an Unlock is the same right as a Go on a loss (costing_unlock_bid: a Super Admin or the decider list).
  const canUnlock = Boolean(matrix.canDecideLoss);
  // #964: Revenue ÷ Final Offer against the Go line. A warning only; it never blocks a Go.
  const marginPercent = matrix.summary?.revenuePercent ?? null;
  const goLine = matrix.summary?.goLinePercent ?? null;
  const underGoLine = Boolean(matrix.summary?.underGoLine);

  const offerCheck = offerVsAbc(tenderLines, matrix.abc);

  const decide = (verdict) =>
    writes.run(async () => {
      await costingMatrixService.decideBid(matrix.matrixId, {
        verdict,
        reason: trimmed,
      });
      setReason("");
    });

  /** A Go opens its confirm first, which states the figures it locks; the other verdicts go straight through. */
  const choose = (verdict) => {
    if (verdict === BID_VERDICT.GO) setConfirmingGo(true);
    else decide(verdict);
  };

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
          {bidDecision.verdict === BID_VERDICT.NO_GO && opportunity && (
            <div className="pt-1">
              <MoveToClosedLost opportunity={opportunity} reason={bidDecision.reason} nameOf={nameOf} />
            </div>
          )}
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

      {showFigures && ready && revenue !== null && (
        <p className="text-xs text-muted-foreground" data-testid="bid-decision-revenue-breakdown">
          Planned revenue: VAT-exclusive {pesos(matrix.summary?.vatExclusive)} − OPEX{" "}
          {pesos(matrix.summary?.opex)} − ITR {pesos(matrix.summary?.itr)} = {pesos(revenue)}
        </p>
      )}
      {showFigures && ready && marginPercent !== null && (
        <div className="space-y-1" data-testid="bid-decision-go-line">
          <p className="text-sm" data-testid="bid-decision-revenue-percent">
            <span className="text-muted-foreground">Revenue ÷ Final Offer </span>
            <span className="font-semibold">{marginPercent.toFixed(2)}%</span>
          </p>
          {underGoLine && (
            <p
              className="rounded-md border border-amber-500/50 bg-amber-500/10 p-2 text-sm text-foreground"
              role="alert"
              data-testid="bid-decision-under-go-line"
            >
              Under the {goLine}% Go line. A Go is still yours to take.
            </p>
          )}
        </div>
      )}
      {showFigures && offerCheck.low && (
        <div
          className="space-y-1 rounded-md border border-amber-500/50 bg-amber-500/10 p-2 text-sm text-foreground"
          role="alert"
          data-testid="bid-decision-low-offer"
        >
          <p className="font-semibold">
            The offer is {offerCheck.percent}% of the ABC — check each ABC is per unit, and the offer prices.
          </p>
          {offerCheck.lines.length > 0 && (
            <ul className="list-disc pl-5 text-xs" data-testid="bid-decision-low-offer-lines">
              {offerCheck.lines.map((l, i) => (
                <li key={l.id ?? i}>
                  {l.number ? `${l.number} ` : ""}
                  {l.name || "Line"}: {l.percent}% of its ABC
                </li>
              ))}
            </ul>
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
          {(!locked || canUnlock) && (
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
          )}
          {writes.notice && (
            <p className="text-sm font-semibold text-destructive" role="alert" data-testid="bid-decision-refusal">
              {writes.notice}
            </p>
          )}
          {locked ? (
            canUnlock ? (
              <Button
                size="lg"
                variant="outline"
                className="h-14 w-full justify-start gap-3 px-4 text-left"
                disabled={trimmed === "" || writes.busy}
                onClick={() => setConfirmingUnlock(true)}
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
              <p
                className="text-sm font-semibold text-foreground"
                data-testid="bid-decision-unlock-blocked"
              >
                Only a Super Admin or the people on the decider&apos;s list can unlock a bid.
              </p>
            )
          ) : (
            <div className="grid gap-2">
              {!evaluated && (
                <p
                  className="text-sm font-semibold text-foreground"
                  data-testid="bid-decision-needs-evaluation"
                >
                  Approve the Evaluation of Specification first. A Go waits for it.
                </p>
              )}
              {blockedLoss && (
                <p
                  className="text-sm font-semibold text-destructive"
                  data-testid="bid-decision-loss-blocked"
                >
                  Planned revenue is negative, so a Go waits for a Super Admin or the decider list. Revise and No-go are still open to you.
                </p>
              )}
              {CHOICES.map(
                ({ verdict, icon: Icon, words, className, variant }) => {
                  const disabled =
                    !ready ||
                    trimmed === "" ||
                    writes.busy ||
                    (verdict === BID_VERDICT.GO && (!evaluated || blockedLoss));
                  // #899: a Go that is off wears the neutral outline, not the solid green that reads as "Go already chosen".
                  const goOff = verdict === BID_VERDICT.GO && disabled;
                  return (
                    <Button
                      key={verdict}
                      size="lg"
                      variant={goOff ? "outline" : variant}
                      className={`h-14 justify-start gap-3 px-4 text-left ${goOff ? "" : (className ?? "")}`}
                      disabled={disabled}
                      onClick={() => choose(verdict)}
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
                  );
                },
              )}
            </div>
          )}
          {!locked && (
            <p className="text-xs text-muted-foreground">
              No-go and Revise tell the Deal Team. Nothing on the deal moves.
            </p>
          )}
          <ConfirmDialog
            open={confirmingGo}
            onOpenChange={setConfirmingGo}
            title="Go on this bid?"
            description="A Go locks the sheet. Nobody can change a number until it is unlocked."
            confirmLabel="Go"
            tone={losing ? "destructive" : "approve"}
            confirmDisabled={writes.busy}
            onConfirm={() => decide(BID_VERDICT.GO)}
          >
            <dl className="grid gap-1 text-sm" data-testid="bid-decision-go-figures">
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">Final Offer</dt>
                <dd className="font-semibold">{pesos(totals.finalOfferTotal)}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">ABC</dt>
                <dd className="font-semibold">{pesos(totals.abcTotal)}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">Planned revenue</dt>
                <dd className="font-semibold" data-testid="bid-decision-go-revenue">
                  {revenue === null
                    ? "Not worked yet"
                    : `${pesos(revenue)}${marginPercent === null ? "" : ` (${marginPercent.toFixed(1)}% of the Final Offer)`}`}
                </dd>
              </div>
            </dl>
            {losing && (
              <p className="text-sm font-semibold text-destructive" role="alert" data-testid="bid-decision-go-loss-warning">
                This bid loses money on the planned figures. Take the Go only if you mean to bid at a loss.
              </p>
            )}
          </ConfirmDialog>
          {locked && canUnlock && (
            <ConfirmDialog
              open={confirmingUnlock}
              onOpenChange={setConfirmingUnlock}
              title="Unlock this bid?"
              description="The sheet opens again and the Go is cleared. The Go has to be taken again."
              confirmLabel="Unlock"
              confirmDisabled={writes.busy}
              onConfirm={unlock}
            >
              <p className="text-sm" data-testid="bid-decision-unlock-reason">
                Your reason: <span className="font-semibold">{trimmed}</span>
              </p>
            </ConfirmDialog>
          )}
        </div>
      )}
    </section>
  );
}
