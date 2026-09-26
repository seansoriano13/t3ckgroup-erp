/**
 * REMOVE-BEFORE-PROD — layout "Flow rail". Question: is the horizontal chevron
 * ribbon the problem? Stages here run top-to-bottom in a rail that never
 * scrolls sideways, show when this SOR was in each one (from the Journey),
 * and put an explicit "Move here" on exactly the stages it can move to.
 * Tabs and the notes column stay where employees already know them.
 */
import { useEffect, useState } from "react";
import TabGroup from "../../../ui/TabGroup";
import NowTab from "../NowTab";
import ItemsTab from "../ItemsTab";
import JourneyTab from "../JourneyTab";
import DetailsTab from "../DetailsTab";
import FlowRail from "./FlowRail";
import { EditBody, HeaderActions, Identity, useWarmTabs } from "./shared";

export default function FlowRailLayout({ p }) {
  useWarmTabs(p, ["journey"]);
  const { ctx } = p;
  const [tab, setTab] = useState("now");

  useEffect(() => {
    if (ctx.pendingStage) setTab("now");
  }, [ctx.pendingStage]);
  useEffect(() => {
    if (tab !== "chat") p.markOpened(tab);
  }, [tab, p]);

  const tabs = [
    { value: "now", label: "Now" },
    { value: "items", label: "Products" },
    { value: "details", label: "Details" },
    p.canViewJourney && { value: "journey", label: "History" },
    !p.isWide && { value: "chat", label: `Notes (${p.notes.length})` },
  ].filter(Boolean);

  return (
    <>
      <div className="flex shrink-0 items-start justify-between gap-4 border-b border-border/60 px-6 pt-5 pb-4">
        <Identity p={p} />
        <HeaderActions p={p} />
      </div>
      {p.windowsBanner}

      <div className="flex min-h-0 flex-1">
        {!ctx.isEditing && <FlowRail p={p} />}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {ctx.isEditing ? (
            <EditBody p={p} />
          ) : (
            <>
              <div className="shrink-0 border-b border-border/60 px-6 pt-3">
                <TabGroup tabs={tabs} activeTab={tab} onChange={setTab} variant="underline" />
              </div>
              <div className="min-h-0 flex-1 overflow-hidden">
                <div className={tab === "now" ? "h-full overflow-y-auto" : "hidden"}>
                  <NowTab ctx={ctx} />
                </div>
                {p.hasOpened("items") && (
                  <div className={tab === "items" ? "h-full" : "hidden"}>
                    <ItemsTab ctx={ctx} hasOpened={p.hasOpened} />
                  </div>
                )}
                {p.hasOpened("details") && (
                  <div className={tab === "details" ? "h-full overflow-y-auto" : "hidden"}>
                    <DetailsTab ctx={ctx} />
                  </div>
                )}
                {tab === "journey" && (
                  <div className="h-full overflow-y-auto">
                    <JourneyTab opportunityId={p.id} hasOpened={p.hasOpened} onGoToNow={() => setTab("now")} />
                  </div>
                )}
                {tab === "chat" && <div className="h-full">{p.chatColumn}</div>}
              </div>
            </>
          )}
        </div>
        {p.isWide && <div className="w-[320px] shrink-0 border-l border-border/60">{p.chatColumn}</div>}
      </div>
    </>
  );
}
