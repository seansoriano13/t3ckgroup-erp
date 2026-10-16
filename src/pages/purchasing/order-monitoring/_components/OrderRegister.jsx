import { useMemo } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Check, Pencil } from "lucide-react";

import EmptyState from "../../../../components/ui/EmptyState";
import FilterBar from "../../../../components/ui/FilterBar";
import { FilterSelect } from "../../../../components/ui/FilterDropdown";
import QueryError from "../../../../components/ui/QueryError";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../../../components/ui/table";
import { orderMonitoringService } from "../../../../services/orderMonitoringService";
import { formatAmount } from "../../../../utils/ipas";
import { IPAS_SOURCE_LABELS, IPAS_STATE, IPAS_STATE_LABELS } from "../../../../constants/ipas";
import { ORDER_GROUP, ORDER_OWNER_LABELS } from "../../../../constants/orderMonitoring";
import { HEAD, plural } from "./format";
import { ALL } from "./useOrderRegisterFilters";
import { NextThing, WaitCell } from "./parts";

/**
 * The order register (#264, spec #261): one row per IPAS, filed included and
 * cancelled left out, answering "where is order X". The track is drawn as the
 * IPAS page's status section does: a step is stamped (Odoo, payments, a
 * Transmittal or a hand stamp), typed (a person typed its date) or pending.
 * The hand-off column reads the latest Transmittal and its check result.
 */

const CHECK_LABELS = { open: "Check open", gc: "GC", na: "NA", na_replaced: "NA · replaced" };
const CHECK_TONES = {
  open: "text-amber-11",
  gc: "text-green-11",
  na: "font-semibold text-destructive",
  na_replaced: "text-muted-foreground",
};

/** The buyer track: one circle per step, stamped (tick), typed (pencil) or pending (empty). */
function Track({ row }) {
  return (
    <ol className="flex items-center gap-1" aria-label={`Buyer track for ${row.number}`}>
      {row.buyerTrack.map((step) => {
        const name = `${step.label}, ${step.mark}${step.on ? `, ${step.on}` : ""}`;
        const tone =
          step.mark !== "pending"
            ? "border-green-7 bg-green-3/40 text-green-11"
            : step.partial
              ? "border-amber-7 bg-amber-3/40 text-amber-11"
              : "border-border text-transparent";
        return (
          <li
            key={step.key}
            aria-label={name}
            title={name}
            data-mark={step.mark}
            className={`grid size-5 shrink-0 place-items-center rounded-full border ${tone}`}
          >
            {step.mark === "typed" ? <Pencil size={10} strokeWidth={3} /> : <Check size={12} strokeWidth={3} />}
          </li>
        );
      })}
    </ol>
  );
}

/** The latest Transmittal's stage and the check result on this order's lines. */
function HandOff({ transmittals }) {
  const latest = transmittals?.latest;
  if (!latest) return <span className="text-xs text-muted-foreground">No Transmittal</span>;
  return (
    <div className="flex flex-col">
      <span className="font-mono text-xs font-semibold">{latest.number}</span>
      <span className="text-xs text-muted-foreground">{latest.stateLabel}</span>
      {latest.check && <span className={`text-xs ${CHECK_TONES[latest.check]}`}>{CHECK_LABELS[latest.check]}</span>}
    </div>
  );
}

const optionsOf = (values, allLabel) => [
  { value: ALL, label: allLabel },
  ...[...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b)).map((value) => ({ value, label: value })),
];

/**
 * The register's filter bar. `options` are rows of the unfiltered list, only
 * used to fill the entity, SOR and supplier choices.
 */
export function OrderRegisterToolbar({ register, options }) {
  const { search, setSearch, filters, set, clearAll, hasActiveFilters } = register;
  const choices = useMemo(() => {
    const sors = new Map();
    for (const row of options) for (const sor of row.sors) sors.set(sor.id, sor.salesReference);
    return {
      entity: optionsOf(options.map((row) => row.entity), "All entities"),
      supplier: optionsOf(options.map((row) => row.supplier), "All suppliers"),
      sor: [
        { value: ALL, label: "All SORs" },
        ...[...sors].sort((a, b) => String(a[1]).localeCompare(String(b[1]))).map(([value, label]) => ({ value, label })),
      ],
    };
  }, [options]);

  return (
    <FilterBar
      search={{ value: search, onChange: setSearch, placeholder: "Search IPAS, PO or S number" }}
      chips={
        <>
          <FilterSelect options={choices.entity} value={filters.entity} onChange={set("entity")} label="Entity" className="h-9 w-auto" />
          <FilterSelect
            options={[
              { value: ALL, label: "Import and Local" },
              ...Object.entries(IPAS_SOURCE_LABELS).map(([value, label]) => ({ value, label })),
            ]}
            value={filters.source}
            onChange={set("source")}
            label="Source"
            className="h-9 w-auto"
          />
          <FilterSelect
            options={[
              { value: ALL, label: "Open and filed" },
              ...["open", "filed"].map((value) => ({ value, label: IPAS_STATE_LABELS[value] })),
            ]}
            value={filters.state}
            onChange={set("state")}
            label="State"
            className="h-9 w-auto"
          />
        </>
      }
      filters={
        <div className="flex flex-col gap-2 p-2">
          <FilterSelect options={choices.sor} value={filters.sorId} onChange={set("sorId")} label="SOR" />
          <FilterSelect options={choices.supplier} value={filters.supplier} onChange={set("supplier")} label="Supplier" />
        </div>
      }
      activeCount={[filters.sorId, filters.supplier].filter((value) => value !== ALL).length}
      hasActiveFilters={hasActiveFilters}
      onClearAll={clearAll}
    />
  );
}

/** The register table. `query` comes from `useOrderRegisterFilters`; the filter bar is `OrderRegisterToolbar`. */
export default function OrderRegister({ onOpen, query }) {
  const { data: rows = [], isLoading, isError, refetch } = useQuery({
    queryKey: ["order-monitoring", "register", query],
    queryFn: () => orderMonitoringService.list(query),
    placeholderData: keepPreviousData,
  });

  return (
    <section aria-label="Order register" className="flex flex-col gap-3">
      {isError && <QueryError title="The order register could not be loaded." onRetry={refetch} />}
      {!isError && !isLoading && rows.length === 0 && (
        <EmptyState title="No orders match" description="Change the search or the filters." />
      )}

      {!isError && rows.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          <div className="overflow-x-auto">
            <Table tableId="order-register" className="md:min-w-[72rem]">
              <TableHeader>
                <TableRow className="bg-muted/40 hover:bg-muted/40">
                  {["PO and source", "SOR and entity", "Supplier and item", "Value", "Track", "Next thing", "Hand-off", "Age"].map(
                    (heading) => (
                      <TableHead key={heading} className={HEAD}>
                        {heading}
                      </TableHead>
                    ),
                  )}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id} className="cursor-pointer" onClick={() => onOpen(row.id)}>
                    <TableCell>
                      <span className="font-mono font-semibold">{row.number}</span>
                      <div className="text-xs text-muted-foreground">
                        PO {row.poNumber} · {IPAS_SOURCE_LABELS[row.source] ?? row.source}
                      </div>
                      {row.state === IPAS_STATE.FILED && <div className="text-xs font-semibold text-muted-foreground">Filed</div>}
                    </TableCell>
                    <TableCell>
                      {row.sors.length ? row.sors.map((sor) => sor.salesReference).join(", ") : "No SOR"}
                      <div className="text-xs text-muted-foreground">{row.entity ?? "—"}</div>
                    </TableCell>
                    <TableCell>
                      {row.supplier ?? "—"}
                      <div className="text-xs text-muted-foreground">
                        {row.item?.name ?? "—"}
                        {row.item?.more > 0 && ` +${row.item.more} more`}
                      </div>
                    </TableCell>
                    <TableCell className="tabular-nums">{formatAmount(row.value, row.currency)}</TableCell>
                    <TableCell>
                      <Track row={row} />
                    </TableCell>
                    <TableCell>
                      <NextThing row={row} />
                      {row.next?.owner && (
                        <div className="text-xs text-muted-foreground">{ORDER_OWNER_LABELS[row.next.owner]}</div>
                      )}
                      {row.group !== ORDER_GROUP.FILED && <WaitCell row={row} />}
                    </TableCell>
                    <TableCell>
                      <HandOff transmittals={row.transmittals} />
                    </TableCell>
                    <TableCell className="tabular-nums">{plural(row.ageDays ?? 0, "day")}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}
    </section>
  );
}
