import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import { Building2, Layers, Plus, ReceiptText, Settings2 } from "lucide-react";

import ProtectedRoute from "../../../components/ProtectedRoute";
import PageShell from "../../../components/ui/PageShell";
import EmptyState from "../../../components/ui/EmptyState";
import QueryError from "../../../components/ui/QueryError";
import Spinner from "../../../components/ui/Spinner";
import TabGroup from "../../../components/ui/TabGroup";
import FilterBar from "../../../components/ui/FilterBar";
import { FilterSelect } from "../../../components/ui/FilterDropdown";
import { Button } from "../../../components/ui/button";
import { SortHead, Table, TableBody, TableCell, TableHeader, TableRow } from "../../../components/ui/table";
import { useTableSort } from "../../../hooks/useTableSort";
import { useAuth } from "../../../context/AuthContext";
import IpasStateBadge from "../../../components/ipas/IpasStateBadge";
import NewIpasDialog from "../../../components/ipas/NewIpasDialog";
import { ipasListKey } from "../../../components/ipas/ipasKeys";
import { ipasService } from "../../../services/ipasService";
import { getPermissionContext } from "../../../utils/permissions";
import { filterIpas } from "../../../utils/ipas";
import { formatDate } from "../../../utils/formatDate.js";
import {
  IPAS_PRIORITY_LABELS,
  IPAS_PURPOSES,
  IPAS_PURPOSE_LABELS,
  IPAS_SOURCE_LABELS,
  IPAS_STATE,
  IPAS_STATE_FILTER_ALL,
} from "../../../constants/ipas";

/**
 * The IPAS list (issue #242, spec #241), a Register: every IPAS the signed-in
 * employee may read, with level-2 pills for open, filed and cancelled and
 * filters for entity and Purpose. Reached by Purchasing access, Finance access,
 * Super Admins and the sign-off lists; the database returns nothing to anyone
 * else. Purchasing raises one from here.
 */

const HEAD = "text-[10px] font-bold uppercase tracking-wider";
const CHIP = "h-9 w-auto gap-2 px-2.5";
const CHIP_WRAPPER = "w-auto shrink-0";
const ALL = "__all__";

// Supplier, Entity, SORs and Raised hide below md so the number, Purpose and State stay in view.
const NARROW_HIDDEN = new Set(["Supplier", "Entity", "SORs", "Raised"]);

const IPAS_SORT = {
  ipas: (r) => r.number,
  po: (r) => r.po_number,
  supplier: (r) => r.supplier,
  entity: (r) => r.entity,
  purpose: (r) => IPAS_PURPOSE_LABELS[r.purpose],
  sors: (r) => r.sors[0]?.salesReference,
  raised: (r) => new Date(r.created_at).getTime(),
  state: (r) => r.state,
};

const PURPOSE_OPTIONS = [
  { value: ALL, label: "Any Purpose" },
  ...IPAS_PURPOSES.map((value) => ({ value, label: IPAS_PURPOSE_LABELS[value] })),
];

const slug = (heading) => heading.toLowerCase().replace(/[^a-z0-9]+/g, "-");

function IpasRow({ row, onOpen }) {
  return (
    <TableRow
      tabIndex={0}
      data-testid="ipas-row"
      onClick={() => onOpen(row.id)}
      onKeyDown={(e) => {
        if (e.key === "Enter" && e.target === e.currentTarget) {
          e.preventDefault();
          onOpen(row.id);
        }
      }}
      className={`group cursor-pointer outline-none focus-visible:bg-muted ${row.state === IPAS_STATE.CANCELLED ? "opacity-70" : ""}`}
    >
      <TableCell>
        <span className="block font-mono text-xs font-semibold text-foreground">{row.number}</span>
        <span className="mt-0.5 block text-[11px] text-muted-foreground">
          {IPAS_PRIORITY_LABELS[row.priority]} · {IPAS_SOURCE_LABELS[row.source]}
        </span>
      </TableCell>
      <TableCell>
        <span className="font-mono text-xs text-foreground">{row.po_number}</span>
      </TableCell>
      <TableCell className="hidden md:table-cell">
        <span className="block max-w-[16rem] truncate text-xs text-foreground">{row.supplier || "—"}</span>
      </TableCell>
      <TableCell className="hidden md:table-cell">
        <span className="text-xs text-muted-foreground">{row.entity || "—"}</span>
      </TableCell>
      <TableCell>
        <span className="text-xs font-medium text-foreground">{IPAS_PURPOSE_LABELS[row.purpose]}</span>
      </TableCell>
      <TableCell className="hidden md:table-cell">
        {row.sors.length === 0 ? (
          <span className="text-xs text-muted-foreground">—</span>
        ) : (
          <span className="font-mono text-xs text-foreground">
            {row.sors.map((s) => s.salesReference).join(", ")}
          </span>
        )}
      </TableCell>
      <TableCell className="hidden md:table-cell">
        <span className="text-xs tabular-nums text-muted-foreground">{formatDate(row.created_at)}</span>
      </TableCell>
      <TableCell className="text-right">
        <IpasStateBadge state={row.state} />
      </TableCell>
    </TableRow>
  );
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
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);

  const { data: rows = [], isLoading, isError, refetch } = useQuery({
    queryKey: ipasListKey,
    queryFn: () => ipasService.list(),
  });

  const entityOptions = useMemo(
    () => [
      { value: ALL, label: "Any entity" },
      ...[...new Set(rows.map((r) => r.entity).filter(Boolean))].sort().map((e) => ({ value: e, label: e })),
    ],
    [rows],
  );

  // Search, entity and Purpose narrow first; the state pills count within that.
  const scoped = useMemo(() => filterIpas(rows, { entity, purpose, search }), [rows, entity, purpose, search]);
  const filtered = useMemo(() => filterIpas(scoped, { state }), [scoped, state]);
  const { sorted: visible, sort, toggle } = useTableSort(filtered, IPAS_SORT);

  const count = (s) => filterIpas(scoped, { state: s }).length;
  const hasActiveFilters = search !== "" || entity !== null || purpose !== null;

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
        search={{ value: search, onChange: setSearch, placeholder: "Search IPAS" }}
        chips={
          <>
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
              icon={Layers}
              label="Purpose"
              options={PURPOSE_OPTIONS}
              value={purpose ?? ALL}
              onChange={(v) => setPurpose(v === ALL ? null : v)}
              allValue={ALL}
              className={CHIP}
              wrapperClassName={CHIP_WRAPPER}
            />
          </>
        }
        hasActiveFilters={hasActiveFilters}
        onClearAll={() => {
          setSearch("");
          setEntity(null);
          setPurpose(null);
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
                onClick={() => navigate("/purchasing/ipas/settings")}
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
        {isLoading && (
          <div className="flex justify-center py-20">
            <Spinner />
          </div>
        )}

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
          <div className="overflow-hidden rounded-xl border border-border bg-card">
            <div className="overflow-x-auto">
              <Table tableId="ipas" className="md:min-w-[52rem]">
                <TableHeader>
                  <TableRow className="bg-muted/40 hover:bg-muted/40">
                    {["IPAS", "PO", "Supplier", "Entity", "Purpose", "SORs", "Raised", "State"].map((heading) => (
                      <SortHead
                        key={heading}
                        id={slug(heading)}
                        sortKey={slug(heading)}
                        sort={sort}
                        onSort={toggle}
                        className={`${HEAD} ${heading === "State" ? "text-right" : ""} ${NARROW_HIDDEN.has(heading) ? "hidden md:table-cell" : ""}`}
                      >
                        {heading}
                      </SortHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visible.map((row) => (
                    <IpasRow key={row.id} row={row} onOpen={(id) => navigate(`/purchasing/ipas/${id}`)} />
                  ))}
                </TableBody>
              </Table>
            </div>
            <div className="border-t border-border px-4 py-2 text-[11px] text-muted-foreground">
              {visible.length} IPAS shown
            </div>
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
