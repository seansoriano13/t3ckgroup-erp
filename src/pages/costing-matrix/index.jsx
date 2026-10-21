import { useMemo, useState } from "react";
import { Navigate } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { Building2, Calculator, Layers, TrendingDown } from "lucide-react";

import ProtectedRoute from "../../components/ProtectedRoute";
import HighlightText from "../../components/HighlightText";
import PageShell from "../../components/ui/PageShell";
import EmptyState from "../../components/ui/EmptyState";
import QueryError from "../../components/ui/QueryError";
import PageLoading from "../../components/ui/PageLoading";
import FilterBar from "../../components/ui/FilterBar";
import { FilterSelect } from "../../components/ui/FilterDropdown";
import { TablePager } from "../../components/ui/TablePager";
import { SortHead, Table, TableBody, TableCell, TableHeader, TableRow } from "../../components/ui/table";
import { pesos } from "../../components/costing/gridFormat";
import { usePaging } from "../../hooks/usePaging";
import { useTableSort } from "../../hooks/useTableSort";
import { useAuth } from "../../context/AuthContext";
import { costingMatrixService } from "../../services/costingMatrixService";
import { getPermissionContext } from "../../utils/permissions";
import { filterMatrixPage, matrixPageTotals } from "../../utils/costingMatrixPage";

/**
 * The Costing Matrix page (#606, spec #595): every SOR that has a Costing Matrix with its Planned and
 * Actual Revenue side by side, so margins can be compared without opening each SOR. Closed Book only
 * (Super Admins and the Final Acquire list): the menu offers it to them alone, the page sends anyone
 * else home, and the database refuses the read whatever the screen does. Planned and Actual are worked
 * with the same maths as the SOR's own summary. A row opens that SOR's Costing Matrix (PMS) tab.
 */

const HEAD = "text-label font-bold uppercase tracking-wider";
const RIGHT = "text-right";
const CHIP = "h-9 w-auto gap-2 px-2.5";
const CHIP_WRAPPER = "w-auto shrink-0";
const ALL = "__all__";
const BELOW = "below";

// Stage, Final Offer and Items hide below md so the SOR, project and the three Revenue figures stay in view.
const NARROW_HIDDEN = "hidden md:table-cell";

const COLUMNS = [
  { key: "sor", label: "SOR" },
  { key: "so", label: "SO" },
  { key: "project", label: "Project" },
  { key: "stage", label: "Stage", hidden: true },
  { key: "offer", label: "Final Offer", right: true, hidden: true },
  { key: "planned", label: "Planned Revenue", right: true },
  { key: "actual", label: "Actual Revenue", right: true },
  { key: "difference", label: "Difference", right: true },
  { key: "items", label: "Items bought", right: true, hidden: true },
];

const SORT = {
  sor: (r) => r.sorNumber,
  so: (r) => r.soNumber,
  project: (r) => r.projectTitle,
  stage: (r) => r.stage,
  offer: (r) => r.finalOffer,
  planned: (r) => r.comparison.planned,
  actual: (r) => r.comparison.actual,
  difference: (r) => r.comparison.difference,
  items: (r) => (r.comparison.itemsTotal === 0 ? null : r.comparison.itemsBought / r.comparison.itemsTotal),
};

const MARGIN_OPTIONS = [
  { value: ALL, label: "Any margin" },
  { value: BELOW, label: "Actual below Planned" },
];

const blank = <span className="font-normal text-muted-foreground">—</span>;
const figure = (value) => (value === null || value === undefined ? blank : pesos(value));
const signed = (value) => (value === null || value === undefined ? blank : `${value > 0 ? "+" : ""}${pesos(value)}`);

/** Actual is an estimate while any IPAS of the SOR is short of LC Odoo Done (the same mark as the SOR's summary). */
function EstimateMark({ testId }) {
  return (
    <span
      className="ml-1.5 rounded bg-amber-a3 px-1.5 py-0.5 text-xs font-normal text-amber-12"
      data-testid={testId}
      title="An IPAS of this SOR has not reached LC Odoo Done yet"
    >
      estimate
    </span>
  );
}

function openMatrix(opportunityId) {
  window.dispatchEvent(new CustomEvent("OPEN_ENTITY_DETAILS", { detail: { id: opportunityId, type: "OPPORTUNITY", view: "pms" } }));
}

function MatrixRow({ row, search }) {
  const { comparison } = row;
  const lower = comparison.actualLower;
  return (
    <TableRow
      tabIndex={0}
      data-testid="costing-matrix-row"
      data-lower={lower ? "true" : "false"}
      onClick={() => openMatrix(row.opportunityId)}
      onKeyDown={(e) => {
        if (e.key === "Enter" && e.target === e.currentTarget) {
          e.preventDefault();
          openMatrix(row.opportunityId);
        }
      }}
      className={`group cursor-pointer outline-none focus-visible:bg-muted ${lower ? "bg-destructive/10 hover:bg-destructive/15" : ""}`}
    >
      <TableCell>
        <span className="font-mono text-xs font-semibold text-foreground">
          <HighlightText text={row.sorNumber} search={search} />
        </span>
      </TableCell>
      <TableCell>
        <span className="font-mono text-xs text-foreground">{row.soNumber ? <HighlightText text={row.soNumber} search={search} /> : "—"}</span>
      </TableCell>
      <TableCell>
        <span className="block max-w-[22rem] truncate text-xs font-medium text-foreground" title={row.projectTitle}>
          <HighlightText text={row.projectTitle} search={search} />
        </span>
      </TableCell>
      <TableCell className={NARROW_HIDDEN}>
        <span className="text-xs text-muted-foreground">{row.stage || "—"}</span>
      </TableCell>
      <TableCell className={`${NARROW_HIDDEN} ${RIGHT} text-xs tabular-nums`}>{figure(row.finalOffer)}</TableCell>
      <TableCell className={`${RIGHT} text-xs tabular-nums`} data-testid="costing-matrix-planned">
        {figure(comparison.planned)}
      </TableCell>
      <TableCell className={`${RIGHT} text-xs tabular-nums`} data-testid="costing-matrix-actual">
        {figure(comparison.actual)}
        {comparison.estimate && comparison.actual !== null && <EstimateMark testId="costing-matrix-estimate" />}
      </TableCell>
      <TableCell
        className={`${RIGHT} text-xs tabular-nums ${lower ? "font-semibold text-destructive" : "text-muted-foreground"}`}
        data-testid="costing-matrix-difference"
      >
        {signed(comparison.difference)}
      </TableCell>
      <TableCell className={`${NARROW_HIDDEN} ${RIGHT} text-xs tabular-nums text-muted-foreground`} data-testid="costing-matrix-items">
        {comparison.itemsBought} of {comparison.itemsTotal}
      </TableCell>
    </TableRow>
  );
}

/** The totals for the rows shown (all of them, not just this page). */
function TotalsRow({ totals }) {
  const lower = totals.difference < 0;
  return (
    <TableRow className="bg-muted/40 font-semibold hover:bg-muted/40" data-testid="costing-matrix-totals">
      <TableCell colSpan={3} className="text-xs">
        Total of {totals.count} {totals.count === 1 ? "SOR" : "SORs"} shown
        {totals.incomplete > 0 && (
          <span className="ml-2 font-normal text-muted-foreground" data-testid="costing-matrix-incomplete">
            {totals.incomplete} without a figure yet, left out
          </span>
        )}
      </TableCell>
      <TableCell className={NARROW_HIDDEN} />
      <TableCell className={`${NARROW_HIDDEN} ${RIGHT} text-xs tabular-nums`} data-testid="costing-matrix-total-offer">
        {pesos(totals.finalOffer)}
      </TableCell>
      <TableCell className={`${RIGHT} text-xs tabular-nums`} data-testid="costing-matrix-total-planned">
        {pesos(totals.planned)}
      </TableCell>
      <TableCell className={`${RIGHT} text-xs tabular-nums`} data-testid="costing-matrix-total-actual">
        {pesos(totals.actual)}
        {totals.estimate && <EstimateMark testId="costing-matrix-total-estimate" />}
      </TableCell>
      <TableCell className={`${RIGHT} text-xs tabular-nums ${lower ? "text-destructive" : ""}`} data-testid="costing-matrix-total-difference">
        {signed(totals.difference)}
      </TableCell>
      <TableCell className={`${NARROW_HIDDEN} ${RIGHT} text-xs tabular-nums`} data-testid="costing-matrix-total-items">
        {totals.itemsBought} of {totals.itemsTotal}
      </TableCell>
    </TableRow>
  );
}

function CostingMatrixList() {
  const [stage, setStage] = useState(null);
  const [entity, setEntity] = useState(null);
  const [margin, setMargin] = useState(null);
  const [search, setSearch] = useState("");

  const { data: rows = [], isLoading, isError, refetch } = useQuery({
    queryKey: ["costingMatrixPage"],
    queryFn: () => costingMatrixService.matrixPage(),
  });

  const stageOptions = useMemo(
    () => [{ value: ALL, label: "Any stage" }, ...[...new Set(rows.map((r) => r.stage).filter(Boolean))].sort().map((s) => ({ value: s, label: s }))],
    [rows],
  );
  const entityOptions = useMemo(
    () => [{ value: ALL, label: "Any entity" }, ...[...new Set(rows.flatMap((r) => r.entities))].sort().map((e) => ({ value: e, label: e }))],
    [rows],
  );

  const filtered = useMemo(
    () => filterMatrixPage(rows, { stage, entity, belowPlanned: margin === BELOW, search }),
    [rows, stage, entity, margin, search],
  );
  const totals = useMemo(() => matrixPageTotals(filtered), [filtered]);
  const { sorted: visible, sort, toggle } = useTableSort(filtered, SORT);
  const paging = usePaging(visible);

  const hasActiveFilters = search !== "" || stage !== null || entity !== null || margin !== null;

  const toolbar = (
    <FilterBar
      search={{ value: search, onChange: setSearch, placeholder: "Search SO number, SOR number or project" }}
      chips={
        <>
          <FilterSelect
            icon={Layers}
            label="Stage"
            options={stageOptions}
            value={stage ?? ALL}
            onChange={(v) => setStage(v === ALL ? null : v)}
            allValue={ALL}
            className={CHIP}
            wrapperClassName={CHIP_WRAPPER}
          />
          <FilterSelect
            icon={Building2}
            label="Entity"
            options={entityOptions}
            value={entity ?? ALL}
            onChange={(v) => setEntity(v === ALL ? null : v)}
            allValue={ALL}
            className={CHIP}
            wrapperClassName={CHIP_WRAPPER}
          />
          <FilterSelect
            icon={TrendingDown}
            label="Margin"
            options={MARGIN_OPTIONS}
            value={margin ?? ALL}
            onChange={(v) => setMargin(v === ALL ? null : v)}
            allValue={ALL}
            className={CHIP}
            wrapperClassName={CHIP_WRAPPER}
          />
        </>
      }
      hasActiveFilters={hasActiveFilters}
      onClearAll={() => {
        setSearch("");
        setStage(null);
        setEntity(null);
        setMargin(null);
      }}
    />
  );

  return (
    <PageShell
      title="Costing Matrix"
      description="Every SOR's costing with Planned and Actual Revenue. Closed Book only."
      toolbar={toolbar}
    >
      {isLoading && <PageLoading label="Costing Matrix" />}

      {isError && <QueryError title="The Costing Matrix page could not be loaded." onRetry={refetch} />}

      {!isLoading && !isError && visible.length === 0 && (
        <EmptyState
          icon={Calculator}
          title={rows.length === 0 ? "No Costing Matrix yet" : "No matching SOR"}
          description={
            rows.length === 0
              ? "An SOR appears here once it has a Costing Matrix."
              : "Nothing matches. Try another search or clear the filters."
          }
        />
      )}

      {!isLoading && !isError && visible.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          <div className="overflow-x-auto">
            <Table tableId="costing-matrix" className="md:min-w-[60rem]">
              <TableHeader>
                <TableRow className="bg-muted/40 hover:bg-muted/40">
                  {COLUMNS.map((column) => (
                    <SortHead
                      key={column.key}
                      id={`costing-matrix-${column.key}`}
                      sortKey={column.key}
                      sort={sort}
                      onSort={toggle}
                      className={`${HEAD} ${column.right ? RIGHT : ""} ${column.hidden ? NARROW_HIDDEN : ""}`}
                    >
                      {column.label}
                    </SortHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {paging.rows.map((row) => (
                  <MatrixRow key={row.opportunityId} row={row} search={search} />
                ))}
                <TotalsRow totals={totals} />
              </TableBody>
            </Table>
          </div>
          <TablePager {...paging} noun="SORs" />
        </div>
      )}
    </PageShell>
  );
}

// Every employee can type the address; only the Closed Book gets past this, and the database refuses
// the read to anyone else whatever the screen does.
function ClosedBookOnly({ children }) {
  const { user } = useAuth();
  if (!getPermissionContext(user).isBidDecider) return <Navigate to="/" replace />;
  return children;
}

export default function CostingMatrixPage() {
  return (
    <ProtectedRoute>
      <ClosedBookOnly>
        <CostingMatrixList />
      </ClosedBookOnly>
    </ProtectedRoute>
  );
}
