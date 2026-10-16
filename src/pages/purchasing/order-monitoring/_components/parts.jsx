/** Small pieces both Order Monitoring views draw the same way. */

import { plural } from "./format";

/** "3 days" in the wait column, with how far past its rule a late line is. */
export function WaitCell({ row }) {
  return (
    <div className="flex flex-col">
      <span className="tabular-nums">{plural(row.daysWaiting ?? 0, "day")}</span>
      {row.late && (
        <span className="text-xs font-semibold text-destructive">
          {plural(row.daysPastRule, "day")} past its {row.ruleDays}-day rule
        </span>
      )}
    </div>
  );
}

/** The one next thing, and for an Import waiting on Delivered its latest Supplier Origin date. */
export function NextThing({ row }) {
  const detail = row.next?.detail;
  return (
    <>
      <div className="font-medium">{row.next?.label}</div>
      {detail && (
        <div className="text-xs text-muted-foreground">
          Latest supplier date: {detail.label}, {detail.on}
        </div>
      )}
    </>
  );
}
