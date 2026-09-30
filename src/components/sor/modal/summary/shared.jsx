/**
 * PROTOTYPE — throwaway. Pieces the SOR modal layout variants (B–E) share:
 * data shaping (detail rows, team, stage moves) and a few small controls
 * (identity, header actions, quotation buttons). Layout lives in each variant.
 * Delete this folder once a variant wins and is rebuilt properly.
 */
import { useEffect } from "react";
import { ChevronLeft, ChevronRight, ExternalLink, FileDown, Link2, MoreHorizontal, Pencil, Trash2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import Dropdown from "../../../ui/Dropdown";
import Spinner from "../../../ui/Spinner";
import Avatar from "../../../Avatar";
import StatusBadge from "../../../StatusBadge";
import { confirmDeleteToast } from "../../../ui/CustomToast";
import { outgoingStages } from "../../../../constants/salesFlow";
import { PROJECT_TYPE_LABELS, formatLeadSource, itbGateSatisfiedBy, ITB_EXEMPT_LABEL, formatPHP } from "../../../../constants/sor";
import DetailsTab from "../DetailsTab";
import ItemsTab from "../ItemsTab";

export const LABEL = "text-[10px] font-bold tracking-widest text-muted-foreground uppercase";

/** Variants show data the baseline only loads when its tab opens — warm those queries once. */
export function useWarmTabs(p, tabs) {
  const { markOpened, canViewJourney, id } = p;
  useEffect(() => {
    tabs.forEach((t) => {
      if (t === "journey" && !canViewJourney) return;
      markOpened(t);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, canViewJourney, markOpened]);
}

function formatLongDate(dateString) {
  if (!dateString) return "";
  return new Date(dateString).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

export function formatShort(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** Every read-mode field DetailsTab shows, as label/value rows. */
export function detailRows(p) {
  const o = p.opportunity;
  const leadSources = p.ctx.activeLeadSources;
  const rows = [
    { label: "Lead Source", value: formatLeadSource(o.lead_source, o.lead_source_detail, leadSources) },
    { label: "Sales Division", value: PROJECT_TYPE_LABELS[o.project_type] },
    { label: "Date Registered", value: formatLongDate(o.registration_date) },
    { label: "Expected Award", value: formatLongDate(o.expected_award_date) },
    { label: "Contact Person", value: o.contact_person },
    {
      label: "Sales Reference",
      value: o.sales_reference ? (
        <span className="font-mono font-bold text-primary">{o.sales_reference}</span>
      ) : o.status === "LEAD" ? (
        <span className="text-xs font-medium text-amber-11">Required to qualify</span>
      ) : null,
    },
  ];
  if (o.po_date) rows.push({ label: "PO Date", value: formatLongDate(o.po_date) });
  if (itbGateSatisfiedBy(o)) {
    rows.push({ label: "ITB Number", value: o.itb_number || <span className="text-xs font-bold text-amber-11">{ITB_EXEMPT_LABEL}</span> });
  }
  if (p.flowCanvas?.saleType?.name) rows.push({ label: "Sale Type", value: p.flowCanvas.saleType.name });
  if (o.opportunity_no) rows.push({ label: "SOR No.", value: <span className="font-mono text-[13px]">{o.opportunity_no}</span> });
  return rows;
}

export function teamRows(o) {
  const byId = new Map();
  const add = (person, role) => {
    if (!person) return;
    const entry = byId.get(person.id);
    if (entry) entry.roles.push(role);
    else byId.set(person.id, { person, roles: [role] });
  };
  const isStrategic = o.project_type === "STRATEGIC";
  add(o.deal_owner, isStrategic ? "Deal Owner / Originator" : "Deal Owner");
  add(o.closing_sales, "Closing Salesperson");
  add(o.sales_director, "Sales Director");
  add(o.support_1, "Support Sales 1");
  add(o.support_2, "Support Sales 2");
  const missing = [];
  if (!o.deal_owner) missing.push(isStrategic ? "Deal Owner / Originator" : "Deal Owner");
  if (isStrategic && !o.closing_sales) missing.push("Closing Salesperson");
  if (!o.sales_director) missing.push("Sales Director");
  return { people: [...byId.values()], missing };
}

export function TeamList({ opportunity, compact = false }) {
  const { people, missing } = teamRows(opportunity);
  return (
    <div className="space-y-2.5">
      {missing.length > 0 && (
        <p className="rounded-lg border border-amber-7 bg-amber-3 px-2.5 py-2 text-[11px] leading-snug text-amber-11">
          <span className="font-bold">Unassigned: {missing.join(", ")}.</span> Their commission shares stay unattributed.
        </p>
      )}
      {people.length === 0 && <p className="text-sm text-muted-foreground">No one assigned yet.</p>}
      {people.map(({ person, roles }) => (
        <div key={person.id} className="flex items-center gap-2.5">
          <Avatar name={person.name} src={person.avatar_path} size={compact ? "xs" : "sm"} />
          <div className="min-w-0">
            <p className="truncate text-[13px] font-semibold text-foreground">{person.name}</p>
            <p className="truncate text-[11px] text-muted-foreground">{roles.join(" · ")}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

export function blockedLabels(checklist) {
  return checklist.filter(({ condition, status }) => condition?.is_required && status === "unsatisfied").map(({ condition }) => condition.label);
}

/**
 * Where the deal is and where it can go, for both kinds of deal. A flow deal
 * offers only its drawn outgoing edges; a legacy deal offers every other
 * pipeline stage through `handleStageChange` (which owns the lost-reason and
 * Sales Reference confirm steps).
 */
export function stageMoves(p) {
  const blockedBy = blockedLabels(p.checklist);
  const isMoving = p.stageMutation.isPending;
  if (p.isFlowDeal) {
    const canvas = p.flowCanvas;
    const destinations = canvas ? outgoingStages(p.opportunity.flow_stage_id, canvas.stages, canvas.edges) : [];
    return {
      isFlow: true,
      currentLabel: p.currentFlowStage?.name || "—",
      currentTone: p.currentFlowStageTone,
      isWon: !!canvas && canvas.flow.won_stage_id === p.currentFlowStage?.id,
      isTerminal: !!p.currentFlowStage?.is_terminal,
      destinations: destinations.map((s) => ({ key: s.id, label: s.name })),
      blockedBy,
      // A Return is never blocked by the Stage being left (#390).
      isBlocked: (key) => blockedBy.length > 0 && !(p.returnStageIds || []).includes(key),
      canMove: !p.moveDisabled && !isMoving && (blockedBy.length === 0 || destinations.some((s) => (p.returnStageIds || []).includes(s.id))),
      isMoving,
      move: (key) => {
        if (p.moveDisabled || isMoving || (blockedBy.length && !(p.returnStageIds || []).includes(key))) return;
        p.stageMutation.mutate({ next: key, reason: null, salesReference: null });
      },
    };
  }
  const stages = p.pipelineStages;
  const idx = stages.findIndex((s) => s.code === p.opportunity.status);
  const current = stages[idx];
  const next = stages[idx + 1];
  return {
    isFlow: false,
    currentLabel: current?.label || p.opportunity.status,
    currentTone: undefined,
    isWon: false,
    isTerminal: false,
    suggested: next ? { key: next.code, label: next.label } : null,
    destinations: stages.filter((s) => s.code !== p.opportunity.status).map((s) => ({ key: s.code, label: s.label })),
    legacy: stages.map((s, i) => ({ key: s.code, label: s.label, state: i < idx ? "done" : i === idx ? "current" : "upcoming" })),
    blockedBy,
    canMove: !p.moveDisabled && !isMoving,
    isMoving,
    move: (key) => {
      if (p.moveDisabled || isMoving) return;
      p.handleStageChange(key);
    },
  };
}

export function StageBadge({ p }) {
  return p.isFlowDeal ? (
    p.currentFlowStage && <StatusBadge label={p.currentFlowStage.name} theme={p.currentFlowStageTone} />
  ) : (
    <StatusBadge status={p.opportunity.status} />
  );
}

/** Reference line + title + company; inputs while editing. */
export function Identity({ p, badge = true, titleClass = "text-lg" }) {
  const o = p.opportunity;
  const { isEditing, editForm, setEditForm } = p.ctx;
  return (
    <div className="min-w-0">
      <div className="mb-1 flex items-center gap-2">
        {o.sales_reference ? (
          <span className="font-mono text-xs font-bold text-primary">{o.sales_reference}</span>
        ) : (
          <span className="font-mono text-xs font-bold text-muted-foreground">{o.opportunity_no || "No Sales Reference"}</span>
        )}
        {badge && <StageBadge p={p} />}
      </div>
      {isEditing ? (
        <div className="mt-1 max-w-xl space-y-2">
          <Input
            value={editForm.project_title}
            onChange={(e) => setEditForm((f) => ({ ...f, project_title: e.target.value }))}
            containerClassName="w-full"
            className="text-base font-black"
            placeholder="Project Title"
            autoFocus
          />
          <Input
            value={editForm.client_name}
            onChange={(e) => setEditForm((f) => ({ ...f, client_name: e.target.value }))}
            containerClassName="w-full"
            className="h-8 text-xs"
            placeholder="Company"
          />
        </div>
      ) : (
        <>
          <h2 className={cn("truncate font-black tracking-tight text-foreground", titleClass)} title={o.project_title}>
            {o.project_title}
          </h2>
          <p className="truncate text-xs font-medium text-muted-foreground">{o.client_name}</p>
        </>
      )}
    </div>
  );
}

/** Prev/next, edit/save, more (expand, delete), close — the baseline header's actions. */
export function HeaderActions({ p, extra = null }) {
  const { isEditing } = p.ctx;
  return (
    <div className="flex shrink-0 items-center gap-1">
      {(p.hasPrev || p.hasNext) && (
        <>
          <Button type="button" variant="ghost" size="icon-sm" onClick={p.goPrev} disabled={!p.hasPrev} aria-label="Previous opportunity" className="text-muted-foreground">
            <ChevronLeft size={15} />
          </Button>
          <Button type="button" variant="ghost" size="icon-sm" onClick={p.goNext} disabled={!p.hasNext} aria-label="Next opportunity" className="text-muted-foreground">
            <ChevronRight size={15} />
          </Button>
          <div className="mx-1 h-4 w-px bg-border/60" />
        </>
      )}
      {isEditing ? (
        <>
          <Button type="button" variant="ghost" size="sm" onClick={p.handleEditToggle}>
            Cancel
          </Button>
          <Button type="button" size="sm" onClick={() => p.updateMutation.mutate(p.ctx.editForm)} disabled={p.updateMutation.isPending}>
            {p.updateMutation.isPending ? "Saving..." : "Save"}
          </Button>
        </>
      ) : (
        <>
          {extra}
          {p.canEdit && (
            <Button type="button" variant="ghost" size="icon-sm" onClick={p.handleEditToggle} aria-label="Edit opportunity" title="Edit" className="text-muted-foreground">
              <Pencil size={14} />
            </Button>
          )}
          <Dropdown
            usePortal
            placement="bottom-end"
            popoverClassName="popover-enter z-[10001] w-max min-w-52 rounded-xl bg-popover p-1.5 shadow-2xl ring-1 ring-mauve-6"
            trigger={
              <Button type="button" variant="ghost" size="icon-sm" aria-label="More actions" className="text-muted-foreground">
                <MoreHorizontal size={15} />
              </Button>
            }
          >
            {({ close }) => (
              <div className="flex flex-col gap-0.5">
                {p.canEdit && (
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => {
                      close();
                      confirmDeleteToast(`Delete ${p.opportunity.opportunity_no}?`, "The record is archived, not erased.", () => p.deleteMutation.mutate());
                    }}
                    className="h-auto justify-start gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm hover:bg-red-9/10 hover:text-red-11"
                  >
                    <Trash2 size={14} className="text-red-11" />
                    Delete opportunity
                  </Button>
                )}
              </div>
            )}
          </Dropdown>
          <Button type="button" variant="ghost" size="icon-sm" onClick={p.onClose} aria-label="Close" className="text-muted-foreground">
            <X size={15} />
          </Button>
        </>
      )}
    </div>
  );
}

export function showMoney(p) {
  return p.ctx.accessLevel !== "participant";
}

export function ValueFigure({ p, className }) {
  if (!showMoney(p)) return null;
  return <p className={cn("font-black tracking-tight tabular-nums text-foreground", className)}>{p.ctx.estimatedValueDisplay}</p>;
}

/** Preview / copy link / full PDF, only where the baseline shows them. */
export function QuoteActions({ p, stacked = true }) {
  const { ctx, opportunity } = p;
  if (!showMoney(p) || ctx.isEditing || !opportunity.sales_reference) return null;
  return (
    <div className="space-y-2">
      <div className={cn("flex gap-2", stacked ? "" : "flex-wrap")}>
        <Button type="button" variant="outline" size="sm" disabled={ctx.buildingLink} onClick={ctx.handlePreviewQuotation} className="flex-1 gap-1.5">
          {ctx.buildingLink ? <Spinner size="sm" /> : <ExternalLink size={13} />}
          Preview quote
        </Button>
        <Button type="button" variant="outline" size="icon-sm" disabled={ctx.buildingLink} onClick={ctx.handleCopyQuotationLink} aria-label="Copy customer quotation link" title="Copy customer quotation link" className="text-muted-foreground">
          <Link2 size={13} />
        </Button>
        {!stacked && (
          <Button type="button" variant="outline" size="sm" disabled={!!ctx.downloadStep} onClick={ctx.handleDownloadQuotation} className="flex-1 gap-1.5">
            {ctx.downloadStep ? <Spinner size="sm" /> : <FileDown size={13} />}
            Full PDF
          </Button>
        )}
      </div>
      {stacked && (
        <Button type="button" variant="outline" size="sm" disabled={!!ctx.downloadStep} onClick={ctx.handleDownloadQuotation} className="w-full gap-1.5">
          {ctx.downloadStep ? <Spinner size="sm" /> : <FileDown size={13} />}
          Download full PDF
        </Button>
      )}
      {ctx.downloadStep && <p className="truncate text-center text-[11px] text-muted-foreground">{ctx.downloadStep}</p>}
    </div>
  );
}

export function itemsTotal(items) {
  return items.reduce((sum, it) => sum + (Number(it.quantity) || 0) * (Number(it.unit_price) || 0), 0);
}
export { formatPHP };

/** Edit mode is not the question here: every variant edits the same fields in one scroll. */
export function EditBody({ p }) {
  return (
    <div className="h-full overflow-y-auto">
      <DetailsTab ctx={p.ctx} />
      <div className="border-t border-border/60">
        <p className={cn(LABEL, "px-6 pt-6")}>Product list</p>
        <ItemsTab ctx={p.ctx} hasOpened={p.hasOpened} />
      </div>
    </div>
  );
}
