import { cn } from "@/lib/utils";
import { Button } from "./button";

function Stat({ label, value, sub, onClick }) {
  const body = (
    <>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-lg font-semibold tabular-nums text-foreground">{value}</dd>
      {sub && <dd className="text-xs text-muted-foreground">{sub}</dd>}
    </>
  );
  if (!onClick) return <div className="min-w-0">{body}</div>;
  return (
    <div className="min-w-0">
      <Button
        type="button"
        variant="ghost"
        onClick={onClick}
        className="-mx-2 -my-1 h-auto w-full flex-col items-start justify-start gap-0 whitespace-normal px-2 py-1 text-left font-normal"
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
 * `{ label, value, sub, onClick }`; one with `onClick` is a button. `chart` is
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
        <Stat key={s.label} {...s} />
      ))}
    </dl>
  );

  if (!hasHeadline && !chart) return <section className={className}>{list}</section>;

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
