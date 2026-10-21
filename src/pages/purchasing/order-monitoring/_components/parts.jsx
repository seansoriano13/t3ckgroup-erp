/** Small pieces both Order Monitoring views draw the same way. */

import { pluralize } from "../../../../utils/plural";
import { useAuth } from "../../../../context/AuthContext";
import { getPermissionContext, transmittalListsOf } from "../../../../utils/permissions";
import { standingLabel } from "../../../../utils/orderStanding";
import { formatDateWith } from "../../../../utils/formatDate";
import { DEADLINE_MARK } from "../../../../utils/deliveryDeadline";

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
  const { user } = useAuth();
  const detail = row.next?.detail;
  const label = standingLabel(row.next, transmittalListsOf(getPermissionContext(user)));
  return (
    <>
      <div className={row.late ? "font-medium text-destructive" : "font-medium"}>{label}</div>
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

const DEADLINE_TONES = {
  [DEADLINE_MARK.OK]: "text-muted-foreground",
  [DEADLINE_MARK.NONE]: "text-muted-foreground",
  [DEADLINE_MARK.NEAR]: "font-semibold text-amber-11",
  [DEADLINE_MARK.LATE]: "font-semibold text-destructive",
};

/** "Client deadline Nov 12, 2026 · near" for an SOR with a delivery deadline (#467); nothing without one. */
export function DeadlineLine({ deadline, className = "text-xs" }) {
  if (!deadline?.dueAt) return null;
  const on = formatDateWith(deadline.dueAt, { month: "short", day: "numeric", year: "numeric", timeZone: "Asia/Manila" });
  const note = deadline.mark === DEADLINE_MARK.NEAR ? " · near" : deadline.mark === DEADLINE_MARK.LATE ? " · late" : "";
  return (
    <div className={`${className} ${DEADLINE_TONES[deadline.mark]}`} data-deadline={deadline.mark}>
      Client deadline {on}
      {note}
    </div>
  );
}

/** The SOR(s) an order names, the entity under them, and the client's delivery deadline when the SOR has one. */
export function SorCell({ row }) {
  return (
    <>
      {row.sors.length ? row.sors.map((sor) => sor.salesReference).join(", ") : "No SOR"}
      <div className="text-xs text-muted-foreground">{row.entity ?? "—"}</div>
      <DeadlineLine deadline={row.deadline} />
    </>
  );
}
