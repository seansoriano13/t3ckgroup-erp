import { useSorModalData } from "./useSorModalData";
import TabSkeleton from "./TabSkeleton";

/**
 * Stub for #300 — real content is `opportunityService.getJourney` +
 * `journeyRows` rendering every Stage Visit latest-first. This ticket (#298)
 * only needs the tab to exist and fetch lazily once opened.
 */
export default function JourneyTab({ opportunityId, hasOpened }) {
  const { isLoading } = useSorModalData({
    tab: "journey",
    opportunityId,
    queryFn: () => Promise.resolve(null),
    hasOpened,
  });

  if (isLoading) return <TabSkeleton />;
  return (
    <div className="p-6 text-sm text-muted-foreground">
      The Journey — every Stage Visit, latest first — is coming in #300.
    </div>
  );
}
