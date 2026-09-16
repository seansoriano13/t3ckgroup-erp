import { useSorModalData } from "./useSorModalData";
import TabSkeleton from "./TabSkeleton";

/**
 * Stub for #302 — real content moves the SOR's fields, Deal Team, Expected
 * Value and commission footer here. This ticket (#298) only needs the tab to
 * exist and fetch lazily once opened.
 */
export default function DetailsTab({ opportunityId, hasOpened }) {
  const { isLoading } = useSorModalData({
    tab: "details",
    opportunityId,
    queryFn: () => Promise.resolve(null),
    hasOpened,
  });

  if (isLoading) return <TabSkeleton />;
  return (
    <div className="p-6 text-sm text-muted-foreground">
      Fields, Deal Team, Expected Value and commission are coming in #302.
    </div>
  );
}
