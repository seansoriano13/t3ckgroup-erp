/**
 * REMOVE-BEFORE-PROD — layout "Rail + summary". Built from round-one
 * feedback: Flow rail's stage rail (2nd favourite), Overview board's "see
 * everything at once" (favourite, but it didn't read as a summary), and the
 * notes pop-out.
 *
 * The Summary tab is a digest, not a wall of panels: one sentence on where the
 * deal stands, five numbers, what needs someone's attention (each with a way
 * to go and fix it), and the key facts. Everything else is a tab away.
 */
import { useEffect, useState } from "react";
import TabGroup from "../../../ui/TabGroup";
import NowTab from "../NowTab";
import ItemsTab from "../ItemsTab";
import JourneyTab from "../JourneyTab";
import DetailsTab from "../DetailsTab";
import FlowRail from "./FlowRail";
import NotesDrawer, { NotesButton } from "../summary/NotesDrawer";
import DigestSummary from "../summary/DigestSummary";
import { EditBody, HeaderActions, Identity, useWarmTabs } from "../summary/shared";

export default function RailSummaryLayout({ p }) {
  useWarmTabs(p, ["items", "details", "journey"]);
  const { ctx } = p;
  const [tab, setTab] = useState("summary");
  const [notesOpen, setNotesOpen] = useState(false);

  useEffect(() => {
    if (ctx.pendingStage) setTab("now");
  }, [ctx.pendingStage]);
  useEffect(() => setTab("summary"), [p.id]);

  const tabs = [
    { value: "summary", label: "Summary" },
    { value: "now", label: "This stage" },
    { value: "items", label: `Products${ctx.items.length ? ` (${ctx.items.length})` : ""}` },
    { value: "details", label: "Details" },
    p.canViewJourney && { value: "journey", label: "History" },
  ].filter(Boolean);

  return (
    <>
      <div className="flex shrink-0 items-start justify-between gap-4 border-b border-border/60 px-6 pt-5 pb-4">
        <Identity p={p} />
        <HeaderActions p={p} extra={<NotesButton p={p} open={notesOpen} onToggle={() => setNotesOpen((v) => !v)} className="mr-1" />} />
      </div>
      {p.windowsBanner}

      <div className="relative flex min-h-0 flex-1">
        {ctx.isEditing ? (
          <div className="min-h-0 flex-1">
            <EditBody p={p} />
          </div>
        ) : (
          <>
            <FlowRail p={p} />
            <div className="flex min-h-0 min-w-0 flex-1 flex-col">
              <div className="shrink-0 border-b border-border/60 px-6 pt-3">
                <TabGroup tabs={tabs} activeTab={tab} onChange={setTab} variant="underline" />
              </div>
              <div className="min-h-0 flex-1 overflow-hidden">
                {tab === "summary" && (
                  <div className="h-full overflow-y-auto">
                    <DigestSummary p={p} go={setTab} openNotes={() => setNotesOpen(true)} />
                  </div>
                )}
                <div className={tab === "now" ? "h-full overflow-y-auto" : "hidden"}>
                  <NowTab ctx={ctx} />
                </div>
                <div className={tab === "items" ? "h-full" : "hidden"}>
                  <ItemsTab ctx={ctx} hasOpened={p.hasOpened} />
                </div>
                <div className={tab === "details" ? "h-full overflow-y-auto" : "hidden"}>
                  <DetailsTab ctx={ctx} />
                </div>
                {tab === "journey" && (
                  <div className="h-full overflow-y-auto">
                    <JourneyTab opportunityId={p.id} hasOpened={p.hasOpened} onGoToNow={() => setTab("now")} />
                  </div>
                )}
              </div>
            </div>
            <NotesDrawer p={p} open={notesOpen} onClose={() => setNotesOpen(false)} />
          </>
        )}
      </div>
    </>
  );
}
