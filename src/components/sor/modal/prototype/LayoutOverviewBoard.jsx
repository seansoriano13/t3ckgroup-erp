/**
 * REMOVE-BEFORE-PROD — layout "Overview board". Question: does a one-screen
 * summary of *everything* beat opening on the stage's work? Every area of the
 * SOR gets a panel sized by how often it's needed; each opens full-size in
 * place (with a way back) when the summary isn't enough.
 */
import { useEffect, useState } from "react";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import SorModalHeader from "../SorModalHeader";
import { ActivityPanel, DrillView, JourneyPanel, Panel, ProductsPanel, StagePanel } from "./BoardPanels";
import { EditBody, LABEL, QuoteActions, TeamList, ValueFigure, detailRows, showMoney, useWarmTabs } from "./shared";


export default function OverviewBoardLayout({ p }) {
  useWarmTabs(p, ["items", "details", "journey"]);
  const { ctx, opportunity } = p;
  const [view, setView] = useState("overview");

  useEffect(() => {
    if (ctx.pendingStage) setView("now");
  }, [ctx.pendingStage]);
  useEffect(() => setView("overview"), [p.id]);

  const body = (() => {
    if (ctx.isEditing) return <EditBody p={p} />;
    if (view === "overview") {
      return (
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
            <ActivityPanel p={p} onOpen={() => setView("activity")} />

            {p.canViewJourney ? <JourneyPanel p={p} onOpen={() => setView("journey")} /> : <div className="hidden lg:col-span-7 lg:block" />}
            <Panel title="Deal team" className="col-span-12 lg:col-span-5">
              <TeamList opportunity={opportunity} compact />
            </Panel>

            <Panel title="Details" onOpen={() => setView("details")} openLabel="Inclusions & purchasing" className="col-span-12">
              <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3 lg:grid-cols-4">
                {detailRows(p).map((r) => (
                  <div key={r.label} className="min-w-0">
                    <dt className={LABEL}>{r.label}</dt>
                    <dd className="mt-0.5 truncate text-[13px] font-semibold text-foreground">{r.value || <span className="text-muted-foreground/60">—</span>}</dd>
                  </div>
                ))}
              </dl>
              {showMoney(p) && (
                <div className="mt-4 border-t border-border/50 pt-3">
                  <Button type="button" variant="ghost" size="xs" onClick={() => setView("commission")} className="gap-1 px-0 text-muted-foreground hover:bg-transparent hover:text-foreground">
                    Commission split
                    <ArrowRight size={12} />
                  </Button>
                </div>
              )}
            </Panel>
          </div>
        </div>
      );
    }
    return <DrillView p={p} view={view} onBack={() => setView("overview")} onGoNow={() => setView("now")} />;
  })();

  return (
    <>
      <SorModalHeader {...p.headerProps} />
      {p.windowsBanner}
      <div className="min-h-0 flex-1">{body}</div>
    </>
  );
}
