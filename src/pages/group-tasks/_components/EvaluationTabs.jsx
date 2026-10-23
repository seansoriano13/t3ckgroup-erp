import TabGroup from "@/components/ui/TabGroup";

export const AWAITING_EVALUATION_FILTER = "AWAITING_EVALUATION";

/**
 * The Group Tasks page's two views: every task, or only those waiting for their
 * evaluator. The tab is a shortcut for the Status filter, so `statusFilter` stays
 * the one thing that says which view is on. `count` is how many tasks wait for
 * the signed-in person to rate them.
 */
export default function EvaluationTabs({ statusFilter, count, onChange }) {
  return (
    <TabGroup
      variant="underline"
      size="sm"
      tabs={[
        { value: "all", label: "All group tasks" },
        { value: "evaluate", label: "To evaluate", badge: count },
      ]}
      activeTab={statusFilter === AWAITING_EVALUATION_FILTER ? "evaluate" : "all"}
      onChange={(tab) => onChange(tab === "evaluate" ? AWAITING_EVALUATION_FILTER : "ALL")}
      className="mb-4"
    />
  );
}
