/**
 * The Bid decision on the price corridor (layout F, 2026-11-13). One card that answers "can I decide, and what?":
 *  1. Before a Go: the checks (the same as Costing settled), each a jump to the step that fixes it.
 *  2. The figures the decision is stamped with, as one line.
 *  3. Warnings only when they apply, one line each. The low-offer check (#942: the offer under half the ABC,
 *     usually an ABC typed as a total) stays, folded: one line with a count, the lines on request.
 *  4. The reason, then Go / Revise / No-go side by side; a Go that cannot be taken says why in one line.
 * A live decision replaces the controls with the verdict, who, when and why; a Go shows the lock and Unlock.
 *
 * The rules are BidDecisionPanel's: who may decide, Go waits for the Evaluation of Specification, a Go on a loss
 * needs a Super Admin or the decider list, a Go locks the sheet and confirms first, an Unlock takes its own reason.
 */
import { useState } from "react";
import { AlertTriangle, Check, ChevronDown, ChevronRight, CircleDashed, Lock, RotateCcw, Unlock, X } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "../../../ui/button";
import ConfirmDialog from "../../../ui/ConfirmDialog";
import { Textarea } from "../../../ui/textarea";
import StatusBadge from "../../../StatusBadge";
import { MoveToClosedLost } from "../../BidDecisionPanel";
import { pesos } from "../../gridFormat";
import { costingMatrixService } from "../../../../services/costingMatrixService";
import { BID_VERDICT, BID_VERDICT_LABEL, COSTING_TIER, tierDecidesBid, tierReadsBidDecision } from "../../../../constants/costing";
import { offerVsAbc } from "../../../../utils/costingMath";
import { formatDate } from "../../../../utils/formatDate";

const VERDICT_THEME = { [BID_VERDICT.GO]: "green", [BID_VERDICT.REVISE]: "amber", [BID_VERDICT.NO_GO]: "red" };

const CHOICES = [
  { verdict: BID_VERDICT.GO, icon: Check, words: "Bid, and lock the sheet", on: "border-green-8 bg-green-3 text-green-12 hover:bg-green-4" },
  { verdict: BID_VERDICT.REVISE, icon: RotateCcw, words: "Send back to reprice", on: "border-amber-8 bg-amber-3 text-amber-12 hover:bg-amber-4" },
  { verdict: BID_VERDICT.NO_GO, icon: X, words: "Do not bid", on: "border-red-8 bg-red-3 text-red-12 hover:bg-red-4" },
];

function Checks({ items, onJump }) {
  const done = items.filter((i) => i.done).length;
  return (
    <div>
      <div className="flex items-baseline justify-between px-4 pb-1 pt-3">
        <h4 className="text-xs font-semibold text-muted-foreground">Before a Go</h4>
        <span className="text-xs tabular-nums text-muted-foreground">
          {done} of {items.length}
        </span>
      </div>
      <ul>
        {items.map((item) => (
          <li key={item.key}>
            <Button type="button" variant="ghost" className="h-auto w-full justify-start gap-2.5 rounded-none px-4 py-1.5 text-left font-normal" onClick={() => onJump(item.step)}>
              {item.done ? <Check size={15} className="shrink-0 text-mauve-9" aria-label="Done" /> : <CircleDashed size={15} className="shrink-0 text-mauve-11" aria-label="Not done" />}
              <span className={cn("min-w-0 flex-1 truncate text-sm", item.done ? "text-muted-foreground" : "text-foreground")}>{item.label}</span>
              {item.left && <span className="shrink-0 text-xs font-medium text-foreground">{item.left}</span>}
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function DecisionCard({ matrix, c, fall, writes, nameOf, opportunity, onJump }) {
  const { tier, bidDecision, bidDecisionHistory = [], totals, tenderLines, evaluation } = matrix;
  const [reason, setReason] = useState("");
  const [confirmingGo, setConfirmingGo] = useState(false);
  const [confirmingUnlock, setConfirmingUnlock] = useState(false);
  const [showLow, setShowLow] = useState(false);
  if (!tierReadsBidDecision(tier)) return null;

  const canDecide = tierDecidesBid(tier);
  const ready = tenderLines.length > 0 && totals.missingOffer === 0;
  const evaluated = Boolean(evaluation?.approved);
  const trimmed = reason.trim();
  const locked = bidDecision?.verdict === BID_VERDICT.GO;
  const revenue = matrix.summary?.revenue ?? null;
  const losing = revenue !== null && Number(revenue) < 0;
  const blockedLoss = losing && !matrix.canDecideLoss;
  const canUnlock = Boolean(matrix.canDecideLoss);
  const underGoLine = Boolean(matrix.summary?.underGoLine);
  const low = offerVsAbc(tenderLines, matrix.abc, matrix.offer);
  const earlier = bidDecisionHistory[0] ?? null;

  // The checks and the figures are the Closed Book's; another tier reading the decision gets the verdict and the reason.
  const closed = tier === COSTING_TIER.CLOSED_BOOK;
  const left = (key) => c.steps.find((s) => s.key === key)?.left ?? 0;
  const items = [
    { key: "offers", done: ready, label: "A Final Offer on every line", left: totals.missingOffer ? `${totals.missingOffer} without` : null, step: "offers" },
    { key: "fa", done: left("finalAcquire") === 0 && c.rows.length > 0, label: "Every part has a Final Acquire", left: left("finalAcquire") ? `${left("finalAcquire")} blank` : null, step: "finalAcquire" },
    { key: "other", done: left("otherCosts") === 0, label: "Every other cost has an amount", left: left("otherCosts") ? `${left("otherCosts")} blank` : null, step: "otherCosts" },
    { key: "abc", done: !totals.overAbc && totals.abcTotal != null, label: "The offer is within the ABC", left: totals.overAbc ? "over" : totals.abcTotal == null ? "no ABC" : null, step: "offers" },
    { key: "specs", done: evaluated, label: "The specs are approved", left: evaluated ? null : "waiting", step: "specs" },
  ];

  // Why a Go cannot be taken right now, in one line; Revise and No-go only need a reason.
  const goBlocked = !ready ? "Every line needs a Final Offer first." : !evaluated ? "A Go waits for the specs to be approved." : blockedLoss ? "This bid loses money: a Go needs a Super Admin or the decider list." : null;

  const decide = (verdict) =>
    writes.run(async () => {
      await costingMatrixService.decideBid(matrix.matrixId, { verdict, reason: trimmed });
      setReason("");
    });
  const unlock = () =>
    writes.run(async () => {
      await costingMatrixService.unlockBid(matrix.matrixId, { reason: trimmed });
      setReason("");
    });

  const frame = { [BID_VERDICT.NO_GO]: "border-red-7", [BID_VERDICT.REVISE]: "border-amber-7" }[bidDecision?.verdict] ?? "border-border";

  return (
    <section className={cn("overflow-hidden rounded-xl border bg-card", frame)} aria-label="Bid decision" data-testid="corridor-decision">
      <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
        <h3 className="text-sm font-semibold">Bid decision</h3>
        {bidDecision ? (
          <StatusBadge theme={VERDICT_THEME[bidDecision.verdict]} label={`${BID_VERDICT_LABEL[bidDecision.verdict] ?? bidDecision.verdict}${locked ? " · locked" : ""}`} />
        ) : (
          <span className="text-xs text-muted-foreground">No decision yet</span>
        )}
      </div>

      {!locked && closed && <Checks items={items} onJump={onJump} />}

      <div className="space-y-3 border-t border-border px-4 py-3">
        {/* What the decision is stamped with. */}
        {closed && (
        <dl className="grid grid-cols-3 gap-2 text-xs" data-testid="corridor-decision-figures">
          <div>
            <dt className="text-muted-foreground">Offer</dt>
            <dd className="font-semibold tabular-nums">{totals.finalOfferTotal == null ? "—" : pesos(bidDecision?.finalOfferTotal ?? totals.finalOfferTotal)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">ABC</dt>
            <dd className="font-semibold tabular-nums">{totals.abcTotal == null ? "—" : pesos(bidDecision?.abcTotal ?? totals.abcTotal)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Revenue</dt>
            <dd className={cn("font-semibold tabular-nums", underGoLine && "text-amber-11", losing && "text-red-11")}>{fall?.revenuePercent == null ? "—" : `${fall.revenuePercent.toFixed(1)}%`}</dd>
          </div>
        </dl>
        )}

        {/* Warnings, only when they apply: one line each. */}
        {closed && (underGoLine || low.low || losing) && (
          <ul className="space-y-1.5 text-xs" data-testid="corridor-decision-warnings">
            {losing && (
              <li className="flex gap-1.5 text-red-11" data-testid="corridor-decision-loss">
                <AlertTriangle size={13} className="mt-0.5 shrink-0" aria-hidden="true" />
                Planned revenue is negative: this bid loses money.
              </li>
            )}
            {underGoLine && !losing && (
              <li className="flex gap-1.5 text-amber-11" data-testid="corridor-decision-under-go-line">
                <AlertTriangle size={13} className="mt-0.5 shrink-0" aria-hidden="true" />
                Under the {fall?.goLine ?? 20}% Go line. A Go is still yours to take.
              </li>
            )}
            {low.low && (
              <li className="text-amber-11">
                <Button type="button" variant="ghost" size="xs" className="-mx-1.5 h-auto items-start gap-1.5 whitespace-normal px-1.5 py-0.5 text-left text-xs font-normal text-amber-11 hover:text-amber-12" aria-expanded={showLow} onClick={() => setShowLow((v) => !v)}>
                  <AlertTriangle size={13} className="mt-0.5 shrink-0" aria-hidden="true" />
                  <span>
                    The offer is {low.percent}% of the ABC. Is every ABC per unit?
                    {low.lines.length > 0 && <span className="ml-1 underline underline-offset-2">{showLow ? "Hide" : `${low.lines.length} lines`}</span>}
                  </span>
                  {low.lines.length > 0 && (showLow ? <ChevronDown size={13} className="mt-0.5 shrink-0" /> : <ChevronRight size={13} className="mt-0.5 shrink-0" />)}
                </Button>
                {showLow && (
                  <ul className="mt-1 space-y-0.5 pl-5 text-muted-foreground" data-testid="corridor-decision-low-lines">
                    {low.lines.map((l, i) => (
                      <li key={l.id ?? i} className="flex justify-between gap-2">
                        <span className="min-w-0 truncate">
                          {l.number}. {l.name || "Line"}
                        </span>
                        <span className="shrink-0 tabular-nums">{l.percent}%</span>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            )}
          </ul>
        )}

        {bidDecision && (
          <div className="space-y-1.5" data-testid="corridor-decision-live">
            <p className="text-xs text-muted-foreground">
              {nameOf(bidDecision.decidedBy) ?? "Someone"}, {formatDate(bidDecision.decidedAt)}
            </p>
            <p className="whitespace-pre-wrap text-sm" data-testid="corridor-decision-reason">
              {bidDecision.reason}
            </p>
            {locked && (
              <p className="flex items-center gap-1.5 text-xs font-semibold" data-testid="corridor-decision-locked">
                <Lock size={13} aria-hidden="true" /> The sheet is locked until someone unlocks it.
              </p>
            )}
            {bidDecision.verdict === BID_VERDICT.NO_GO && opportunity && <MoveToClosedLost opportunity={opportunity} reason={bidDecision.reason} nameOf={nameOf} />}
          </div>
        )}
        {!bidDecision && earlier && (
          <p className="text-xs text-muted-foreground" data-testid="corridor-decision-cleared">
            Earlier {BID_VERDICT_LABEL[earlier.verdict] ?? earlier.verdict} was cleared: {earlier.clearedReason}.
          </p>
        )}

        {canDecide && (!locked || canUnlock) && (
          <Textarea
            aria-label={locked ? "Reason for unlocking" : "Reason for the decision"}
            placeholder={locked ? "Unlock? Write why. It is recorded." : bidDecision ? "Decide again? Write why." : "Why? Write the reason in your own words."}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            disabled={(!locked && !ready) || writes.busy}
            className="min-h-[56px] text-sm"
          />
        )}
        {writes.notice && (
          <p className="text-xs font-semibold text-destructive" role="alert">
            {writes.notice}
          </p>
        )}

        {canDecide && !locked && (
          <>
            <div className="grid grid-cols-3 gap-1.5" role="group" aria-label="Decide">
              {CHOICES.map(({ verdict, icon: Icon, words, on }) => {
                const disabled = !ready || trimmed === "" || writes.busy || (verdict === BID_VERDICT.GO && Boolean(goBlocked));
                return (
                  <Button
                    key={verdict}
                    type="button"
                    variant="outline"
                    disabled={disabled}
                    title={words}
                    aria-label={`${BID_VERDICT_LABEL[verdict]}: ${words}`}
                    onClick={() => (verdict === BID_VERDICT.GO ? setConfirmingGo(true) : decide(verdict))}
                    className={cn("h-auto flex-col gap-0.5 rounded-lg px-1 py-2", !disabled && on)}
                  >
                    <Icon size={16} aria-hidden="true" />
                    <span className="text-sm font-semibold">{BID_VERDICT_LABEL[verdict]}</span>
                  </Button>
                );
              })}
            </div>
            <p className="text-xs text-muted-foreground" data-testid="corridor-decision-why">
              {goBlocked ?? (trimmed === "" ? "Write a reason to decide." : "Go locks the sheet. Revise and No-go tell the Deal Team; nothing on the deal moves.")}
            </p>
          </>
        )}

        {canDecide && locked && canUnlock && (
          <Button type="button" variant="outline" className="w-full" disabled={trimmed === "" || writes.busy} onClick={() => setConfirmingUnlock(true)}>
            <Unlock size={14} aria-hidden="true" />
            Unlock the sheet
          </Button>
        )}
        {canDecide && locked && !canUnlock && (
          <p className="text-xs text-muted-foreground" data-testid="corridor-decision-unlock-blocked">
            Only a Super Admin or the decider list can unlock a bid.
          </p>
        )}
      </div>

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
        <dl className="grid gap-1 text-sm" data-testid="corridor-decision-go-figures">
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
            <dd className="font-semibold" data-testid="corridor-decision-go-revenue">
              {revenue === null ? "Not worked yet" : `${pesos(revenue)}${fall?.revenuePercent == null ? "" : ` (${fall.revenuePercent.toFixed(1)}%)`}`}
            </dd>
          </div>
        </dl>
        {losing && (
          <p className="mt-2 text-sm font-semibold text-red-11" data-testid="corridor-decision-go-loss">
            This bid loses money.
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
          <p className="text-sm">
            Your reason: <span className="font-semibold">{trimmed}</span>
          </p>
        </ConfirmDialog>
      )}
    </section>
  );
}
