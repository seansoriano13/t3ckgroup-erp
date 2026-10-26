/**
 * REMOVE-BEFORE-PROD (ADR 0028): turns one example line into a LinerList row
 * for the Product status prototype. The row's `actions` slot carries the
 * columns (Qty, Stock or For, Status, P0, Delivery and notes), so the list is
 * the real LinerList and still opens in place for the line's details.
 */
import Dot from "@/components/ui/Dot";
import { cn } from "@/lib/utils";
import { AskedSub, AskedText, Details, Notes } from "./LineParts";
import { StatusCell } from "./LineStatus";
import { COLUMNS, stockText } from "./lineState";

const STOCK_DOT = { enough: "bg-green-9", some: "bg-amber-9", "none-left": "bg-red-9", none: "bg-mauve-7" };

/** `kind` is "sor" (lines from the S0) or "other" (asked in words). */
export function buildRow({ line, role, onChoose, onAction, onYours }) {
  const asked = line.section === "other";
  const stock = stockText(line);
  return {
    key: line.id,
    testId: "product-line",
    label: line.name,
    main: asked ? <AskedText line={line} /> : line.name,
    sub: asked ? <AskedSub line={line} /> : line.code ? <span className="font-mono">[{line.code}]</span> : null,
    subWrap: asked,
    actions: (
      <div className={cn("grid items-center gap-3", COLUMNS)}>
        <span className="text-right font-mono text-xs text-foreground">×{line.qty}</span>
        {asked ? (
          <span className="text-xs text-muted-foreground">{line.forWhat}</span>
        ) : (
          <span className="flex items-center gap-1.5 text-xs text-foreground">
            <Dot color={STOCK_DOT[stock.tone]} aria-hidden="true" />
            {stock.text}
          </span>
        )}
        <span className="flex">
          <StatusCell line={line} role={role} onChoose={onChoose} />
        </span>
        <span className="font-mono text-xs text-foreground">{line.p0?.number ?? <span className="text-muted-foreground">—</span>}</span>
        <Notes line={line} onYours={onYours} />
      </div>
    ),
    children: <Details line={line} role={role} onAction={onAction} />,
  };
}
