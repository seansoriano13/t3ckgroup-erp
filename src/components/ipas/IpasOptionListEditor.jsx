import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { ArrowDown, ArrowUp, Pencil, Plus } from "lucide-react";

import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Switch } from "../ui/switch";
import Spinner from "../ui/Spinner";
import QueryError from "../ui/QueryError";
import StatusBadge from "../StatusBadge";
import EditValueDialog from "./EditValueDialog";
import { ipasService } from "../../services/ipasService";
import { IPAS_OPTION_LIST_LABELS, IPAS_OPTION_LIST_NOUNS } from "../../constants/ipas";
import { ipasErrorMessage } from "../../utils/ipas";
import { ipasOptionsKey } from "./ipasKeys";

/**
 * One option list of the IPAS settings (#244): add, rename, reorder and
 * deactivate. Options are never deleted. A deactivated option is no longer
 * offered for new rows and stays on the rows that already use it. Writable by
 * Purchasing access and Super Admins (the database decides).
 */
export default function IpasOptionListEditor({ list }) {
  const queryClient = useQueryClient();
  const noun = IPAS_OPTION_LIST_NOUNS[list] ?? "option";
  const [label, setLabel] = useState("");
  const [renaming, setRenaming] = useState(null);

  const { data: options = [], isLoading, isError, refetch } = useQuery({
    queryKey: ipasOptionsKey(list),
    queryFn: () => ipasService.listOptions(list),
  });

  const changed = () => {
    queryClient.invalidateQueries({ queryKey: ipasOptionsKey(list) });
    // Open IPAS pages read the options with the IPAS.
    queryClient.invalidateQueries({ queryKey: ["ipas", "one"] });
  };
  const failed = (error) => toast.error(ipasErrorMessage(error));

  const add = useMutation({
    mutationFn: () => ipasService.saveOption({ list, label }),
    onSuccess: (row) => {
      toast.success(`${row.label} added.`);
      setLabel("");
      changed();
    },
    onError: failed,
  });

  const rename = useMutation({
    mutationFn: ({ id, value }) => ipasService.saveOption({ id, list, label: value }),
    onSuccess: () => {
      toast.success("Renamed.");
      changed();
    },
    onError: failed,
  });

  const toggle = useMutation({
    mutationFn: ({ id, active }) => ipasService.setOptionActive(id, active),
    onSuccess: (row) => {
      toast.success(row.active ? `${row.label} is offered again.` : `${row.label} deactivated. Rows that use it keep it.`);
      changed();
    },
    onError: failed,
  });

  const move = useMutation({
    mutationFn: ({ id, by }) => {
      const ids = options.map((o) => o.id);
      const from = ids.indexOf(id);
      const to = from + by;
      if (from < 0 || to < 0 || to >= ids.length) return Promise.resolve();
      [ids[from], ids[to]] = [ids[to], ids[from]];
      return ipasService.reorderOptions(list, ids);
    },
    onSuccess: changed,
    onError: failed,
  });

  const busy = add.isPending || toggle.isPending || move.isPending || rename.isPending;

  if (isLoading) {
    return (
      <div className="flex justify-center py-16">
        <Spinner />
      </div>
    );
  }
  if (isError) return <QueryError title="This list could not be loaded." onRetry={refetch} />;

  return (
    <div className="space-y-4">
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
            onChange={(e) => setLabel(e.target.value)}
            placeholder={`Add a ${noun}`}
            aria-label={`New ${noun}`}
          />
        </div>
        <Button type="submit" className="gap-1.5" disabled={busy || label.trim() === ""}>
          <Plus size={14} />
          Add
        </Button>
      </form>

      {options.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-4 py-6 text-sm text-muted-foreground">
          Nothing on the {IPAS_OPTION_LIST_LABELS[list]?.toLowerCase() ?? "list"} yet.
        </p>
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
          {options.map((option, index) => (
            <li
              key={option.id}
              data-testid="ipas-option-row"
              className={`flex items-center gap-3 px-4 py-2.5 ${option.active ? "" : "bg-muted/30"}`}
            >
              <div className="flex shrink-0 flex-col">
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label={`Move ${option.label} up`}
                  disabled={busy || index === 0}
                  onClick={() => move.mutate({ id: option.id, by: -1 })}
                >
                  <ArrowUp />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label={`Move ${option.label} down`}
                  disabled={busy || index === options.length - 1}
                  onClick={() => move.mutate({ id: option.id, by: 1 })}
                >
                  <ArrowDown />
                </Button>
              </div>

              <span
                className={`min-w-0 flex-1 truncate text-[13px] font-medium ${
                  option.active ? "text-foreground" : "text-muted-foreground line-through"
                }`}
              >
                {option.label}
              </span>
              {!option.active && <StatusBadge theme="mauve" label="Deactivated" />}

              <Button
                variant="ghost"
                size="icon-xs"
                aria-label={`Rename ${option.label}`}
                onClick={() => setRenaming(option)}
              >
                <Pencil />
              </Button>
              <Switch
                size="sm"
                checked={option.active}
                disabled={busy}
                aria-label={`${option.label} is offered`}
                onCheckedChange={(active) => toggle.mutate({ id: option.id, active })}
              />
            </li>
          ))}
        </ul>
      )}

      <p className="text-xs text-muted-foreground">
        A deactivated {noun} is no longer offered for new rows, and stays on the rows that already use it. Options are
        never deleted.
      </p>

      <EditValueDialog
        open={renaming !== null}
        onOpenChange={(open) => !open && setRenaming(null)}
        title={`Rename ${noun}`}
        description="Rows that use it show the new name."
        label="Name"
        initialValue={renaming?.label ?? ""}
        submitLabel="Rename"
        onSubmit={(value) => rename.mutateAsync({ id: renaming.id, value })}
      />
    </div>
  );
}
