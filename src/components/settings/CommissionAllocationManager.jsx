import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, Plus, Trash2, Building2 } from "lucide-react";
import toast from "react-hot-toast";

import { commissionService } from "../../services/commissionService";
import { cn } from "@/lib/utils";
import { useAuth } from "../../context/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

function sumOf(rows) {
  return rows.reduce((sum, row) => sum + (Number(row.allocationPercent) || 0), 0);
}

function PositionsEditor({ department, actorId }) {
  const queryClient = useQueryClient();
  const [rows, setRows] = useState(null);

  const { data: positions, isLoading } = useQuery({
    queryKey: ["commissionPositions", department.id],
    queryFn: () => commissionService.getPositions(department.id),
  });

  const draft = rows ?? positions ?? [];
  const total = sumOf(draft);

  const saveMutation = useMutation({
    mutationFn: (payload) => commissionService.savePositionAllocations(department.id, payload, actorId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["commissionPositions", department.id] });
      toast.success("Positions updated.");
      setRows(null);
    },
    onError: (err) => toast.error(err.message),
  });

  const updateRow = (index, patch) => {
    setRows(draft.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  };

  const addRow = () => {
    setRows([...draft, { name: "", allocationPercent: 0 }]);
  };

  const removeRow = (index) => {
    setRows(draft.filter((_, i) => i !== index));
  };

  if (isLoading) {
    return <p className="py-3 text-xs text-muted-foreground">Loading positions...</p>;
  }

  return (
    <div className="space-y-2 py-3 pl-8 pr-2">
      {draft.length === 0 && <p className="text-xs text-muted-foreground">No positions yet.</p>}
      {draft.map((row, i) => (
        <div key={row.id ?? `new-${i}`} className="flex items-center gap-2">
          <Input
            value={row.name}
            onChange={(e) => updateRow(i, { name: e.target.value })}
            placeholder="Position name"
            className="h-8" containerClassName="flex-1"
          />
          <Input
            type="number"
            step="0.001"
            value={row.allocationPercent}
            onChange={(e) => updateRow(i, { allocationPercent: Number(e.target.value) })}
            className="h-8 tabular-nums" containerClassName="w-20"
          />
          <span className="text-xs text-muted-foreground">%</span>
          <Button
            type="button"
            onClick={() => removeRow(i)}
            variant="ghost" size="icon-xs"
            aria-label={`Remove ${row.name || "position"}`}
          >
            <Trash2 size={12} />
          </Button>
        </div>
      ))}

      <div className="flex items-center justify-between pt-1">
        <Button
          type="button"
          onClick={addRow}
          variant="ghost" className="h-auto"
        >
          <Plus size={12} /> Add Position
        </Button>
        <div className="flex items-center gap-3">
          <span className={cn("text-xs font-semibold tabular-nums", Math.abs(total - 100) > 0.01 ? "text-red-9" : "text-muted-foreground")}>
            {total.toFixed(2)}%
          </span>
          <Button
            type="button"
            disabled={saveMutation.isPending || draft.length === 0}
            onClick={() => saveMutation.mutate(draft)}
            variant="default"
          >
            Save
          </Button>
        </div>
      </div>
    </div>
  );
}

function DepartmentRow({ department, index, onChange, isOpen, onToggle, actorId }) {
  return (
    <div className="rounded-lg border border-border/60">
      <div className="flex items-center gap-2 px-3 py-2">
        <Button
          type="button"
          onClick={onToggle}
          variant="ghost" className="flex-1 text-left h-auto justify-start"
        >
          <ChevronDown size={13} className={cn("shrink-0 text-muted-foreground transition-transform", isOpen && "rotate-180")} />
          <span className="text-sm font-semibold text-foreground">{department.name}</span>
        </Button>
        <Input
          type="number"
          step="0.001"
          value={department.allocationPercent}
          onChange={(e) => onChange(index, { allocationPercent: Number(e.target.value) })}
          className="h-8 tabular-nums" containerClassName="w-20"
        />
        <span className="text-xs text-muted-foreground">%</span>
      </div>
      {isOpen && <PositionsEditor department={department} actorId={actorId} />}
    </div>
  );
}

/** Manages Commission Department and Commission Position allocation percentages. */
export default function CommissionAllocationManager() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [rows, setRows] = useState(null);
  const [openId, setOpenId] = useState(null);

  const { data: departments, isLoading } = useQuery({
    queryKey: ["commissionDepartments"],
    queryFn: () => commissionService.getDepartments(),
  });

  const draft = rows ?? departments ?? [];
  const total = sumOf(draft);

  const saveMutation = useMutation({
    mutationFn: (payload) => commissionService.saveDepartmentAllocations(payload, user?.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["commissionDepartments"] });
      toast.success("Department allocations updated.");
      setRows(null);
    },
    onError: (err) => toast.error(err.message),
  });

  const updateRow = (index, patch) => {
    setRows(draft.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  };

  if (isLoading) {
    return <div className="py-6 text-center text-sm text-muted-foreground animate-pulse">Loading departments...</div>;
  }

  return (
    <div className="bg-card border border-border rounded-2xl shadow-sm overflow-hidden">
      <div className="px-5 py-4 border-b border-border bg-muted/30 flex items-center gap-2.5">
        <div className="w-6 h-6 rounded-lg bg-primary/10 flex items-center justify-center">
          <Building2 size={14} className="text-primary" />
        </div>
        <h2 className="text-[10px] font-black text-muted-foreground uppercase tracking-[0.2em]">
          Department &amp; Position Allocation
        </h2>
      </div>

      <div className="space-y-2 p-5">
        {draft.map((department, i) => (
          <DepartmentRow
            key={department.id ?? department.name}
            department={department}
            index={i}
            onChange={updateRow}
            isOpen={openId === (department.id ?? department.name)}
            onToggle={() => setOpenId((prev) => (prev === (department.id ?? department.name) ? null : department.id ?? department.name))}
            actorId={user?.id}
          />
        ))}

        <div className="flex items-center justify-end gap-3 pt-2">
          <span className={cn("text-xs font-semibold tabular-nums", Math.abs(total - 100) > 0.01 ? "text-red-9" : "text-muted-foreground")}>
            Total {total.toFixed(2)}%
          </span>
          <Button
            type="button"
            disabled={saveMutation.isPending}
            onClick={() => saveMutation.mutate(draft)}
            variant="default"
          >
            Save Departments
          </Button>
        </div>
      </div>
    </div>
  );
}
