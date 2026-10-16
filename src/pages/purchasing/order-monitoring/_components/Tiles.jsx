import { Card, CardContent } from "../../../../components/ui/card";
import { formatAmount } from "../../../../utils/ipas";

export function Tile({ label, children }) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-1 p-4">
        <span className="text-label font-bold uppercase tracking-wider text-muted-foreground">{label}</span>
        {children}
      </CardContent>
    </Card>
  );
}

/** The four totals above the groups. */
export default function Tiles({ counts }) {
  if (!counts) return null;
  return (
    <section aria-label="Totals" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Tile label="Needs chasing">
        <span className="text-2xl font-bold tabular-nums">{counts.needsChasing}</span>
      </Tile>
      <Tile label="Waiting on us">
        <span className="text-2xl font-bold tabular-nums">{counts.waitingOnUs}</span>
      </Tile>
      <Tile label="Waiting on someone else">
        <span className="text-2xl font-bold tabular-nums">{counts.waitingOnOthers}</span>
      </Tile>
      <Tile label="Value open">
        {counts.valueOpen.length === 0 ? (
          <span className="text-2xl font-bold tabular-nums">—</span>
        ) : (
          counts.valueOpen.map((value) => (
            <span key={value.currency ?? "none"} className="text-base font-semibold tabular-nums">
              {formatAmount(value.total, value.currency)}
            </span>
          ))
        )}
      </Tile>
    </section>
  );
}
