import { manilaToday } from "@/lib/manilaDate.js";
import { useCallback, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import { Building2, Calculator, CircleDot, Columns3, Download, Eye, Layers, Plus, ReceiptText, Settings2 } from "lucide-react";

import ProtectedRoute from "../../../components/ProtectedRoute";
import PageShell from "../../../components/ui/PageShell";
import EmptyState from "../../../components/ui/EmptyState";
import QueryError from "../../../components/ui/QueryError";
import PageLoading from "../../../components/ui/PageLoading";
import TabGroup from "../../../components/ui/TabGroup";
import FilterBar from "../../../components/ui/FilterBar";
import { FilterSelect, FilterTriggerButton } from "../../../components/ui/FilterDropdown";
import Dropdown from "../../../components/ui/Dropdown";
import { Checkbox } from "../../../components/ui/checkbox";
import { FieldBox } from "../../../components/ui/FieldBox";
import { Button } from "../../../components/ui/button";
import { TablePager } from "../../../components/ui/TablePager";
import { SortHead, Table, TableBody, TableHeader, TableRow } from "../../../components/ui/table";
import { usePaging } from "../../../hooks/usePaging";
import { useTableSort } from "../../../hooks/useTableSort";
import { useAuth } from "../../../context/AuthContext";
import IpasRow from "../../../components/ipas/IpasRow";
import NewIpasDialog from "../../../components/ipas/NewIpasDialog";
import { ipasListKey } from "../../../components/ipas/ipasKeys";
import { ipasService } from "../../../services/ipasService";
import { getPermissionContext } from "../../../utils/permissions";
import { filterIpas, formatAmount } from "../../../utils/ipas";
import { ipasFigures, ipasTotalsByCurrency } from "../../../utils/ipasFigures";
import { IPAS_EXPORT_HEADER, ipasExportRows } from "../../../utils/ipasListExport";
import { IPAS_VIEW, IPAS_VIEW_LABELS, inIpasView } from "../../../utils/ipasListViews";
import { downloadXlsx } from "../../../utils/xlsx";
import {
  IPAS_COMPUTATION_STATUSES,
  IPAS_COMPUTATION_STATUS_LABELS,
  IPAS_COSTING_SECTION,
  IPAS_PURPOSES,
  IPAS_PURPOSE_LABELS,
  IPAS_SECTION_3_APPROVED_FILTER,
  IPAS_STATE,
  IPAS_STATE_FILTER_ALL,
  IPAS_STATUSES,
  IPAS_STATUS_LABELS,
  ipasSectionNo,
} from "../../../constants/ipas";

/**
 * The IPAS list (issue #242, spec #241), a Register: every IPAS the signed-in
 * employee may read, with level-2 pills for open, filed and cancelled and
 * filters for entity and Purpose. Reached by Purchasing access, Finance access,
 * Super Admins and the sign-off lists; the database returns nothing to anyone
 * else. Purchasing raises one from here.
 */

const HEAD = "text-label font-bold uppercase tracking-wider";
const CHIP = "h-9 w-auto gap-2 px-2.5";
const CHIP_WRAPPER = "w-auto shrink-0";
const ALL = "__all__";

// Supplier, Entity, Project / SO, Raised, Raised by and the payment columns hide below md so the number, Purpose,
// Costing, Amount, Remaining balance and State stay in view.
const NARROW_HIDDEN = new Set(["Supplier", "Entity", "Project / SO", "Raised", "Raised by", "Payment scheme", "DP", "FP"]);
// The sheet's money columns (#596): worked out by the IPAS figures, in each PO's currency.
const MONEY_HEADINGS = ["Amount", "Payment scheme", "DP", "FP", "Remaining balance"];
const MONEY_RIGHT = new Set(["Amount", "DP", "FP", "Remaining balance"]);

const IPAS_SORT = {
  ipas: (r) => r.number,
  "odoo-po": (r) => r.po_number,
  supplier: (r) => r.supplier,
  entity: (r) => r.entity,
  purpose: (r) => IPAS_PURPOSE_LABELS[r.purpose],
  costing: (r) => IPAS_COMPUTATION_STATUSES.indexOf(r.computation_status),
  "project-so": (r) => r.sors[0]?.salesReference ?? r.sors[0]?.sorCode,
  raised: (r) => new Date(r.created_at).getTime(),
  "raised-by": (r) => r.creator?.name,
  amount: (r) => r.figures.amount,
  "payment-scheme": (r) => r.figures.paymentScheme,
  dp: (r) => r.figures.downPayment,
  fp: (r) => r.figures.fullPayment,
  "remaining-balance": (r) => r.figures.remainingBalance,
  status: (r) => (r.figures.status ? IPAS_STATUSES.indexOf(r.figures.status) : IPAS_STATUSES.length),
  state: (r) => r.state,
};

const STATUS_OPTIONS = [
  { value: ALL, label: "Any IPAS Status" },
  ...IPAS_STATUSES.map((value) => ({ value, label: IPAS_STATUS_LABELS[value] })),
];

const COSTING_OPTIONS = [
  { value: ALL, label: "Any costing status" },
  ...IPAS_COMPUTATION_STATUSES.map((value) => ({ value, label: IPAS_COMPUTATION_STATUS_LABELS[value] })),
  { value: IPAS_SECTION_3_APPROVED_FILTER, label: `Section ${ipasSectionNo(IPAS_COSTING_SECTION)} approved` },
];

const PURPOSE_OPTIONS = [
  { value: ALL, label: "Any Purpose" },
  ...IPAS_PURPOSES.map((value) => ({ value, label: IPAS_PURPOSE_LABELS[value] })),
];

const VIEW_OPTIONS = [
  { value: ALL, label: "All IPAS" },
  ...Object.values(IPAS_VIEW).map((value) => ({ value, label: IPAS_VIEW_LABELS[value] })),
];

// Every column of the list, in order. The IPAS number is always shown; the rest can be hidden with the column picker.
const LIST_HEADINGS = [
  "IPAS",
  "Odoo PO",
  "Supplier",
  "Entity",
  "Purpose",
  "Costing",
  "Project / SO",
  "Raised",
  "Raised by",
  ...MONEY_HEADINGS,
  "Status",
  "State",
];
const LOCKED_HEADING = "IPAS";

const slug = (heading) => heading.toLowerCase().replace(/[^a-z0-9]+/g, "-");

// The hidden columns are remembered per employee on this browser. Blocked or broken storage never breaks the page.
const columnsKey = (userId) => `erp_ipas_columns_${userId ?? "anon"}`;

function readHiddenColumns(userId) {
  try {
    const stored = JSON.parse(localStorage.getItem(columnsKey(userId)) ?? "[]");
    return Array.isArray(stored) ? stored.filter((key) => typeof key === "string") : [];
  } catch {
    return [];
  }
}

function writeHiddenColumns(userId, hidden) {
  try {
    if (hidden.length) localStorage.setItem(columnsKey(userId), JSON.stringify(hidden));
    else localStorage.removeItem(columnsKey(userId));
  } catch {
    /* ignore */
  }
}

function IpasList() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { hasPurchasingFlow, isSuperAdmin } = getPermissionContext(user);
  // The option lists: Purchasing access and Super Admins.
  const canEditSettings = hasPurchasingFlow || isSuperAdmin;

  const [state, setState] = useState(IPAS_STATE.OPEN);
  const [entity, setEntity] = useState(null);
  const [purpose, setPurpose] = useState(null);
  const [costing, setCosting] = useState(null);
  const [status, setStatus] = useState(null);
  const [search, setSearch] = useState("");
  const [view, setView] = useState(null);
  const [creating, setCreating] = useState(false);
  const [hiddenColumns, setHiddenColumns] = useState(() => readHiddenColumns(user?.id));
  const show = useCallback((key) => !hiddenColumns.includes(key), [hiddenColumns]);
  const toggleColumn = (key) => {
    const next = hiddenColumns.includes(key) ? hiddenColumns.filter((k) => k !== key) : [...hiddenColumns, key];
    setHiddenColumns(next);
    writeHiddenColumns(user?.id, next);
  };

  const { data: listed = [], isLoading, isError, refetch } = useQuery({
    queryKey: ipasListKey,
    queryFn: () => ipasService.list(),
  });
  // Every money figure comes from the IPAS figures, never worked out in the row.
  const rows = useMemo(() => listed.map((row) => ({ ...row, figures: ipasFigures(row) })), [listed]);

  const entityOptions = useMemo(
    () => [
      { value: ALL, label: "Any entity" },
      ...[...new Set(rows.map((r) => r.entity).filter(Boolean))].sort().map((e) => ({ value: e, label: e })),
    ],
    [rows],
  );

  // Search, entity and Purpose narrow first; the state pills count within that.
  const viewed = useMemo(() => (view ? rows.filter((row) => inIpasView(row, view, user?.id)) : rows), [rows, view, user?.id]);
  const scoped = useMemo(
    () => filterIpas(viewed, { entity, purpose, computationStatus: costing, status, search }),
    [viewed, entity, purpose, costing, status, search],
  );
  const filtered = useMemo(() => filterIpas(scoped, { state }), [scoped, state]);
  const { sorted: visible, sort, toggle } = useTableSort(filtered, IPAS_SORT);
  const paging = usePaging(visible);

  const count = (s) => filterIpas(scoped, { state: s }).length;
  const hasActiveFilters = view !== null || search !== "" || entity !== null || purpose !== null || costing !== null || status !== null;

  // Totals of the rows shown (every page), one line per currency: currencies are never added together.
  const totals = useMemo(() => ipasTotalsByCurrency(visible), [visible]);

  // The rows shown, in the order shown, as the sheet's columns. Only what the list itself shows.
  const exportToExcel = () => {
    downloadXlsx(`ipas-${manilaToday()}.xlsx`, {
      sheetName: "IPAS",
      header: IPAS_EXPORT_HEADER,
      rows: ipasExportRows(visible),
    });
  };

  // A view sets the state tab it needs: the first three are about open IPAS, Raised by me spans them all.
  const pickView = (next) => {
    setView(next);
    if (next) setState(next === IPAS_VIEW.MINE ? IPAS_STATE_FILTER_ALL : IPAS_STATE.OPEN);
  };

  const toolbar = (
    <>
      <TabGroup
        variant="pill"
        size="sm"
        activeTab={state}
        onChange={setState}
        tabs={[
          { value: IPAS_STATE.OPEN, label: "Open", badge: count(IPAS_STATE.OPEN) },
          { value: IPAS_STATE.FILED, label: "Filed", badge: count(IPAS_STATE.FILED) },
          { value: IPAS_STATE.CANCELLED, label: "Cancelled", badge: count(IPAS_STATE.CANCELLED) },
          { value: IPAS_STATE_FILTER_ALL, label: "All", badge: scoped.length },
        ]}
      />
      <FilterBar
        search={{ value: search, onChange: setSearch, placeholder: "Search IPAS, PO, supplier, SO, SOR or project" }}
        chips={
          <FilterSelect
            icon={CircleDot}
            label="IPAS Status"
            options={STATUS_OPTIONS}
            value={status ?? ALL}
            onChange={(v) => setStatus(v === ALL ? null : v)}
            allValue={ALL}
            className={CHIP}
            wrapperClassName={CHIP_WRAPPER}
          />
        }
        // The rest sit behind one Filters button, so the bar stays on one line.
        filters={
          <div className="grid gap-2 sm:grid-cols-2">
            <FilterSelect
              icon={Eye}
              label="View"
              options={VIEW_OPTIONS}
              value={view ?? ALL}
              onChange={(v) => pickView(v === ALL ? null : v)}
              allValue={ALL}
            />
            <FilterSelect
              icon={Building2}
              label="Entity"
              options={entityOptions}
              value={entity ?? ALL}
              onChange={(v) => setEntity(v === ALL ? null : v)}
              allValue={ALL}
            />
            <FilterSelect
              icon={Layers}
              label="Purpose"
              options={PURPOSE_OPTIONS}
              value={purpose ?? ALL}
              onChange={(v) => setPurpose(v === ALL ? null : v)}
              allValue={ALL}
            />
            <FilterSelect
              icon={Calculator}
              label="Costing"
              options={COSTING_OPTIONS}
              value={costing ?? ALL}
              onChange={(v) => setCosting(v === ALL ? null : v)}
              allValue={ALL}
            />
          </div>
        }
        activeCount={[view, entity, purpose, costing].filter((value) => value !== null).length}
        actions={
          <>
            <Dropdown
              usePortal
              placement="bottom-end"
              matchTriggerWidth={false}
              className="w-auto shrink-0"
              trigger={({ isOpen }) => (
                <FilterTriggerButton
                  popup="dialog"
                  wrapperClassName="w-auto"
                  className={CHIP}
                  icon={Columns3}
                  label="Columns"
                  // Icon and count only, so the bar stays on one line; the label stays its name.
                  labelClassName="hidden"
                  count={hiddenColumns.length}
                  isActive={hiddenColumns.length > 0}
                  isOpen={isOpen}
                />
              )}
            >
              {() => (
                <div className="flex max-h-[min(60vh,24rem)] w-56 flex-col gap-1 overflow-y-auto overscroll-contain p-2" role="group" aria-label="Columns shown">
                  {LIST_HEADINGS.map((heading) => (
                    <FieldBox inline key={heading} className="rounded-md px-1.5 py-1 text-[13px] hover:bg-muted">
                      <Checkbox
                        checked={heading === LOCKED_HEADING || show(slug(heading))}
                        disabled={heading === LOCKED_HEADING}
                        onCheckedChange={() => toggleColumn(slug(heading))}
                        aria-label={heading}
                      />
                      {heading}
                    </FieldBox>
                  ))}
                </div>
              )}
            </Dropdown>
            <Button
              size="sm"
              variant="outline"
              className="h-9 gap-1.5"
              onClick={exportToExcel}
              disabled={visible.length === 0}
              aria-label="Export to Excel"
              title="Export to Excel"
            >
              <Download size={14} />
              Export
            </Button>
          </>
        }
        hasActiveFilters={hasActiveFilters}
        onClearAll={() => {
          setView(null);
          setSearch("");
          setEntity(null);
          setPurpose(null);
          setCosting(null);
          setStatus(null);
        }}
      />
    </>
  );

  return (
    <>
      <PageShell
        title="IPAS"
        description="One per Odoo purchase order that needs one: its Odoo copy, payments and sign-offs."
        action={
          <>
            {canEditSettings && (
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5"
                onClick={() => navigate("/settings?tab=purchasing")}
              >
                <Settings2 size={14} />
                IPAS settings
              </Button>
            )}
            {hasPurchasingFlow && (
              <Button size="sm" onClick={() => setCreating(true)} className="gap-1.5">
                <Plus size={14} />
                Raise IPAS
              </Button>
            )}
          </>
        }
        toolbar={toolbar}
      >
        {isLoading && <PageLoading label="IPAS" />}

        {isError && <QueryError title="IPAS could not be loaded." onRetry={refetch} />}

        {!isLoading && !isError && visible.length === 0 && (
          <EmptyState
            icon={ReceiptText}
            title={rows.length === 0 ? "No IPAS yet" : "No matching IPAS"}
            description={
              rows.length === 0
                ? "An IPAS is raised from an Odoo purchase order. Purchasing raises one when a purchase needs it."
                : "Nothing in this slice. Try another tab or clear the filters."
            }
          />
        )}

        {!isLoading && !isError && visible.length > 0 && (
          // No overflow-hidden here: the table's "Reset columns" sits just above this card.
          <div className="rounded-xl border border-border bg-card [&_thead_tr]:rounded-t-xl [&_th:first-child]:rounded-tl-xl [&_th:last-child]:rounded-tr-xl">
            <div>
              <Table tableId="ipas" resetAbove className="md:min-w-[72rem]">
                <TableHeader>
                  <TableRow className="bg-muted/40 hover:bg-muted/40">
                    {LIST_HEADINGS.filter((heading) => heading === LOCKED_HEADING || show(slug(heading))).map((heading) => (
                      <SortHead
                        key={heading}
                        id={slug(heading)}
                        sortKey={slug(heading)}
                        sort={sort}
                        onSort={toggle}
                        className={`${HEAD} ${heading === "State" || MONEY_RIGHT.has(heading) ? "text-right" : ""} ${NARROW_HIDDEN.has(heading) ? "hidden md:table-cell" : ""}`}
                      >
                        {heading}
                      </SortHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {paging.rows.map((row) => (
                    <IpasRow
                      key={row.id}
                      row={row}
                      search={search}
                      show={show}
                      onOpen={(id) => navigate(`/purchasing/ipas/${id}`)}
                    />
                  ))}
                </TableBody>
              </Table>
            </div>
            <div
              className="flex flex-wrap items-baseline gap-x-6 gap-y-1 border-t border-border bg-muted/30 px-4 py-2.5 text-xs"
              data-testid="ipas-totals"
            >
              <span className="font-bold uppercase tracking-wider text-muted-foreground">Totals for {visible.length} shown</span>
              {totals.map((total) => (
                <span key={total.currency ?? "none"} className="tabular-nums text-foreground" data-testid="ipas-total">
                  <span className="font-semibold">{total.currency ?? "No currency"}</span>
                  {" · Amount "}
                  <span data-testid="ipas-total-amount">{formatAmount(total.amount, total.currency)}</span>
                  {" · Remaining balance "}
                  <span data-testid="ipas-total-remaining">{formatAmount(total.remainingBalance, total.currency)}</span>
                </span>
              ))}
            </div>
            <TablePager {...paging} noun="IPAS" />
          </div>
        )}
      </PageShell>

      <NewIpasDialog
        open={creating}
        onOpenChange={setCreating}
        onCreated={(row) => navigate(`/purchasing/ipas/${row.id}`)}
      />
    </>
  );
}

// Every employee reaches the route; what they see is the database's decision
// (ipas_can_read), and the navigation only offers it to the readers.
export default function IpasListPage() {
  return (
    <ProtectedRoute>
      <IpasList />
    </ProtectedRoute>
  );
}
