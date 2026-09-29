import { formatPHP, formatPHPCompact } from "../../constants/sor";
import { Tooltip } from "../ui/Tooltip";
import { cn } from "@/lib/utils";

/**
 * The register's result readout: how many SORs the current search and filters
 * left, and what they add up to.
 *
 * Every figure here is computed from the *filtered* set, which is why it only
 * renders on the tabs that read that set. It is a readout of the controls
 * beside it, not a standing page metric.
 *
 * The money is compact (₱353.7M). This is a figure you scan on your way past,
 * and at full precision the two of them ate a third of the toolbar; the exact
 * amount is one hover away, and the register's own columns carry it to the
 * centavo for anything you would act on.
 *
 * `count` is optional: the Release Notes deck shows the two money figures on
 * their own, with no register behind them to count.
 */
export default function SorsTotals({ count, openValue, wonValue, className }) {
  return (
    <div
      className={cn(
        "flex shrink-0 items-center gap-2.5 text-xs font-semibold text-muted-foreground",
        className,
      )}
    >
      {count != null && (
        <>
          <span className="tabular-nums text-foreground">
            {count.toLocaleString()}{" "}
            <span className="font-semibold text-muted-foreground">
              {count === 1 ? "SOR" : "SORs"}
            </span>
          </span>
          <Separator />
        </>
      )}
      <Figure label="Open" value={openValue} />
      <Separator />
      <Figure label="Won" value={wonValue} />
    </div>
  );
}

function Separator() {
  return (
    <span aria-hidden="true" className="text-muted-foreground/40">
      •
    </span>
  );
}

function Figure({ label, value }) {
  return (
    <Tooltip content={formatPHP(value)}>
      <span className="cursor-default whitespace-nowrap">
        {label}{" "}
        <span className="font-bold tabular-nums text-foreground">
          {formatPHPCompact(value)}
        </span>
      </span>
    </Tooltip>
  );
}
