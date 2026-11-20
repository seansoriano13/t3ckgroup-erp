import { Check, Pencil } from "lucide-react";

import { Button } from "../ui/button";
import StatusBadge from "../StatusBadge";
import { IPAS_STATE, IPAS_STATUS, IPAS_STATUS_LABELS, ipasStatusesFor } from "../../constants/ipas";
import { formatDay } from "../../utils/ipasPayments";
import { suggestStatus } from "../../utils/ipasStatusSuggestion";
import { cn } from "@/lib/utils";

/**
 * The IPAS Status as a step picker (#1154, ADR 0054): one liner row for each step of the IPAS's source, the
 * step's label, the day it was reached (blank when skipped or not yet) and who set it. The current step is
 * marked and carries its colour. Picking a row asks only for the date (the page's dialog, prefilled with
 * today); a reached row also offers "Edit date". Done is shown but not pickable: it comes from filing.
 *
 *   ipas        the shaped IPAS (`statusSteps`, `status`, `source`, `state`)
 *   canSet      Purchasing access, Logistics access or a Super Admin
 *   onPick      (step) => void   the page asks for the date, then calls the service
 *   onEditDate  (step) => void   the same dialog, for a step already reached
 *   onSuggest   (step) => void   the one-click move to a suggested step, dated today (#1155)
 *   suggesting  true while that move is saving
 */
export default function IpasStatusSteps({ ipas, canSet = false, onPick, onEditDate, onSuggest, suggesting = false }) {
  const open = ipas.state === IPAS_STATE.OPEN;
  const settable = canSet && open;
  const reached = new Map((ipas.statusSteps ?? []).map((item) => [item.step, item]));

  // One quiet line, only for people who may set the status; the status never moves without the click.
  const suggestion = settable && onSuggest ? suggestStatus(ipas) : null;

  return (
    <div className="space-y-2">
      {suggestion && (
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground" data-testid="ipas-status-suggestion">
          <span>
            {suggestion.because} Move to {suggestion.label}?
          </span>
          <Button type="button" variant="outline" size="xs" disabled={suggesting} onClick={() => onSuggest(suggestion.step)}>
            Move to {suggestion.label}
          </Button>
        </p>
      )}
    <ul className="divide-y divide-border" data-testid="ipas-status-steps">
      {ipasStatusesFor(ipas.source).map((step) => {
        const label = IPAS_STATUS_LABELS[step];
        const item = reached.get(step);
        const current = ipas.status === step;
        const isDone = step === IPAS_STATUS.DONE;
        const pickable = settable && !isDone;

        const body = (
          <>
            <span
              className={cn(
                "grid size-5 shrink-0 place-items-center rounded-full border",
                current
                  ? "border-foreground bg-foreground text-background"
                  : item
                    ? "border-green-400 bg-green-3/40 text-green-11"
                    : "border-border text-transparent",
              )}
              aria-hidden="true"
            >
              <Check size={12} strokeWidth={3} />
            </span>
            {current ? (
              <StatusBadge status={step} label={label} />
            ) : (
              <span className={cn("text-sm font-medium", item ? "text-foreground" : "text-muted-foreground")}>{label}</span>
            )}
            {current && <span className="text-xs font-medium text-muted-foreground">Current</span>}
            {isDone && !item && <span className="text-xs text-muted-foreground">Comes from filing</span>}
          </>
        );

        return (
          <li
            key={step}
            data-testid={`ipas-step-${step}`}
            aria-current={current ? "step" : undefined}
            className="flex flex-wrap items-center gap-x-3 gap-y-1 py-1.5"
          >
            {pickable ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-auto min-w-0 flex-1 justify-start gap-3 px-1 py-1 text-left font-normal whitespace-normal"
                aria-label={current ? `${label}, the current status` : `Set the status to ${label}`}
                onClick={() => onPick(step)}
              >
                {body}
              </Button>
            ) : (
              <div className="flex min-w-0 flex-1 items-center gap-3 px-1 py-1">{body}</div>
            )}
            <span className="ml-auto inline-flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              {item?.on && <span className="font-medium text-foreground tabular-nums">{formatDay(item.on)}</span>}
              {item?.by?.name && <span>set by {item.by.name}</span>}
              {pickable && item && (
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  className="gap-1 text-muted-foreground"
                  aria-label={`Edit the ${label} date`}
                  onClick={() => onEditDate(step)}
                >
                  <Pencil size={12} />
                  Edit date
                </Button>
              )}
            </span>
          </li>
        );
      })}
    </ul>
    </div>
  );
}
