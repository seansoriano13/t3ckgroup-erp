/**
 * REMOVE-BEFORE-PROD — SOR modal layout prototype. A slide-over work sheet
 * inside the modal body ("Thread"): the timeline stays underneath, the
 * full tab slides over it; the scrim or ✕ closes it. Parent must be
 * `relative`. `view` null = closed.
 */
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import OpportunityCommissionFooter from "../../OpportunityCommissionFooter";
import NowTab from "../NowTab";
import ItemsTab from "../ItemsTab";
import JourneyTab from "../JourneyTab";
import DetailsTab from "../DetailsTab";

export const SHEET_TITLES = {
  now: "This stage",
  items: "Products",
  details: "Details, inclusions & purchasing",
  journey: "Stage history",
  commission: "Commission",
};

export default function Sheet({ p, view, onClose, onOpen }) {
  const open = !!view;
  return (
    <>
      <div
        className={cn("absolute inset-0 z-20 bg-mauve-12/10 transition-opacity duration-200", open ? "opacity-100" : "pointer-events-none opacity-0")}
        onClick={onClose}
        aria-hidden
      />
      <div
        className={cn(
          "absolute inset-y-0 right-0 z-20 flex w-full max-w-[820px] flex-col border-l border-border/60 bg-popover shadow-[-16px_0_40px_-20px_rgba(0,0,0,0.3)] transition-transform duration-300 ease-out-expo md:w-[72%]",
          open ? "translate-x-0" : "pointer-events-none translate-x-full",
        )}
        inert={!open}
        role="region"
        aria-label={open ? SHEET_TITLES[view] : undefined}
      >
        {open && (
          <>
            <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border/60 px-6 py-3">
              <h3 className="text-sm font-black text-foreground">{SHEET_TITLES[view]}</h3>
              <Button type="button" variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close" className="text-muted-foreground">
                <X size={15} />
              </Button>
            </div>
            <div className="min-h-0 flex-1 overflow-hidden">
              {view === "now" && (
                <div className="h-full overflow-y-auto">
                  <NowTab ctx={p.ctx} />
                </div>
              )}
              {view === "items" && <ItemsTab ctx={p.ctx} hasOpened={p.hasOpened} />}
              {view === "details" && (
                <div className="h-full overflow-y-auto">
                  <DetailsTab ctx={p.ctx} />
                </div>
              )}
              {view === "journey" && (
                <div className="h-full overflow-y-auto">
                  <JourneyTab opportunityId={p.id} hasOpened={p.hasOpened} onGoToNow={() => onOpen("now")} />
                </div>
              )}
              {view === "commission" && (
                <div className="h-full overflow-y-auto p-6">
                  <OpportunityCommissionFooter opportunity={p.opportunity} onClose={p.onClose} />
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </>
  );
}
