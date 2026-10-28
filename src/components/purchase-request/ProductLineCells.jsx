import { useQuery } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";

import Dot from "@/components/ui/Dot";
import { cn } from "@/lib/utils";
import { canvassService } from "../../services/canvassService";
import { canvassLine } from "../../utils/itemCanvass";
import { askedByText, lineNotes, p0Cell, purposeLabel, splitProductName, stockCell } from "../../utils/productLine";
import { formatAmount } from "../../utils/requestedItem";

/** Column widths, shared by the header row and every line so they line up. */
export const COLUMNS = "grid-cols-[3.5rem_8rem_10.5rem_4.75rem_14rem]";

const STOCK_DOT = { enough: "bg-green-9", some: "bg-amber-9", "none-left": "bg-red-9", none: "bg-mauve-7" };

/** The header row of one list: the first column and the third differ between the two sections. */
export function ColumnHeads({ first, third }) {
  const head = "text-label font-bold uppercase tracking-wider text-muted-foreground";
  return (
    <div className="flex gap-3 border-b border-border bg-muted/40 py-1.5 pr-4" aria-hidden="true">
      <span className={cn(head, "min-w-0 flex-1 px-4")}>{first}</span>
      <div className={cn("grid gap-3", COLUMNS)}>
        <span className={cn(head, "text-right")}>Qty</span>
        <span className={head}>{third}</span>
        <span className={head}>Status</span>
        <span className={head}>P0</span>
        <span className={head}>Delivery and notes</span>
      </div>
      <span className="w-4 shrink-0" />
    </div>
  );
}

/** "×2" in mono, right-aligned. */
export const QtyCell = ({ item }) => (
  <span className="text-right font-mono text-xs text-foreground">×{formatAmount(item.quantity, item.unit)}</span>
);

/** The Stock column of a line from the S0: a colour dot and the figure in words. */
export function StockCell({ stock }) {
  const { text, tone } = stockCell(stock);
  return (
    <span className="flex items-center gap-1.5 text-xs text-foreground">
      <Dot color={STOCK_DOT[tone]} aria-hidden="true" />
      {text}
    </span>
  );
}

/** The "For" column of an Other request. */
export const ForCell = ({ item }) => <span className="text-xs text-muted-foreground">{purposeLabel(item) ?? "—"}</span>;

export const P0Cell = ({ item }) => (
  <span className="font-mono text-xs text-foreground">{p0Cell(item) ?? <span className="text-muted-foreground">—</span>}</span>
);

/** The code under a line's name, in mono: Odoo's "[M18C]" prefix, or nothing. */
export function ProductCode({ item }) {
  const { code } = splitProductName(item.name);
  return code ? <span className="font-mono">[{code}]</span> : null;
}

export function AskedSub({ item, side }) {
  return (
    <>
      {item.po_number && item.bought_as && (
        <span className="block" data-testid="requested-item-bought-as">
          Bought as: {item.bought_as}
        </span>
      )}
      {item.ordered_early_reason && (
        <span className="block" data-testid="requested-item-ordered-early">
          Ordered early: {item.ordered_early_reason}
        </span>
      )}
      <span className="block">{askedByText(item, side)}</span>
    </>
  );
}

/** "Canvass CNV_0009 · 2 of 3 offers", read from the Canvass the line already has. */
function CanvassNote({ item }) {
  const { data: canvass = null } = useQuery({
    queryKey: ["canvass", "requestedItem", item.id],
    queryFn: () => canvassService.getForRequestedItem(item.id),
    enabled: !!item.canvass,
  });
  const summary = canvassLine(canvass);
  return summary ? <span className="min-w-0 break-words">{summary}</span> : null;
}

/** The Delivery and notes column: what to know about the line, then the "Is this yours?" pill when it applies. */
export function NotesCell({ item, replacedBy, yours }) {
  const notes = lineNotes(item, { replacedBy });
  const quiet = notes.length === 0 && !item.canvass && !yours;
  return (
    <div className="flex min-w-0 flex-col items-start gap-1 text-xs text-muted-foreground">
      {yours}
      {yours && <span className="text-amber-12">New on the S0 today</span>}
      {item.canvass && <CanvassNote item={item} />}
      {notes.map((note) => (
        <span key={note.text} className={cn("flex items-start gap-1", note.warn && "font-medium text-amber-12")}>
          {note.warn && <AlertTriangle size={12} aria-hidden="true" className="mt-0.5 shrink-0" />}
          <span className="min-w-0 break-words">{note.text}</span>
        </span>
      ))}
      {quiet && <span aria-hidden="true">—</span>}
    </div>
  );
}
