import ReportFigure from "../../../../components/ui/ReportFigure";
import { formatAmount } from "../../../../utils/ipas";

/** The four totals above the groups, as the repo's stat row. */
export default function Tiles({ counts }) {
  if (!counts) return null;
  const valueOpen =
    counts.valueOpen.length === 0
      ? "—"
      : counts.valueOpen.map((value) => (
          <span key={value.currency ?? "none"} className="block">
            {formatAmount(value.total, value.currency)}
          </span>
        ));
  return (
    <section aria-label="Totals" className="pt-4 mb-4">
      <ReportFigure
        stats={[
          { label: "Needs chasing", value: counts.needsChasing, tone: "attention" },
          { label: "Waiting on us", value: counts.waitingOnUs },
          { label: "Waiting on someone else", value: counts.waitingOnOthers },
          { label: "Value open", value: valueOpen },
        ]}
      />
    </section>
  );
}
