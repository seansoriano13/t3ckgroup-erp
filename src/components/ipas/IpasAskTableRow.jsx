// An open ask as a grey row at the top of a read-only money table (#1225 Payments, #1227 Charges): not paid yet,
// so it adds to no total. What it is for (and the % when it has one) sits where a payment's or charge's kind is,
// the priority next to it, the asked amount (muted, in the ask's own currency) in Amount, and the note across
// the rest. People who may write get Record as paid, Edit and Withdraw in the last cell, the same three the
// record's edit form offers (AskLiners).

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
 * `noteSpan` is how many columns the note runs across (the Payments table has more money columns than Charges);
 * `testId` names the row for the tests; `noteFallback` is what the note says when the ask has none. Write rights
 * show the three buttons: `onRecord(ask)`, `onEdit(ask)`, `onWithdraw(ask)`.
 */
export default function IpasAskTableRow({ ask, currency, canAct = false, noteSpan = 1, testId, noteFallback, onRecord, onEdit, onWithdraw }) {
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
        <StatusBadge theme="mauve" label="Not paid yet" />
      </TableCell>
      <TableCell className={cn(td, "text-muted-foreground")}>{ask.priority ? `${askPriorityLabel(ask.priority)} priority` : "—"}</TableCell>
      <TableCell className={cn(td, num, "italic text-muted-foreground")}>{formatAmount(Number(ask.amount), askCurrency(ask, currency))}</TableCell>
      <TableCell colSpan={noteSpan} className={cn(td, "text-xs text-muted-foreground")}>
        {note}
      </TableCell>
      {canAct && (
        <TableCell className={td}>
          <span className="flex flex-col items-start gap-1" data-testid="ipas-ask-row-actions">
            <Button type="button" size="xs" variant="outline" className="gap-1" onClick={() => onRecord?.(ask)}>
              <WalletCards size={12} aria-hidden="true" />
              Record as paid
            </Button>
            <span className="flex gap-1">
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
          </span>
        </TableCell>
      )}
    </TableRow>
  );
}
