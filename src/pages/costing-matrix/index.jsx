import { useMemo, useState } from "react";
import { Navigate, useNavigate } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { Building2, Calculator, Layers, Link2Off, Plus, TrendingDown } from "lucide-react";

import ProtectedRoute from "../../components/ProtectedRoute";
import HighlightText from "../../components/HighlightText";
import PageShell from "../../components/ui/PageShell";
import { Button } from "../../components/ui/button";
import { NewStandaloneDialog } from "../../components/costing/StandaloneDialogs";
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
import { costingKeys } from "../../components/costing/costingKeys";
import { getPermissionContext } from "../../utils/permissions";
import { filterMatrixPage, matrixPageTotals } from "../../utils/costingMatrixPage";

/**
 * The Costing Matrix page (#606, spec #595): every SOR that has a Costing Matrix with its Planned and
 * Actual Revenue side by side, so margins can be compared without opening each SOR. Closed Book only
 * (Super Admins and the Final Acquire list): the menu offers it to them alone, the page sends anyone
 * else home, and the database refuses the read whatever the screen does. Planned and Actual are worked
 * with the same maths as the SOR's own summary. A row opens that SOR's Costing Matrix in its record window.
 */

const HEAD = "text-label font-bold uppercase tracking-wider";
const RIGHT = "text-right";
const CHIP = "h-9 w-auto gap-2 px-2.5";
const CHIP_WRAPPER = "w-auto shrink-0";
const ALL = "__all__";
const BELOW = "below";
const NO_SOR = "no-sor";

// Stage, Final Offer and Items hide below md so the SOR, project and the three Revenue figures stay in view.
const NARROW_HIDDEN = "hidden md:table-cell";
// Phones show each row as a card (Table `stackOnPhone`): SOR and project on top, the stage as its badge, then three figures.

const COLUMNS = [
  { key: "sor", label: "SOR", phone: "title" },
  { key: "so", label: "SO", phone: "hide" },
  { key: "project", label: "Project", phone: "hide" },
  { key: "stage", label: "Stage", phone: "badge" },
  { key: "offer", label: "Final offer", right: true, phone: "meta" },
  { key: "planned", label: "Planned", right: true, phone: "meta" },
  { key: "actual", label: "Actual", right: true, phone: "meta" },
  { key: "difference", label: "Difference", right: true, phone: "hide" },
  { key: "items", label: "Items bought", right: true, hidden: true, phone: "hide" },
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

const SOR_OPTIONS = [
  { value: ALL, label: "With or without a SOR" },
  { value: NO_SOR, label: "No SOR" },
];

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

function MatrixRow({ row, search }) {
  const navigate = useNavigate();
  // A row opens that SOR's Costing Matrix in its record window, over this list.
  // A standalone evaluation (#966) opens by its own id.
  const openMatrix = (id) => navigate(`/costing-matrix/${id}`);
  const subjectId = row.standalone ? row.matrixId : row.opportunityId;
  const { comparison } = row;
  const lower = comparison.actualLower;
  return (
    <TableRow
      tabIndex={0}
      data-testid="costing-matrix-row"
      data-lower={lower ? "true" : "false"}
      onClick={() => openMatrix(subjectId)}
      onKeyDown={(e) => {
        if (e.key === "Enter" && e.target === e.currentTarget) {
          e.preventDefault();
          openMatrix(subjectId);
        }
      }}
      className={`group cursor-pointer outline-none focus-visible:bg-muted ${lower ? "bg-destructive/10 hover:bg-destructive/15" : ""}`}
    >
      <TableCell className="whitespace-nowrap">
        {row.standalone ? (
          <span className="rounded bg-muted px-1.5 py-0.5 text-xs font-semibold text-muted-foreground" data-testid="costing-matrix-no-sor">
            No SOR
          </span>
        ) : (
          <>
            <span className="font-mono text-xs font-semibold text-foreground">
              <HighlightText text={row.sorNumber} search={search} />
            </span>
            <span className="text-xs font-normal text-muted-foreground md:hidden"> · {row.projectTitle}</span>
          </>
        )}
      </TableCell>
      <TableCell className="whitespace-nowrap">
        <span className="font-mono text-xs text-foreground">{row.soNumber ? <HighlightText text={row.soNumber} search={search} /> : "—"}</span>
      </TableCell>
      <TableCell>
        <span className="block max-w-[22rem] truncate text-xs font-medium text-foreground" title={row.projectTitle}>
          {row.standalone ? <span className="font-normal text-muted-foreground">Started from the S0 alone</span> : <HighlightText text={row.projectTitle} search={search} />}
        </span>
      </TableCell>
      <TableCell>
        <span className="text-xs text-muted-foreground">{row.standalone ? "—" : row.stage || "—"}</span>
      </TableCell>
      <TableCell className={`${RIGHT} text-xs tabular-nums max-md:text-left`}>{figure(row.finalOffer)}</TableCell>
      <TableCell className={`${RIGHT} text-xs tabular-nums max-md:text-left`} data-testid="costing-matrix-planned">
        {figure(comparison.planned)}
      </TableCell>
      <TableCell className={`${RIGHT} text-xs tabular-nums max-md:text-left`} data-testid="costing-matrix-actual">
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
        {row.standalone ? "—" : `${comparison.itemsBought} of ${comparison.itemsTotal}`}
      </TableCell>
    </TableRow>
  );
}

/** The totals for the rows shown (all of them, not just this page). */
function TotalsRow({ totals }) {
  const lower = totals.difference < 0;
  return (
    <TableRow className="bg-muted/40 font-semibold hover:bg-muted/40 max-md:hidden!" data-testid="costing-matrix-totals">
      <TableCell colSpan={3} className="text-xs">
        Total of {totals.count} {totals.count === 1 ? "SOR" : "SORs"} shown
        {totals.incomplete > 0 && (
          <span className="ml-2 font-normal text-muted-foreground" data-testid="costing-matrix-incomplete">
            {totals.incomplete} without a figure yet, left out
          </span>
        )}
      </TableCell>
      <TableCell />
      <TableCell className={`${RIGHT} text-xs tabular-nums`} data-testid="costing-matrix-total-offer">
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

export function CostingMatrixList() {
  const [stage, setStage] = useState(null);
  const [entity, setEntity] = useState(null);
  const [margin, setMargin] = useState(null);
  const [sorKind, setSorKind] = useState(null);
  const [search, setSearch] = useState("");
  const [starting, setStarting] = useState(false);
  const navigate = useNavigate();
  const { user } = useAuth();
  const permissions = getPermissionContext(user);

  // The SORs' rows are the Closed Book's (the database refuses anyone else); someone only named on a standalone
  // evaluation (#966) sees just those.
  const { data: sorRows = [], isLoading: sorLoading, isError: sorError, refetch: refetchSors } = useQuery({
    queryKey: costingKeys.matrixPage,
    queryFn: () => costingMatrixService.matrixPage(),
    enabled: permissions.isBidDecider,
  });
  const { data: standaloneRows = [], isLoading: standaloneLoading, isError: standaloneError, refetch: refetchStandalone } = useQuery({
    queryKey: costingKeys.standalonePage,
    queryFn: () => costingMatrixService.standalonePage(),
  });
  const rows = useMemo(() => [...standaloneRows, ...sorRows], [standaloneRows, sorRows]);
  const isLoading = (permissions.isBidDecider && sorLoading) || standaloneLoading;
  const isError = sorError || standaloneError;
  const refetch = () => {
    if (permissions.isBidDecider) refetchSors();
    refetchStandalone();
  };

  const stageOptions = useMemo(
    () => [{ value: ALL, label: "Any stage" }, ...[...new Set(rows.map((r) => r.stage).filter(Boolean))].sort().map((s) => ({ value: s, label: s }))],
    [rows],
  );
  const entityOptions = useMemo(
    () => [{ value: ALL, label: "Any entity" }, ...[...new Set(rows.flatMap((r) => r.entities))].sort().map((e) => ({ value: e, label: e }))],
    [rows],
  );

  const filtered = useMemo(
    () => filterMatrixPage(rows, { stage, entity, belowPlanned: margin === BELOW, noSor: sorKind === NO_SOR, search }),
    [rows, stage, entity, margin, sorKind, search],
  );
  const totals = useMemo(() => matrixPageTotals(filtered), [filtered]);
  const { sorted: visible, sort, toggle } = useTableSort(filtered, SORT);
  const paging = usePaging(visible);

  const hasActiveFilters = search !== "" || stage !== null || entity !== null || margin !== null || sorKind !== null;

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
          <FilterSelect
            icon={Link2Off}
            label="SOR"
            options={SOR_OPTIONS}
            value={sorKind ?? ALL}
            onChange={(v) => setSorKind(v === ALL ? null : v)}
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
        setSorKind(null);
      }}
    />
  );

  return (
    <PageShell
      title="S0 Evaluation"
      description="Every SOR's costing you can see, with Planned and Actual Revenue, and the evaluations started from an S0 alone. Open one to work its matrix."
      toolbar={toolbar}
      action={
        permissions.isBidDecider ? (
          <Button type="button" size="sm" onClick={() => setStarting(true)} data-testid="new-standalone">
            <Plus size={14} aria-hidden="true" />
            New evaluation from an S0
          </Button>
        ) : null
      }
    >
      <NewStandaloneDialog open={starting} onOpenChange={setStarting} onOpen={(subjectId) => navigate(`/costing-matrix/${subjectId}`)} />
      {isLoading && <PageLoading label="S0 Evaluation" />}

      {isError && <QueryError title="The S0 Evaluation page could not be loaded." onRetry={refetch} />}

      {!isLoading && !isError && visible.length === 0 && (
        <EmptyState
          icon={Calculator}
          title={rows.length === 0 ? "No S0 Evaluation yet" : "No matching evaluation"}
          description={
            rows.length === 0
              ? "An SOR appears here once it has an S0 Evaluation, or start one from an S0 with the button above."
              : "Nothing matches. Try another search or clear the filters."
          }
        />
      )}

      {!isLoading && !isError && visible.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          <div className="overflow-x-auto">
            <Table tableId="costing-matrix" stackOnPhone className="md:min-w-[60rem]">
              <TableHeader>
                <TableRow className="bg-muted/40 hover:bg-muted/40">
                  {COLUMNS.map((column) => (
                    <SortHead
                      key={column.key}
                      id={`costing-matrix-${column.key}`}
                      phone={column.phone}
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
                  <MatrixRow key={row.standalone ? row.matrixId : row.opportunityId} row={row} search={search} />
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

// Every employee can type the address; only the Closed Book and the people named on a standalone evaluation (#966)
// get past this, and the database refuses the read to anyone else whatever the screen does.
function ClosedBookOnly({ children }) {
  const { user } = useAuth();
  if (!getPermissionContext(user).canOpenCostingPage) return <Navigate to="/" replace />;
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
