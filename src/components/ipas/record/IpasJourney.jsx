// The rail of the IPAS record: one road in two stretches (journey.js).
// "Get it ready" is a checklist of the work; "Sign the final IPAS" opens once
// it is all ticked, and every signer reads the final IPAS form before signing.
// Each item names who does it; the viewer's own items carry their button.

import { useState } from "react";
import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { Check, Circle, CircleAlert, Lock } from "lucide-react";

import MoveButton from "@/components/record/MoveButton";
import { CHROME } from "@/components/record/sectionChrome";
import { useMoveConfirm } from "@/components/record/useMoveConfirm";
import { Button } from "@/components/ui/button";
import { APPROVE_CLASS } from "@/components/ui/approveClass";
import ModalShell from "@/components/ui/ModalShell";
import { ipasErrorMessage } from "@/utils/ipas";
import { missingDocumentsByPart } from "@/utils/ipasDocuments";
import { ipasService } from "@/services/ipasService";
import { ipasFilingWarningsKey } from "../ipasKeys";
import { movesFor } from "./moves";
import { PreviewFrame } from "./PrintPreview";

function Item({ item, number, locked, onAct, busy }) {
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

/**
 * "Review and file" warns like the filing dialog does (#936): the required documents
 * nobody has ticked and the required files still missing. It only warns; the database
 * refuses a sign-off whose files are missing and names them.
 */
function FilingWarning({ ipas }) {
  const ticks = useQuery({
    queryKey: ipasFilingWarningsKey(ipas.id),
    queryFn: () => ipasService.filingWarnings(ipas.id),
    staleTime: 0,
    gcTime: 0,
    retry: false,
  });
  const byPart = missingDocumentsByPart(ipas.documents ?? [], ipas.payments ?? [], ipas.source);
  const files = [...byPart.purchasing, ...byPart.finance, ...byPart.costing, ...byPart.filing];
  const unticked = (ticks.data ?? []).map((doc) => doc.label);
  if (files.length === 0 && unticked.length === 0) return null;
  return (
    <div
      role="status"
      data-testid="ipas-review-warnings"
      className="border-b border-amber-400 bg-amber-3/40 px-5 py-2 text-[13px] text-amber-11"
    >
      <p className="flex items-center gap-1.5 font-semibold">
        <CircleAlert size={15} aria-hidden="true" />
        Required documents are missing
      </p>
      {files.length > 0 && <p className="mt-0.5 text-xs">No file attached: {files.join(", ")}.</p>}
      {unticked.length > 0 && <p className="mt-0.5 text-xs">Not ticked: {unticked.join(", ")}.</p>}
    </div>
  );
}

/** The final IPAS form, as it prints, with the one button that signs it. */
function SignReview({ ctx, item, onClose, onSign }) {
  const [working, setWorking] = useState(false);
  // A refusal stays here, beside the button, until the next try (a toast is gone in seconds).
  const [problem, setProblem] = useState(null);
  const { ipas, viewer } = ctx;
  const action = item?.action;
  return (
    <ModalShell
      open={Boolean(item)}
      onOpenChange={(next) => {
        if (next || working) return;
        setProblem(null);
        onClose();
      }}
      size="wide"
      expandable
      className="h-[90vh]"
      bodyClassName="gap-0 p-0"
      crumbs={["IPAS", ipas.number, item?.label ?? "Sign"]}
      cancelLabel="Not yet"
      actions={
        action && (
          <Button
            size="lg"
            className={APPROVE_CLASS}
            disabled={working}
            onClick={async () => {
              setWorking(true);
              setProblem(null);
              try {
                await onSign(item);
                onClose();
              } catch (error) {
                setProblem(ipasErrorMessage(error));
              } finally {
                setWorking(false);
              }
            }}
          >
            {working ? "Signing…" : action.confirm}
          </Button>
        )
      }
    >
      <p className="border-b border-border px-5 py-2 text-xs text-muted-foreground">
        Read the final IPAS below. When you press <span className="font-semibold text-foreground">{action?.confirm}</span>, {action?.what}.
        {viewer ? ` You sign as ${viewer}.` : ""}
      </p>
      {action?.kind === "file" && <FilingWarning ipas={ipas} />}
      {problem && (
        <p role="alert" className="border-b border-red-7 bg-red-3/40 px-5 py-2 text-sm font-medium text-red-11">
          {problem}
        </p>
      )}
      <div className="min-h-0 flex-1 bg-mauve-4">{item && <PreviewFrame ctx={ctx} filingCopy={false} />}</div>
    </ModalShell>
  );
}

export default function IpasJourney({ ctx, digest, journey, onEdit, next }) {
  const { busy, failure, viewer, on } = ctx;
  const [reviewing, setReviewing] = useState(null);
  const [showReady, setShowReady] = useState(false);
  const { run, dialog } = useMoveConfirm({ restate: (section) => digest.lines[section], viewer, origin: CHROME.CARD });
  const { returns } = movesFor(ctx, digest);
  const working = Boolean(busy.signoff || busy.give);
  const { ready, readyDone, sign } = journey;

  const act = (item) => {
    const { action } = item;
    if (action.kind === "edit") onEdit(action.section);
    else if (action.kind === "landed") on.setComputationStatus(action.status, { key: "costs", origin: CHROME.CARD });
    else if (action.kind === "logistics") on.approve(8, { key: "logistics", origin: CHROME.CARD });
    else setReviewing(item);
  };
  const signIt = (item) => {
    const { action } = item;
    if (action.kind === "sign") return on.signMany(action.steps);
    if (action.kind === "check") return on.signCheck();
    return on.file();
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
                <Item key={item.key} item={item} onAct={act} busy={working} />
              ))}
            </ul>
          )}

          <h3 className="mt-5 text-sm font-semibold text-foreground">2. Sign the final IPAS</h3>
          {!readyDone && (
            <p className="mt-1 text-xs text-muted-foreground">Opens once everything in 1 is done. Then each signer reads the final form and signs.</p>
          )}
          <ol className="mt-2 space-y-2">
            {sign.map((item, index) => (
              <Item key={item.key} item={item} number={index + 1} locked={!readyDone && !item.done} onAct={act} busy={working} />
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
      <SignReview ctx={ctx} item={reviewing} onClose={() => setReviewing(null)} onSign={signIt} />
    </section>
  );
}
