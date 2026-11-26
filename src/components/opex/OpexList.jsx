import { useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { Banknote, CalendarClock, Plus } from "lucide-react";

import PageShell from "@/components/ui/PageShell";
import EmptyState from "@/components/ui/EmptyState";
import QueryError from "@/components/ui/QueryError";
import PageLoading from "@/components/ui/PageLoading";
import TabGroup from "@/components/ui/TabGroup";
import FilterBar from "@/components/ui/FilterBar";
import { FilterSelect } from "@/components/ui/FilterDropdown";
import { Button } from "@/components/ui/button";
import { TablePager } from "@/components/ui/TablePager";
import { SortHead, Table, TableBody, TableCell, TableHeader, TableRow } from "@/components/ui/table";
import { IdentityCell } from "@/components/purchasing/list/IdentityCell";
import { StateCell, STATE_HEAD_CLASS } from "@/components/purchasing/list/StateCell";
import ExportButton from "@/components/purchasing/list/ExportButton";
import { usePaging } from "@/hooks/usePaging";
import { useTableSort } from "@/hooks/useTableSort";
import { opexReportService } from "@/services/opexReportService";
import { formatPesos } from "@/utils/opexReport";
import { listDate } from "@/utils/listDates";
import {
  OPEX_EXPORT_HEADER,
  OPEX_HEALTH,
  OPEX_HEALTH_LOOK,
  OPEX_READ_FILTER,
  OPEX_STATE_FILTER,
  filterOpexRows,
  inOpexState,
  opexExportRows,
  opexListRow,
  opexTotals,
} from "@/utils/opexList";
import { NewOpexReportDialog } from "./OpexDialogs";
import { opexKeys, useOpexSettings, usePrefetchOpexReport } from "./useOpexReport";

/**
 * The OPEX list (spec #1241, redesign 2026-11-26), built like the Purchasing lists: state pills
 * with counts, one filter bar with Export last, the table, a totals band and a pager. Every row
 * comes from its saved snapshot, so the list never calls Odoo. A row opens the report in its
 * window over the list; `children` is that window.
 */

const HEAD = "text-label font-bold uppercase tracking-wider";
const CHIP = "h-9 w-auto gap-2 px-2.5";
const CHIP_WRAPPER = "w-auto shrink-0";
const ALL = "__all__";
const NARROW = "hidden md:table-cell";

const READ_OPTIONS = [
  { value: ALL, label: "Read any time" },
  { value: OPEX_READ_FILTER.WEEK, label: "Read this week" },
  { value: OPEX_READ_FILTER.STALE, label: "Not read for 30 days" },
];

const COLUMNS = [
  { key: "s0", label: "S0", phone: "title" },
  { key: "contract", label: "Contract price", right: true, phone: "meta" },
  { key: "product", label: "Product cost", right: true, narrow: true, phone: "hide" },
  { key: "opsAdmin", label: "Operation & Admin", right: true, narrow: true, phone: "hide" },
  { key: "marketing", label: "Marketing", right: true, narrow: true, phone: "hide" },
  { key: "actualOpex", label: "Actual OPEX", right: true, phone: "meta" },
  { key: "revenue", label: "Revenue", right: true, phone: "meta" },
  { key: "pct", label: "Revenue %", right: true, phone: "hide" },
  { key: "readAt", label: "Last read", narrow: true, phone: "hide" },
  { key: "health", label: "State", right: true, phone: "badge" },
];

const HEALTH_ORDER = [OPEX_HEALTH.LOSS, OPEX_HEALTH.BELOW, OPEX_HEALTH.ON_TARGET, OPEX_HEALTH.UNREAD];
const SORT = {
  s0: (r) => r.s0,
  contract: (r) => r.contract,
  product: (r) => r.product,
  opsAdmin: (r) => r.opsAdmin,
  marketing: (r) => r.marketing,
  actualOpex: (r) => r.actualOpex,
  revenue: (r) => r.revenue,
  pct: (r) => r.pct,
  readAt: (r) => (r.readAt ? new Date(r.readAt).getTime() : null),
  health: (r) => HEALTH_ORDER.indexOf(r.health),
};
const TONES = Object.fromEntries(Object.entries(OPEX_HEALTH_LOOK).map(([key, look]) => [key, look.theme]));

const blank = <span className="font-normal text-muted-foreground">—</span>;
const money = (v) => (v === null || v === undefined ? blank : formatPesos(v));
const percent = (v) => (v === null || v === undefined ? blank : `${Number(v).toFixed(2)}%`);
const FIGURE = "text-right text-xs tabular-nums max-md:text-left";

function OpexRow({ row, search, active, onOpen, onHover }) {
  return (
    <TableRow
      tabIndex={0}
      data-testid="opex-row"
      data-active={active ? "true" : undefined}
      onClick={() => onOpen(row.s0)}
      onMouseEnter={() => onHover(row.s0)}
      onFocus={() => onHover(row.s0)}
      onKeyDown={(e) => {
        if (e.key === "Enter" && e.target === e.currentTarget) {
          e.preventDefault();
          onOpen(row.s0);
        }
      }}
      className="group cursor-pointer outline-none focus-visible:bg-muted data-[active=true]:bg-muted"
    >
      <IdentityCell reference={row.s0} name={row.project ?? "No Project tag in Odoo"} search={search} />
      <TableCell className={FIGURE}>{money(row.contract)}</TableCell>
      <TableCell className={`${FIGURE} ${NARROW}`}>{money(row.product)}</TableCell>
      <TableCell className={`${FIGURE} ${NARROW}`}>{money(row.opsAdmin)}</TableCell>
      <TableCell className={`${FIGURE} ${NARROW}`}>{money(row.marketing)}</TableCell>
      <TableCell className={FIGURE}>{money(row.actualOpex)}</TableCell>
      <TableCell className={`${FIGURE} ${row.health === OPEX_HEALTH.LOSS ? "font-semibold text-red-11" : ""}`}>{money(row.revenue)}</TableCell>
      <TableCell className="text-right text-xs tabular-nums">{percent(row.pct)}</TableCell>
      <TableCell className={`text-xs text-muted-foreground ${NARROW}`}>{row.readAt ? listDate(row.readAt) : "Not read"}</TableCell>
      <StateCell state={row.health} tones={TONES} label={OPEX_HEALTH_LOOK[row.health].label} />
    </TableRow>
  );
}

export default function OpexList({ openS0 = null, children }) {
  const navigate = useNavigate();
  const prefetch = usePrefetchOpexReport();
  const [state, setState] = useState(OPEX_STATE_FILTER.ALL);
  const [search, setSearch] = useState("");
  const [readWhen, setReadWhen] = useState(null);
  const [creating, setCreating] = useState(false);

  // isPending, not isLoading: a paused retry must not fall through to "No OPEX Reports yet" (#1235).
  const { data: listed = [], isPending, isError, refetch } = useQuery({ queryKey: opexKeys.list, queryFn: () => opexReportService.list() });
  const { data: settings } = useOpexSettings();
  const goLine = Number(settings?.goLinePercent ?? 20);
  const rows = useMemo(() => listed.map((row) => opexListRow(row, goLine)), [listed, goLine]);

  // Search and Last read narrow first; the state pills count within that.
  const scoped = useMemo(() => filterOpexRows(rows, { search, readWhen }), [rows, search, readWhen]);
  const filtered = useMemo(() => scoped.filter((r) => inOpexState(r, state)), [scoped, state]);
  const { sorted: visible, sort, toggle } = useTableSort(filtered, SORT);
  const paging = usePaging(visible);
  const totals = opexTotals(visible);
  const count = (s) => scoped.filter((r) => inOpexState(r, s)).length;
  const hasActiveFilters = search !== "" || readWhen !== null;
  const open = (s0) => navigate(`/finance/opex/${s0}`);

  const toolbar = (
    <>
      <TabGroup
        variant="pill"
        size="sm"
        activeTab={state}
        onChange={setState}
        tabs={[
          { value: OPEX_STATE_FILTER.ALL, label: "All", badge: scoped.length },
          { value: OPEX_STATE_FILTER.BELOW, label: "Below go line", badge: count(OPEX_STATE_FILTER.BELOW) },
          { value: OPEX_STATE_FILTER.ON_TARGET, label: "On target", badge: count(OPEX_STATE_FILTER.ON_TARGET) },
        ]}
      />
      <FilterBar
        search={{ value: search, onChange: setSearch, placeholder: "Search S0 or project" }}
        chips={
          <FilterSelect
            icon={CalendarClock}
            label="Last read"
            options={READ_OPTIONS}
            value={readWhen ?? ALL}
            onChange={(v) => setReadWhen(v === ALL ? null : v)}
            allValue={ALL}
            className={CHIP}
            wrapperClassName={CHIP_WRAPPER}
          />
        }
        actions={<ExportButton name="opex-reports" sheetName="OPEX" header={OPEX_EXPORT_HEADER} rows={opexExportRows(visible)} />}
        hasActiveFilters={hasActiveFilters}
        onClearAll={() => {
          setSearch("");
          setReadWhen(null);
        }}
      />
    </>
  );

  return (
    <PageShell
      title="OPEX Report"
      description="What Odoo says each project really spent, one report per S0."
      action={
        <Button size="sm" onClick={() => setCreating(true)} className="gap-1.5">
          <Plus size={14} />
          New OPEX Report
        </Button>
      }
      toolbar={toolbar}
    >
      {isPending && <PageLoading label="OPEX Reports" />}
      {isError && <QueryError title="OPEX Reports could not be loaded." onRetry={refetch} />}

      {!isPending && !isError && visible.length === 0 && (
        <EmptyState
          icon={Banknote}
          title={rows.length === 0 ? "No OPEX Reports yet" : "No matching report"}
          description={rows.length === 0 ? "Start one from an S0 number." : "Nothing in this slice. Try another pill or clear the filters."}
        />
      )}

      {!isPending && !isError && visible.length > 0 && (
        // No overflow-hidden here: the table's "Reset columns" sits just above this card.
        <div className="rounded-xl border border-border bg-card [&_thead_tr]:rounded-t-xl [&_th:first-child]:rounded-tl-xl [&_th:last-child]:rounded-tr-xl">
          <Table tableId="opex-reports" resetAbove stackOnPhone className="md:min-w-[60rem]">
            <TableHeader>
              <TableRow className="bg-muted/40 hover:bg-muted/40">
                {COLUMNS.map((c) => (
                  <SortHead
                    key={c.key}
                    id={c.key}
                    phone={c.phone}
                    sortKey={c.key}
                    sort={sort}
                    onSort={toggle}
                    className={`${HEAD} ${c.right ? "text-right" : ""} ${c.key === "health" ? STATE_HEAD_CLASS : ""} ${c.narrow ? NARROW : ""}`}
                  >
                    {c.label}
                  </SortHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {paging.rows.map((row) => (
                <OpexRow key={row.id} row={row} search={search} active={row.s0 === openS0} onOpen={open} onHover={prefetch} />
              ))}
            </TableBody>
          </Table>
          <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1 border-t border-border bg-muted/30 px-4 py-2.5 text-xs" data-testid="opex-totals">
            <span className="font-bold uppercase tracking-wider text-muted-foreground">Totals for {totals.count} shown</span>
            <span className="tabular-nums text-foreground">
              Contract price {money(totals.contract)} · Actual OPEX {money(totals.actualOpex)} · Revenue {money(totals.revenue)}
              {totals.pct !== null && ` (${totals.pct.toFixed(2)}%)`}
            </span>
          </div>
          <TablePager {...paging} noun="reports" />
        </div>
      )}

      <NewOpexReportDialog open={creating} onOpenChange={setCreating} />
      {children}
    </PageShell>
  );
}
