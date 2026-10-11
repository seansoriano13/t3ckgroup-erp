import { useSearchParams } from "react-router";
import ProtectedRoute from "../../components/ProtectedRoute.jsx";
import PageShell from "../../components/ui/PageShell";
import TabGroup from "../../components/ui/TabGroup";
import ReleaseNotesSection from "../../components/release-notes/ReleaseNotesView";
import { RELEASE, SECTIONS } from "../../components/release-notes/content";

/**
 * Release Notes — what changed in the ERP, for every employee (ADR 0030).
 * Tool page type: one level-1 tab per section, `?tab=` so the What's new
 * popup and announcements can link straight to one. Every screen on it is
 * the real component fed Sample Data; the page reads no records of its own.
 */
export default function ReleaseNotesPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const section = SECTIONS.find((s) => s.key === searchParams.get("tab")) ?? SECTIONS[0];

  return (
    <ProtectedRoute>
      <PageShell
        title="Release Notes"
        description={`${RELEASE.title}. ${RELEASE.window}`}
        tabs={
          <TabGroup
            variant="underline"
            tabs={SECTIONS.map(({ key, label }) => ({ value: key, label }))}
            activeTab={section.key}
            onChange={(value) => setSearchParams((prev) => { const next = new URLSearchParams(prev); next.set("tab", value); return next; }, { replace: true })}
          />
        }
      >
        <ReleaseNotesSection key={section.key} section={section} />
      </PageShell>
    </ProtectedRoute>
  );
}
