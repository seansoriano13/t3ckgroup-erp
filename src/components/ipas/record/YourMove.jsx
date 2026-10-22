// The IPAS's "Your move": the shared Your move card, with one step per gate of
// the chain (gates.js). Each step names where it stands, offers the moves the
// viewer may make there (Submit, Approve, the filing steps, the next LC step)
// and links to its section. A move that signs asks first, as it always did.

import { Link } from "react-router";

import MoveButton from "@/components/record/MoveButton";
import { CHROME } from "@/components/record/sectionChrome";
import YourMoveCard from "@/components/record/YourMoveCard";
import { useMoveConfirm } from "@/components/record/useMoveConfirm";
import { Button } from "@/components/ui/button";
import { ipasSectionLabel } from "@/constants/ipas";
import { nowGate } from "./gates";
import { COSTS_WAITING } from "./moveCopy";
import { movesFor } from "./moves";

/** One line under "Your move": what the viewer can do, or who the IPAS waits on. */
function statusLine(digest, offered) {
  if (digest.filed) return "Filed. Nothing left to do.";
  if (digest.cancelled) return "Cancelled. Nothing to do.";
  // No gate is Now only while LC Odoo Done waits for Purchasing's encoding (gates.js).
  const now = nowGate(digest.gates);
  if (!now) return offered.length === 0 ? `Nothing needs you right now. ${COSTS_WAITING}` : COSTS_WAITING;
  const mine = now.moveKeys.some((key) => offered.some((move) => move.key === key));
  // Filing has three steps under one section number, so it names the step too.
  const step = now.part === "filing" ? `${now.label}, ${now.role}` : now.label;
  // "the approvers of 1 · Purchasing" already named the section once: say it once.
  const who = now.waitsOn.replace(` of ${now.label}`, "");
  return mine ? `Waiting for you: ${step}` : `Next: ${step}, waiting on ${who}`;
}

/** A step's title: "Section 1 · Purchasing", and for the gates that share a section its role too. Never a bare section label, which names the section row below. */
const titleOf = (gate) => `Section ${gate.key === gate.part ? gate.label : `${gate.label}, ${gate.role}`}`;

function MoveList({ items, run, busy, failure }) {
  if (items.length === 0) return null;
  return (
    <ul className="space-y-3">
      {items.map((item) => (
        <MoveButton key={item.key} move={item} origin={CHROME.CARD} disabled={busy} busy={busy} failure={failure} onRun={run} />
      ))}
    </ul>
  );
}

export default function YourMove({ ctx, digest, onReview, next }) {
  const { busy, failure, viewer } = ctx;
  const { run, dialog } = useMoveConfirm({ restate: (section) => digest.lines[section], viewer, origin: CHROME.CARD });
  const { moves, costs, returns } = movesFor(ctx, digest);
  const byKey = new Map([...moves, ...costs].map((item) => [item.key, item]));
  const offered = [...moves, ...costs, ...returns];
  const working = Boolean(busy.signoff || busy.give);

  const steps = digest.gates.map((gate) => {
    const own = gate.moveKeys.map((key) => byKey.get(key)).filter(Boolean);
    return {
      key: gate.key,
      title: titleOf(gate),
      summary: gate.line,
      state: gate.state,
      needsMe: own.length > 0,
      body: (
        <Button
          type="button"
          variant="link"
          onClick={() => onReview(gate.part)}
          className="h-auto p-0 text-xs font-medium underline underline-offset-4"
        >
          Review section {ipasSectionLabel(gate.part)}
        </Button>
      ),
      moves: <MoveList items={own} run={run} busy={working} failure={failure} />,
    };
  });

  return (
    <>
      <YourMoveCard
        status={statusLine(digest, offered)}
        next={
          next && (
            <p className="text-[13px]">
              <Link to={`/purchasing/ipas/${next.ipasId}`} className="font-semibold underline underline-offset-4">
                Next IPAS waiting for me: {next.number}
              </Link>
            </p>
          )
        }
        lead={<MoveList items={returns} run={run} busy={working} failure={failure} />}
        steps={steps}
      />
      {dialog}
    </>
  );
}
