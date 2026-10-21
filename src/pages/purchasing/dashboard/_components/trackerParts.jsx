import { Check, Pencil } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { DEADLINE_MARK } from "../../../../utils/deliveryDeadline";
import { formatDateWith } from "../../../../utils/formatDate";
import { pluralize } from "../../../../utils/plural";
import { ageDays, rowLabel } from "../../../../utils/purchasingDashboard";
import { TRACKER_STAGES, orderMove, stageStates } from "../../../../utils/purchasingTracker";

/**
 * Small pieces the tracker table and the SOR panel draw the same way. The
 * circles are the Register's: a tick for a stamped step, a pencil for a typed
 * one, a number for work still outstanding, empty for a step not reached.
 */

const TONE = {
  done: "border-green-7 bg-green-3/40 text-green-11",
  open: "border-amber-7 bg-amber-3/40 text-amber-11",
  late: "border-destructive/60 bg-destructive/10 text-destructive",
  none: "border-border text-transparent",
};

export function Circle({ tone = "none", children, title, size = "size-5" }) {
  return (
    <span
      role="img"
      aria-label={title}
      title={title}
      className={cn("grid shrink-0 place-items-center rounded-full border text-[10px] font-bold tabular-nums", size, TONE[tone])}
    >
      {children}
    </span>
  );
}

const stageTitle = (stage, state) =>
  `${stage.label}: ${state.n > 0 ? `${state.n} ${stage.unit}` : state.tone === "done" ? "cleared" : "nothing yet"}`;

/** One stage's circle for a SOR: the count when work is outstanding, a tick when cleared. */
export function StageCircle({ stage, state }) {
  return (
    <Circle tone={state.tone} size="size-6" title={stageTitle(stage, state)}>
      {state.n > 0 ? (state.n > 99 ? "99+" : state.n) : <Check size={12} strokeWidth={3} />}
    </Circle>
  );
}

/** The order's buyer track, as the Register draws it. */
export function OrderTrack({ order }) {
  return (
    <ol className="flex items-center gap-1" aria-label={`Buyer track for ${order.number}`}>
      {order.buyerTrack.map((step) => {
        const tone = step.mark !== "pending" ? "done" : step.partial ? "open" : "none";
        return (
          <li key={step.key}>
            <Circle tone={tone} title={`${step.label}, ${step.mark}`}>
              {step.mark === "typed" ? <Pencil size={10} strokeWidth={3} /> : <Check size={12} strokeWidth={3} />}
            </Circle>
          </li>
        );
      })}
    </ol>
  );
}

/** "Due Nov 12 · 4d left", "Due Nov 12 · 3d late", or none. `data-deadline` carries the mark. */
export function DeadlineText({ deadline, className }) {
  if (!deadline?.dueAt) return <span className={cn("text-xs text-muted-foreground", className)}>No client deadline</span>;
  const on = formatDateWith(deadline.dueAt, { month: "short", day: "numeric", timeZone: "Asia/Manila" });
  const left = deadline.daysLeft;
  const tail = left == null ? "" : left < 0 ? ` · ${-left}d late` : left === 0 ? " · today" : ` · ${left}d left`;
  const tone =
    deadline.mark === DEADLINE_MARK.LATE
      ? "font-semibold text-destructive"
      : deadline.mark === DEADLINE_MARK.NEAR
        ? "font-semibold text-amber-11"
        : "text-muted-foreground";
  return (
    <span data-deadline={deadline.mark} className={cn("text-xs", tone, className)}>
      Client deadline {on}
      {tail}
    </span>
  );
}

export const Age = ({ days, late }) => (
  <span className={cn("shrink-0 text-xs tabular-nums", late ? "font-semibold text-destructive" : "text-muted-foreground")}>{days}d</span>
);

/** A SOR's next move as two lines: what to do (red when late), then which record, who owes it and for how long. */
export function MoveText({ next }) {
  const move = next.move;
  if (!move) return <span className="text-xs text-muted-foreground">Nothing open</span>;
  return (
    <span className="flex min-w-0 flex-col">
      <span className={cn("truncate text-sm", move.late ? "font-semibold text-destructive" : "font-medium")} title={move.label}>
        {move.label}
      </span>
      <span className="truncate text-xs text-muted-foreground">
        {move.ref} · {move.ours ? move.ownerLabel : `waiting on ${move.ownerLabel.toLowerCase()}`} · {pluralize(move.days, "day")}
        {next.more > 0 && ` · +${next.more} more`}
      </span>
    </span>
  );
}

/** A whole line as one click target: a ghost Button stripped to a row. */
function LineButton({ className, ...props }) {
  return (
    <Button
      type="button"
      variant="ghost"
      className={cn("h-auto w-full justify-start whitespace-normal rounded-lg text-left font-normal", className)}
      {...props}
    />
  );
}

/** A project record (a Request, a Canvass, a Costing Matrix, a Transmittal) as one line. */
function RecordLine({ row, today, onOpen }) {
  return (
    <LineButton onClick={() => onOpen(row)} className="flex-wrap items-center gap-x-3 gap-y-1 px-2.5 py-1.5 text-sm">
      <span className="min-w-0 flex-1 basis-40 truncate font-medium" title={rowLabel(row)}>
        {rowLabel(row)}
      </span>
      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{pluralize(row.item_count, "item")}</span>
      <Age days={ageDays(row.since, today)} />
    </LineButton>
  );
}

/** An order as one line: IPAS number, supplier and item, its track, the next thing and who owes it. */
function OrderLine({ order, labelOf, onOpen }) {
  const move = orderMove(order, labelOf);
  return (
    <LineButton
      onClick={() => onOpen(order)}
      className={cn("flex-wrap items-center gap-x-3 gap-y-1 px-2.5 py-2 text-sm", order.late && "bg-destructive/5 hover:bg-destructive/10")}
    >
      <span className="shrink-0 font-mono text-xs font-semibold">{order.number}</span>
      <span className="min-w-0 flex-1 basis-40 truncate">
        <span className="font-medium">{order.supplier ?? "—"}</span>
        <span className="text-muted-foreground"> · {order.item?.name}</span>
      </span>
      <OrderTrack order={order} />
      {order.group !== "filed" && (
        <span className={cn("min-w-0 basis-full truncate text-xs sm:basis-auto sm:max-w-[18rem]", move.late ? "font-medium text-destructive" : "text-muted-foreground")}>
          {move.label} · {move.ours ? move.ownerLabel : `waiting on ${move.ownerLabel.toLowerCase()}`}
        </span>
      )}
      <Age days={order.group === "filed" ? (order.ageDays ?? 0) : move.days} late={move.late} />
    </LineButton>
  );
}

/**
 * One SOR's whole purchase as a stage-by-stage checklist, each record under
 * the stage it is in. Records are one-line liners, never a table inside a row.
 */
export function StageChecklist({ sor, checkIds, labelOf, today, onOpenRow, onOpenOrder }) {
  const states = stageStates(sor);
  const projectRows = sor.rows.filter((row) => row.target_kind !== "ipas");
  const ordersIn = (key) => {
    if (key === "filed") return sor.orders.filter((order) => order.group === "filed");
    if (key !== "on_order" && key !== "to_check") return [];
    return sor.openOrders.filter((order) => checkIds.has(order.id) === (key === "to_check"));
  };
  return (
    <ol className="flex flex-col">
      {TRACKER_STAGES.map((stage, index) => {
        const state = states[index];
        const rows = projectRows.filter((row) => row.grp === stage.key);
        const orders = ordersIn(stage.key);
        return (
          <li key={stage.key} className="grid grid-cols-[1.75rem_minmax(0,1fr)] gap-x-3 pb-4 last:pb-0">
            <div className="flex flex-col items-center">
              <StageCircle stage={stage} state={state} />
              {index < TRACKER_STAGES.length - 1 && <span className="mt-1 w-px flex-1 bg-border" />}
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <h3 className={cn("text-sm font-semibold", state.tone === "none" && "text-muted-foreground")}>{stage.label}</h3>
                <span className="text-xs text-muted-foreground">
                  {state.n > 0 ? `${state.n} ${stage.unit}` : state.tone === "done" ? "cleared" : "not reached"}
                </span>
              </div>
              {(rows.length > 0 || orders.length > 0) && (
                <div className="mt-1 flex flex-col">
                  {rows.map((row) => (
                    <RecordLine key={`${row.target_kind}-${row.target_id}`} row={row} today={today} onOpen={onOpenRow} />
                  ))}
                  {orders.map((order) => (
                    <OrderLine key={order.id} order={order} labelOf={labelOf} onOpen={onOpenOrder} />
                  ))}
                </div>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
