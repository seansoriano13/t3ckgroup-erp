import TabGroup from "@/components/ui/TabGroup";

export const AWAITING_EVALUATION_FILTER = "AWAITING_EVALUATION";
export const ON_HOLD_FILTER = "ON_HOLD";

/**
 * The Group Tasks page's views: every task, those waiting for their evaluator,
 * or those on hold. A tab is a shortcut for the Status filter, so `statusFilter`
 * stays the one thing that says which view is on. `count` is how many tasks wait
 * for the signed-in person to rate them; `holdCount` how many are on hold.
 */
export default function EvaluationTabs({ statusFilter, count, holdCount = 0, onChange }) {
  const activeTab =
    statusFilter === AWAITING_EVALUATION_FILTER
      ? "evaluate"
      : statusFilter === ON_HOLD_FILTER
        ? "hold"
        : "all";
  const filterOf = { all: "ALL", evaluate: AWAITING_EVALUATION_FILTER, hold: ON_HOLD_FILTER };
  return (
    <TabGroup
      variant="underline"
      size="sm"
      tabs={[
        { value: "all", label: "All group tasks" },
        { value: "evaluate", label: "To evaluate", badge: count },
        { value: "hold", label: "On hold", badge: holdCount },
      ]}
      activeTab={activeTab}
      onChange={(tab) => onChange(filterOf[tab])}
      className="mb-4"
    />
  );
}
