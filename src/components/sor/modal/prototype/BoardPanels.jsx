/**
 * PROTOTYPE — throwaway. The summary panels of the overview board (Overview board,
 * Rail + board). Each panel summarises one area and offers a way into the full view.
 */
import { ArrowLeft, ArrowRight, Check, CircleDashed, ShieldOff, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import Avatar from "../../../Avatar";
import OpportunityCommissionFooter from "../../OpportunityCommissionFooter";
import NowTab from "../NowTab";
import ItemsTab from "../ItemsTab";
import JourneyTab from "../JourneyTab";
import DetailsTab from "../DetailsTab";
import { useSorModalData } from "../useSorModalData";
import { opportunityService } from "../../../../services/opportunityService";
import { isTaskDeleted, isTaskOpen, journeyRows } from "../../../../constants/journey";
import { CONDITION_STATUS } from "../../../../constants/stageGate";
import { formatPHP, formatShort, itemsTotal, showMoney } from "../summary/shared";

export function Panel({ title, meta, onOpen, openLabel = "Open", className, children }) {
  return (
    <section className={cn("flex min-w-0 flex-col rounded-xl border border-border/70 bg-card", className)}>
      <header className="flex items-center justify-between gap-2 border-b border-border/50 px-4 py-2.5">
        <div className="flex min-w-0 items-baseline gap-2">
          <h3 className="truncate text-[13px] font-black text-foreground">{title}</h3>
          {meta && <span className="shrink-0 text-[11px] font-semibold tabular-nums text-muted-foreground">{meta}</span>}
        </div>
        {onOpen && (
          <Button type="button" variant="ghost" size="xs" onClick={onOpen} className="shrink-0 gap-1 text-muted-foreground hover:text-foreground">
            {openLabel}
            <ArrowRight size={12} />
          </Button>
        )}
      </header>
      <div className="min-h-0 flex-1 p-4">{children}</div>
    </section>
  );
}

export function StagePanel({ p, onOpen }) {
  const { checklist } = p;
  const tasks = [...(p.ctx.automationTasks.individualTasks || []), ...(p.ctx.automationTasks.groupTasks || [])];
  const open = tasks.filter((t) => isTaskOpen(t) && !isTaskDeleted(t));
  const unmet = checklist.filter((c) => c.status !== CONDITION_STATUS.SATISFIED);

  return (
    <Panel title="This stage" meta={p.isFlowDeal ? p.currentFlowStage?.name : null} onOpen={onOpen} openLabel="Work this stage" className="col-span-12 lg:col-span-7">
      {p.isRestricted && (
        <p className="mb-3 flex items-center gap-2 text-xs font-semibold text-amber-11">
          <ShieldOff size={13} /> This stage is restricted — Move is disabled.
        </p>
      )}
      {checklist.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing blocks this stage.</p>
      ) : (
        <ul className="space-y-1.5">
          {checklist.map((c) => {
            const met = c.status === CONDITION_STATUS.SATISFIED;
            return (
              <li key={c.condition.id} className="flex items-start gap-2 text-[13px]">
                {met ? <Check size={14} className="mt-0.5 shrink-0 text-green-11" /> : <CircleDashed size={14} className="mt-0.5 shrink-0 text-amber-11" />}
                <span className={cn("min-w-0 flex-1", met ? "text-muted-foreground line-through decoration-mauve-7" : "font-semibold text-foreground")}>{c.condition.label}</span>
                {!met && c.condition.is_required && <span className="shrink-0 text-[10px] font-bold text-amber-11 uppercase">Required</span>}
              </li>
            );
          })}
        </ul>
      )}
      <div className="mt-4 flex flex-wrap gap-x-5 gap-y-1 border-t border-border/50 pt-3 text-xs text-muted-foreground">
        <span>
          <span className="font-bold text-foreground tabular-nums">{unmet.length}</span> of {checklist.length} still open
        </span>
        <span>
          <span className="font-bold text-foreground tabular-nums">{open.length}</span> open task{open.length === 1 ? "" : "s"} on this SOR
        </span>
        {p.ctx.pendingStage && <span className="font-semibold text-amber-11">A move is waiting for your confirmation</span>}
      </div>
    </Panel>
  );
}

export function ProductsPanel({ p, onOpen }) {
  const { items, itemsLoading } = p.ctx;
  const money = showMoney(p);
  return (
    <Panel title="Products" meta={items.length ? `${items.length} line${items.length === 1 ? "" : "s"}` : null} onOpen={onOpen} openLabel="Full list" className="col-span-12 lg:col-span-7">
      {itemsLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{p.opportunity.sales_reference ? "No products yet — pull them from Odoo in the full list." : "No products yet. Add a Sales Reference first."}</p>
      ) : (
        <>
          <ul className="divide-y divide-border/50">
            {items.slice(0, 5).map((it) => (
              <li key={it.id} className="flex items-baseline gap-3 py-1.5 text-[13px]">
                <span className="min-w-0 flex-1 truncate font-semibold text-foreground">{it.product_name}</span>
                <span className="shrink-0 tabular-nums text-muted-foreground">×{it.quantity}</span>
                {money && <span className="w-28 shrink-0 text-right font-semibold tabular-nums text-foreground">{formatPHP(Number(it.quantity) * Number(it.unit_price))}</span>}
              </li>
            ))}
          </ul>
          <div className="mt-2 flex items-baseline justify-between border-t border-border/50 pt-2 text-xs text-muted-foreground">
            <span>{items.length > 5 ? `+ ${items.length - 5} more` : "All lines shown"}</span>
            {money && (
              <span>
                Total <span className="ml-1 text-sm font-black tabular-nums text-foreground">{formatPHP(itemsTotal(items))}</span>
              </span>
            )}
          </div>
        </>
      )}
    </Panel>
  );
}

export function ActivityPanel({ p, onOpen }) {
  const latest = p.notes.slice(-3).reverse();
  return (
    <Panel title="Latest notes" meta={p.notes.length} onOpen={onOpen} openLabel="Open & reply" className="col-span-12 lg:col-span-5">
      {latest.length === 0 ? (
        <p className="text-sm text-muted-foreground">No notes yet.</p>
      ) : (
        <ul className="space-y-3">
          {latest.map((n) => (
            <li key={n.id} className="flex gap-2.5">
              {n.type === "SYSTEM" ? (
                <div className="flex size-6 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                  <Sparkles size={12} />
                </div>
              ) : (
                <Avatar name={n.author?.name} src={n.author?.avatar_path} size="xs" />
              )}
              <div className="min-w-0 flex-1">
                <p className="text-[11px] text-muted-foreground">
                  <span className="font-semibold">{n.author?.name || "System"}</span> · {formatShort(n.created_at)}
                </p>
                <p className="line-clamp-2 text-[13px] text-foreground">{n.content || n.metadata?.changes?.join(" · ") || "Attachment"}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

export function JourneyPanel({ p, onOpen }) {
  const { data: visits = [] } = useSorModalData({
    tab: "journey",
    opportunityId: p.id,
    queryFn: () => opportunityService.getJourney(p.id),
    hasOpened: p.hasOpened,
  });
  const rows = journeyRows(visits).slice(0, 6);
  return (
    <Panel title="History" meta={visits.length ? `${visits.length} visit${visits.length === 1 ? "" : "s"}` : null} onOpen={onOpen} openLabel="All stages" className="col-span-12 lg:col-span-7">
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No Stage Visits yet.</p>
      ) : (
        <ol className="space-y-1.5">
          {rows.map(({ visit, isCurrent }) => (
            <li key={visit.id} className="flex items-center gap-2.5 text-[13px]">
              <span className={cn("size-2 shrink-0 rounded-full", isCurrent ? "bg-foreground" : "bg-mauve-7")} />
              <span className={cn("min-w-0 flex-1 truncate", isCurrent ? "font-black text-foreground" : "font-medium text-foreground")}>{visit.stage.name}</span>
              <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                {formatShort(visit.enteredAt)} → {visit.leftAt ? formatShort(visit.leftAt) : "now"}
              </span>
            </li>
          ))}
        </ol>
      )}
    </Panel>
  );
}

const VIEWS = {
  now: "This stage",
  items: "Products",
  activity: "Activity",
  journey: "History",
  details: "Details, inclusions & purchasing",
  commission: "Commission",
};

/** One area of the SOR at full size, with a way back to the board. */
export function DrillView({ p, view, onBack, onGoNow }) {
  const { ctx, opportunity } = p;
  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-border/60 px-4 py-2">
        <Button type="button" variant="ghost" size="sm" onClick={onBack} className="gap-1.5 text-muted-foreground">
          <ArrowLeft size={14} />
          Overview
        </Button>
        <span className="text-muted-foreground/50">/</span>
        <span className="text-sm font-black text-foreground">{VIEWS[view]}</span>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        {view === "now" && (
          <div className="h-full overflow-y-auto">
            <NowTab ctx={ctx} />
          </div>
        )}
        {view === "items" && <ItemsTab ctx={ctx} hasOpened={p.hasOpened} />}
        {view === "activity" && <div className="mx-auto h-full max-w-3xl border-x border-border/60">{p.chatColumn}</div>}
        {view === "journey" && (
          <div className="h-full overflow-y-auto">
            <JourneyTab opportunityId={p.id} hasOpened={p.hasOpened} onGoToNow={onGoNow} />
          </div>
        )}
        {view === "details" && (
          <div className="h-full overflow-y-auto">
            <DetailsTab ctx={ctx} />
          </div>
        )}
        {view === "commission" && (
          <div className="h-full overflow-y-auto p-6">
            <OpportunityCommissionFooter opportunity={opportunity} onClose={p.onClose} />
          </div>
        )}
      </div>
    </div>
  );
}
