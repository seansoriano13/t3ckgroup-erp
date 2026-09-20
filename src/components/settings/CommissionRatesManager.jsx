import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Percent } from "lucide-react";
import toast from "react-hot-toast";

import { commissionService } from "../../services/commissionService";
import { RATE_TYPES, RATE_TYPE_LABELS } from "../../utils/commission";
import { useAuth } from "../../context/AuthContext";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";

export default function CommissionRatesManager() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [isAdding, setIsAdding] = useState(false);
  const [rateType, setRateType] = useState(RATE_TYPES.POOL);
  const [percent, setPercent] = useState("");
  const [effectiveFrom, setEffectiveFrom] = useState("");

  const { data: history, isLoading } = useQuery({
    queryKey: ["commissionRateHistory"],
    queryFn: () => commissionService.listRateHistory(),
  });

  const addMutation = useMutation({
    mutationFn: (payload) => commissionService.createRate(payload, user?.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["commissionRateHistory"] });
      toast.success("Commission Rate added.");
      setPercent("");
      setEffectiveFrom("");
      setIsAdding(false);
    },
    onError: (err) => toast.error(err.message),
  });

  const handleAdd = (e) => {
    e.preventDefault();
    if (!percent || !effectiveFrom) return;
    addMutation.mutate({ rateType, percent: Number(percent), effectiveFrom });
  };

  return (
    <div className="bg-card border border-border rounded-2xl shadow-sm overflow-hidden">
      <div className="px-5 py-4 border-b border-border bg-muted/30 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-6 h-6 rounded-lg bg-primary/10 flex items-center justify-center">
            <Percent size={14} className="text-primary" />
          </div>
          <h2 className="text-[10px] font-black text-muted-foreground uppercase tracking-[0.2em]">
            Commission Rates
          </h2>
        </div>
        {!isAdding && (
          <Button
            onClick={() => setIsAdding(true)}
            variant="link"
          >
            <Plus size={14} /> Add Rate
          </Button>
        )}
      </div>

      <div className="p-5">
        {isAdding && (
          <form
            onSubmit={handleAdd}
            className="flex items-end gap-3 mb-6 p-4 rounded-xl border border-border bg-muted/20 flex-wrap"
          >
            <div className="space-y-1">
              <label className="text-xs font-bold text-muted-foreground">Type</label>
              <Select
  options={[...Object.entries(RATE_TYPE_LABELS).map(([value, label]) => ({ value: value, label: label }))]}
  value={rateType}
  onChange={(next) => setRateType(next)}
/>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-bold text-muted-foreground">Percent</label>
              <input
                type="number"
                step="0.001"
                value={percent}
                onChange={(e) => setPercent(e.target.value)}
                placeholder="e.g. 12"
                className="w-28 h-9 rounded-lg border border-border bg-card px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                required
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-bold text-muted-foreground">Effective From</label>
              <input
                type="date"
                value={effectiveFrom}
                onChange={(e) => setEffectiveFrom(e.target.value)}
                className="h-9 rounded-lg border border-border bg-card px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                required
              />
            </div>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                onClick={() => setIsAdding(false)}
                variant="outline"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={addMutation.isPending}
                variant="default"
              >
                Save
              </Button>
            </div>
          </form>
        )}

        {isLoading ? (
          <div className="py-6 text-center text-sm text-muted-foreground animate-pulse">
            Loading rate history...
          </div>
        ) : history?.length === 0 ? (
          <div className="py-6 text-center text-sm text-muted-foreground">No Commission Rates yet.</div>
        ) : (
          <div className="divide-y divide-border/60">
            {history?.map((rate) => (
              <div key={rate.id} className="flex items-center justify-between py-2.5 text-sm">
                <span className="font-semibold text-foreground">{RATE_TYPE_LABELS[rate.rate_type] || rate.rate_type}</span>
                <span className="text-muted-foreground">effective {rate.effective_from}</span>
                <span className="font-bold tabular-nums text-foreground">{rate.percent}%</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
