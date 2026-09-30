import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { commissionService } from "../../../services/commissionService";
import { Button } from "../../ui/button";
import { Input } from "../../ui/input";
import { compactPHP } from "./commissionView";
import { Meter, Swatch, UsageRow, UsageSection } from "./parts";

const INPUT_CLASS = "h-7 rounded-md border border-border bg-card px-2 text-right text-sm tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-mauve-6";

const sumOf = (values) => values.reduce((sum, v) => sum + (Number(v) || 0), 0);
const isHundred = (total) => Math.abs(total - 100) <= 0.01;

function Total({ total, className = "" }) {
  return (
    <span className={`text-xs tabular-nums ${isHundred(total) ? "text-muted-foreground" : "font-semibold text-destructive"} ${className}`}>
      Total {total.toFixed(2)}%{!isHundred(total) && " — must be 100%"}
    </span>
  );
}

/**
 * The positions inside one Commission Department, as name · percent. Read-only
 * by default; a Super Admin gets an Edit button that turns them into inputs.
 */
function PositionsDetail({ department, canEdit, actorId }) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState(null);

  const { data: positions = [], isLoading } = useQuery({
    queryKey: ["commissionPositions", department.id],
    queryFn: () => commissionService.getPositions(department.id),
  });

  const rows = draft ?? positions;
  const total = sumOf(rows.map((r) => r.allocationPercent));
  const dirty = draft !== null;
  const valid = isHundred(total) && rows.length > 0 && rows.every((r) => r.name.trim());
  const patch = (index, change) => setDraft(rows.map((row, i) => (i === index ? { ...row, ...change } : row)));

  const save = useMutation({
    mutationFn: () => commissionService.savePositionAllocations(department.id, rows.map((r) => ({ ...r, name: r.name.trim(), allocationPercent: Number(r.allocationPercent) || 0 })), actorId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["commissionPositions", department.id] });
      queryClient.invalidateQueries({ queryKey: ["commissionDashboard"] });
      toast.success(`${department.name} positions updated.`);
      setDraft(null);
    },
    onError: (err) => toast.error(err.message),
  });

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading positions…</p>;

  if (!dirty) {
    return (
      <div className="flex flex-wrap items-start justify-between gap-x-8 gap-y-3">
        {positions.length === 0 ? (
          <p className="text-sm text-muted-foreground">No positions — the whole allocation stays with the department.</p>
        ) : (
          <div className="grid flex-1 gap-x-8 gap-y-2 sm:grid-cols-2">
            {positions.map((p) => (
              <div key={p.id} className="flex items-center justify-between gap-3 text-sm">
                <span className="text-muted-foreground">{p.name}</span>
                <span className="font-medium tabular-nums text-foreground">{p.allocationPercent}%</span>
              </div>
            ))}
          </div>
        )}
        {canEdit && (
          <Button type="button" variant="outline" size="sm" aria-label={`Edit ${department.name} positions`} onClick={() => setDraft(positions)}>
            <Pencil /> Edit
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {rows.map((row, i) => (
        <div key={row.id ?? `new-${i}`} className="flex items-center gap-2">
          <Input aria-label={`Position ${i + 1} name`} value={row.name} onChange={(e) => patch(i, { name: e.target.value })} placeholder="Position name" containerClassName="flex-1" className={`${INPUT_CLASS} text-left`} />
          <Input aria-label={`Position ${i + 1} percent`} type="number" step="0.001" min={0} max={100} value={row.allocationPercent} onChange={(e) => patch(i, { allocationPercent: e.target.value })} containerClassName="w-20" className={INPUT_CLASS} />
          <span className="text-xs text-muted-foreground">%</span>
          <Button type="button" variant="ghost" size="icon-xs" aria-label={`Remove position ${i + 1}`} onClick={() => setDraft(rows.filter((_, j) => j !== i))}>
            <Trash2 />
          </Button>
        </div>
      ))}
      <div className="flex items-center justify-between gap-3 pt-1">
        <Button type="button" variant="ghost" size="sm" onClick={() => setDraft([...rows, { name: "", allocationPercent: 0 }])}>
          <Plus /> Add position
        </Button>
        <div className="flex items-center gap-3">
          <Total total={total} />
          <Button type="button" variant="ghost" size="sm" onClick={() => setDraft(null)}>Cancel</Button>
          <Button type="button" size="sm" disabled={!valid || save.isPending} onClick={() => save.mutate()}>Save positions</Button>
        </div>
      </div>
    </div>
  );
}

/**
 * Each Commission Department's fixed share of the pool. A department opens onto
 * its positions. A Super Admin edits the allocations here — in place, not on a
 * separate admin page — and the set must always add to 100.
 */
export default function DepartmentsSection({ departments, canViewAllFinancials, canViewSalesAmounts, canEdit, actorId }) {
  const queryClient = useQueryClient();
  const [openName, setOpenName] = useState(null);
  const [draft, setDraft] = useState(null);

  // The dashboard's totals carry no ids; the editors need them.
  const { data: records = [] } = useQuery({
    queryKey: ["commissionDepartments"],
    queryFn: () => commissionService.getDepartments(),
  });
  const idOf = (name) => records.find((r) => r.name === name)?.id;

  const editing = draft !== null;
  const values = (record) => draft?.[record.id] ?? record.allocationPercent;
  const total = sumOf(records.map(values));
  const dirty = editing && records.some((r) => Number(values(r)) !== r.allocationPercent);

  const save = useMutation({
    mutationFn: () => commissionService.saveDepartmentAllocations(records.map((r) => ({ ...r, allocationPercent: Number(values(r)) || 0 })), actorId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["commissionDepartments"] });
      queryClient.invalidateQueries({ queryKey: ["commissionDashboard"] });
      queryClient.invalidateQueries({ queryKey: ["commissionBreakdown"] });
      toast.success("Department allocations updated.");
      setDraft(null);
    },
    onError: (err) => toast.error(err.message),
  });

  return (
    <UsageSection
      title="Departments"
      description="Fixed split of the pool across Commission Departments. Open one to see its positions."
      action={canEdit && !editing && records.length > 0 && (
        <Button type="button" variant="outline" size="sm" onClick={() => setDraft({})}>
          <Pencil /> Edit allocations
        </Button>
      )}
    >
      {editing
        ? records.map((r) => {
            const shown = departments.find((d) => d.name === r.name);
            return (
              <UsageRow
                key={r.id}
                lead={<Swatch color={shown?.color} />}
                label={r.name}
                meter={<Meter value={Number(values(r)) || 0} color={shown?.color} />}
                value={
                  <span className="flex items-center justify-end gap-1">
                    <Input aria-label={`${r.name} allocation percent`} type="number" step="0.001" min={0} max={100} value={values(r)} onChange={(e) => setDraft({ ...draft, [r.id]: e.target.value })} containerClassName="w-20" className={INPUT_CLASS} />
                    <span className="text-xs font-normal text-muted-foreground">%</span>
                  </span>
                }
              />
            );
          })
        : departments.map((d) => {
            const id = idOf(d.name);
            return (
              <UsageRow
                key={d.name}
                lead={<Swatch color={d.color} />}
                label={d.name}
                sub={d.isSales ? "Paid out by role on each SOR" : "Company reserve"}
                meter={<Meter value={d.allocationPercent} color={d.color} />}
                value={`${d.allocationPercent}%`}
                valueSub={canViewAllFinancials || (d.isSales && canViewSalesAmounts) ? compactPHP(d.amount) : "Restricted"}
                open={openName === d.name}
                onToggle={() => setOpenName((n) => (n === d.name ? null : d.name))}
                detail={id ? <PositionsDetail department={{ id, name: d.name }} canEdit={canEdit} actorId={actorId} /> : undefined}
              />
            );
          })}
      {editing && (
        <div className="flex items-center justify-end gap-3 px-4 py-3">
          <Total total={total} />
          <Button type="button" variant="ghost" size="sm" onClick={() => setDraft(null)}>Cancel</Button>
          <Button type="button" size="sm" disabled={!dirty || !isHundred(total) || save.isPending} onClick={() => save.mutate()}>Save allocations</Button>
        </div>
      )}
    </UsageSection>
  );
}
