import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip as RechartsTooltip,
  CartesianGrid,
  Legend,
} from "recharts";
import { ShoppingBag } from "lucide-react";
import EmptyState from "../ui/EmptyState";
import { formatPHP } from "../../constants/sor";

// Neutral, solid shades (not opacity, which the legend swatch would not show),
// so the report matches the commission dashboard and each storefront is
// told apart in the legend.
const SERIES_FILLS = [
  "var(--color-foreground, #222)",
  "var(--color-muted-foreground, #888)",
  "var(--color-border, #bbb)",
  "var(--color-muted, #ddd)",
];

/** "₱120K" / "₱1.2M" for a y-axis tick; full pesos would be wider than the axis. */
function formatAxisPeso(value) {
  const n = Number(value) || 0;
  if (n >= 1e6) return `₱${+(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `₱${+(n / 1e3).toFixed(0)}K`;
  return `₱${n}`;
}

/**
 * The stacked monthly Order Income chart, one bar segment per Marketplace.
 * `series` is the result of `monthlySeries`; `empty` is the result of
 * `emptyCopy`, shown when there is nothing to plot.
 */
export default function MonthlyIncomeChart({ series, empty }) {
  return (
    <div>
      <h3 className="text-sm font-semibold text-foreground">Monthly Order Income</h3>
      <p className="mb-4 mt-0.5 text-sm text-muted-foreground">By Marketplace, for the selected range.</p>
      {series.rows.length === 0 ? (
        <EmptyState
          icon={ShoppingBag}
          title={empty.title}
          description={empty.description}
          className="min-h-[180px] py-8"
        />
      ) : (
        <div className="h-[260px] w-full">
          <ResponsiveContainer
            width="100%"
            height="100%"
            minWidth={100}
            minHeight={200}
            initialDimension={{ width: 600, height: 260 }}
          >
            <BarChart data={series.rows} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} opacity={0.15} />
              <XAxis
                dataKey="label"
                tickLine={false}
                axisLine={false}
                tick={{ fontSize: 11, fill: "var(--color-muted-foreground, #888)" }}
              />
              <YAxis
                tickLine={false}
                axisLine={false}
                tickFormatter={formatAxisPeso}
                width={56}
                tick={{ fontSize: 10, fill: "var(--color-muted-foreground, #888)" }}
              />
              <RechartsTooltip
                formatter={(value) => formatPHP(value)}
                cursor={{ fill: "var(--color-muted, #eee)", opacity: 0.4 }}
                contentStyle={{
                  borderRadius: 12,
                  border: "1px solid var(--color-border, #ddd)",
                  background: "var(--color-card, #fff)",
                  fontSize: 12,
                }}
              />
              <Legend iconType="circle" wrapperStyle={{ fontSize: 11 }} />
              {series.marketplaces.map((marketplace, index) => (
                <Bar
                  key={marketplace}
                  dataKey={marketplace}
                  stackId="sales"
                  maxBarSize={44}
                  fill={SERIES_FILLS[index % SERIES_FILLS.length]}
                />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
