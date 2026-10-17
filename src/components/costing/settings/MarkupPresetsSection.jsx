import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { ArrowDown, ArrowUp, Plus } from "lucide-react";

import { Button } from "../../ui/button";
import { Input } from "../../ui/input";
import { Switch } from "../../ui/switch";
import PageLoading from "../../ui/PageLoading";
import QueryError from "../../ui/QueryError";
import StatusBadge from "../../StatusBadge";
import { costingMatrixService } from "../../../services/costingMatrixService";
import { costingKeys } from "../costingKeys";
import { Cell } from "../GridCell";
import { useCanManageMarkup } from "../useCostingMatrix";
import { factorLabel, percentLabel, refusalMessage } from "../gridFormat";

/**
 * Markup presets (#269): the named factors a Costing Matrix's default markup is picked from ("Government
 * ×1.35"). Add, rename, retype the factor, reorder and switch off. A preset is never deleted, and a matrix
 * that took one keeps its factor, because picking a preset copies the number. Presets are the Final Acquire
 * list's, like the factor itself: Super Admins and that list read and edit them, and the database refuses
 * everyone else.
 */
export default function MarkupPresetsSection() {
  const queryClient = useQueryClient();
  const [label, setLabel] = useState("");
  const [factor, setFactor] = useState("");

  const { data: canManage, isLoading: checking } = useCanManageMarkup();

  const { data: presets = [], isLoading, isError, refetch } = useQuery({
    queryKey: costingKeys.presets(),
    queryFn: () => costingMatrixService.listPresets(),
    enabled: canManage === true,
    retry: false,
  });

  const changed = () => queryClient.invalidateQueries({ queryKey: costingKeys.presets() });
  const failed = (error) => toast.error(refusalMessage(error));

  const add = useMutation({
    mutationFn: () => costingMatrixService.savePreset({ label, factor }),
    onSuccess: (row) => {
      toast.success(`${row.label} added.`);
      setLabel("");
      setFactor("");
      changed();
    },
    onError: failed,
  });

  const toggle = useMutation({
    mutationFn: ({ id, active }) => costingMatrixService.savePreset({ id, active }),
    onSuccess: (row) => {
      toast.success(row.active ? `${row.label} is offered again.` : `${row.label} switched off. Matrices that used it keep their factor.`);
      changed();
    },
    onError: failed,
  });

  const move = useMutation({
    mutationFn: async ({ index, by }) => {
      const other = index + by;
      if (other < 0 || other >= presets.length) return;
      const order = [...presets];
      [order[index], order[other]] = [order[other], order[index]];
      // Number the list 1, 2, … in its new order; only a preset whose place changed is written.
      for (let i = 0; i < order.length; i += 1) {
        if (order[i].sort !== i + 1) await costingMatrixService.savePreset({ id: order[i].id, sort: i + 1 });
      }
    },
    onSuccess: changed,
    onError: failed,
  });

  const busy = add.isPending || toggle.isPending || move.isPending;

  if (checking) return <PageLoading label="markup presets" />;

  return (
    <section className="space-y-4" aria-label="Markup presets" data-testid="markup-presets">
      <div>
        <h2 className="text-sm font-semibold text-foreground">Markup presets</h2>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          Named factors a Costing Matrix&apos;s default markup is picked from, such as &quot;Government ×1.35&quot;. A factor
          multiplies a Component&apos;s Acquire cost: ×1.35 is the same as +35%.
        </p>
      </div>

      {canManage !== true ? (
        <p className="rounded-lg border border-dashed border-border px-4 py-6 text-sm text-muted-foreground" data-testid="markup-presets-closed">
          Only Super Admins and the Final Acquire list can see or change the markup presets.
        </p>
      ) : isLoading ? (
        <PageLoading label="markup presets" />
      ) : isError ? (
        <QueryError title="The markup presets could not be loaded." onRetry={refetch} />
      ) : (
        <>
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (!busy && label.trim() && factor !== "") add.mutate();
            }}
          >
            <div className="min-w-[12rem] flex-1">
              <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Name, e.g. Government" aria-label="New markup preset name" />
            </div>
            <div className="w-32">
              <Input
                type="number"
                min={0}
                step="0.0001"
                value={factor}
                onChange={(e) => setFactor(e.target.value)}
                placeholder="Factor"
                className="text-right tabular-nums"
                aria-label="New markup preset factor"
              />
            </div>
            <Button type="submit" className="gap-1.5" disabled={busy || label.trim() === "" || factor === ""}>
              <Plus size={14} />
              Add
            </Button>
          </form>

          {presets.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border px-4 py-6 text-sm text-muted-foreground">No markup presets yet.</p>
          ) : (
            <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
              {presets.map((preset, index) => (
                <li key={preset.id} data-testid="markup-preset-row" className={`flex flex-wrap items-start gap-3 px-4 py-2.5 ${preset.active ? "" : "bg-muted/30"}`}>
                  <div className="flex shrink-0 flex-col">
                    <Button variant="ghost" size="icon-xs" aria-label={`Move ${preset.label} up`} disabled={busy || index === 0} onClick={() => move.mutate({ index, by: -1 })}>
                      <ArrowUp />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      aria-label={`Move ${preset.label} down`}
                      disabled={busy || index === presets.length - 1}
                      onClick={() => move.mutate({ index, by: 1 })}
                    >
                      <ArrowDown />
                    </Button>
                  </div>
                  <div className="min-w-[12rem] flex-1">
                    <Cell
                      label={`${preset.label}: name`}
                      noun="Name"
                      value={preset.label}
                      onSave={async (value) => {
                        await costingMatrixService.savePreset({ id: preset.id, label: value });
                        await changed();
                      }}
                    />
                  </div>
                  <div className="w-32">
                    <Cell
                      label={`${preset.label}: factor`}
                      noun="Factor"
                      value={preset.factor}
                      numeric
                      required
                      step="0.0001"
                      align="right"
                      onSave={async (value) => {
                        await costingMatrixService.savePreset({ id: preset.id, factor: value });
                        await changed();
                      }}
                    />
                  </div>
                  <p className="w-28 pt-1.5 text-sm tabular-nums text-muted-foreground">
                    {factorLabel(preset.factor)} · {percentLabel(preset.factor)}
                  </p>
                  {!preset.active && <StatusBadge theme="mauve" label="Switched off" />}
                  <Switch
                    size="sm"
                    className="mt-2"
                    checked={preset.active}
                    disabled={busy}
                    aria-label={`${preset.label} is offered`}
                    onCheckedChange={(active) => toggle.mutate({ id: preset.id, active })}
                  />
                </li>
              ))}
            </ul>
          )}

          <p className="text-xs text-muted-foreground">
            A preset that is switched off is no longer offered on a matrix. Presets are never deleted, and a matrix that took one keeps its
            factor even if the preset changes later.
          </p>
        </>
      )}
    </section>
  );
}
