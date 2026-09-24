import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { ChevronDown, Download, ListChecks, Pencil, Plus, RefreshCw, Trash2, X } from "lucide-react";

import { cn } from "@/lib/utils";
import Dropdown from "../ui/Dropdown";
import { FilterOptionList } from "../ui/FilterDropdown";
import { confirmDeleteToast } from "../ui/CustomToast";
import { useAuth } from "../../context/AuthContext";
import { projectEvaluationService } from "../../services/projectEvaluationService";
import { odooService } from "../../services/odooService";
import CanvassPanel, { CanvassTriggerButton } from "../CanvassPanel";
import {
  COMPLETENESS,
  COMPLETENESS_LABELS,
  COMPLETENESS_VALUES,
  COST_SOURCE_LABELS,
  SOURCING_LABELS,
  SOURCING_VALUES,
  costAgeDays,
  summariseCompleteness,
} from "../../constants/projectEvaluation";
import { REQUEST_UNITS } from "../../constants/procurement";
import { Button } from "../ui/button";
import { Input } from "@/components/ui/input";
import { SelectField } from "@/components/ui/SelectField";

/**
 * Inclusions (issue #43) — the client's specification, broken out.
 *
 * Odoo bundles: an Ambulance Commuter is one order line whose inclusions live
 * as free text in the description. This panel is the only place the spec can be
 * walked item by item and each condition confirmed, which is what an
 * apple-to-apple comparison against a tender demands and what the team
 * currently rebuilds in a spreadsheet on every deal.
 *
 * The arithmetic is constants/projectEvaluation.js. Nothing here recomputes it.
 */

const COMPLETENESS_TONE = {
  [COMPLETENESS.COVERED]: "bg-green-a3 text-green-11",
  [COMPLETENESS.MISSING]: "bg-amber-a3 text-amber-11",
  [COMPLETENESS.SUBSTITUTED]: "bg-violet-a3 text-violet-11",
  [COMPLETENESS.NOT_REQUIRED]: "bg-mauve-a3 text-mauve-11",
};

const asOptions = (values, labels) =>
  values.map((value) => ({ value, label: labels[value] }));

const COMPLETENESS_OPTIONS = asOptions(COMPLETENESS_VALUES, COMPLETENESS_LABELS);
const SOURCING_OPTIONS = [
  { value: "", label: "Not assessed" },
  ...asOptions(SOURCING_VALUES, SOURCING_LABELS),
];

/** A small dropdown that reads as a pill until you click it. */
function PillSelect({ label, tone, options, value, onChange, disabled }) {
  return (
    <Dropdown
      usePortal
      placement="bottom-end"
      disabled={disabled}
      popoverClassName="popover-enter z-[10001] w-56 rounded-xl bg-popover p-1 shadow-2xl ring-1 ring-mauve-6"
      trigger={() => (
        <span
          className={cn(
            "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider whitespace-nowrap",
            tone,
            disabled ? "opacity-70" : "cursor-pointer hover:brightness-110",
          )}
        >
          {label}
          {!disabled && <ChevronDown size={10} />}
        </span>
      )}
    >
      {({ close }) => (
        <FilterOptionList
          options={options}
          value={value ?? ""}
          onChange={onChange}
          close={close}
        />
      )}
    </Dropdown>
  );
}

/** Cost basis, or an honest "not costed yet" — never a bare 0. */
function CostLine({ inclusion }) {
  if (inclusion.cost_amount === null || inclusion.cost_amount === undefined) {
    return <span className="text-muted-foreground/70">No cost yet</span>;
  }

  const age = costAgeDays(inclusion.cost_established_at);
  const ageLabel = age === null ? "" : age === 0 ? "today" : age === 1 ? "1 day ago" : `${age} days ago`;

  return (
    <span>
      ₱{Number(inclusion.cost_amount).toLocaleString()}
      <span className="text-muted-foreground/70">
        {" "}
        · {COST_SOURCE_LABELS[inclusion.cost_source] || inclusion.cost_source}
        {ageLabel && ` · ${ageLabel}`}
      </span>
    </span>
  );
}

function InclusionRow({
  inclusion,
  canEdit,
  canEditCanvass,
  userId,
  onPatch,
  onRemove,
  onRefreshCost,
  onSetManualCost,
  isPending,
}) {
  const completeness = inclusion.completeness;
  const [isCanvassOpen, setIsCanvassOpen] = useState(false);
  const [isEditingCost, setIsEditingCost] = useState(false);
  const [manualAmount, setManualAmount] = useState("");

  const submitManualCost = (e) => {
    e.preventDefault();
    if (manualAmount === "") return;
    onSetManualCost(inclusion.id, Number(manualAmount));
    setIsEditingCost(false);
    setManualAmount("");
  };

  return (
    <div className="group flex items-start gap-3 rounded-xl border border-border/60 bg-card px-3 py-2.5 transition-colors hover:border-mauve-8">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold leading-snug text-foreground">
          {inclusion.description}
        </p>
        <p className="mt-0.5 text-[11px] font-medium text-muted-foreground">
          {Number(inclusion.quantity)} {inclusion.unit || "unit"}
          {inclusion.note ? ` · ${inclusion.note}` : ""}
        </p>

        {isEditingCost ? (
          <form onSubmit={submitManualCost} className="mt-1 flex items-center gap-1.5">
            <Input
              autoFocus
              type="number"
              min="0"
              step="any"
              value={manualAmount}
              onChange={(e) => setManualAmount(e.target.value)}
              placeholder="Manual cost"
              containerClassName="w-28" className="h-auto rounded-md border border-border bg-card px-2 py-0.5 text-[12px] font-semibold text-foreground outline-none focus:border-mauve-8"
            />
            <Button type="submit" variant="link" className="h-auto p-0 text-[11px]">
              Save
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setIsEditingCost(false)}
              className="h-auto p-0 text-[11px] font-semibold text-muted-foreground hover:bg-transparent hover:text-foreground"
            >
              Cancel
            </Button>
          </form>
        ) : (
          <p className="mt-1 flex items-center gap-1.5 text-[11px] font-semibold text-foreground">
            <CostLine inclusion={inclusion} />
            {canEditCanvass && (
              <>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  onClick={() => onRefreshCost(inclusion.id)}
                  title="Refresh cost"
                  className="h-auto w-auto p-0.5 text-muted-foreground opacity-0 hover:bg-transparent hover:text-foreground group-hover:opacity-100"
                >
                  <RefreshCw size={11} />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  onClick={() => setIsEditingCost(true)}
                  title="Set manual cost"
                  className="h-auto w-auto p-0.5 text-muted-foreground opacity-0 hover:bg-transparent hover:text-foreground group-hover:opacity-100"
                >
                  <Pencil size={11} />
                </Button>
              </>
            )}
          </p>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-1.5 pt-0.5">
        <CanvassTriggerButton onClick={() => setIsCanvassOpen(true)} />
        {isCanvassOpen && (
          <CanvassPanel
            open={isCanvassOpen}
            onOpenChange={setIsCanvassOpen}
            subject={{ inclusionId: inclusion.id }}
            subjectLabel={inclusion.description}
            userId={userId}
            canEdit={canEditCanvass}
          />
        )}

        <PillSelect
          label={COMPLETENESS_LABELS[completeness] || completeness}
          tone={COMPLETENESS_TONE[completeness] || COMPLETENESS_TONE[COMPLETENESS.MISSING]}
          options={COMPLETENESS_OPTIONS}
          value={completeness}
          disabled={!canEdit || isPending}
          onChange={(next) => onPatch(inclusion.id, { completeness: next })}
        />

        <PillSelect
          label={SOURCING_LABELS[inclusion.sourcing] || "Not assessed"}
          tone="bg-mauve-a3 text-mauve-11"
          options={SOURCING_OPTIONS}
          value={inclusion.sourcing ?? ""}
          disabled={!canEdit || isPending}
          onChange={(next) => onPatch(inclusion.id, { sourcing: next || null })}
        />

        {canEdit && (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={() => onRemove(inclusion)}
            disabled={isPending}
            aria-label={`Remove ${inclusion.description}`}
            className="text-muted-foreground opacity-0 hover:bg-red-a3 hover:text-red-11 group-hover:opacity-100 focus-visible:opacity-100"
          >
            <Trash2 size={13} />
          </Button>
        )}
      </div>
    </div>
  );
}

function Composer({ onAdd, onCancel, isPending }) {
  const [description, setDescription] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [unit, setUnit] = useState("unit");

  const submit = (e) => {
    e.preventDefault();
    if (!description.trim()) return;
    onAdd({ description, quantity, unit });
    setDescription("");
    setQuantity(1);
  };

  return (
    <form
      onSubmit={submit}
      className="flex items-center gap-2 rounded-xl border border-dashed border-mauve-7 bg-muted/30 px-3 py-2"
    >
      <Input
        autoFocus
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="What the client asked for…"
        containerClassName="min-w-0 flex-1" className="border-0 bg-transparent rounded-none px-0 py-0 shadow-none focus-visible:ring-0 h-auto bg-transparent text-sm font-medium text-foreground outline-none placeholder:text-muted-foreground"
      />
      <Input
        type="number"
        min="0"
        step="any"
        value={quantity}
        onChange={(e) => setQuantity(e.target.value)}
        aria-label="Quantity"
        containerClassName="w-16" className="h-auto rounded-md border border-border bg-card px-2 py-1 text-right text-[13px] font-semibold tabular-nums text-foreground outline-none focus:border-mauve-4"
      />
      <SelectField
        value={unit}
        onChange={setUnit}
        aria-label="Unit"
        options={REQUEST_UNITS.map((u) => ({ value: u, label: u }))}
      />

      <Button
        type="submit"
        disabled={!description.trim() || isPending}
        className="px-3 py-1.5 text-[12px]"
      >
        Add
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        onClick={onCancel}
        aria-label="Close"
        className="text-muted-foreground"
      >
        <X size={14} />
      </Button>
    </form>
  );
}

/**
 * One imported-but-unsaved row (issue #44). Lives only in this component's
 * state until Save — nothing here has touched sor_inclusions yet, so editing
 * or discarding a draft is a plain state update, no mutation, no confirm.
 */
function DraftRow({ draft, onChange, onDiscard, isPending }) {
  return (
    <div className="flex items-center gap-2 rounded-xl border border-dashed border-violet-7 bg-violet-a2 px-3 py-2">
      <Input
        value={draft.description}
        onChange={(e) => onChange({ description: e.target.value })}
        aria-label="Imported description"
        containerClassName="min-w-0 flex-1" className="border-0 bg-transparent rounded-none px-0 py-0 shadow-none focus-visible:ring-0 h-auto bg-transparent text-sm font-medium text-foreground outline-none"
      />
      <Input
        type="number"
        min="0"
        step="any"
        value={draft.quantity}
        onChange={(e) => onChange({ quantity: e.target.value })}
        aria-label="Imported quantity"
        containerClassName="w-16" className="h-auto rounded-md border border-border bg-card px-2 py-1 text-right text-[13px] font-semibold tabular-nums text-foreground outline-none focus:border-mauve-4"
      />
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        onClick={onDiscard}
        disabled={isPending}
        aria-label={`Discard ${draft.description}`}
        className="text-muted-foreground hover:bg-red-a3 hover:text-red-11"
      >
        <X size={14} />
      </Button>
    </div>
  );
}

export default function InclusionsPanel({ opportunity, isRequired = false }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [isComposing, setIsComposing] = useState(false);
  const [isFolded, setIsFolded] = useState(false);
  const [drafts, setDrafts] = useState([]);
  const [isImporting, setIsImporting] = useState(false);

  const opportunityId = opportunity?.id;
  const salesReference = opportunity?.sales_reference;

  const { data: inclusions = [] } = useQuery({
    queryKey: ["inclusions", opportunityId],
    queryFn: () => projectEvaluationService.listInclusions(opportunityId),
    enabled: Boolean(opportunityId),
  });

  // Mirrors sor_can_edit_opportunity (0003), which is what the database will
  // actually enforce. Kept in step deliberately: a UI that offers a control RLS
  // then refuses produces a write of zero rows and no error, which is the
  // worst way for a permission problem to present.
  const canEdit =
    !!user &&
    (user.isSuperAdmin ||
      user.is_super_admin ||
      user.isHead ||
      user.is_head ||
      [
        opportunity?.registered_by,
        opportunity?.deal_owner_id,
        opportunity?.support_sales_1_id,
        opportunity?.support_sales_2_id,
        opportunity?.sales_director_id,
      ].includes(user.id));

  // Mirrors sor_canvasses_write (0059): canvassing is purchasing's job
  // regardless of which subject a Canvass hangs off, independent of whether
  // this viewer is also one of the SOR's sales participants above.
  const canEditCanvass =
    !!user &&
    (user.has_purchasing_flow ||
      user.hasPurchasingFlow ||
      user.is_head ||
      user.isHead ||
      user.is_super_admin ||
      user.isSuperAdmin);

  // Issue #48: the Project Evaluation's base cost and margin roll up from
  // Inclusions, so any write here has to refresh that panel's cache too, or
  // the margin figure sits stale until something else happens to invalidate
  // it — the same class of gap found and fixed in CanvassPanel for #47.
  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["inclusions", opportunityId] });
    queryClient.invalidateQueries({ queryKey: ["projectEvaluation", opportunityId] });
  };

  const addMutation = useMutation({
    mutationFn: (entry) =>
      projectEvaluationService.addInclusion({ opportunityId, ...entry }, user?.id),
    onSuccess: invalidate,
    onError: (err) => toast.error(err.message),
  });

  const patchMutation = useMutation({
    mutationFn: ({ id, patch }) =>
      projectEvaluationService.updateInclusion(id, patch),
    onSuccess: invalidate,
    onError: (err) => {
      toast.error(err.message);
      invalidate();
    },
  });

  const removeMutation = useMutation({
    mutationFn: (id) => projectEvaluationService.removeInclusion(id),
    onSuccess: () => {
      invalidate();
      toast.success("Inclusion removed.");
    },
    onError: (err) => toast.error(err.message),
  });

  const refreshCostMutation = useMutation({
    mutationFn: (id) => projectEvaluationService.refreshInclusionCost(id),
    onSuccess: invalidate,
    onError: (err) => toast.error(err.message),
  });

  const setManualCostMutation = useMutation({
    mutationFn: ({ id, amount }) =>
      projectEvaluationService.refreshInclusionCost(id, { manualAmount: amount }),
    onSuccess: invalidate,
    onError: (err) => toast.error(err.message),
  });

  const saveDraftsMutation = useMutation({
    mutationFn: () =>
      projectEvaluationService.addInclusions(
        opportunityId,
        drafts.map(({ localId: _localId, ...entry }) => entry),
        user?.id,
      ),
    onSuccess: (saved) => {
      invalidate();
      setDrafts([]);
      toast.success(`Saved ${saved.length} imported inclusion(s).`);
    },
    onError: (err) => toast.error(err.message),
  });

  // Issue #44: the client's spec on a bundled Odoo order lives as free text
  // inside the order line's description — a separate field from the product
  // name the Product List already maps, so importing here never touches
  // that mapping or its consumers.
  const handleImport = async () => {
    if (!salesReference) return;
    setIsImporting(true);
    try {
      const result = await odooService.fetchOrderLines(salesReference);
      if (!result?.success) {
        toast.error(result?.message || "Could not fetch items from Odoo.");
        return;
      }

      const alreadyHave = new Set(
        [...inclusions.map((i) => i.description), ...drafts.map((d) => d.description)].map((d) =>
          d.trim().toLowerCase(),
        ),
      );

      const candidates = (result.items || [])
        .map((item) => ({
          description: (item.description || item.product_name || "").trim(),
          quantity: item.quantity || 1,
          unit: item.unit || "",
        }))
        .filter((c) => c.description);

      const fresh = candidates.filter((c) => !alreadyHave.has(c.description.toLowerCase()));

      if (candidates.length === 0) {
        toast.error("That quotation has no line description to import.");
        return;
      }
      if (fresh.length === 0) {
        toast.success("Already imported — nothing new to add.");
        return;
      }

      setDrafts((prev) => [
        ...prev,
        ...fresh.map((entry, i) => ({ ...entry, localId: `${Date.now()}-${i}` })),
      ]);
      toast.success(`Imported ${fresh.length} line(s) — review before saving.`);
    } catch (err) {
      toast.error(err.message || "Could not reach Odoo — try again.");
    } finally {
      setIsImporting(false);
    }
  };

  const summary = summariseCompleteness(inclusions);
  const isPending = patchMutation.isPending || removeMutation.isPending;

  if (!opportunity) return null;
  if (!isRequired && inclusions.length === 0) return null;

  return (
    <div className="rounded-xl border border-border/50 p-6 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <Button
          type="button"
          variant="ghost"
          onClick={() => setIsFolded(!isFolded)}
          className="h-auto gap-1.5 p-0 text-[11px] font-bold uppercase tracking-wider text-muted-foreground hover:bg-transparent hover:text-foreground"
        >
          <ChevronDown
            size={12}
            className={cn("transition-transform duration-150", isFolded && "-rotate-90")}
          />
          Inclusions
        </Button>

        {canEdit && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleImport}
            disabled={!salesReference || isImporting}
            title={
              salesReference
                ? "Import the order line description(s) from Odoo"
                : "Bind a Sales Reference first to import from Odoo"
            }
            className="gap-1.5 text-[11px] text-muted-foreground hover:border-primary hover:text-primary"
          >
            <Download size={12} />
            {isImporting ? "Importing…" : "Import from Odoo"}
          </Button>
        )}

        {/* An untouched breakdown has no percentage, deliberately — "0%" would
            tell a salesperson their spec is failing when nobody has looked. */}
        {summary.percent !== null && (
          <div className="flex items-center gap-2">
            {summary.substituted > 0 && (
              <span className="text-[10px] font-bold uppercase tracking-wider text-violet-11">
                {summary.substituted} substituted
              </span>
            )}
            <span
              className={cn(
                "text-[11px] font-bold tabular-nums",
                summary.isComplete ? "text-green-11" : "text-amber-11",
              )}
            >
              {summary.answered}/{summary.counted} answered
            </span>
            <div className="h-1.5 w-20 overflow-hidden rounded-full bg-mauve-a4">
              <div
                className={cn(
                  "h-full rounded-full transition-all duration-300",
                  summary.isComplete ? "bg-green-9" : "bg-amber-9",
                )}
                style={{ width: `${summary.percent}%` }}
              />
            </div>
          </div>
        )}
      </div>

      {!isFolded && (
        <>
          {canEdit && !salesReference && (
            <p className="text-[11px] font-medium text-muted-foreground">
              Bind a Sales Reference to this SOR to import Inclusions from Odoo.
            </p>
          )}

          {drafts.length > 0 && (
            <div className="space-y-1.5">
              {drafts.map((draft) => (
                <DraftRow
                  key={draft.localId}
                  draft={draft}
                  isPending={saveDraftsMutation.isPending}
                  onChange={(patch) =>
                    setDrafts((prev) =>
                      prev.map((d) => (d.localId === draft.localId ? { ...d, ...patch } : d)),
                    )
                  }
                  onDiscard={() =>
                    setDrafts((prev) => prev.filter((d) => d.localId !== draft.localId))
                  }
                />
              ))}
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  onClick={() => saveDraftsMutation.mutate()}
                  disabled={saveDraftsMutation.isPending}
                  className="px-3 py-1.5 text-[12px]"
                >
                  Save imported ({drafts.length})
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setDrafts([])}
                  disabled={saveDraftsMutation.isPending}
                  className="h-auto p-0 text-[11px] font-semibold text-muted-foreground hover:bg-transparent hover:text-foreground"
                >
                  Discard all
                </Button>
              </div>
            </div>
          )}

          {inclusions.length > 0 && (
            <div className="space-y-1.5">
              {inclusions.map((inclusion) => (
                <InclusionRow
                  key={inclusion.id}
                  inclusion={inclusion}
                  canEdit={canEdit}
                  canEditCanvass={canEditCanvass}
                  userId={user?.id}
                  isPending={isPending}
                  onPatch={(id, patch) => patchMutation.mutate({ id, patch })}
                  onRefreshCost={(id) => refreshCostMutation.mutate(id)}
                  onSetManualCost={(id, amount) => setManualCostMutation.mutate({ id, amount })}
                  onRemove={(row) =>
                    confirmDeleteToast(
                      "Remove this inclusion?",
                      `"${row.description}" comes off the client's breakdown.`,
                      () => removeMutation.mutate(row.id),
                    )
                  }
                />
              ))}
            </div>
          )}

          {inclusions.length === 0 && !isComposing && (
            <div className="rounded-xl border border-dashed border-mauve-7 px-4 py-6 text-center">
              <ListChecks size={20} className="mx-auto mb-2 text-muted-foreground/60" />
              <p className="text-[13px] font-semibold text-foreground">
                No breakdown yet
              </p>
              <p className="mx-auto mt-1 max-w-md text-[11px] leading-relaxed text-muted-foreground">
                Odoo bundles this into one order line. Enter the client&apos;s spec
                sheet here to check each condition is answered.
              </p>
            </div>
          )}

          {isComposing && canEdit && (
            <Composer
              onAdd={(entry) => addMutation.mutate(entry)}
              onCancel={() => setIsComposing(false)}
              isPending={addMutation.isPending}
            />
          )}

          {canEdit && !isComposing && (
            <Button
              type="button"
              variant="outline"
              onClick={() => setIsComposing(true)}
              className="h-auto w-full gap-1.5 rounded-xl border-dashed py-2 text-[12px] text-muted-foreground hover:border-primary hover:bg-primary/5 hover:text-primary"
            >
              <Plus size={14} /> Add Inclusion
            </Button>
          )}
        </>
      )}
    </div>
  );
}
