import { useSorModalData } from "./useSorModalData";
import TabSkeleton from "./TabSkeleton";

/**
 * Stub for #301 — real content moves the Product List (sticky header,
 * search, stock badges) into its own tab. This ticket (#298) only needs the
 * tab to exist and fetch lazily once opened.
 */
export default function ItemsTab({ opportunityId, hasOpened }) {
  const { isLoading } = useSorModalData({
    tab: "items",
    opportunityId,
    queryFn: () => Promise.resolve(null),
    hasOpened,
  });

  if (isLoading) return <TabSkeleton />;
  return (
    <div className="p-6 text-sm text-muted-foreground">
      The Product List, with search and a sticky header, is coming in #301.
    </div>
  );
}
