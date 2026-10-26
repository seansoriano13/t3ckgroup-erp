import { useId, useState } from "react";
import { ChevronRight } from "lucide-react";

import StatusBadge from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import Reveal from "./Reveal";

function LinerRow({ row }) {
  const [open, setOpen] = useState(Boolean(row.defaultOpen));
  const panelId = useId();
  const expandable = row.children != null;
  const text = (
    <>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-semibold text-foreground" title={typeof row.main === "string" ? row.main : undefined}>
          {row.main}
        </span>
        {row.sub && <span className={cn("block text-xs text-muted-foreground", !row.subWrap && "truncate")}>{row.sub}</span>}
      </span>
      {row.quantity != null && <span className="shrink-0 font-mono text-xs text-foreground">{row.quantity}</span>}
    </>
  );
  const status = row.actions ?? (row.badge && <StatusBadge label={row.badge.label} theme={row.badge.theme} status={row.badge.status} />);
  const chevron = (
    <ChevronRight
      size={16}
      aria-hidden="true"
      className={cn("shrink-0 text-muted-foreground transition-transform duration-200 ease-out-expo", open && "rotate-90")}
    />
  );
  const head = (
    <>
      {text}
      {status}
      {expandable && chevron}
    </>
  );
  // A row that carries its own controls (`actions`, a menu) cannot sit inside the toggle button, so the toggle takes only the text.
  const withActions = expandable && row.actions != null;
  return (
    <li id={row.domId} data-testid={row.testId}>
      {withActions ? (
        <div className="flex items-center gap-3 pr-4 hover:bg-muted/50">
          <Button
            type="button"
            variant="ghost"
            aria-expanded={open}
            aria-controls={panelId}
            aria-label={`${open ? "Close" : "Open"} details of ${row.label ?? row.main}`}
            onClick={() => setOpen((prev) => !prev)}
            className="h-auto min-w-0 flex-1 justify-start gap-3 rounded-none px-4 py-2.5 text-left font-normal whitespace-normal hover:bg-transparent"
          >
            {text}
          </Button>
          {status}
          {chevron}
        </div>
      ) : expandable ? (
        <Button
          type="button"
          variant="ghost"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen((prev) => !prev)}
          className="h-auto w-full min-w-0 justify-start gap-3 rounded-none px-4 py-2.5 text-left font-normal whitespace-normal hover:bg-muted/50"
        >
          {head}
        </Button>
      ) : (
        <div className="flex items-center gap-3 px-4 py-2.5">{head}</div>
      )}
      {expandable && (
        <Reveal open={open} id={panelId} className="border-t border-border px-4 py-4">
          {row.children}
        </Reveal>
      )}
    </li>
  );
}

/**
 * A record's children as one bordered box of one-line rows split by hairlines:
 * main text, a sub line, a mono quantity, an optional badge and a chevron. A
 * row with `children` opens in place (the `.reveal` pattern: its content stays
 * mounted) and several can be open at once.
 *
 * `rows`: `[{ key, main, sub?, quantity?, badge?: { label, theme? }, actions?, label?, testId?, domId?, children?, defaultOpen?, subWrap? }]`.
 * `domId` sets the row's element id, so a caller can scroll to it.
 * `subWrap` lets a long sub line wrap instead of cutting it short.
 * `actions` is a node (a status menu) shown in place of the badge; the row's toggle then holds only its text.
 * `groups` (instead of `rows`): `[{ key, title?, count?, rows }]`, each group's title a
 * sub-heading inside the box. `empty` is the one quiet sentence shown, with no
 * box, when there are no rows. `total` (`{ label, value }`) adds a closing
 * row under the rows, for a figure that sums them up.
 */
export default function LinerList({ rows, groups, empty = "Nothing here yet.", label, total, className }) {
  const all = groups ?? [{ key: "all", rows: rows ?? [] }];
  const filled = all.filter((group) => group.rows.length > 0);
  if (filled.length === 0) return <p className="text-[13px] text-muted-foreground">{empty}</p>;
  return (
    <div role="group" aria-label={label} className={cn("divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card", className)}>
      {filled.map((group) => (
        <section key={group.key} aria-label={group.title} data-testid={group.testId}>
          {group.title && (
            <h4 className="flex items-baseline gap-2 border-b border-border bg-muted/40 px-4 py-1.5 text-xs font-semibold text-muted-foreground">
              {group.title}
              {group.count != null && <span className="font-medium tabular-nums">{group.count}</span>}
            </h4>
          )}
          <ul className="divide-y divide-border">
            {group.rows.map((row) => (
              <LinerRow key={row.key} row={row} />
            ))}
          </ul>
        </section>
      ))}
      {total && (
        <div
          data-testid={total.testId}
          className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 bg-muted/20 px-4 py-2 text-xs"
        >
          <span className="text-muted-foreground">{total.label}</span>
          <span className="font-mono font-semibold tabular-nums text-foreground">{total.value}</span>
        </div>
      )}
    </div>
  );
}
