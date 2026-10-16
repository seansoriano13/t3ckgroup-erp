/** Small pieces both Order Monitoring views draw the same way. */

import { pluralize } from "../../../../utils/plural";
import { formatDateWith } from "../../../../utils/formatDate";

/** "3 days" in the wait column, with how far past its rule a late line is. */
export function WaitCell({ row }) {
  return (
    <div className="flex flex-col">
      <span className="tabular-nums">{pluralize(row.daysWaiting ?? 0, "day")}</span>
      {row.late && (
        <span className="text-xs font-semibold text-destructive">
          Late · {pluralize(row.daysPastRule, "day")} past its {row.ruleDays}-day rule
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
      <div className={row.late ? "font-medium text-destructive" : "font-medium"}>{row.next?.label}</div>
      {detail && (
        <div className="text-xs text-muted-foreground">
          Latest supplier date: {detail.label}, {detail.on}
        </div>
      )}
    </>
  );
}

/** The IPAS number, its PO, and when the stored Odoo copy was fetched (Order Monitoring never calls Odoo). */
export function OrderCell({ row, children }) {
  return (
    <>
      <span className="font-mono font-semibold">{row.number}</span>
      <div className="text-xs text-muted-foreground">PO {row.poNumber}</div>
      {children}
      {row.odooFetchedAt && (
        <div className="text-xs text-muted-foreground">
          Odoo copy from{" "}
          {formatDateWith(row.odooFetchedAt, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }, { time: true })}
        </div>
      )}
    </>
  );
}

/** The SOR(s) an order names, and the entity under them. */
export function SorCell({ row }) {
  return (
    <>
      {row.sors.length ? row.sors.map((sor) => sor.salesReference).join(", ") : "No SOR"}
      <div className="text-xs text-muted-foreground">{row.entity ?? "—"}</div>
    </>
  );
}
