import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { Pencil } from "lucide-react";
import { commissionService } from "../../../services/commissionService";
import { useSalesDirectorAccess } from "../../../hooks/useSalesDirectorAccess";
import { Button } from "../../ui/button";
import { Input } from "../../ui/input";
import { SPLIT_PROJECT_TYPES, TONE, compactPHP, shareRoleLabel, splitRows } from "./commissionView";
import { useCommissionSplits } from "./useCommissionDashboard";
import { Meter, SplitBar, Swatch, UsageRow, UsageSection } from "./parts";
import CommissionCalculator from "./CommissionCalculator";

/**
 * The expanded body of a Split rule. Read-only by default; a Sales Director or
 * Super Admin gets an Edit button that turns the roles into inputs.
 */
function SplitDetail({ projectType, splits, canEdit, actorId }) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(null);
  const roles = projectType.roles;
  const saved = Object.fromEntries(roles.map((role) => [role, Number(splits.find((s) => s.shareRole === role)?.percent) || 0]));
  const values = draft ?? saved;
  const total = roles.reduce((sum, role) => sum + (Number(values[role]) || 0), 0);
  const dirty = draft !== null && roles.some((role) => Number(draft[role]) !== saved[role]);

  const stopEditing = () => {
    setDraft(null);
    setEditing(false);
  };

  const save = useMutation({
    mutationFn: () => commissionService.saveSplitsForProjectType(projectType.value, roles.map((role) => ({ shareRole: role, percent: Number(values[role]) || 0 })), actorId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["commissionSplits", projectType.value] });
      queryClient.invalidateQueries({ queryKey: ["commissionDashboard"] });
      queryClient.invalidateQueries({ queryKey: ["commissionBreakdown"] });
      toast.success(`${projectType.long} split updated.`);
      stopEditing();
    },
    onError: (err) => toast.error(err.message),
  });

  if (!editing) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-x-8 gap-y-3">
        <div className="grid flex-1 gap-x-8 gap-y-2 sm:grid-cols-2 lg:grid-cols-4">
          {splitRows(splits, projectType.value).map((r) => (
            <div key={r.role} className="flex items-center justify-between gap-3 text-sm">
              <span className="flex items-center gap-2 text-muted-foreground"><Swatch tone={r.role} />{r.label}</span>
              <span className="font-medium tabular-nums text-foreground">{r.percent}%</span>
            </div>
          ))}
        </div>
        {canEdit && (
          <Button type="button" variant="outline" size="sm" aria-label={`Edit ${projectType.long} split`} onClick={() => setEditing(true)}>
            <Pencil /> Edit
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="grid gap-x-8 gap-y-2 sm:grid-cols-2 lg:grid-cols-4">
        {roles.map((role) => (
          <div key={role} className="flex items-center justify-between gap-3 text-sm">
            <span className="flex items-center gap-2 text-muted-foreground"><Swatch tone={role} />{shareRoleLabel(role)}</span>
            <span className="flex items-center gap-1">
              <Input
                type="number"
                step="0.001"
                min={0}
                max={100}
                aria-label={`${shareRoleLabel(role)} percent`}
                value={values[role]}
                onChange={(e) => setDraft({ ...values, [role]: e.target.value })}
                containerClassName="w-20"
                className="h-7 rounded-md border border-border bg-card px-2 text-right text-sm tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-mauve-6"
              />
              <span className="text-xs text-muted-foreground">%</span>
            </span>
          </div>
        ))}
      </div>
      <div className="flex items-center justify-end gap-3">
        <span className={`text-xs tabular-nums ${Math.abs(total - 100) > 0.01 ? "font-semibold text-destructive" : "text-muted-foreground"}`}>
          Total {total.toFixed(2)}%{Math.abs(total - 100) > 0.01 && " — must be 100%"}
        </span>
        <Button type="button" variant="ghost" size="sm" onClick={stopEditing}>Cancel</Button>
        <Button type="button" size="sm" disabled={!dirty || save.isPending || Math.abs(total - 100) > 0.01} onClick={() => save.mutate()}>
          Save split
        </Button>
      </div>
    </div>
  );
}

/**
 * The rules behind the pool, as label · meter · number rows: the live
 * Commission Rates, each Commission Department's allocation, the Commission
 * Split per Project Type (editable by a Sales Director), and a calculator to
 * try them on any contract value.
 */
export default function FormulaTab({ access, departments }) {
  const { rates, salesPercent, canViewAllFinancials, canViewSalesAmounts } = access;
  const { splits } = useCommissionSplits();
  const { user, hasAccess: canEditSplits } = useSalesDirectorAccess();
  const [open, setOpen] = useState({});

  return (
    <div className="space-y-10">
      <div className="grid gap-8 xl:grid-cols-2">
        <UsageSection title="Formula" description="Live rates, applied top to bottom. A SOR keeps the rates in force on its Contract Date.">
          <UsageRow lead={<Swatch tone="tax" />} label="VAT" sub="Divided out of the contract value" meter={<Meter value={rates.vat} max={25} color={TONE.tax.solid} />} value={`${rates.vat}%`} valueSub={`÷ ${(1 + rates.vat / 100).toFixed(2)}`} />
          <UsageRow lead={<Swatch tone="tax" />} label="Withholding" sub="Of the VAT-free amount" meter={<Meter value={rates.withholding} max={25} color={TONE.tax.solid} />} value={`${rates.withholding}%`} valueSub="subtracted" />
          <UsageRow lead={<Swatch tone="pool" />} label="Pool rate" sub="Of Commissionable Revenue" meter={<Meter value={rates.pool} max={25} color={TONE.pool.solid} />} value={`${rates.pool}%`} valueSub="into the pool" />
          <UsageRow lead={<Swatch tone="sales" />} label="Sales share" sub="Of the pool, to the people on the SOR" meter={<Meter value={salesPercent} color={TONE.sales.solid} />} value={`${salesPercent}%`} valueSub="to Sales" />
        </UsageSection>

        <UsageSection title="Departments" description="Fixed split of the pool across Commission Departments.">
          {departments.map((d) => (
            <UsageRow
              key={d.name}
              lead={<Swatch color={d.color} />}
              label={d.name}
              sub={d.isSales ? "Paid out by role on each SOR" : "Company reserve"}
              meter={<Meter value={d.allocationPercent} color={d.color} />}
              value={`${d.allocationPercent}%`}
              valueSub={canViewAllFinancials || (d.isSales && canViewSalesAmounts) ? compactPHP(d.amount) : "Restricted"}
            />
          ))}
        </UsageSection>
      </div>

      <UsageSection
        title="Split rules"
        description={canEditSplits ? "How the Sales fund is divided on a SOR, by Project Type. Open one to see each role, and edit it." : "How the Sales fund is divided on a SOR, by Project Type. Open one to see each role."}
      >
        {SPLIT_PROJECT_TYPES.map((p) => {
          const rows = splitRows(splits[p.value], p.value);
          return (
            <UsageRow
              key={p.value}
              label={p.long}
              sub={p.blurb}
              open={!!open[p.value]}
              onToggle={() => setOpen((o) => ({ ...o, [p.value]: !o[p.value] }))}
              meter={<SplitBar parts={rows.map((r) => ({ key: r.role, percent: r.percent, color: TONE[r.role].solid }))} />}
              value={`${rows.length} role${rows.length === 1 ? "" : "s"}`}
              detail={<SplitDetail projectType={p} splits={splits[p.value]} canEdit={canEditSplits} actorId={user?.id} />}
            />
          );
        })}
      </UsageSection>

      <CommissionCalculator access={access} splits={splits} />
    </div>
  );
}
