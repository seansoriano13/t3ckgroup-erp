// The rail of the IPAS record: one road in two stretches (journey.js).
// "Get it ready" is a checklist of the work; "Sign the final IPAS" opens once
// it is all ticked. A sign-off is only pointed to here ("Go to sign-off"); it is signed from its
// own row in 6 · Sign-offs, after the signer reads the final IPAS form.
// Each item names who does it; the viewer's own items carry their button.

import { useState } from "react";
import { Link } from "react-router";
import { Check, Circle, Lock } from "lucide-react";

import MoveButton from "@/components/record/MoveButton";
import { CHROME } from "@/components/record/sectionChrome";
import { useMoveConfirm } from "@/components/record/useMoveConfirm";
import { Button } from "@/components/ui/button";
import { isSignAction } from "./journey";
import { movesFor } from "./moves";

function Item({ item, number, locked, onAct, onGo, busy }) {
  const { done, action } = item;
  const mine = Boolean(action) && !locked;
  return (
    <li
      className={`rounded-xl border px-3 py-2.5 ${mine ? "border-amber-a6 bg-amber-2" : "border-border bg-background"}`}
      data-testid={`ipas-journey-${item.key}`}
    >
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5 shrink-0" aria-hidden="true">
          {done ? (
            <Check size={16} className="text-green-11" />
          ) : locked ? (
            <Lock size={14} className="text-muted-foreground" />
          ) : (
            <Circle size={16} className={mine ? "text-amber-11" : "text-muted-foreground"} />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <p className={`text-sm font-semibold ${done ? "text-muted-foreground" : "text-foreground"}`}>
            {number ? `${number}. ` : ""}
            {item.label}
            <span className="sr-only">{done ? ", done" : mine ? ", your turn" : ", waiting"}</span>
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">{item.line}</p>
          {item.warning && !done && <p className="mt-1 text-xs font-medium text-red-11">{item.warning}</p>}
          {!done && (
            <p className={`mt-1 text-xs ${item.who.empty ? "font-medium text-red-11" : "text-muted-foreground"}`}>
              {item.who.empty ? item.who.names : <>Who: <span className="font-medium text-foreground">{item.who.names}</span></>}
            </p>
          )}
          {mine && (
            <div className="mt-2">
              {action.kind === "link" ? (
                <Button asChild size="sm" variant="outline">
                  <Link to={action.to}>{action.label}</Link>
                </Button>
              ) : isSignAction(action) ? (
                <Button size="sm" variant="outline" onClick={() => onGo(item.key)}>
                  Go to sign-off
                </Button>
              ) : (
                <Button size="sm" variant="outline" disabled={busy} onClick={() => onAct(item)}>
                  {action.label}
                </Button>
              )}
            </div>
          )}
        </div>
      </div>
    </li>
  );
}


export default function IpasJourney({ ctx, digest, journey, onEdit, onGoToSignoff, next }) {
  const { busy, failure, viewer, on } = ctx;
  const [showReady, setShowReady] = useState(false);
  const { run, dialog } = useMoveConfirm({ restate: (section) => digest.lines[section], viewer, origin: CHROME.CARD });
  const { returns } = movesFor(ctx, digest);
  const working = Boolean(busy.signoff || busy.give);
  const { ready, readyDone, sign } = journey;

  const act = (item) => {
    const { action } = item;
    if (action.kind === "edit") onEdit(action.section);
    else if (action.kind === "landed") on.setComputationStatus(action.status, { key: "costs", origin: CHROME.CARD });
  };

  const finished = digest.filed || digest.cancelled;

  return (
    <section className="rounded-2xl border border-border bg-card p-4" aria-labelledby="ipas-journey-title" data-testid="ipas-journey">
      <h2 id="ipas-journey-title" className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Your move
      </h2>
      <p className="mt-1 text-base font-semibold text-foreground" role="status" data-testid="ipas-journey-headline">
        {journey.headline}
      </p>
      {next && (
        <p className="mt-1 text-[13px]">
          <Link to={`/purchasing/ipas/${next.ipasId}`} className="font-semibold underline underline-offset-4">
            Next IPAS waiting for me: {next.number}
          </Link>
        </p>
      )}

      {!finished && (
        <>
          <h3 className="mt-4 text-sm font-semibold text-foreground">
            1. Get it ready{" "}
            <span className="font-normal text-muted-foreground">
              · {ready.filter((item) => item.done).length} of {ready.length} done
            </span>
          </h3>
          {/* Once it is all ready the list folds away, so a signer's button sits near the top. */}
          {readyDone && !showReady ? (
            <Button variant="link" className="h-auto p-0 text-xs font-medium underline underline-offset-4" onClick={() => setShowReady(true)}>
              Show what was done
            </Button>
          ) : (
            <ul className="mt-2 space-y-2">
              {ready.map((item) => (
                <Item key={item.key} item={item} onAct={act} onGo={onGoToSignoff} busy={working} />
              ))}
            </ul>
          )}

          <h3 className="mt-5 text-sm font-semibold text-foreground">2. Sign the final IPAS</h3>
          {!readyDone && (
            <p className="mt-1 text-xs text-muted-foreground">Opens once everything in 1 is done. Then each signer reads the final form and signs.</p>
          )}
          <ol className="mt-2 space-y-2">
            {sign.map((item, index) => (
              <Item key={item.key} item={item} number={index + 1} locked={!readyDone && !item.done} onAct={act} onGo={onGoToSignoff} busy={working} />
            ))}
          </ol>
        </>
      )}

      {returns.length > 0 && (
        <ul className="mt-4 border-t border-border pt-3">
          {returns.map((item) => (
            <MoveButton key={item.key} move={item} origin={CHROME.CARD} disabled={working} busy={working} failure={failure} onRun={run} />
          ))}
        </ul>
      )}
      {dialog}
    </section>
  );
}
