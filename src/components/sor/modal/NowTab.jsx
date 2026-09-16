import { useState } from "react";
import { cn } from "@/lib/utils";
import Spinner from "../../ui/Spinner";
import Avatar from "../../Avatar";
import StatusBadge from "../../StatusBadge";
import Dropdown from "../../ui/Dropdown";
import { FilterOptionList } from "../../ui/FilterDropdown";
import DatePicker from "react-datepicker";
import { Download, ExternalLink, FileDown, Link2, ChevronDown, ChevronRight, RefreshCw } from "lucide-react";
import OpportunityItemsEditor from "../OpportunityItemsEditor";
import PurchasingPanel from "../PurchasingPanel";
import InclusionsPanel from "../InclusionsPanel";
import StageChecklist from "../StageChecklist";
import OpportunityCommissionFooter from "../OpportunityCommissionFooter";
import { stockBadge, STOCK_BADGE_THEME } from "../../../constants/stock";
import {
  PROJECT_TYPE_LABELS,
  formatLeadSource,
  formatPHP,
  normalizeSalesReference,
  itbGateSatisfiedBy,
  ITB_EXEMPT_LABEL,
  SALES_REFERENCE_HINT,
} from "../../../constants/sor";
import { deriveProjectType } from "../../../utils/commission";

function Detail({ label, children, isEditing, control, wrapperClass = "w-full" }) {
  if (isEditing) {
    return (
      <div className={`bg-muted/30 border border-border rounded-xl p-3 flex flex-col group focus-within:border-mauve-7 focus-within:ring-1 ring-mauve-7 transition-all ${wrapperClass}`}>
        <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-1 block">
          {label}
        </label>
        {control}
      </div>
    );
  }
  return (
    <div>
      <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-1">{label}</p>
      <div className="text-sm font-semibold text-foreground break-words">
        {children || <span className="text-muted-foreground/60">—</span>}
      </div>
    </div>
  );
}

function peopleByRole(o) {
  const byId = new Map();
  const add = (person, role) => {
    if (!person) return;
    const entry = byId.get(person.id);
    if (entry) entry.roles.push(role);
    else byId.set(person.id, { person, roles: [role] });
  };
  add(o.deal_owner, o.project_type === "STRATEGIC" ? "Deal Owner / Originator" : "Deal Owner");
  add(o.closing_sales, "Closing Salesperson");
  add(o.sales_director, "Sales Director");
  add(o.support_1, "Support Sales 1");
  add(o.support_2, "Support Sales 2");
  return [...byId.values()];
}

function PeopleRoster({ opportunity }) {
  const people = peopleByRole(opportunity);
  const isStrategic = opportunity.project_type === "STRATEGIC";
  const missingParticipants = [];
  if (!opportunity.deal_owner) missingParticipants.push(isStrategic ? "Deal Owner / Originator" : "Deal Owner");
  if (isStrategic && !opportunity.closing_sales) missingParticipants.push("Closing Salesperson");
  if (!opportunity.sales_director) missingParticipants.push("Sales Director");

  return (
    <div className="space-y-3">
      {missingParticipants.length > 0 && (
        <div className="rounded-lg bg-amber-500/10 border border-amber-500/20 p-2 text-xs text-amber-700 dark:text-amber-300">
          <p className="font-semibold">Unassigned: {missingParticipants.join(", ")}</p>
          <p className="text-[11px] text-amber-600/80 dark:text-amber-400/80 mt-0.5">
            Unassigned roles leave their commission shares unattributed.
          </p>
        </div>
      )}
      {people.length === 0 ? (
        <p className="text-sm text-muted-foreground/60">No one assigned yet.</p>
      ) : (
        people.map(({ person, roles }) => (
          <div key={person.id} className="flex items-center gap-3">
            <Avatar name={person.name} src={person.avatar_path} size="sm" />
            <div className="min-w-0">
              <p className="text-sm font-semibold text-foreground truncate">{person.name}</p>
              <div className="flex flex-wrap gap-1 mt-0.5">
                {roles.map((role) => (
                  <span key={role} className="text-[10px] font-bold text-muted-foreground bg-muted rounded-full px-1.5 py-0.5">
                    {role}
                  </span>
                ))}
              </div>
            </div>
          </div>
        ))
      )}
    </div>
  );
}

function AutomationTasksRoster({ tasks }) {
  const { individualTasks = [], groupTasks = [] } = tasks || {};
  const hasTasks = individualTasks.length > 0 || groupTasks.length > 0;
  if (!hasTasks) return null;

  return (
    <div className="mt-4 border-t border-border/50 pt-4">
      <p className="mb-3 text-[10px] font-bold tracking-widest text-muted-foreground uppercase">Flow Automations</p>
      <div className="space-y-3">
        {groupTasks.map((task) => (
          <div
            key={task.id}
            onClick={() => window.dispatchEvent(new CustomEvent("OPEN_ENTITY_DETAILS", { detail: { id: task.id, type: "GROUP_TASK" } }))}
            className="rounded-lg border border-border/60 bg-muted/20 p-3 cursor-pointer hover:bg-muted/40 transition-colors"
          >
            <p className="mb-2 text-xs font-semibold text-foreground truncate">{task.title}</p>
            <div className="space-y-2">
              {task.members?.map((m) => (
                <div key={m.id} className="flex items-center gap-2">
                  <Avatar name={m.employee?.name} src={m.employee?.avatar_path} size="xs" />
                  <div className="min-w-0 flex-1">
                    <p className="text-[11px] font-medium text-foreground truncate">
                      {m.employee?.name}
                      <span className="text-muted-foreground ml-1 font-normal">
                        ({m.role || m.custom_role || "Assignee"})
                      </span>
                    </p>
                    {m.task_description && (
                      <p className="text-[10px] text-muted-foreground truncate">{m.task_description.split("\n")[0]}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
        {individualTasks.map((task) => {
          const title = task.task_description ? task.task_description.split("\n")[0] : "Individual Task";
          return (
            <div
              key={task.id}
              onClick={() => window.dispatchEvent(new CustomEvent("OPEN_ENTITY_DETAILS", { detail: { id: task.id, type: "TASK" } }))}
              className="rounded-lg border border-border/60 bg-muted/20 p-3 cursor-pointer hover:bg-muted/40 transition-colors"
            >
              <p className="mb-2 text-xs font-semibold text-foreground truncate" title={title}>
                {title}
              </p>
              <div className="flex items-center gap-2">
                <Avatar name={task.assignee?.name} src={task.assignee?.avatar_path} size="xs" />
                <div className="min-w-0 flex-1">
                  <p className="text-[11px] font-medium text-foreground truncate">{task.assignee?.name}</p>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ItemStockRow({ item, snapshotData }) {
  const [expanded, setExpanded] = useState(false);
  const product = item.odoo_product_id ? snapshotData?.products?.[item.odoo_product_id] || null : null;
  const badge = stockBadge({ quantity: item.quantity, product });
  const warehouses = snapshotData?.warehouses || [];
  const canExpand = !!product && warehouses.length > 0;

  return (
    <div className="col-span-12 -mt-1">
      <button
        type="button"
        onClick={() => canExpand && setExpanded((e) => !e)}
        className={cn("flex items-center gap-1 text-left", canExpand ? "cursor-pointer" : "cursor-default")}
        disabled={!canExpand}
      >
        <StatusBadge label={badge.label} theme={STOCK_BADGE_THEME[badge.kind]} />
        {canExpand && (expanded ? <ChevronDown size={12} className="text-muted-foreground" /> : <ChevronRight size={12} className="text-muted-foreground" />)}
      </button>

      {expanded && canExpand && (
        <div className="mt-2 grid grid-cols-4 gap-2 rounded-lg bg-muted/30 px-3 py-2 text-[11px]">
          <span className="col-span-4 font-bold tracking-widest text-muted-foreground uppercase text-[9px]">By warehouse</span>
          {warehouses.map((w) => {
            const wh = product.byWarehouse?.[w.id];
            return (
              <div key={w.id} className="col-span-4 grid grid-cols-4 gap-2">
                <span className="col-span-1 font-medium text-foreground truncate">{w.name}</span>
                <span className="text-right text-muted-foreground">On hand {wh?.onHand ?? 0}</span>
                <span className="text-right text-muted-foreground">Free {wh?.free ?? 0}</span>
                <span className="text-right text-muted-foreground">Forecast {wh?.forecast ?? 0}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function formatWhen(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}

function ItemsList({ items, isSyncing, stockSnapshot, onRefreshStock, refreshingStock }) {
  if (!items.length && !isSyncing) return null;
  const total = items.reduce((sum, it) => sum + (Number(it.quantity) || 0) * (Number(it.unit_price) || 0), 0);
  return (
    <div className="relative overflow-hidden rounded-2xl border border-border/70 bg-card shadow-xs">
      {isSyncing && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/50 backdrop-blur-sm">
          <Spinner size="md" className="text-primary" />
        </div>
      )}
      <div className="overflow-x-auto">
        <div className="min-w-[560px]">
          <div className="flex items-center justify-between gap-2 border-b border-border/60 bg-muted/20 px-4 py-2 text-[11px]">
            <span className="text-muted-foreground">
              {stockSnapshot?.fetched_at ? `Stock as of ${formatWhen(stockSnapshot.fetched_at)}` : "Stock not yet checked"}
            </span>
            <button
              type="button"
              onClick={onRefreshStock}
              disabled={refreshingStock}
              className="flex items-center gap-1 font-bold text-primary hover:text-primary-hover disabled:opacity-50"
            >
              {refreshingStock ? <Spinner size="sm" /> : <RefreshCw size={12} />}
              Refresh
            </button>
          </div>

          <div className="grid grid-cols-12 gap-3 border-b border-border/60 bg-muted/40 px-4 py-2.5 text-[10px] font-bold tracking-widest text-muted-foreground uppercase">
            <span className="col-span-6">Product & Unit</span>
            <span className="col-span-2 text-right">Quantity</span>
            <span className="col-span-2 text-right">Unit Price</span>
            <span className="col-span-2 text-right">Line Total</span>
          </div>

          <div className="max-h-[420px] divide-y divide-border/50 overflow-y-auto custom-scrollbar">
            {items.map((it) => (
              <div key={it.id} className="grid grid-cols-12 gap-3 items-center px-4 py-3 text-sm transition-colors hover:bg-muted/25">
                <div className="col-span-6 min-w-0 pr-2">
                  <span className="block truncate font-semibold text-foreground">{it.product_name}</span>
                  {it.unit && <span className="inline-block mt-0.5 text-[11px] font-medium text-muted-foreground">Unit: {it.unit}</span>}
                </div>
                <div className="col-span-2 text-right">
                  <span className="inline-block rounded-md bg-mauve-3 px-2 py-0.5 text-[12px] font-semibold tabular-nums text-foreground">
                    {it.quantity} {it.unit ? "" : "qty"}
                  </span>
                </div>
                <span className="col-span-2 text-right font-medium text-muted-foreground tabular-nums">{formatPHP(it.unit_price)}</span>
                <span className="col-span-2 text-right font-bold text-foreground tabular-nums">
                  {formatPHP(Number(it.quantity) * Number(it.unit_price))}
                </span>
                <ItemStockRow item={it} snapshotData={stockSnapshot?.data} />
              </div>
            ))}
          </div>

          <div className="grid grid-cols-12 gap-3 border-t border-border/80 bg-muted/30 px-4 py-3 items-center text-sm">
            <span className="col-span-8 text-right text-[10px] font-bold tracking-widest text-muted-foreground uppercase">Product Line Total</span>
            <span className="col-span-4 text-right text-base font-black text-foreground tabular-nums">{formatPHP(total)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function formatLongDate(dateString) {
  if (!dateString) return "";
  return new Date(dateString).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

/**
 * Now — lifted from the old flat modal body as-is (stage checklist through
 * commission footer). Structural move only, per #298; the redesign into
 * blocking conditions / Stage Fields / task rows / follow-up is #299.
 */
export default function NowTab({ ctx }) {
  const {
    opportunity,
    user,
    isEditing,
    editForm,
    setEditForm,
    employees,
    activeLeadSources,
    requiresInclusions,
    requiresPurchasing,
    automationTasks,
    invalidate,
    handleSaveField,
    isLostPending,
    lostReason,
    setLostReason,
    needsSalesRef,
    salesRef,
    setSalesRef,
    salesRefValid,
    pendingStage,
    stageLabel,
    cancelPendingStage,
    stageMutation,
    estimatedValueDisplay,
    estimatedValueSize,
    buildingLink,
    handlePreviewQuotation,
    handleCopyQuotationLink,
    downloadStep,
    handleDownloadQuotation,
    fetchingOdoo,
    handleFetchFromOdoo,
    items,
    isExpanded,
    autoSyncingOdoo,
    stockSnapshot,
    handleRefreshStock,
    refreshingStock,
  } = ctx;

  return (
    <div className="space-y-7 p-6">
      <StageChecklist
        opportunity={opportunity}
        employees={employees}
        actorId={user?.id}
        onChanged={invalidate}
        onSaveField={handleSaveField}
      />

      {isLostPending && (
        <div className="flex items-end gap-2">
          <div className="flex-1 rounded-xl border border-border bg-muted/30 p-3 focus-within:border-mauve-7">
            <label className="mb-1 block text-[10px] font-bold tracking-widest text-muted-foreground uppercase">Reason for loss</label>
            <input
              autoFocus
              value={lostReason}
              onChange={(e) => setLostReason(e.target.value)}
              placeholder="e.g. Lost to lower bid"
              className="w-full bg-transparent text-sm font-medium text-foreground outline-none"
            />
          </div>
          <button
            disabled={!lostReason.trim() || stageMutation.isPending}
            onClick={() => stageMutation.mutate({ next: pendingStage, reason: lostReason.trim(), salesReference: null })}
            className="h-10 rounded-xl bg-primary px-4 text-[13px] font-bold text-primary-foreground transition-all hover:bg-primary-hover disabled:opacity-50"
          >
            Confirm
          </button>
          <button onClick={cancelPendingStage} className="h-10 rounded-xl px-3 text-[13px] font-bold text-muted-foreground hover:text-foreground">
            Cancel
          </button>
        </div>
      )}

      {needsSalesRef && (
        <div className="rounded-xl border border-amber-400/20 bg-amber-500/5 p-3">
          <div className="flex-1 rounded-xl border border-border bg-muted/30 p-3 focus-within:border-mauve-7">
            <label className="mb-1 block text-[10px] font-bold tracking-widest text-muted-foreground uppercase">
              Sales Reference<span className="ml-0.5 text-red-500">*</span>
            </label>
            <input
              autoFocus
              value={salesRef}
              onChange={(e) => setSalesRef(e.target.value.toUpperCase())}
              placeholder="e.g. S01237"
              className="w-full bg-transparent font-mono text-sm font-medium text-foreground uppercase outline-none"
            />
            <p className={cn("mt-1.5 text-[11px] leading-relaxed", salesRef && !salesRefValid ? "font-semibold text-red-500" : "text-muted-foreground")}>
              {salesRef && !salesRefValid ? SALES_REFERENCE_HINT : "Enter the Odoo sales quotation number to confirm a quotation exists."}
            </p>
          </div>

          <div className="mt-3 flex items-center justify-end gap-2">
            <button onClick={cancelPendingStage} className="h-10 rounded-xl px-3 text-[13px] font-bold text-muted-foreground hover:text-foreground">
              Cancel
            </button>
            <button
              disabled={(needsSalesRef && !salesRefValid) || stageMutation.isPending}
              onClick={() =>
                stageMutation.mutate({
                  next: pendingStage,
                  reason: null,
                  salesReference: needsSalesRef ? normalizeSalesReference(salesRef) : null,
                })
              }
              className="h-10 rounded-xl bg-primary px-4 text-[13px] font-bold text-primary-foreground transition-all hover:bg-primary-hover disabled:opacity-50"
            >
              Confirm {stageLabel(pendingStage) || pendingStage}
            </button>
          </div>
        </div>
      )}

      {opportunity.lost_reason && (
        <div className="rounded-xl border border-red-400/40 bg-red-500/5 px-3 py-2.5">
          <p className="mb-1 text-[10px] font-bold tracking-widest text-red-500 uppercase">Lost Reason</p>
          <p className="text-sm text-foreground">{opportunity.lost_reason}</p>
        </div>
      )}

      {!isEditing && <InclusionsPanel opportunity={opportunity} isRequired={requiresInclusions} />}
      {!isEditing && <PurchasingPanel opportunity={opportunity} isRequired={requiresPurchasing} />}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12 items-start">
        <div className="lg:col-span-4 flex flex-col gap-6">
          <div className="rounded-2xl border border-border/70 bg-card shadow-xs overflow-hidden divide-y divide-border/60">
            <div className="p-5 bg-gradient-to-b from-muted/40 to-transparent">
              <div className="flex items-center justify-between gap-2 mb-2">
                <span className="text-[10px] font-bold tracking-widest text-muted-foreground uppercase">Estimated Value</span>
                {opportunity.status && <StatusBadge status={opportunity.status} />}
              </div>
              {isEditing ? (
                <div>
                  <p className={cn("font-black tracking-tight break-words text-foreground tabular-nums opacity-80", estimatedValueSize)}>
                    {estimatedValueDisplay}
                  </p>
                  <p className="text-[10px] text-muted-foreground/70 mt-1 font-medium italic">Auto-calculated from Product List</p>
                </div>
              ) : (
                <p className={cn("font-black tracking-tight break-words text-foreground tabular-nums", estimatedValueSize)}>{estimatedValueDisplay}</p>
              )}
            </div>

            {!isEditing && opportunity.sales_reference && (
              <div className="p-4 bg-muted/15 space-y-2">
                <div className="flex items-center justify-between text-[11px] font-semibold text-muted-foreground mb-1">
                  <span>Quotation Document</span>
                  <span className="font-mono text-primary">{opportunity.sales_reference}</span>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={buildingLink}
                    onClick={handlePreviewQuotation}
                    className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-border/80 bg-background px-3 py-2 text-[12px] font-semibold text-foreground shadow-xs transition-colors hover:bg-muted disabled:opacity-50"
                  >
                    {buildingLink ? <Spinner size="sm" /> : <ExternalLink size={13} />}
                    <span>Preview Quote</span>
                  </button>
                  <button
                    type="button"
                    disabled={buildingLink}
                    onClick={handleCopyQuotationLink}
                    title="Copy customer quotation link"
                    aria-label="Copy customer quotation link"
                    className="flex items-center justify-center rounded-lg border border-border/80 bg-background px-2.5 text-muted-foreground shadow-xs transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
                  >
                    <Link2 size={13} />
                  </button>
                </div>
                <button
                  type="button"
                  disabled={!!downloadStep}
                  onClick={handleDownloadQuotation}
                  className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-border/80 bg-background px-3 py-2 text-[12px] font-semibold text-foreground shadow-xs transition-colors hover:bg-muted disabled:opacity-50"
                >
                  {downloadStep ? <Spinner size="sm" /> : <FileDown size={13} />}
                  <span>Download Full PDF</span>
                </button>
                {downloadStep && <p className="truncate text-center text-[10.5px] font-medium text-muted-foreground">{downloadStep}</p>}
              </div>
            )}

            <div className="p-5">
              <p className="mb-3 text-[10px] font-bold tracking-widest text-muted-foreground uppercase">Team & Assignees</p>
              {isEditing ? (
                <div className="space-y-3">
                  <Detail
                    label={editForm.project_type === "STRATEGIC" ? "Deal Owner / Originator" : "Deal Owner"}
                    isEditing={isEditing}
                    control={
                      <Dropdown
                        usePortal
                        className="w-full"
                        trigger={() => (
                          <div className="w-full h-full flex items-center justify-between bg-transparent text-sm font-medium outline-none cursor-pointer">
                            <span className={editForm.deal_owner_id ? "text-foreground" : "text-muted-foreground/50"}>
                              {editForm.deal_owner_id ? employees.find((e) => e.id === editForm.deal_owner_id)?.name : "Unassigned"}
                            </span>
                          </div>
                        )}
                      >
                        {({ close }) => (
                          <FilterOptionList
                            options={employees.map((e) => ({ value: e.id, label: e.name }))}
                            value={editForm.deal_owner_id}
                            onChange={(val) => setEditForm((f) => ({ ...f, deal_owner_id: val }))}
                            close={close}
                          />
                        )}
                      </Dropdown>
                    }
                  />
                  {editForm.project_type === "STRATEGIC" && (
                    <Detail
                      label="Closing Salesperson"
                      isEditing={isEditing}
                      control={
                        <Dropdown
                          usePortal
                          className="w-full"
                          trigger={() => (
                            <div className="w-full h-full flex items-center justify-between bg-transparent text-sm font-medium outline-none cursor-pointer">
                              <span className={editForm.closing_sales_id ? "text-foreground" : "text-muted-foreground/50"}>
                                {editForm.closing_sales_id ? employees.find((e) => e.id === editForm.closing_sales_id)?.name : "Unassigned"}
                              </span>
                            </div>
                          )}
                        >
                          {({ close }) => (
                            <FilterOptionList
                              options={employees.map((e) => ({ value: e.id, label: e.name }))}
                              value={editForm.closing_sales_id}
                              onChange={(val) => setEditForm((f) => ({ ...f, closing_sales_id: val }))}
                              close={close}
                            />
                          )}
                        </Dropdown>
                      }
                    />
                  )}
                  <Detail
                    label="Sales Director"
                    isEditing={isEditing}
                    control={
                      <Dropdown
                        usePortal
                        className="w-full"
                        trigger={() => (
                          <div className="w-full h-full flex items-center justify-between bg-transparent text-sm font-medium outline-none cursor-pointer">
                            <span className={editForm.sales_director_id ? "text-foreground" : "text-muted-foreground/50"}>
                              {editForm.sales_director_id ? employees.find((e) => e.id === editForm.sales_director_id)?.name : "Unassigned"}
                            </span>
                          </div>
                        )}
                      >
                        {({ close }) => (
                          <FilterOptionList
                            options={employees.map((e) => ({ value: e.id, label: e.name }))}
                            value={editForm.sales_director_id}
                            onChange={(val) => setEditForm((f) => ({ ...f, sales_director_id: val }))}
                            close={close}
                          />
                        )}
                      </Dropdown>
                    }
                  />
                  <Detail
                    label="Support Sales 1"
                    isEditing={isEditing}
                    control={
                      <Dropdown
                        usePortal
                        className="w-full"
                        trigger={() => (
                          <div className="w-full h-full flex items-center justify-between bg-transparent text-sm font-medium outline-none cursor-pointer">
                            <span className={editForm.support_sales_1_id ? "text-foreground" : "text-muted-foreground/50"}>
                              {editForm.support_sales_1_id ? employees.find((e) => e.id === editForm.support_sales_1_id)?.name : "Unassigned"}
                            </span>
                          </div>
                        )}
                      >
                        {({ close }) => (
                          <FilterOptionList
                            options={employees.map((e) => ({ value: e.id, label: e.name }))}
                            value={editForm.support_sales_1_id}
                            onChange={(val) =>
                              setEditForm((f) => {
                                const next = { ...f, support_sales_1_id: val };
                                next.project_type = deriveProjectType({
                                  supportSales1Id: next.support_sales_1_id,
                                  supportSales2Id: next.support_sales_2_id,
                                  currentProjectType: f.project_type,
                                });
                                return next;
                              })
                            }
                            close={close}
                          />
                        )}
                      </Dropdown>
                    }
                  />
                  <Detail
                    label="Support Sales 2"
                    isEditing={isEditing}
                    control={
                      <Dropdown
                        usePortal
                        className="w-full"
                        trigger={() => (
                          <div className="w-full h-full flex items-center justify-between bg-transparent text-sm font-medium outline-none cursor-pointer">
                            <span className={editForm.support_sales_2_id ? "text-foreground" : "text-muted-foreground/50"}>
                              {editForm.support_sales_2_id ? employees.find((e) => e.id === editForm.support_sales_2_id)?.name : "Unassigned"}
                            </span>
                          </div>
                        )}
                      >
                        {({ close }) => (
                          <FilterOptionList
                            options={employees.map((e) => ({ value: e.id, label: e.name }))}
                            value={editForm.support_sales_2_id}
                            onChange={(val) =>
                              setEditForm((f) => {
                                const next = { ...f, support_sales_2_id: val };
                                next.project_type = deriveProjectType({
                                  supportSales1Id: next.support_sales_1_id,
                                  supportSales2Id: next.support_sales_2_id,
                                  currentProjectType: f.project_type,
                                });
                                return next;
                              })
                            }
                            close={close}
                          />
                        )}
                      </Dropdown>
                    }
                  />
                </div>
              ) : (
                <PeopleRoster opportunity={opportunity} />
              )}
              <AutomationTasksRoster tasks={automationTasks} />
            </div>
          </div>
        </div>

        <div className="lg:col-span-8 flex flex-col gap-6">
          <div className="rounded-2xl border border-border/70 bg-card p-6 shadow-xs">
            <p className="mb-4 text-[10px] font-bold tracking-widest text-muted-foreground uppercase">Deal Details</p>
            <div className={cn("grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-3", isExpanded && "xl:grid-cols-4")}>
              <Detail
                label="Lead Source"
                isEditing={isEditing}
                control={
                  <Dropdown
                    usePortal
                    className="w-full"
                    trigger={() => (
                      <div className="w-full h-full flex items-center justify-between bg-transparent text-sm font-medium outline-none cursor-pointer min-w-0">
                        <span className={`truncate ${editForm.lead_source ? "text-foreground" : "text-muted-foreground/50"}`}>
                          {editForm.lead_source ? activeLeadSources.find((l) => l.value === editForm.lead_source)?.label || editForm.lead_source : "Select..."}
                        </span>
                      </div>
                    )}
                  >
                    {({ close }) => (
                      <FilterOptionList
                        options={activeLeadSources.map((s) => ({ value: s.value, label: s.label }))}
                        value={editForm.lead_source}
                        onChange={(val) => setEditForm((f) => ({ ...f, lead_source: val }))}
                        close={close}
                      />
                    )}
                  </Dropdown>
                }
              >
                {formatLeadSource(opportunity.lead_source, opportunity.lead_source_detail, activeLeadSources)}
              </Detail>

              {editForm.lead_source === "OTHERS" && isEditing && (
                <Detail
                  label="Referral"
                  isEditing={isEditing}
                  control={
                    <input
                      type="text"
                      value={editForm.lead_source_detail}
                      onChange={(e) => setEditForm((f) => ({ ...f, lead_source_detail: e.target.value }))}
                      className="w-full bg-transparent text-sm text-foreground placeholder:text-muted-foreground/50 outline-none font-medium"
                      placeholder="Specify..."
                    />
                  }
                />
              )}

              <Detail
                label="Sales Division"
                isEditing={isEditing}
                control={
                  <div className="w-full flex items-center justify-between gap-2 min-w-0">
                    <span
                      data-testid="project-type-badge-edit"
                      className={`inline-flex items-center text-xs font-semibold px-2 py-0.5 rounded-md border truncate ${
                        editForm.project_type === "STRATEGIC"
                          ? "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20"
                          : editForm.project_type === "CP"
                            ? "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20"
                            : "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20"
                      }`}
                    >
                      {PROJECT_TYPE_LABELS[editForm.project_type] || editForm.project_type}
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        setEditForm((prev) => ({
                          ...prev,
                          project_type:
                            prev.project_type === "STRATEGIC"
                              ? deriveProjectType({ supportSales1Id: prev.support_sales_1_id, supportSales2Id: prev.support_sales_2_id })
                              : "STRATEGIC",
                        }))
                      }
                      className={`text-[11px] font-semibold px-2 py-0.5 rounded-md border transition-colors shrink-0 ${
                        editForm.project_type === "STRATEGIC"
                          ? "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30"
                          : "bg-muted/50 text-muted-foreground hover:text-foreground border-border hover:bg-muted"
                      }`}
                      title="Toggle Strategic project override"
                    >
                      {editForm.project_type === "STRATEGIC" ? "★ Strategic" : "Mark as Strategic"}
                    </button>
                  </div>
                }
              >
                <span className="block truncate" title={PROJECT_TYPE_LABELS[opportunity.project_type]}>
                  {PROJECT_TYPE_LABELS[opportunity.project_type]}
                </span>
              </Detail>

              <Detail
                label="Date Registered"
                isEditing={isEditing}
                control={
                  <Dropdown
                    usePortal
                    placement="bottom-start"
                    className="w-full"
                    trigger={() => (
                      <div className="w-full h-full flex items-center bg-transparent text-sm font-medium outline-none cursor-pointer">
                        <span className={editForm.registration_date ? "text-foreground" : "text-muted-foreground/50"}>
                          {editForm.registration_date || "Select date..."}
                        </span>
                      </div>
                    )}
                  >
                    {({ close }) => (
                      <div className="p-1">
                        <DatePicker
                          selected={editForm.registration_date ? new Date(editForm.registration_date) : null}
                          onChange={(date) => {
                            if (!date) {
                              setEditForm((f) => ({ ...f, registration_date: "" }));
                            } else {
                              const y = date.getFullYear();
                              const m = String(date.getMonth() + 1).padStart(2, "0");
                              const d = String(date.getDate()).padStart(2, "0");
                              setEditForm((f) => ({ ...f, registration_date: `${y}-${m}-${d}` }));
                            }
                            close();
                          }}
                          inline
                        />
                      </div>
                    )}
                  </Dropdown>
                }
              >
                {formatLongDate(opportunity.registration_date)}
              </Detail>

              <Detail
                label="Expected Award Date"
                isEditing={isEditing}
                control={
                  <Dropdown
                    usePortal
                    placement="bottom-start"
                    className="w-full"
                    trigger={() => (
                      <div className="w-full h-full flex items-center bg-transparent text-sm font-medium outline-none cursor-pointer">
                        <span className={editForm.expected_award_date ? "text-foreground" : "text-muted-foreground/50"}>
                          {editForm.expected_award_date || "Select date..."}
                        </span>
                      </div>
                    )}
                  >
                    {({ close }) => (
                      <div className="p-1">
                        <DatePicker
                          selected={editForm.expected_award_date ? new Date(editForm.expected_award_date) : null}
                          onChange={(date) => {
                            if (!date) {
                              setEditForm((f) => ({ ...f, expected_award_date: "" }));
                            } else {
                              const y = date.getFullYear();
                              const m = String(date.getMonth() + 1).padStart(2, "0");
                              const d = String(date.getDate()).padStart(2, "0");
                              setEditForm((f) => ({ ...f, expected_award_date: `${y}-${m}-${d}` }));
                            }
                            close();
                          }}
                          inline
                        />
                      </div>
                    )}
                  </Dropdown>
                }
              >
                {formatLongDate(opportunity.expected_award_date)}
              </Detail>

              <Detail
                label="Contact Person"
                isEditing={isEditing}
                control={
                  <input
                    type="text"
                    required
                    value={editForm.contact_person}
                    onChange={(e) => setEditForm((f) => ({ ...f, contact_person: e.target.value }))}
                    className="w-full bg-transparent text-sm text-foreground placeholder:text-muted-foreground/50 outline-none font-medium"
                    placeholder="e.g. Juan Dela Cruz"
                  />
                }
              >
                {opportunity.contact_person}
              </Detail>

              {isEditing ? (
                <div className="flex gap-2 items-stretch col-span-1 sm:col-span-2 md:col-span-1 lg:col-span-2 xl:col-span-1 2xl:col-span-2">
                  <Detail
                    label="Sales Reference"
                    isEditing={true}
                    wrapperClass="flex-1"
                    control={
                      <input
                        type="text"
                        value={editForm.sales_reference}
                        onChange={(e) => setEditForm((f) => ({ ...f, sales_reference: e.target.value.toUpperCase() }))}
                        className="w-full bg-transparent text-sm font-mono text-foreground placeholder:text-muted-foreground/50 outline-none font-medium uppercase"
                        placeholder="e.g. S01237"
                      />
                    }
                  />
                  <button
                    type="button"
                    disabled={fetchingOdoo || !editForm.sales_reference}
                    onClick={handleFetchFromOdoo}
                    className="h-full min-h-[66px] px-4 rounded-xl border border-border flex items-center gap-2 text-[13px] font-bold text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-all shrink-0"
                  >
                    {fetchingOdoo ? <Spinner size="sm" /> : <Download size={16} />}
                    <span className="hidden sm:inline">Fetch Items</span>
                  </button>
                </div>
              ) : (
                <Detail label="Sales Reference">
                  {opportunity.sales_reference ? (
                    <span className="font-mono text-primary font-bold">{opportunity.sales_reference}</span>
                  ) : opportunity.status === "LEAD" ? (
                    <span className="text-xs font-medium text-amber-11">Required to qualify</span>
                  ) : null}
                </Detail>
              )}

              {itbGateSatisfiedBy(opportunity) && (
                <Detail label="ITB Number (Invitation to Bid)">
                  {opportunity.itb_number || <span className="text-xs font-bold text-amber-11">{ITB_EXEMPT_LABEL}</span>}
                </Detail>
              )}
            </div>
          </div>
        </div>
      </div>

      {(items.length > 0 || isEditing || autoSyncingOdoo) && (
        <div className="space-y-3">
          {isEditing ? (
            <div className="rounded-2xl border border-border/70 bg-card p-6 shadow-xs">
              <OpportunityItemsEditor items={editForm.items || []} onChange={(newItems) => setEditForm((f) => ({ ...f, items: newItems }))} />
            </div>
          ) : (
            <div>
              <div className="flex items-center justify-between gap-2 mb-3">
                <p className="text-[10px] font-bold tracking-widest text-muted-foreground uppercase">Product List</p>
                <span className="text-[11px] font-semibold text-muted-foreground tabular-nums">
                  {items.length} item{items.length === 1 ? "" : "s"}
                </span>
              </div>
              <ItemsList
                items={items}
                isSyncing={autoSyncingOdoo || fetchingOdoo}
                stockSnapshot={stockSnapshot}
                onRefreshStock={handleRefreshStock}
                refreshingStock={refreshingStock}
              />
            </div>
          )}
        </div>
      )}

      {!isEditing && <OpportunityCommissionFooter opportunity={opportunity} onClose={ctx.onClose} />}
    </div>
  );
}
