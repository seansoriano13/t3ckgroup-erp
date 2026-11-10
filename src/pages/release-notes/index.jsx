import { useSearchParams } from "react-router";
import ProtectedRoute from "../../components/ProtectedRoute.jsx";
import PageShell from "../../components/ui/PageShell";
import DesktopNotice from "@/components/ui/DesktopNotice";
import TabGroup from "../../components/ui/TabGroup";
import ReleaseNotesSection, { ReleaseNotesOverview } from "../../components/release-notes/ReleaseNotesView";
import { RELEASE, SECTIONS } from "../../components/release-notes/content";

const OVERVIEW = "overview";

/**
 * Release Notes — what changed in the ERP, for every employee (ADR 0030).
 * Tool page type. It opens on the Overview (every change as one line), then
 * one level-1 tab per area. `?tab=` links to a tab and `?open=` to one row in
 * it, so the What's new popup and announcements can link straight there.
 * Every screen on it is the real component fed Sample Data; the page reads no
 * records of its own.
 */
export default function ReleaseNotesPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const section = SECTIONS.find((s) => s.key === searchParams.get("tab"));
  const open = searchParams.get("open") ?? undefined;

  const go = (tab, row, { replace }) =>
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set("tab", tab);
        if (row) next.set("open", row);
        else next.delete("open");
        return next;
      },
      { replace },
    );

  return (
    <ProtectedRoute>
      <PageShell
        title="Release Notes"
        description={`${RELEASE.title}. ${RELEASE.window}`}
        tabs={
          <TabGroup
            variant="underline"
            tabs={[{ value: OVERVIEW, label: "Overview" }, ...SECTIONS.map(({ key, label }) => ({ value: key, label }))]}
            activeTab={section?.key ?? OVERVIEW}
            onChange={(value) => go(value, null, { replace: true })}
          />
        }
      >
        <DesktopNotice className="mb-4">Demo screens are best on desktop.</DesktopNotice>
        {section ? (
          <ReleaseNotesSection key={`${section.key}:${open ?? ""}`} section={section} defaultOpen={open} />
        ) : (
          // From the Overview a line is a step forward, so Back returns to it.
          <ReleaseNotesOverview sections={SECTIONS} onOpen={(tab, row) => go(tab, row, { replace: false })} />
        )}
      </PageShell>
    </ProtectedRoute>
  );
}
