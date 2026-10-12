import ReportFigure from "../ui/ReportFigure";
import MonthlyIncomeChart from "./MonthlyIncomeChart";
import { formatPHP } from "../../constants/sor";
import { formatCount } from "../../utils/retailFormat";

function monthOverMonthSubtitle({ lastMonth, deltaPct }) {
  if (deltaPct === null) return lastMonth === 0 ? "Nothing to compare with last month" : "vs same period last month";
  const arrow = deltaPct >= 0 ? "▲" : "▼";
  return `${arrow} ${Math.abs(deltaPct).toFixed(0)}% vs same period last month (${formatPHP(lastMonth)})`;
}

const plural = (count) => (count === 1 ? "" : "s");

/**
 * The report's top block: Order Income, the Missing/Suspect lines and the
 * headline stats, with the monthly chart beside them. `summary` is the result
 * of `summarize`, `mom` of `monthOverMonth`, `series` of `monthlySeries`;
 * `scope` and `empty` are the words from `retailReportCopy`.
 */
export default function RetailHeadline({ summary, mom, series, scope, empty, searching = false }) {
  return (
    <ReportFigure
      label="Order Income"
      figure={formatPHP(summary.total)}
      note={
        <>
          <span>{scope} · OK orders only</span>
          {searching && (
            <>
              <br />
              <span>Search ignores date range</span>
            </>
          )}
          <br />
          <span>
            Missing income: {formatCount(summary.missingCount)} order{plural(summary.missingCount)} ·{" "}
            {formatPHP(summary.missingAmount)} Order Amount
          </span>
          {summary.suspectCount > 0 && (
            <>
              <br />
              <span>
                Suspect income: {formatCount(summary.suspectCount)} order{plural(summary.suspectCount)} ·{" "}
                {formatPHP(summary.suspectAmount)} Order Amount
              </span>
            </>
          )}
        </>
      }
      stats={[
        { label: "Orders", value: formatCount(summary.count), sub: scope },
        { label: "Average order income", value: formatPHP(summary.average), sub: "Order Income ÷ OK orders" },
        { label: "This month", value: formatPHP(mom.thisMonth), sub: monthOverMonthSubtitle(mom) },
      ]}
      chart={<MonthlyIncomeChart series={series} empty={empty} />}
    />
  );
}
