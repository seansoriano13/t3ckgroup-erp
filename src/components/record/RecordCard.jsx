// The decider, shared by every form that has a record page (IPAS, Transmittal,
// Packing List): "Your move" answers what this person can do here, and says
// what happens next for whoever is up. A card move asks first when it
// `confirm`s (the restatement is the same line as the section row), and so does
// the drawer footer. Below the wide breakpoint the chain sits behind a toggle;
// above it the chain is always shown beside the moves.

import { useId, useState } from "react";
import { Link } from "react-router";

import { Button } from "@/components/ui/button";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { cn } from "@/lib/utils";
import MoveButton from "./MoveButton";
import RecordChain from "./RecordChain";
import { CHROME } from "./sectionChrome";
import { useMoveConfirm } from "./useMoveConfirm";

/** The wide breakpoint (Tailwind xl): the card sits beside the sections and shows its chain. */
const WIDE = "(min-width: 1280px)";

/** A group of moves, each with its label and its one-line consequence under it. */
function MoveGroup({ items, origin, className, ...rest }) {
  return (
    <ul className={cn("space-y-3", className)}>
      {items.map((item) => (
        <MoveButton key={item.key} move={item} origin={origin} {...rest} />
      ))}
    </ul>
  );
}

/**
 * @param {object} props
 * @param {string} props.status     the one line under "Your move"
 * @param {{ to: string, label: string }|null} [props.next]  the next record waiting on the viewer
 * @param {{ items: object[], className?: string }[]} props.groups  the viewer's moves, in order
 * @param {object[]} props.gates    the chain (see RecordChain)
 * @param {(section: string) => string} props.restate  the line a confirming move restates
 * @param {(section: string) => string} [props.reviewText]  the words of a move's review link
 * @param {(section: string) => void} [props.onReview]
 * @param {string} [props.viewer]
 * @param {boolean} props.busy     a move is running; every move is disabled
 * @param {object|null} props.failure  the failed move, shown under it with Retry
 * @param {string} [props.chainLabel]  e.g. "Where it stands"
 */
export default function RecordCard({
  status,
  next,
  groups,
  gates,
  restate,
  reviewText,
  onReview,
  viewer,
  busy,
  failure,
  chainLabel = "Where it stands",
}) {
  const wide = useMediaQuery(WIDE);
  const movesId = useId();
  const [chainOpen, setChainOpen] = useState(false);
  // Below the wide breakpoint the card is its heading and status line; the moves open on request.
  const [movesOpen, setMovesOpen] = useState(false);
  const offeredCount = groups.reduce((total, group) => total + group.items.length, 0);
  const doneCount = gates.filter((gate) => gate.done).length;

  // A card move asks first, unless it asks in its own dialog (the filing dialog, the reason of a return).
  const { run: runFromCard, dialog: confirmDialog } = useMoveConfirm({ restate, viewer, origin: CHROME.CARD });
  const rest = { disabled: busy, busy, failure, onRun: runFromCard, onReview, reviewText };

  return (
    <section
      id="your-move"
      tabIndex={-1}
      aria-labelledby="your-move-heading"
      className="overflow-hidden rounded-2xl border border-border bg-card outline-none"
    >
      <div className="space-y-4 p-5">
        <h2 id="your-move-heading" className="text-base font-semibold text-foreground">
          Your move
        </h2>
        <p className="text-sm text-foreground">{status}</p>
        {next && (
          <p className="text-sm">
            <Link to={next.to} className="font-semibold text-foreground underline underline-offset-4">
              {next.label}
            </Link>
          </p>
        )}

        {!wide && offeredCount > 0 && (
          <Button
            variant="outline"
            size="sm"
            aria-expanded={movesOpen}
            aria-controls={movesId}
            onClick={() => setMovesOpen((open) => !open)}
          >
            {movesOpen ? "Hide my moves" : `Show my moves · ${offeredCount}`}
          </Button>
        )}
        {(wide || movesOpen) && (
          <div id={movesId} className="space-y-4">
            {groups
              .filter((group) => group.items.length > 0)
              .map((group, index) => (
                <MoveGroup key={index} items={group.items} origin={CHROME.CARD} className={group.className} {...rest} />
              ))}
          </div>
        )}
      </div>

      {!wide && (
        <div className="border-t border-border px-5 py-3">
          <Button
            variant="ghost"
            size="sm"
            aria-expanded={chainOpen}
            aria-controls={chainOpen ? "your-move-chain" : undefined}
            onClick={() => setChainOpen((open) => !open)}
          >
            {chainOpen ? `Hide ${chainLabel.toLowerCase()}` : `${chainLabel} · ${doneCount} of ${gates.length}`}
          </Button>
        </div>
      )}
      {(wide || chainOpen) && (
        <div id="your-move-chain" className="border-t border-border p-5">
          <RecordChain gates={gates} label={chainLabel} />
        </div>
      )}

      {confirmDialog}
    </section>
  );
}
