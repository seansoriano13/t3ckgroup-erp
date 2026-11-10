import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import toast from "react-hot-toast";
import { PackageOpen, Plus } from "lucide-react";

import ProtectedRoute from "../../../components/ProtectedRoute";
import PageShell from "../../../components/ui/PageShell";
import EmptyState from "../../../components/ui/EmptyState";
import QueryError from "../../../components/ui/QueryError";
import PageLoading from "../../../components/ui/PageLoading";
import TabGroup from "../../../components/ui/TabGroup";
import { Button } from "../../../components/ui/button";
import ModalShell from "../../../components/ui/ModalShell";
import { FieldBox } from "../../../components/ui/FieldBox";
import { Input } from "../../../components/ui/input";
import FilterBar from "../../../components/ui/FilterBar";
import { TablePager } from "../../../components/ui/TablePager";
import { SortHead, Table, TableBody, TableCell, TableHeader, TableRow } from "../../../components/ui/table";
import { usePaging } from "../../../hooks/usePaging";
import { useTableSort } from "../../../hooks/useTableSort";
import { IdentityCell } from "../../../components/purchasing/list/IdentityCell";
import { StateCell, STATE_HEAD_CLASS } from "../../../components/purchasing/list/StateCell";
import ExportButton from "../../../components/purchasing/list/ExportButton";
import SorPicker from "../../../components/ipas/SorPicker";
import { useAuth } from "../../../context/AuthContext";
import { getPermissionContext } from "../../../utils/permissions";
import { packingListService } from "../../../services/packingListService";
import { ipasErrorMessage } from "../../../utils/ipas";

/**
 * The Packing Lists list (#255, spec #251): every Packing List the signed-in
 * employee may read, newest first, with draft and packed tabs. A new list is
 * made for one SOR, optionally with its Odoo delivery reference.
 */

const HEAD = "text-label font-bold uppercase tracking-wider";
const TAB = { DRAFT: "draft", PACKED: "packed", ALL: "all" };
const KEY = ["packing-lists"];

/** State -> StatusBadge tone, and the word shown: the one place this list maps them. */
const STATE_TONES = { draft: "amber", packed: "green" };
const stateLabel = (row) => (row.state === "packed" ? "Packed" : "Draft");

const COLUMNS = [
  { id: "number", label: "Number" },
  { id: "sor", label: "SOR" },
  { id: "boxes", label: "Boxes" },
  { id: "odoo-ref", label: "Odoo ref" },
  { id: "state", label: "State" },
];

const SORT = {
  number: (r) => r.number,
  sor: (r) => r.sorReference,
  boxes: (r) => r.boxCount,
  "odoo-ref": (r) => r.odooDeliveryRef,
  state: (r) => stateLabel(r),
};

const EXPORT_HEADER = ["Number", "SOR", "Project", "Boxes", "Odoo ref", "State"];
const exportRows = (rows) =>
  rows.map((r) => [r.number, r.sorReference, r.projectTitle, r.boxCount, r.odooDeliveryRef, stateLabel(r)]);

const matchesSearch = (row, term) =>
  [row.number, row.sorReference, row.projectTitle, row.odooDeliveryRef].some((field) =>
    field?.toLowerCase().includes(term),
  );

function NewPackingListDialog({ open, onOpenChange }) {
  const navigate = useNavigate();
  const [sor, setSor] = useState([]);
  const [deliveryRef, setDeliveryRef] = useState("");
  const [saving, setSaving] = useState(false);

  const reset = () => {
    setSor([]);
    setDeliveryRef("");
  };

  const create = async () => {
    if (sor.length !== 1) return;
    setSaving(true);
    try {
      const made = await packingListService.create({ opportunityId: sor[0].id, odooDeliveryRef: deliveryRef || null });
      toast.success(`${made.number} started`);
      onOpenChange(false);
      reset();
      navigate(`/purchasing/packing-lists/${made.id}`);
    } catch (error) {
      toast.error(ipasErrorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalShell
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
      crumbs={["Packing List", "New Packing List"]}
      actions={
        <Button size="lg" onClick={create} disabled={saving || sor.length !== 1}>
          {saving ? "Making…" : "Make Packing List"}
        </Button>
      }
    >
      <p className="text-sm text-muted-foreground">A Packing List is for one SOR. Its boxes are added on the next page.</p>
      <div className="space-y-4">
        {/* The picker names itself ("Find an SOR"), so no second SOR label wraps it. */}
        <SorPicker selected={sor} onChange={(next) => setSor(next.slice(-1))} />
        <FieldBox label="Odoo delivery reference (optional)" bare>
          <Input value={deliveryRef} onChange={(e) => setDeliveryRef(e.target.value)} placeholder="e.g. TG En/OUT/03390" />
        </FieldBox>
      </div>
    </ModalShell>
  );
}

function PackingListsList() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { hasPurchasingFlow, isSuperAdmin, isTransmittalWarehouse } = getPermissionContext(user);
  const canMake = hasPurchasingFlow || isSuperAdmin || isTransmittalWarehouse;

  const [tab, setTab] = useState(TAB.DRAFT);
  const [creating, setCreating] = useState(false);

  const { data: rows = [], isLoading, isError, refetch } = useQuery({
    queryKey: KEY,
    queryFn: () => packingListService.list(),
  });

  const [search, setSearch] = useState("");

  // Search narrows first; the tabs count within that.
  const term = search.trim().toLowerCase();
  const narrowed = rows.filter((row) => !term || matchesSearch(row, term));
  const count = (t) => narrowed.filter((row) => t === TAB.ALL || row.state === t).length;
  const filtered = narrowed.filter((row) => tab === TAB.ALL || row.state === tab);
  const { sorted: visible, sort, toggle } = useTableSort(filtered, SORT);
  const paging = usePaging(visible);
  const rowsToExport = useMemo(() => exportRows(visible), [visible]);

  return (
    <PageShell
      title="Packing Lists"
      description="What the Warehouse packs in each box for an SOR. Signing Packed by closes a list."
      action={
        canMake && (
          <Button size="sm" onClick={() => setCreating(true)} className="gap-1.5">
            <Plus size={14} />
            New Packing List
          </Button>
        )
      }
      toolbar={
        <>
          <TabGroup
            variant="pill"
            size="sm"
            activeTab={tab}
            onChange={setTab}
            tabs={[
              { value: TAB.DRAFT, label: "Draft", badge: count(TAB.DRAFT) },
              { value: TAB.PACKED, label: "Packed", badge: count(TAB.PACKED) },
              { value: TAB.ALL, label: "All", badge: narrowed.length },
            ]}
          />
          <FilterBar
            search={{ value: search, onChange: setSearch, placeholder: "Search Packing Lists" }}
            hasActiveFilters={search !== ""}
            onClearAll={() => setSearch("")}
            actions={
              <ExportButton name="packing-lists" sheetName="Packing Lists" header={EXPORT_HEADER} rows={rowsToExport} />
            }
          />
        </>
      }
    >
      {isLoading && <PageLoading label="Packing Lists" />}
      {isError && <QueryError title="Packing Lists could not be loaded." onRetry={refetch} />}

      {!isLoading && !isError && visible.length === 0 && (
        <EmptyState
          icon={PackageOpen}
          title={rows.length === 0 ? "No Packing Lists yet" : "No matching Packing Lists"}
          description={
            rows.length === 0
              ? "A Packing List records the boxes packed for an SOR, with their marks, seals and contents."
              : "Nothing in this tab. Try another tab or clear the search."
          }
        />
      )}

      {!isLoading && !isError && visible.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          <div className="overflow-x-auto">
            <Table tableId="packing-lists" className="md:min-w-[40rem]">
              <TableHeader>
                <TableRow className="bg-muted/40 hover:bg-muted/40">
                  {COLUMNS.map(({ id, label }) => (
                    <SortHead
                      key={id}
                      id={id}
                      sortKey={id}
                      sort={sort}
                      onSort={toggle}
                      className={`${HEAD} ${id === "state" ? STATE_HEAD_CLASS : ""}`}
                    >
                      {label}
                    </SortHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {paging.rows.map((row) => (
                  <TableRow key={row.id} className="cursor-pointer" onClick={() => navigate(`/purchasing/packing-lists/${row.id}`)}>
                    <IdentityCell reference={row.number} name={row.projectTitle} />
                    <TableCell className="font-mono">{row.sorReference ?? "—"}</TableCell>
                    <TableCell>{row.boxCount}</TableCell>
                    <TableCell>{row.odooDeliveryRef ?? "—"}</TableCell>
                    <StateCell state={row.state} label={stateLabel(row)} tones={STATE_TONES} />
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <TablePager {...paging} noun="Packing Lists" />
        </div>
      )}

      <NewPackingListDialog open={creating} onOpenChange={setCreating} />
    </PageShell>
  );
}

export default function PackingListsPage() {
  return (
    <ProtectedRoute>
      <PackingListsList />
    </ProtectedRoute>
  );
}
