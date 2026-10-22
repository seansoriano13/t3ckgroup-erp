import { cn } from "@/lib/utils";

const isEmpty = (value) => value === null || value === undefined || value === "";

/**
 * A record's fields in an auto-fill grid: an 11px uppercase label above each
 * value. `items` is `[{ label, value, mono? }]`; a missing value reads as a dash
 * unless `hideEmpty` leaves the field out. `min` is the narrowest a column gets.
 */
export default function DetailGrid({ items, hideEmpty = false, min = "11rem", className }) {
  const shown = hideEmpty ? items.filter((item) => !isEmpty(item.value)) : items;
  if (shown.length === 0) return null;
  return (
    <dl className={cn("grid gap-x-6 gap-y-3", className)} style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${min}, 1fr))` }}>
      {shown.map((item) => (
        <div key={item.label} className="min-w-0 space-y-0.5">
          <dt className="text-label font-bold uppercase tracking-wider text-muted-foreground">{item.label}</dt>
          <dd className={cn("min-w-0 break-words text-[13px] font-medium text-foreground", item.mono && "font-mono")}>
            {isEmpty(item.value) ? "—" : item.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}
