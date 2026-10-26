/**
 * REMOVE-BEFORE-PROD (ADR 0028): the "N of M ready" bar at the top of the
 * Product status prototype, with the buttons that jump to each section.
 */
import { Button } from "@/components/ui/button";
import Dot from "@/components/ui/Dot";

export default function ReadySummary({ summary, jumps }) {
  const shown = summary.segments.filter((s) => s.count > 0);
  return (
    <div className="space-y-3 rounded-2xl border border-border bg-card px-4 py-4" data-testid="ready-summary">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <p className="text-lg font-black tracking-tight text-foreground">
          {summary.ready} of {summary.total} ready
        </p>
        <p className="text-[13px] text-muted-foreground">Ready means Available or Received</p>
      </div>

      <div
        role="img"
        aria-label={`${summary.ready} of ${summary.total} ready. ${shown.map((s) => `${s.count} ${s.label}`).join(", ")}.`}
        className="flex h-2.5 w-full gap-0.5 overflow-hidden rounded-full bg-muted"
      >
        {shown.map((s) => (
          <span key={s.key} className={s.bar} style={{ flexGrow: s.count, flexBasis: 0 }} />
        ))}
      </div>

      <ul className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
        {summary.segments.map(
          (s) =>
            (s.count > 0 || s.key !== "cannot") && (
              <li key={s.key} className="flex items-center gap-1.5">
                <Dot size="size-2" color={s.bar} aria-hidden="true" />
                <span className="font-semibold tabular-nums text-foreground">{s.count}</span>
                {s.label}
              </li>
            ),
        )}
      </ul>

      <p className="text-[13px] text-foreground">{summary.sentence}</p>

      <div className="flex flex-wrap gap-2" role="group" aria-label="Jump to a section">
        {jumps.map((jump) => (
          <Button key={jump.key} type="button" variant="outline" size="sm" onClick={jump.onClick}>
            {jump.label} · {jump.count}
          </Button>
        ))}
      </div>
    </div>
  );
}
