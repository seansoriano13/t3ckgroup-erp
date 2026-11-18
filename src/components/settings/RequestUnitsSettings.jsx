import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { ArrowDown, ArrowUp, Pencil, Plus } from "lucide-react";

import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Switch } from "../ui/switch";
import PageLoading from "../ui/PageLoading";
import QueryError from "../ui/QueryError";
import StatusBadge from "../StatusBadge";
import EditValueDialog from "../ipas/EditValueDialog";
import { requestUnitService } from "../../services/requestUnitService";
import { REQUEST_UNITS_KEY } from "../../hooks/useRequestUnits";

/**
 * Settings > Purchasing > Request units: the choices in the Unit dropdown (Quantity section) of a Purchasing
 * Request. Add, rename, reorder and switch off. Units are never deleted: one switched off is no longer offered
 * for new items and stays on the items that already use it. Purchasing access and Super Admins edit (the
 * database decides); the first unit that is on is what a new item starts with.
 */
export default function RequestUnitsSettings() {
  const queryClient = useQueryClient();
  const [label, setLabel] = useState("");
  const [renaming, setRenaming] = useState(null);

  const { data: units = [], isLoading, isError, refetch } = useQuery({
    queryKey: REQUEST_UNITS_KEY,
    queryFn: () => requestUnitService.list(),
  });

  const changed = () => queryClient.invalidateQueries({ queryKey: REQUEST_UNITS_KEY });
  const failed = (error) => toast.error(error?.message || "Could not save the unit.");

  const add = useMutation({
    mutationFn: () => requestUnitService.add(label),
    onSuccess: (row) => {
      toast.success(`${row.label} added.`);
      setLabel("");
      changed();
    },
    onError: failed,
  });

  const rename = useMutation({
    mutationFn: ({ id, value }) => requestUnitService.rename(id, value),
    onSuccess: () => {
      toast.success("Renamed.");
      changed();
    },
    onError: failed,
  });

  const toggle = useMutation({
    mutationFn: ({ id, active }) => requestUnitService.setActive(id, active),
    onSuccess: (row) => {
      toast.success(row.active ? `${row.label} is offered again.` : `${row.label} switched off. Items that use it keep it.`);
      changed();
    },
    onError: failed,
  });

  const move = useMutation({
    mutationFn: ({ id, by }) => {
      const ids = units.map((u) => u.id);
      const from = ids.indexOf(id);
      const to = from + by;
      if (from < 0 || to < 0 || to >= ids.length) return Promise.resolve();
      [ids[from], ids[to]] = [ids[to], ids[from]];
      return requestUnitService.reorder(ids);
    },
    onSuccess: changed,
    onError: failed,
  });

  const busy = add.isPending || toggle.isPending || move.isPending || rename.isPending;

  if (isLoading) return <PageLoading label="the units" />;
  if (isError) return <QueryError title="The units could not be loaded." onRetry={refetch} />;

  return (
    <div className="space-y-4" data-testid="request-units-settings">
      <div>
        <h3 className="text-sm font-semibold text-foreground">Request units</h3>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          The choices in the Unit dropdown next to Quantity on a Purchasing Request. The first one that is on is what a
          new item starts with.
        </p>
      </div>

      <form
        className="flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!busy && label.trim()) add.mutate();
        }}
      >
        <div className="flex-1">
          <Input
            value={label}
            maxLength={24}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Add a unit, like carton"
            aria-label="New unit"
          />
        </div>
        <Button type="submit" className="gap-1.5" disabled={busy || label.trim() === ""}>
          <Plus size={14} />
          Add
        </Button>
      </form>

      <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
        {units.map((unit, index) => (
          <li
            key={unit.id}
            data-testid="request-unit-row"
            className={`flex items-center gap-3 px-4 py-2.5 ${unit.active ? "" : "bg-muted/30"}`}
          >
            <div className="flex shrink-0 flex-col">
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label={`Move ${unit.label} up`}
                disabled={busy || index === 0}
                onClick={() => move.mutate({ id: unit.id, by: -1 })}
              >
                <ArrowUp />
              </Button>
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label={`Move ${unit.label} down`}
                disabled={busy || index === units.length - 1}
                onClick={() => move.mutate({ id: unit.id, by: 1 })}
              >
                <ArrowDown />
              </Button>
            </div>
            <span
              className={`min-w-0 flex-1 truncate text-[13px] font-medium ${
                unit.active ? "text-foreground" : "text-muted-foreground line-through"
              }`}
            >
              {unit.label}
            </span>
            {!unit.active && <StatusBadge theme="mauve" label="Off" />}
            <Button variant="ghost" size="icon-xs" aria-label={`Rename ${unit.label}`} onClick={() => setRenaming(unit)}>
              <Pencil />
            </Button>
            <Switch
              size="sm"
              checked={unit.active}
              disabled={busy}
              aria-label={`${unit.label} is offered`}
              onCheckedChange={(active) => toggle.mutate({ id: unit.id, active })}
            />
          </li>
        ))}
      </ul>

      <p className="text-xs text-muted-foreground">
        A unit that is off is no longer offered for new items, and stays on the items that already use it. Renaming
        changes the list only; items already requested keep the word they were filed with. Units are never deleted.
      </p>

      <EditValueDialog
        open={renaming !== null}
        onOpenChange={(open) => !open && setRenaming(null)}
        title="Rename unit"
        description="New items use the new name. Items already requested keep the old one."
        label="Name"
        initialValue={renaming?.label ?? ""}
        submitLabel="Rename"
        onSubmit={(value) => rename.mutateAsync({ id: renaming.id, value })}
      />
    </div>
  );
}
