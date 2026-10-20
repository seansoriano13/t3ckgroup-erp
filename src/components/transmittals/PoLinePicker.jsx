import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Plus, Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import ModalShell from "@/components/ui/ModalShell";
import { Input } from "@/components/ui/input";
import PageLoading from "@/components/ui/PageLoading";
import QueryError from "@/components/ui/QueryError";
import { transmittalService } from "@/services/transmittalService";
import { pickedLineLabel } from "@/utils/transmittals";

/**
 * Picks PO lines from the live IPAS for a slip (#252). Shows what the slip
 * needs only: the PO, the IPAS, the item and its quantity and unit. The
 * database returns no prices, supplier or bank columns to a preparer.
 */
export default function PoLinePicker({ open, onOpenChange, onPick }) {
  const [search, setSearch] = useState("");
  const [term, setTerm] = useState("");

  const { data: picks = [], isLoading, isError, refetch } = useQuery({
    queryKey: ["transmittals", "pickable", term],
    queryFn: () => transmittalService.pickablePoLines(term),
    enabled: open,
  });

  return (
    <ModalShell
      open={open}
      onOpenChange={onOpenChange}
      crumbs={["Transmittal", "Add a PO line"]}
      cancelLabel="Close"
    >
      <p className="text-sm text-muted-foreground">Lines from the IPAS purchase orders. Search by PO number or item name.</p>

        <form
          className="flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            setTerm(search.trim());
          }}
        >
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="e.g. P02552 or Cutter" />
          <Button type="submit" variant="outline" className="gap-1.5">
            <Search size={14} />
            Search
          </Button>
        </form>

        <div className="space-y-2">
          {isLoading && <PageLoading label="PO lines" />}
          {isError && <QueryError title="PO lines could not be loaded." onRetry={refetch} />}
          {!isLoading && !isError && picks.length === 0 && (
            <p className="p-4 text-center text-[13px] text-muted-foreground">No live PO lines match.</p>
          )}
          {picks.map((pick) => (
            <div
              key={`${pick.ipasId}-${pick.odooPoLineId}`}
              className="flex items-center justify-between gap-3 rounded-lg border border-border p-3 text-[13px]"
            >
              <div className="min-w-0">
                <p className="truncate font-medium">{pickedLineLabel(pick)}</p>
                <p className="text-muted-foreground">
                  {pick.poNumber} · {pick.ipasNumber}
                  {pick.sors.length > 0 && ` · ${pick.sors.map((s) => s.sales_reference).join(", ")}`}
                </p>
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="shrink-0 gap-1.5"
                onClick={() => {
                  onPick(pick);
                  onOpenChange(false);
                }}
              >
                <Plus size={14} />
                Add
              </Button>
            </div>
          ))}
      </div>
    </ModalShell>
  );
}
