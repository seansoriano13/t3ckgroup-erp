import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { pipelineStageService } from "../../services/pipelineStageService";
import { Plus, Check, X, Shield, Lock, ArrowUp, ArrowDown } from "lucide-react";
import toast from "react-hot-toast";

const THEMES = [
  { value: "mauve", label: "Mauve" },
  { value: "amber", label: "Amber" },
  { value: "blue", label: "Blue" },
  { value: "violet", label: "Violet" },
  { value: "green", label: "Green" },
  { value: "orange", label: "Orange" },
  { value: "red", label: "Red" }
];

export default function PipelineStageManager() {
  const queryClient = useQueryClient();
  const [newLabel, setNewLabel] = useState("");
  const [newTheme, setNewTheme] = useState("mauve");
  const [isAdding, setIsAdding] = useState(false);

  const { data: stages, isLoading } = useQuery({
    queryKey: ["pipelineStages", "all"],
    queryFn: () => pipelineStageService.getAllStages(),
  });

  const addMutation = useMutation({
    mutationFn: (payload) => pipelineStageService.addStage(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pipelineStages"] });
      toast.success("Stage added successfully!");
      setNewLabel("");
      setNewTheme("mauve");
      setIsAdding(false);
    },
    onError: (err) => toast.error(err.message),
  });

  const toggleMutation = useMutation({
    mutationFn: ({ code, isActive }) =>
      pipelineStageService.toggleStage(code, isActive),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pipelineStages"] });
      toast.success("Stage status updated!");
    },
    onError: (err) => toast.error(err.message),
  });

  const reorderMutation = useMutation({
    mutationFn: (updates) => pipelineStageService.reorderStages(updates),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pipelineStages"] });
    },
    onError: (err) => {
      toast.error(err.message);
      queryClient.invalidateQueries({ queryKey: ["pipelineStages"] });
    },
  });

  const handleAdd = (e) => {
    e.preventDefault();
    if (!newLabel.trim()) return;

    if (!stages) return;
    
    // Find highest sort_order BEFORE anchor
    const anchor = stages.find(s => s.is_anchor);
    const beforeAnchor = stages.filter(s => s.sort_order < (anchor ? anchor.sort_order : 999));
    
    // Default to adding right before the anchor, or at the end if no anchor
    const maxBeforeOrder = beforeAnchor.length > 0 ? Math.max(...beforeAnchor.map(s => s.sort_order)) : 10;
    
    const newSortOrder = maxBeforeOrder + 5; // insert with gap

    addMutation.mutate({ label: newLabel, theme: newTheme, sort_order: newSortOrder });
  };

  const moveStage = (index, direction) => {
    if (!stages) return;
    const newIndex = direction === 'up' ? index - 1 : index + 1;
    if (newIndex < 0 || newIndex >= stages.length) return;

    const stageA = stages[index];
    const stageB = stages[newIndex];

    // Cannot move anchor or post-anchor stages
    if (stageA.is_anchor || stageB.is_anchor || 
        stages.findIndex(s => s.is_anchor) < Math.max(index, newIndex)) {
      toast.error("Cannot reorder stages after the Anchor stage.");
      return;
    }

    // Swap sort orders
    const updates = [
      { code: stageA.code, sort_order: stageB.sort_order },
      { code: stageB.code, sort_order: stageA.sort_order }
    ];

    reorderMutation.mutate(updates);
  };

  return (
    <div className="bg-card border border-border rounded-2xl shadow-sm overflow-hidden relative">
      <div className="absolute top-0 right-0 w-64 h-64 bg-primary/5 blur-3xl pointer-events-none -mr-20 -mt-20" />
      <div className="px-5 py-4 border-b border-border bg-muted/30 flex items-center justify-between relative z-10">
        <div className="flex items-center gap-2.5">
          <div className="w-6 h-6 rounded-lg bg-muted flex items-center justify-center">
            <Shield size={14} className="text-foreground" />
          </div>
          <h2 className="text-[10px] font-black text-muted-foreground uppercase tracking-[0.2em]">
            Pipeline Stages
          </h2>
        </div>
        {!isAdding && (
          <button
            onClick={() => setIsAdding(true)}
            className="text-xs font-bold text-foreground flex items-center gap-1 hover:bg-muted px-2.5 py-1.5 rounded-lg transition-colors"
          >
            <Plus size={14} /> Add Stage
          </button>
        )}
      </div>

      <div className="p-5 relative z-10">
        <div className="mb-4 p-4 rounded-xl border border-border bg-muted/20 text-xs text-muted-foreground">
          <p className="mb-2"><strong className="text-foreground">System-owned stages</strong> (marked with a lock) are required for the system to function and cannot be fully edited or removed.</p>
          <p><strong className="text-foreground">Anchor Stage & Beyond:</strong> The Awarded stage and everything after it represents the post-sale accounting pipeline. To preserve historical commission pools, stages in this region cannot be reordered, and new stages cannot be added there.</p>
        </div>

        {isAdding && (
          <form
            onSubmit={handleAdd}
            className="flex flex-col sm:flex-row sm:items-end gap-3 mb-6 p-4 rounded-xl border border-border bg-muted/20"
          >
            <div className="flex-1 space-y-1">
              <label className="text-xs font-bold text-muted-foreground">
                Display Label
              </label>
              <input
                type="text"
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
                placeholder="e.g. Needs Assessment"
                className="w-full h-9 rounded-lg border border-border bg-card px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                required
              />
            </div>
            <div className="flex-1 space-y-1">
              <label className="text-xs font-bold text-muted-foreground">
                Badge Theme
              </label>
              <select
                value={newTheme}
                onChange={(e) => setNewTheme(e.target.value)}
                className="w-full h-9 rounded-lg border border-border bg-card px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              >
                {THEMES.map((theme) => (
                  <option key={theme.value} value={theme.value}>{theme.label}</option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-2 mt-2 sm:mt-0">
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
            Loading pipeline stages...
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {stages?.map((stage, index) => {
              const isLocked = stage.is_system;
              const isAnchorOrAfter = stages.findIndex(s => s.is_anchor) !== -1 && index >= stages.findIndex(s => s.is_anchor);
              const isUndeactivatable = stage.is_default || stage.is_anchor || stage.is_won || stage.is_lost;
              
              // Only allow moving up if previous stage exists and is not anchor-or-after
              const canMoveUp = index > 0 && !isAnchorOrAfter;
              // Only allow moving down if next stage is not anchor-or-after
              const canMoveDown = index < stages.length - 1 && !(stages.findIndex(s => s.is_anchor) !== -1 && (index + 1) >= stages.findIndex(s => s.is_anchor));

              return (
                <div
                  key={stage.code}
                  className={`p-3 rounded-xl border flex items-center justify-between transition-colors ${
                    stage.is_active
                      ? "border-border bg-card"
                      : "border-border/50 bg-muted/20 opacity-60"
                  }`}
                >
                  <div className="flex items-center gap-4">
                    <div className="flex flex-col gap-1 text-muted-foreground">
                      <button 
                        onClick={() => moveStage(index, 'up')}
                        disabled={!canMoveUp || reorderMutation.isPending}
                        className={`p-1 rounded transition-colors ${canMoveUp ? 'hover:bg-muted text-foreground' : 'opacity-20 cursor-not-allowed'}`}
                      >
                        <ArrowUp size={14} />
                      </button>
                      <button 
                        onClick={() => moveStage(index, 'down')}
                        disabled={!canMoveDown || reorderMutation.isPending}
                        className={`p-1 rounded transition-colors ${canMoveDown ? 'hover:bg-muted text-foreground' : 'opacity-20 cursor-not-allowed'}`}
                      >
                        <ArrowDown size={14} />
                      </button>
                    </div>

                    <div>
                      <div className="flex items-center gap-2">
                        <p className="font-bold text-sm text-foreground">
                          {stage.label}
                        </p>
                        {isLocked && (
                          <Lock size={12} className="text-muted-foreground" title="System Stage" />
                        )}
                        {stage.is_anchor && (
                          <span className="text-[10px] font-bold bg-muted text-foreground px-1.5 py-0.5 rounded uppercase">Anchor</span>
                        )}
                      </div>
                      <p className="text-[10px] text-muted-foreground font-mono mt-0.5">
                        {stage.code} • Theme: {stage.theme}
                      </p>
                    </div>
                  </div>
                  
                  <button
                    onClick={() =>
                      toggleMutation.mutate({
                        code: stage.code,
                        isActive: !stage.is_active,
                      })
                    }
                    disabled={toggleMutation.isPending || (stage.is_active && isUndeactivatable)}
                    className={`w-8 h-8 rounded-lg flex items-center justify-center transition-colors ${
                      (stage.is_active && isUndeactivatable) 
                        ? "opacity-50 cursor-not-allowed text-muted-foreground bg-muted"
                        : stage.is_active
                          ? "text-destructive hover:bg-destructive/10"
                          : "text-primary hover:bg-primary/10"
                    }`}
                    title={stage.is_active ? (isUndeactivatable ? "Cannot deactivate this critical stage" : "Deactivate") : "Activate"}
                  >
                    {stage.is_active ? <X size={16} /> : <Check size={16} />}
                  </button>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  );
}
