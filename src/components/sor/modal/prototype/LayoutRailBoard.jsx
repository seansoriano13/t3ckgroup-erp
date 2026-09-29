/**
 * REMOVE-BEFORE-PROD — layout "Rail + board". The two favourites of round
 * one put together: Flow rail's stage rail on the left (stage always visible,
 * Move buttons on the stages it can go to) and the Overview board beside it.
 * Notes open as the pop-out; the board's notes panel replies through it.
 */
import { useEffect, useState } from "react";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import FlowRail from "./FlowRail";
import NotesDrawer, { NotesButton } from "../summary/NotesDrawer";
import { ActivityPanel, DrillView, Panel, ProductsPanel, StagePanel } from "./BoardPanels";
import { EditBody, HeaderActions, Identity, LABEL, QuoteActions, TeamList, ValueFigure, detailRows, showMoney, useWarmTabs } from "../summary/shared";

export default function RailBoardLayout({ p }) {
  useWarmTabs(p, ["items", "details", "journey"]);
  const { ctx, opportunity } = p;
  const [view, setView] = useState("overview");
  const [notesOpen, setNotesOpen] = useState(false);

  useEffect(() => {
    if (ctx.pendingStage) setView("now");
  }, [ctx.pendingStage]);
  useEffect(() => setView("overview"), [p.id]);

  let body;
  if (ctx.isEditing) {
    body = <EditBody p={p} />;
  } else if (view === "overview") {
    body = (
      <div className="h-full overflow-y-auto bg-muted/30 p-5">
        <div className="grid grid-cols-12 gap-4">
          <StagePanel p={p} onOpen={() => setView("now")} />
          <Panel title="Value & quote" className="col-span-12 lg:col-span-5">
            {showMoney(p) ? (
              <div className="space-y-4">
                <ValueFigure p={p} className="text-3xl" />
                <QuoteActions p={p} stacked={false} />
                {!opportunity.sales_reference && <p className="text-xs text-amber-11">No Sales Reference yet — the quotation lives in Odoo once there is one.</p>}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Value and quotation are for the Deal Team.</p>
            )}
          </Panel>
          <ProductsPanel p={p} onOpen={() => setView("items")} />
          <ActivityPanel p={p} onOpen={() => setNotesOpen(true)} />
          <Panel title="Details" onOpen={() => setView("details")} openLabel="All details" className="col-span-12 lg:col-span-7">
            <dl className="grid grid-cols-2 gap-x-6 gap-y-3">
              {detailRows(p).map((r) => (
                <div key={r.label} className="min-w-0">
                  <dt className={LABEL}>{r.label}</dt>
                  <dd className="mt-0.5 truncate text-[13px] font-semibold text-foreground">{r.value || <span className="text-muted-foreground/60">—</span>}</dd>
                </div>
              ))}
            </dl>
          </Panel>
          <Panel title="Deal team" className="col-span-12 lg:col-span-5">
            <TeamList opportunity={opportunity} compact />
            <div className="mt-4 flex flex-wrap gap-x-4 border-t border-border/50 pt-3">
              {p.canViewJourney && (
                <Button type="button" variant="ghost" size="xs" onClick={() => setView("journey")} className="gap-1 px-0 text-muted-foreground hover:bg-transparent hover:text-foreground">
                  Stage history <ArrowRight size={12} />
                </Button>
              )}
              {showMoney(p) && (
                <Button type="button" variant="ghost" size="xs" onClick={() => setView("commission")} className="gap-1 px-0 text-muted-foreground hover:bg-transparent hover:text-foreground">
                  Commission split <ArrowRight size={12} />
                </Button>
              )}
            </div>
          </Panel>
        </div>
      </div>
    );
  } else {
    body = <DrillView p={p} view={view} onBack={() => setView("overview")} onGoNow={() => setView("now")} />;
  }

  return (
    <>
      <div className="flex shrink-0 items-start justify-between gap-4 border-b border-border/60 px-6 pt-5 pb-4">
        <Identity p={p} />
        <HeaderActions p={p} extra={<NotesButton p={p} open={notesOpen} onToggle={() => setNotesOpen((v) => !v)} className="mr-1" />} />
      </div>
      {p.windowsBanner}
      <div className="relative flex min-h-0 flex-1">
        {!ctx.isEditing && <FlowRail p={p} />}
        <div className="min-h-0 min-w-0 flex-1">{body}</div>
        {!ctx.isEditing && <NotesDrawer p={p} open={notesOpen} onClose={() => setNotesOpen(false)} />}
      </div>
    </>
  );
}
