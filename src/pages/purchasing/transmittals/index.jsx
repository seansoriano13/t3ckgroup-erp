import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import { Plus, ReceiptText } from "lucide-react";

import ProtectedRoute from "../../../components/ProtectedRoute";
import PageShell from "../../../components/ui/PageShell";
import EmptyState from "../../../components/ui/EmptyState";
import QueryError from "../../../components/ui/QueryError";
import PageLoading from "../../../components/ui/PageLoading";
import TabGroup from "../../../components/ui/TabGroup";
import { Button } from "../../../components/ui/button";
import { Checkbox } from "../../../components/ui/checkbox";
import { SelectField } from "../../../components/ui/SelectField";
import { TablePager } from "../../../components/ui/TablePager";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../../components/ui/table";
import { usePaging } from "../../../hooks/usePaging";
import { useAuth } from "../../../context/AuthContext";
import { transmittalService } from "../../../services/transmittalService";
import { transmittalKeys } from "../../../components/transmittals/transmittalKeys";
import {
  TRANSMITTAL_ORIGIN_LABELS,
  TRANSMITTAL_PRIORITY_LABELS,
  TRANSMITTAL_STAFF_LIST,
  TRANSMITTAL_STATE,
} from "../../../constants/transmittals";

/**
 * The Transmittals list (#252, spec #251): every TG03 slip the signed-in
 * employee may read, newest first, with tabs for open, closed and cancelled and
 * a "Prepared by me" filter. The database returns only what the caller may
 * read; the navigation offers the screen to the readers.
 */

const TAB = {
  OPEN: "open",
  CLOSED: "closed",
  CANCELLED: "cancelled",
  ALL: "all",
};

/** The list filters (#254): what each slip is waiting on, and whether any line is NA. */
const FILTER = {
  ALL: "all",
  WAITING_WAREHOUSE: "waiting_warehouse",
  WAITING_TECHNICAL: "waiting_technical",
  HAS_NA: "has_na",
  AWAITING_MY_CHECK: "awaiting_my_check",
};

const FILTER_OPTIONS = [
  { value: FILTER.ALL, label: "All slips" },
  { value: FILTER.WAITING_WAREHOUSE, label: "Waiting on Warehouse" },
  { value: FILTER.WAITING_TECHNICAL, label: "Waiting on Technical" },
  { value: FILTER.HAS_NA, label: "Has NA" },
  { value: FILTER.AWAITING_MY_CHECK, label: "Awaiting my Check by" },
];

const HEAD = "text-label font-bold uppercase tracking-wider";

function TransmittalsList() {
  const navigate = useNavigate();
  const { user } = useAuth();
  // Raising follows the database's rule (Purchasing, or the Warehouse or
  // Logistics list); a Super Admin or a Technical member reads but doesn't raise.
  const { data: canRaise = false } = useQuery({
    queryKey: [...transmittalKeys.list, "can-prepare", user?.id],
    queryFn: () => transmittalService.canPrepare(),
    enabled: Boolean(user?.id),
  });

  const [tab, setTab] = useState(TAB.OPEN);
  const [mineOnly, setMineOnly] = useState(false);
  const [filter, setFilter] = useState(FILTER.ALL);

  const { data: rows = [], isLoading, isError, refetch } = useQuery({
    queryKey: [...transmittalKeys.list],
    queryFn: () => transmittalService.list(),
  });

  const inTab = (row, t) => {
    if (t === TAB.OPEN) return ![TRANSMITTAL_STATE.CLOSED, TRANSMITTAL_STATE.CANCELLED].includes(row.state);
    if (t === TAB.CLOSED) return row.state === TRANSMITTAL_STATE.CLOSED;
    if (t === TAB.CANCELLED) return row.state === TRANSMITTAL_STATE.CANCELLED;
    return true;
  };
  const { data: myLists = [] } = useQuery({
    queryKey: [...transmittalKeys.list, "my-lists", user?.id],
    queryFn: () => transmittalService.myStaffLists(user?.id),
    enabled: Boolean(user?.id),
  });
  const onCheckBy = myLists.includes(TRANSMITTAL_STAFF_LIST.CHECK_BY);

  const matchesFilter = (row) => {
    if (filter === FILTER.WAITING_WAREHOUSE) {
      return [TRANSMITTAL_STATE.WAREHOUSE_CHECKING, TRANSMITTAL_STATE.WAREHOUSE_RELEASING].includes(row.state);
    }
    if (filter === FILTER.WAITING_TECHNICAL) return row.state === TRANSMITTAL_STATE.TECHNICAL_INSPECTION;
    if (filter === FILTER.HAS_NA) return row.hasNa;
    if (filter === FILTER.AWAITING_MY_CHECK) {
      return row.state === TRANSMITTAL_STATE.AWAITING_CHECK && onCheckBy && row.preparedById !== user?.id;
    }
    return true;
  };

  const count = (t) => rows.filter((row) => inTab(row, t)).length;
  const visible = rows.filter(
    (row) => inTab(row, tab) && (!mineOnly || row.preparedById === user?.id) && matchesFilter(row),
  );
  const paging = usePaging(visible);

  const toolbar = (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <TabGroup
        variant="pill"
        size="sm"
        activeTab={tab}
        onChange={setTab}
        tabs={[
          { value: TAB.OPEN, label: "Open", badge: count(TAB.OPEN) },
          { value: TAB.CLOSED, label: "Closed", badge: count(TAB.CLOSED) },
          { value: TAB.CANCELLED, label: "Cancelled", badge: count(TAB.CANCELLED) },
          { value: TAB.ALL, label: "All", badge: rows.length },
        ]}
      />
      <div className="flex flex-wrap items-center gap-3 text-[13px]">
        <div className="w-56">
          <SelectField options={FILTER_OPTIONS} value={filter} onChange={setFilter} placeholder="Filter" />
        </div>
        <div className="flex items-center gap-2">
          <Checkbox checked={mineOnly} onCheckedChange={(v) => setMineOnly(Boolean(v))} aria-label="Prepared by me" />
          <span>Prepared by me</span>
        </div>
      </div>
    </div>
  );

  return (
    <PageShell
      title="Transmittals"
      description="TG03 slips: the goods the Warehouse and Technical check, numbered as on paper."
      action={
        canRaise && (
          <Button size="sm" onClick={() => navigate("/purchasing/transmittals/new")} className="gap-1.5">
            <Plus size={14} />
            Raise Transmittal
          </Button>
        )
      }
      toolbar={toolbar}
    >
      {isLoading && <PageLoading label="Transmittals" />}
      {isError && <QueryError title="Transmittals could not be loaded." onRetry={refetch} />}

      {!isLoading && !isError && visible.length === 0 && (
        <EmptyState
          icon={ReceiptText}
          title={rows.length === 0 ? "No Transmittals yet" : "No matching Transmittals"}
          description={
            rows.length === 0
              ? "A Transmittal is raised when goods come in against a PO. Purchasing, Logistics and the Warehouse raise them."
              : "Nothing in this tab. Try another tab."
          }
        />
      )}

      {!isLoading && !isError && visible.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          <div className="overflow-x-auto">
            <Table tableId="transmittals" className="md:min-w-[48rem]">
              <TableHeader>
                <TableRow className="bg-muted/40 hover:bg-muted/40">
                  {["TG03", "Prepared", "Origin", "Company", "Priority", "Lines", "State"].map((heading) => (
                    <TableHead key={heading} className={HEAD}>
                      {heading}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {paging.rows.map((row) => (
                  <TableRow
                    key={row.id}
                    className="cursor-pointer"
                    onClick={() => navigate(`/purchasing/transmittals/${row.id}`)}
                  >
                    <TableCell className="font-mono font-semibold">{row.number}</TableCell>
                    <TableCell>{row.preparedOn}</TableCell>
                    <TableCell>{TRANSMITTAL_ORIGIN_LABELS[row.origin] ?? row.origin}</TableCell>
                    <TableCell>{row.entity}</TableCell>
                    <TableCell>{TRANSMITTAL_PRIORITY_LABELS[row.priority] ?? row.priority}</TableCell>
                    <TableCell>{row.lineCount}</TableCell>
                    <TableCell>{row.stateLabel}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <TablePager {...paging} noun="Transmittals" />
        </div>
      )}
    </PageShell>
  );
}

export default function TransmittalsListPage() {
  return (
    <ProtectedRoute>
      <TransmittalsList />
    </ProtectedRoute>
  );
}
