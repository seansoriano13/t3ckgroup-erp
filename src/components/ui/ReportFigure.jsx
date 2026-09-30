import { ArrowUpRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "./button";

function Stat({ label, value, sub, tone, onClick, large, divided }) {
  const isZero = value === 0 || value === "0";
  const valueTone = isZero ? "text-muted-foreground" : tone === "attention" ? "text-amber-11" : "text-foreground";
  const body = (
    <>
      <dt className="text-xs text-muted-foreground underline-offset-4 group-hover/stat:text-foreground group-hover/stat:underline group-focus-visible/stat:underline">
        {label}
        {onClick && (
          <ArrowUpRight
            aria-hidden
            data-testid="stat-arrow"
            className="ml-1 inline size-3 align-[-1px] opacity-40 transition-opacity group-hover/stat:opacity-100 group-focus-visible/stat:opacity-100"
          />
        )}
      </dt>
      <dd className={cn("mt-0.5 font-semibold tabular-nums", large ? "text-2xl tracking-tight" : "text-lg", valueTone)}>
        {value}
      </dd>
      {sub && <dd className="text-xs text-muted-foreground">{sub}</dd>}
    </>
  );
  const wrap = cn("min-w-0", divided && "lg:border-l lg:border-border lg:pl-5 lg:first:border-l-0 lg:first:pl-0");
  if (!onClick) return <div className={wrap}>{body}</div>;
  return (
    <div className={wrap}>
      <Button
        type="button"
        variant="ghost"
        onClick={onClick}
        className="group/stat h-auto w-full flex-col items-start justify-start gap-0 whitespace-normal rounded-sm p-0 text-left font-normal hover:bg-transparent"
      >
        {body}
      </Button>
    </div>
  );
}

/**
 * The Report layout's headline figure (DESIGN.md "Pages → Report layout"): one
 * big figure with its note, the supporting stats beside the chart. Every part
 * is optional, so a row of counts is `stats` alone. `stats` items are
 * `{ label, value, sub, tone, onClick }`; one with `onClick` is a button (with
 * an arrow), a zero dims, and `tone: "attention"` turns a non-zero value amber.
 * A row of counts gets larger numerals and hairline dividers. `chart` is
 * whatever the Report draws beside the figure.
 *
 * It is the only figure form on a Report. No gradient card, no icon tile.
 */
export default function ReportFigure({ label, figure, note, stats = [], chart, className }) {
  const hasHeadline = figure != null;
  const list = stats.length > 0 && (
    <dl
      className={cn(
        "grid gap-x-6 gap-y-4",
        hasHeadline ? "grid-cols-2" : "grid-cols-2 sm:grid-cols-3 lg:grid-cols-[repeat(auto-fit,minmax(9rem,1fr))]",
      )}
    >
      {stats.map((s) => (
        <Stat key={s.label} large={!hasHeadline} divided={!hasHeadline} {...s} />
      ))}
    </dl>
  );

  if (!hasHeadline && !chart) {
    // A row of counts closes on a hairline; the Page header's rule above it opens the row.
    return <section className={cn("border-b border-border pb-4", className)}>{list}</section>;
  }

  return (
    <section className={cn("grid gap-8", chart && "lg:grid-cols-[minmax(0,280px)_minmax(0,1fr)]", className)}>
      <div className="flex min-w-0 flex-col gap-6">
        {hasHeadline && (
          <div>
            {label && <p className="text-sm font-medium text-muted-foreground">{label}</p>}
            <p className="mt-1 text-3xl font-semibold tabular-nums tracking-tight text-foreground">{figure}</p>
            {note && <p className="mt-1 text-xs text-muted-foreground">{note}</p>}
          </div>
        )}
        {list}
      </div>
      {chart && <div className="min-w-0">{chart}</div>}
    </section>
  );
}
