// An open ask as a grey row at the top of a read-only money table (#1225 Payments, #1227 Charges): not paid yet,
// so it adds to no total. The first cell says what it is for (and the % when it has one), "Not paid yet" and its
// priority; the second (Method or Date) has nothing for an ask; the asked amount (muted, in the ask's own currency)
// sits in Amount. The rest of the row is one wide cell: Record as paid, Edit and Withdraw first, so they are in view
// even when the table scrolls sideways (#1236), then the note. The same three the record's edit form offers (AskLiners).

import { Pencil, Undo2, WalletCards } from "lucide-react";

import { Button } from "../ui/button";
import StatusBadge from "../StatusBadge";
import { TableCell, TableRow } from "../ui/table";
import { cn } from "@/lib/utils";
import { formatAmount } from "../../utils/ipas";
import { askCurrency, askPriorityLabel, askWhat } from "../../utils/ipasPaymentAsk";
import { formatPercent } from "../../utils/ipasPaymentPercent";

const td = "border-b border-r border-mauve-5 px-3 py-2.5 align-top text-[13px] leading-snug last:border-r-0";
const num = "text-right tabular-nums whitespace-nowrap";

/**
 * `noteSpan` is how many columns after Amount the note runs across, not counting the actions column (the Payments
 * table has more money columns than Charges); `actionsColumn` says the table has that last column, which the note
 * cell then also takes. `testId` names the row for the tests; `noteFallback` is what the note says when the ask has
 * none. Write rights (`canAct`) show the three buttons: `onRecord(ask)`, `onEdit(ask)`, `onWithdraw(ask)`.
 */
export default function IpasAskTableRow({
  ask,
  currency,
  canAct = false,
  actionsColumn = canAct,
  noteSpan = 1,
  testId,
  noteFallback,
  onRecord,
  onEdit,
  onWithdraw,
}) {
  const percent = formatPercent(ask.percent_of_order);
  const what = askWhat(ask);
  const note = typeof ask.note === "string" && ask.note.trim() ? ask.note.trim() : noteFallback;
  return (
    <TableRow data-testid={testId} className="hover:bg-transparent [&>td]:bg-mauve-2">
      <TableCell className={td}>
        <div className="font-semibold text-foreground/80">
          {what}
          {percent ? ` · ${percent}%` : ""}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
          <StatusBadge theme="mauve" label="Not paid yet" />
          {ask.priority && <span className="text-xs text-muted-foreground">{askPriorityLabel(ask.priority)} priority</span>}
        </div>
      </TableCell>
      <TableCell className={cn(td, "text-muted-foreground")}>—</TableCell>
      <TableCell className={cn(td, num, "italic text-muted-foreground")}>{formatAmount(Number(ask.amount), askCurrency(ask, currency))}</TableCell>
      <TableCell colSpan={noteSpan + (actionsColumn ? 1 : 0)} className={td}>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          {canAct && (
            <span className="flex shrink-0 flex-wrap items-center gap-1" data-testid="ipas-ask-row-actions">
              <Button type="button" size="xs" variant="outline" className="gap-1" onClick={() => onRecord?.(ask)}>
                <WalletCards size={12} aria-hidden="true" />
                Record as paid
              </Button>
              <Button type="button" size="xs" variant="ghost" className="gap-1" aria-label={`Edit ${what}`} onClick={() => onEdit?.(ask)}>
                <Pencil size={12} aria-hidden="true" />
                Edit
              </Button>
              <Button
                type="button"
                size="xs"
                variant="ghost"
                className="gap-1 text-muted-foreground hover:text-red-11"
                aria-label={`Withdraw ${what}`}
                onClick={() => onWithdraw?.(ask)}
              >
                <Undo2 size={12} aria-hidden="true" />
                Withdraw
              </Button>
            </span>
          )}
          {note && <span className="min-w-0 flex-1 basis-48 text-xs text-muted-foreground">{note}</span>}
        </div>
      </TableCell>
    </TableRow>
  );
}
