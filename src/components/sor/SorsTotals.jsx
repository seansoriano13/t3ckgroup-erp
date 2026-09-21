import { formatPHP } from "../../constants/sor";

/** The Open pipeline and Won figures at the top of the SORS register. */
export default function SorsTotals({ openValue, wonValue }) {
  return (
    <div className="flex shrink-0 items-center gap-3 text-xs font-semibold text-muted-foreground">
      <span>
        Open pipeline <span className="font-bold text-foreground">{formatPHP(openValue)}</span>
      </span>
      <span className="text-muted-foreground/40">•</span>
      <span>
        Won <span className="font-bold text-foreground">{formatPHP(wonValue)}</span>
      </span>
    </div>
  );
}
