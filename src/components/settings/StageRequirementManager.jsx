import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, ListTodo, ArrowUp, ArrowDown, Archive } from "lucide-react";
import toast from "react-hot-toast";

import { pipelineStageService } from "../../services/pipelineStageService";
import { stageRequirementService } from "../../services/stageRequirementService";
import { REQUIREMENT_KINDS } from "../../constants/stageGate";
import { useAuth } from "../../context/AuthContext";

const KIND_LABELS = {
  [REQUIREMENT_KINDS.ATTACHMENT]: "Attachment",
  [REQUIREMENT_KINDS.FIELD]: "Field on record",
  [REQUIREMENT_KINDS.TICKBOX]: "Self-certified",
  [REQUIREMENT_KINDS.ASSIGNMENT]: "Assignment",
  [REQUIREMENT_KINDS.DEADLINE]: "Deadline",
};

const emptyConfigFor = (kind) => {
  switch (kind) {
    case REQUIREMENT_KINDS.ATTACHMENT:
      return { documentType: "" };
    case REQUIREMENT_KINDS.FIELD:
      return { column: "" };
    case REQUIREMENT_KINDS.ASSIGNMENT:
      return { department: "" };
    case REQUIREMENT_KINDS.DEADLINE:
      return { days: "" };
    default:
      return {};
  }
};

/** Strips the config down to what the chosen kind actually reads, and blanks to null. */
function configFor(kind, config) {
  switch (kind) {
    case REQUIREMENT_KINDS.ATTACHMENT:
      return config.documentType?.trim() ? { documentType: config.documentType.trim() } : {};
    case REQUIREMENT_KINDS.FIELD:
      return { column: config.column?.trim() || "" };
    case REQUIREMENT_KINDS.ASSIGNMENT:
      return { department: config.department?.trim() || "" };
    case REQUIREMENT_KINDS.DEADLINE:
      return { days: Number(config.days) || 0 };
    default:
      return {};
  }
}

/**
 * Stage Gate Engine configuration (docs/stage-gate-engine-spec.md, ticket 4
 * of .scratch/stage-gate-engine/issues/) — a Super Admin picks a Stage and
 * manages its requirements: add, reorder, archive. Wired to
 * stageRequirementService only, the same "no direct table access from the
 * UI" rule PipelineStageManager already follows for its own table.
 */
export default function StageRequirementManager() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [selectedStageCode, setSelectedStageCode] = useState("");
  const [isAdding, setIsAdding] = useState(false);
  const [kind, setKind] = useState(REQUIREMENT_KINDS.FIELD);
  const [label, setLabel] = useState("");
  const [isRequired, setIsRequired] = useState(true);
  const [config, setConfig] = useState(emptyConfigFor(REQUIREMENT_KINDS.FIELD));

  const { data: stages } = useQuery({
    queryKey: ["pipelineStages", "all"],
    queryFn: () => pipelineStageService.getAllStages(),
  });

  // Falls back to the first Stage until the admin picks one explicitly —
  // derived on render rather than synced via an effect, so there's no
  // moment where the picker and the fetched requirements disagree.
  const effectiveStageCode = selectedStageCode || stages?.[0]?.code || "";

  const { data: requirements, isLoading } = useQuery({
    queryKey: ["stageRequirements", effectiveStageCode],
    queryFn: () => stageRequirementService.getForStage(effectiveStageCode),
    enabled: Boolean(effectiveStageCode),
  });

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["stageRequirements", effectiveStageCode] });

  const addMutation = useMutation({
    mutationFn: (payload) => stageRequirementService.add(payload, user?.id),
    onSuccess: () => {
      invalidate();
      toast.success("Requirement added.");
      setLabel("");
      setIsRequired(true);
      setKind(REQUIREMENT_KINDS.FIELD);
      setConfig(emptyConfigFor(REQUIREMENT_KINDS.FIELD));
      setIsAdding(false);
    },
    onError: (err) => toast.error(err.message),
  });

  const reorderMutation = useMutation({
    mutationFn: (updates) => stageRequirementService.reorder(updates, user?.id),
    onSuccess: invalidate,
    onError: (err) => {
      toast.error(err.message);
      invalidate();
    },
  });

  const archiveMutation = useMutation({
    mutationFn: (id) => stageRequirementService.archive(id, user?.id),
    onSuccess: () => {
      invalidate();
      toast.success("Requirement archived.");
    },
    onError: (err) => toast.error(err.message),
  });

  const handleKindChange = (nextKind) => {
    setKind(nextKind);
    setConfig(emptyConfigFor(nextKind));
  };

  const handleAdd = (e) => {
    e.preventDefault();
    if (!label.trim() || !effectiveStageCode) return;

    addMutation.mutate({
      stageCode: effectiveStageCode,
      kind,
      label,
      isRequired,
      config: configFor(kind, config),
    });
  };

  const moveRequirement = (index, direction) => {
    if (!requirements) return;
    const newIndex = direction === "up" ? index - 1 : index + 1;
    if (newIndex < 0 || newIndex >= requirements.length) return;

    const a = requirements[index];
    const b = requirements[newIndex];
    reorderMutation.mutate([
      { id: a.id, sortOrder: b.sort_order },
      { id: b.id, sortOrder: a.sort_order },
    ]);
  };

  const handleArchive = (requirement) => {
    if (
      !window.confirm(
        `Archive "${requirement.label}"? This is the only way to remove it — it stops blocking future moves, but a deal that already satisfied it keeps that record.`,
      )
    ) {
      return;
    }
    archiveMutation.mutate(requirement.id);
  };

  return (
    <div className="bg-card border border-border rounded-2xl shadow-sm overflow-hidden">
      <div className="px-5 py-4 border-b border-border bg-muted/30 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2.5">
          <div className="w-6 h-6 rounded-lg bg-muted flex items-center justify-center">
            <ListTodo size={14} className="text-foreground" />
          </div>
          <h2 className="text-[10px] font-black text-muted-foreground uppercase tracking-[0.2em]">
            Stage Requirements
          </h2>
        </div>
        {!isAdding && effectiveStageCode && (
          <button
            onClick={() => setIsAdding(true)}
            className="text-xs font-bold text-foreground flex items-center gap-1 hover:bg-muted px-2.5 py-1.5 rounded-lg transition-colors"
          >
            <Plus size={14} /> Add Requirement
          </button>
        )}
      </div>

      <div className="p-5">
        <div className="mb-4 space-y-1">
          <label className="text-xs font-bold text-muted-foreground">Stage</label>
          <select
            value={effectiveStageCode}
            onChange={(e) => setSelectedStageCode(e.target.value)}
            className="w-full h-10 rounded-lg border border-border bg-card px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
          >
            {stages?.map((stage) => (
              <option key={stage.code} value={stage.code}>
                {stage.label}
              </option>
            ))}
          </select>
        </div>

        {isAdding && (
          <form
            onSubmit={handleAdd}
            className="flex flex-col gap-3 mb-6 p-4 rounded-xl border border-border bg-muted/20"
          >
            <div className="space-y-1">
              <label className="text-xs font-bold text-muted-foreground">Label</label>
              <input
                type="text"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="e.g. Notice of Award attached"
                className="w-full h-9 rounded-lg border border-border bg-card px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                required
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs font-bold text-muted-foreground">Kind</label>
              <select
                value={kind}
                onChange={(e) => handleKindChange(e.target.value)}
                className="w-full h-9 rounded-lg border border-border bg-card px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              >
                {Object.values(REQUIREMENT_KINDS).map((k) => (
                  <option key={k} value={k}>
                    {KIND_LABELS[k]}
                  </option>
                ))}
              </select>
            </div>

            {kind === REQUIREMENT_KINDS.ATTACHMENT && (
              <div className="space-y-1">
                <label className="text-xs font-bold text-muted-foreground">
                  Document type (optional — any attachment satisfies it if left blank)
                </label>
                <input
                  type="text"
                  value={config.documentType || ""}
                  onChange={(e) => setConfig({ documentType: e.target.value })}
                  placeholder="e.g. Notice of Award"
                  className="w-full h-9 rounded-lg border border-border bg-card px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                />
              </div>
            )}

            {kind === REQUIREMENT_KINDS.FIELD && (
              <div className="space-y-1">
                <label className="text-xs font-bold text-muted-foreground">
                  Column name (e.g. po_date)
                </label>
                <input
                  type="text"
                  value={config.column || ""}
                  onChange={(e) => setConfig({ column: e.target.value })}
                  placeholder="po_date"
                  className="w-full h-9 rounded-lg border border-border bg-card px-3 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/50"
                  required
                />
              </div>
            )}

            {kind === REQUIREMENT_KINDS.ASSIGNMENT && (
              <div className="space-y-1">
                <label className="text-xs font-bold text-muted-foreground">Department</label>
                <input
                  type="text"
                  value={config.department || ""}
                  onChange={(e) => setConfig({ department: e.target.value })}
                  placeholder="e.g. Purchasing"
                  className="w-full h-9 rounded-lg border border-border bg-card px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                  required
                />
              </div>
            )}

            {kind === REQUIREMENT_KINDS.DEADLINE && (
              <div className="space-y-1">
                <label className="text-xs font-bold text-muted-foreground">Days from Stage entry</label>
                <input
                  type="number"
                  min="1"
                  value={config.days || ""}
                  onChange={(e) => setConfig({ days: e.target.value })}
                  placeholder="e.g. 10"
                  className="w-28 h-9 rounded-lg border border-border bg-card px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                  required
                />
              </div>
            )}

            <label className="flex items-center gap-2 text-sm text-foreground">
              <input
                type="checkbox"
                checked={isRequired}
                onChange={(e) => setIsRequired(e.target.checked)}
                className="h-4 w-4 rounded border-border"
              />
              Required to leave this Stage
            </label>

            <div className="flex items-center gap-2 justify-end">
              <button
                type="button"
                onClick={() => setIsAdding(false)}
                className="h-9 px-3 rounded-lg border border-border text-muted-foreground hover:bg-muted text-sm font-semibold transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={addMutation.isPending}
                className="h-9 px-4 rounded-lg bg-foreground text-background text-sm font-semibold hover:bg-foreground/90 transition-colors disabled:opacity-50"
              >
                Save
              </button>
            </div>
          </form>
        )}

        {isLoading ? (
          <div className="py-6 text-center text-sm text-muted-foreground animate-pulse">
            Loading requirements...
          </div>
        ) : !effectiveStageCode ? (
          <div className="py-6 text-center text-sm text-muted-foreground">
            No Stages configured yet.
          </div>
        ) : requirements?.length === 0 ? (
          <div className="py-6 text-center text-sm text-muted-foreground">
            No requirements on this Stage yet.
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {requirements?.map((requirement, index) => (
              <div
                key={requirement.id}
                className="p-3 rounded-xl border border-border bg-card flex items-center justify-between gap-3"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="flex flex-col gap-1 text-muted-foreground shrink-0">
                    <button
                      onClick={() => moveRequirement(index, "up")}
                      disabled={index === 0 || reorderMutation.isPending}
                      className={`p-1 rounded transition-colors ${
                        index === 0 ? "opacity-20 cursor-not-allowed" : "hover:bg-muted text-foreground"
                      }`}
                    >
                      <ArrowUp size={14} />
                    </button>
                    <button
                      onClick={() => moveRequirement(index, "down")}
                      disabled={index === requirements.length - 1 || reorderMutation.isPending}
                      className={`p-1 rounded transition-colors ${
                        index === requirements.length - 1
                          ? "opacity-20 cursor-not-allowed"
                          : "hover:bg-muted text-foreground"
                      }`}
                    >
                      <ArrowDown size={14} />
                    </button>
                  </div>

                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-bold text-sm text-foreground truncate">{requirement.label}</p>
                      {!requirement.is_required && (
                        <span className="text-[10px] font-bold bg-muted text-muted-foreground px-1.5 py-0.5 rounded uppercase">
                          Optional
                        </span>
                      )}
                    </div>
                    <p className="text-[10px] text-muted-foreground font-mono mt-0.5">
                      {KIND_LABELS[requirement.kind] || requirement.kind}
                    </p>
                  </div>
                </div>

                <button
                  onClick={() => handleArchive(requirement)}
                  disabled={archiveMutation.isPending}
                  className="w-8 h-8 rounded-lg flex items-center justify-center text-destructive hover:bg-destructive/10 transition-colors shrink-0"
                  title="Archive"
                >
                  <Archive size={16} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
