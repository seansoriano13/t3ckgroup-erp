import FilterBar from "../../../../components/ui/FilterBar";
import ReportFigure from "../../../../components/ui/ReportFigure";

/**
 * The top of every Purchasing Dashboard tab (#574), the same on all three: the
 * filter bar (search, up to three inline choices, the Filters popover with its
 * count badge) over the shared stat row.
 *
 * - `bar`        FilterBar props (`search`, `chips`, `filters`, `activeCount`,
 *                `hasActiveFilters`, `onClearAll`).
 * - `stats`      ReportFigure stats; none draws no row.
 * - `statsLabel` the stat row's accessible name.
 */
export default function TabHeader({ bar, stats, statsLabel }) {
  return (
    <div className="flex flex-col gap-4">
      <FilterBar {...bar} />
      {stats && (
        <div role="group" aria-label={statsLabel}>
          <ReportFigure stats={stats} />
        </div>
      )}
    </div>
  );
}
