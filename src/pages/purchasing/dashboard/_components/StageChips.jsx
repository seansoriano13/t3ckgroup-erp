import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

/**
 * The stage totals as one line of compact chips (label · number · "n SORs"),
 * for the laptop band and phones where ReportFigure's tall tiles push the table
 * down. The chips take the same `stats` as ReportFigure; a chip with `onClick`
 * is a button. `end` (the Value open line) sits at the end of the line. On a
 * phone the line scrolls sideways instead of wrapping.
 */
export default function StageChips({ stats, end }) {
  return (
    <ul className="flex items-center gap-2 overflow-x-auto pb-1 laptop:overflow-visible laptop:pb-0" aria-label="Stage totals">
      {stats.map((stat) => {
        const zero = stat.value === 0;
        const body = (
          <>
            <span className="text-muted-foreground">{stat.label}</span>
            <span
              className={cn(
                "font-semibold tabular-nums",
                zero ? "text-muted-foreground" : stat.tone === "attention" ? "text-amber-11" : "text-foreground",
              )}
            >
              {stat.value}
            </span>
            {stat.sub ? <span className="text-muted-foreground">{stat.sub}</span> : null}
          </>
        );
        return (
          <li key={stat.label} className="shrink-0">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={stat.onClick}
              className="h-8 gap-1.5 whitespace-nowrap px-2.5 text-xs font-normal"
            >
              {body}
            </Button>
          </li>
        );
      })}
      {end ? <li className="ml-auto shrink-0 pl-2">{end}</li> : null}
    </ul>
  );
}
