import { ORDER_GROUP } from "../../../../constants/orderMonitoring";
import { formatAmount } from "../../../../utils/ipas";

/**
 * What needs doing's four totals as stat-row entries, counted from the rows
 * shown (so they follow the filters): open IPAS needing chasing, waiting on us
 * and waiting on someone else, plus the value still open per PO currency
 * (pre-tax, never converted; filed orders leave it out).
 */
export function needsDoingStats(rows) {
  const open = rows.filter((row) => row.group !== ORDER_GROUP.FILED);
  const byCurrency = new Map();
  for (const row of open) {
    const key = row.currency ?? "";
    const entry = byCurrency.get(key) ?? { currency: row.currency ?? null, total: 0 };
    entry.total += row.value ?? 0;
    byCurrency.set(key, entry);
  }
  const values = [...byCurrency.values()].sort((a, b) => String(a.currency).localeCompare(String(b.currency)));
  const valueOpen =
    values.length === 0
      ? "—"
      : values.map((value) => (
          <span key={value.currency ?? "none"} className="block">
            {formatAmount(value.total, value.currency)}
          </span>
        ));
  const count = (group) => open.filter((row) => row.group === group).length;
  return [
    { label: "Needs chasing", value: count(ORDER_GROUP.NEEDS_CHASING), tone: "attention" },
    { label: "Waiting on us", value: count(ORDER_GROUP.WAITING_ON_US) },
    { label: "Waiting on someone else", value: count(ORDER_GROUP.WAITING_ON_OTHERS) },
    { label: "Value open", value: valueOpen },
  ];
}
