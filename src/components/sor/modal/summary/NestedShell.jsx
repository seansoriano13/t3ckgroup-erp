/**
 * SOR modal layout. The shell round 3's picks
 * add up to (the three "Summary" layouts):
 * - the original header and stage ribbon (the chevron boxes),
 * - notes as the pop-out,
 * - a Summary home, with every other view nested under it behind a crumb
 *   ("Summary › Products") instead of a row of tabs,
 * - no Details tab — the fields are the Summary's key facts, editing is the
 *   pencil — and "History", not "Journey".
 * The variants differ only in how the Summary is laid out and whether the
 * crumb also lists the sibling views (`nav="pills"`) or only the path.
 */
import { useEffect, useRef, useState } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import OpportunityCommissionFooter from "../../OpportunityCommissionFooter";
import SorModalHeader from "../SorModalHeader";
import NowTab from "../NowTab";
import ItemsTab from "../ItemsTab";
import JourneyTab from "../JourneyTab";
import PmsTab from "../PmsTab";
import ScrollCueNav from "./ScrollCueNav";
import NotesDrawer, { NotesButton } from "./NotesDrawer";
import { goToDetails } from "./goToDetails";
import { blockedLabels, EditBody, showMoney, useWarmTabs } from "./shared";

export function nestedViews(p) {
  const blocked = blockedLabels(p.checklist, p.missingRequiredStageFields).length;
  return [
    { key: "now", label: "This stage", badge: blocked || null, badgeTone: "amber" },
    { key: "items", label: "Products", badge: p.ctx.items.length || null },
    { key: "pms", label: "PMS" },
    p.canViewJourney && { key: "journey", label: "History" },
    showMoney(p) && { key: "commission", label: "Commission" },
  ].filter(Boolean);
}

function Badge({ view }) {
  if (view.badge == null) return null;
  return (
    <span className={cn("rounded-full px-1.5 text-[10px] font-bold tabular-nums", view.badgeTone === "amber" ? "bg-amber-3 text-amber-11" : "bg-mauve-4 text-mauve-11")}>
      {view.badge}
    </span>
  );
}

/** A plain list of the nested views, for a Summary whose crumb shows only the path. */
export function SectionLinks({ views, open, className }) {
  return (
    <nav className={cn("flex flex-wrap gap-2", className)} aria-label="Open a section">
      {views.map((v) => (
        <Button key={v.key} type="button" variant="outline" size="sm" onClick={() => open(v.key)} className="gap-1.5">
          {v.label}
          <Badge view={v} />
          <ChevronRight size={13} className="text-muted-foreground" />
        </Button>
      ))}
    </nav>
  );
}

export default function NestedShell({ p, nav = "crumb", renderSummary }) {
  useWarmTabs(p, ["items", "details", "journey"]);
  const { ctx, opportunity } = p;
  // The PMS tab exists for everyone who can see the SOR; PmsTab shows the Costing Matrix only to a tier.
  const views = nestedViews(p);
  // A caller can open the SOR on a tab (the Costing Matrix page opens "pms"); one this person has no tab for opens the Summary.
  const asView = (key) => (views.some((v) => v.key === key) ? key : "summary");
  // #1020: a caller that hands over `onViewChange` keeps the tab in the address (`&view=`), so the
  // address is the source of truth; any other caller (the SOR register) keeps it in state.
  const controlled = typeof p.onViewChange === "function";
  const [start] = useState(() => asView(p.initialView));
  const [localView, setLocalView] = useState(start);
  const view = controlled ? asView(p.initialView) : localView;
  const setView = (key) => (controlled ? p.onViewChange(key === "summary" ? null : key) : setLocalView(key));
  // A tab the address names but this reader has no access to (or that does not exist) shows the Summary, and the address is corrected.
  const badView = controlled && p.initialView && view !== p.initialView ? p.initialView : null;
  const onViewChange = p.onViewChange;
  useEffect(() => {
    if (badView) onViewChange(null);
  }, [badView, onViewChange]);
  const [opened, setOpened] = useState(start === "summary" ? ["summary"] : ["summary", start]);
  // A tab the address names (a link, Back) stays mounted once shown, like one clicked open.
  const wasOpened = (key) => opened.includes(key) || view === key;
  const [notesOpen, setNotesOpen] = useState(false);
  const current = views.find((v) => v.key === view);

  const open = (key) => {
    setOpened((prev) => (prev.includes(key) ? prev : [...prev, key]));
    setView(key);
  };
  // The Summary's "Go" links name views; "details" has no view of its own
  // here — fixing a missing field is an edit.
  const go = (target) => {
    if (target === "details") {
      goToDetails(p);
      return;
    }
    open(target);
  };

  useEffect(() => {
    if (ctx.pendingStage) {
      setOpened((prev) => (prev.includes("now") ? prev : [...prev, "now"]));
      setView("now");
    }
  }, [ctx.pendingStage]);
  // Back to Summary only when the window moves to a different SOR, never on mount or a re-render.
  const lastId = useRef(p.id);
  useEffect(() => {
    if (lastId.current === p.id) return;
    lastId.current = p.id;
    if (!controlled) setLocalView("summary");
    setOpened(["summary"]);
  }, [p.id]);

  return (
    <>
      <SorModalHeader {...p.headerProps} />
      {p.windowsBanner}

      {!ctx.isEditing && (
        <div className="flex shrink-0 items-center justify-between gap-4 border-b border-border/60 px-6 py-2 max-sm:gap-2 max-sm:px-3">
          <ScrollCueNav className="flex min-w-0 items-center gap-1" aria-label="Breadcrumb">
            {nav === "pills" ? (
              <>
                <Button type="button" variant={view === "summary" ? "secondary" : "ghost"} size="sm" onClick={() => setView("summary")} className="shrink-0 font-bold">
                  Summary
                </Button>
                <ChevronRight size={14} className="shrink-0 text-muted-foreground/60" />
                {views.map((v) => (
                  <Button
                    key={v.key}
                    type="button"
                    variant={view === v.key ? "secondary" : "ghost"}
                    size="sm"
                    onClick={() => open(v.key)}
                    aria-current={view === v.key ? "page" : undefined}
                    className={cn("shrink-0 gap-1.5", view !== v.key && "text-muted-foreground")}
                  >
                    {v.label}
                    <Badge view={v} />
                  </Button>
                ))}
              </>
            ) : (
              <>
                {view === "summary" ? (
                  <span className="px-2 text-sm font-black text-foreground" aria-current="page">
                    Summary
                  </span>
                ) : (
                  <>
                    <Button type="button" variant="ghost" size="sm" onClick={() => setView("summary")} className="shrink-0 text-muted-foreground">
                      Summary
                    </Button>
                    <ChevronRight size={14} className="shrink-0 text-muted-foreground/60" />
                    <span className="shrink-0 px-1 text-sm font-black text-foreground" aria-current="page">
                      {current?.label}
                    </span>
                  </>
                )}
              </>
            )}
          </ScrollCueNav>
          <NotesButton p={p} open={notesOpen} onToggle={() => setNotesOpen((v) => !v)} className="shrink-0" />
        </div>
      )}

      <div className="relative min-h-0 flex-1">
        {ctx.isEditing ? (
          <EditBody p={p} />
        ) : (
          <>
            {view === "summary" && <div className="h-full overflow-y-auto">{renderSummary({ go, open, views, openNotes: () => setNotesOpen(true) })}</div>}
            {/* This stage and Products stay mounted once opened, so a half-typed Stage Field or a product search survives a trip back to the Summary. */}
            {wasOpened("now") && (
              <div className={view === "now" ? "h-full overflow-y-auto" : "hidden"}>
                <NowTab ctx={ctx} />
              </div>
            )}
            {wasOpened("items") && (
              <div className={view === "items" ? "h-full" : "hidden"}>
                <ItemsTab ctx={ctx} hasOpened={p.hasOpened} />
              </div>
            )}
            {view === "pms" && (
              <div className="h-full overflow-y-auto">
                <PmsTab opportunityId={p.id} opportunity={p.ctx.opportunity} />
              </div>
            )}
            {view === "journey" && (
              <div className="h-full overflow-y-auto">
                <JourneyTab opportunityId={p.id} hasOpened={p.hasOpened} onGoToNow={() => open("now")} />
              </div>
            )}
            {view === "commission" && (
              <div className="h-full overflow-y-auto p-6">
                <OpportunityCommissionFooter opportunity={opportunity} onClose={p.onClose} />
              </div>
            )}
            <NotesDrawer p={p} open={notesOpen} onClose={() => setNotesOpen(false)} />
          </>
        )}
      </div>
    </>
  );
}
