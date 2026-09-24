import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { leadSourceService } from "../../services/leadSourceService";
import { Plus, Check, X, Shield } from "lucide-react";
import toast from "react-hot-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default function LeadSourceManager() {
  const queryClient = useQueryClient();
  const [newValue, setNewValue] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const [isAdding, setIsAdding] = useState(false);

  const { data: leadSources, isLoading } = useQuery({
    queryKey: ["leadSources", "all"],
    queryFn: () => leadSourceService.getAllLeadSources(),
  });

  const addMutation = useMutation({
    mutationFn: (payload) => leadSourceService.addLeadSource(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["leadSources"] });
      toast.success("Lead source added successfully!");
      setNewValue("");
      setNewLabel("");
      setIsAdding(false);
    },
    onError: (err) => toast.error(err.message),
  });

  const toggleMutation = useMutation({
    mutationFn: ({ value, isActive }) =>
      leadSourceService.toggleLeadSource(value, isActive),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["leadSources"] });
      toast.success("Lead source updated!");
    },
    onError: (err) => toast.error(err.message),
  });

  const handleAdd = (e) => {
    e.preventDefault();
    if (!newValue.trim() || !newLabel.trim()) return;
    addMutation.mutate({ value: newValue, label: newLabel });
  };

  return (
    <div className="bg-card border border-border rounded-2xl shadow-sm overflow-hidden relative">
      <div className="absolute top-0 right-0 w-64 h-64 bg-primary/5 blur-3xl pointer-events-none -mr-20 -mt-20" />
      <div className="px-5 py-4 border-b border-border bg-muted/30 flex items-center justify-between relative z-10">
        <div className="flex items-center gap-2.5">
          <div className="w-6 h-6 rounded-lg bg-primary/10 flex items-center justify-center">
            <Shield size={14} className="text-primary" />
          </div>
          <h2 className="text-[10px] font-black text-muted-foreground uppercase tracking-[0.2em]">
            Lead Source Manager
          </h2>
        </div>
        {!isAdding && (
          <Button
            variant="ghost"
            onClick={() => setIsAdding(true)}
            className="h-auto gap-1 px-2.5 py-1.5 text-xs font-bold text-primary hover:bg-primary/10 hover:text-primary"
          >
            <Plus size={14} /> Add New
          </Button>
        )}
      </div>

      <div className="p-5 relative z-10">
        {isAdding && (
          <form
            onSubmit={handleAdd}
            className="flex items-end gap-3 mb-6 p-4 rounded-xl border border-border bg-muted/20"
          >
            <div className="flex-1 space-y-1">
              <label className="text-xs font-bold text-muted-foreground">
                Value (ID)
              </label>
              <Input
                type="text"
                value={newValue}
                onChange={(e) => setNewValue(e.target.value.toUpperCase())}
                placeholder="e.g. LINKEDIN"
                containerClassName="w-full" className="h-9 uppercase"
                required
              />
            </div>
            <div className="flex-1 space-y-1">
              <label className="text-xs font-bold text-muted-foreground">
                Display Label
              </label>
              <Input
                type="text"
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
                placeholder="e.g. LinkedIn"
                containerClassName="w-full" className="h-9"
                required
              />
            </div>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setIsAdding(false)}
                className="h-9 px-3 text-sm font-semibold text-muted-foreground"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={addMutation.isPending}
                className="h-9 px-4 text-sm font-semibold"
              >
                Save
              </Button>
            </div>
          </form>
        )}

        {isLoading ? (
          <div className="py-6 text-center text-sm text-muted-foreground animate-pulse">
            Loading lead sources...
          </div>
        ) : leadSources?.length === 0 ? (
          <div className="py-6 text-center text-sm text-muted-foreground">
            No lead sources found.
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {leadSources?.map((source) => (
              <div
                key={source.value}
                className={`p-3 rounded-xl border flex items-center justify-between transition-colors ${
                  source.is_active
                    ? "border-border bg-card"
                    : "border-border/50 bg-muted/20 opacity-60"
                }`}
              >
                <div>
                  <p className="font-bold text-sm text-foreground">
                    {source.label}
                  </p>
                  <p className="text-[10px] text-muted-foreground font-mono mt-0.5">
                    {source.value}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() =>
                    toggleMutation.mutate({
                      value: source.value,
                      isActive: !source.is_active,
                    })
                  }
                  disabled={toggleMutation.isPending}
                  className={
                    source.is_active
                      ? "text-destructive hover:bg-destructive/10 hover:text-destructive"
                      : "text-primary hover:bg-primary/10 hover:text-primary"
                  }
                  title={source.is_active ? "Deactivate" : "Activate"}
                >
                  {source.is_active ? <X size={16} /> : <Check size={16} />}
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
