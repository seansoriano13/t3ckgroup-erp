import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Navigate, useParams } from "react-router";
import { AlertTriangle, RefreshCw } from "lucide-react";

import ProtectedRoute from "../../../components/ProtectedRoute";
import PageShell from "../../../components/ui/PageShell";
import EmptyState from "../../../components/ui/EmptyState";
import QueryError from "../../../components/ui/QueryError";
import PageLoading from "../../../components/ui/PageLoading";
import { Button } from "../../../components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../../components/ui/table";
import { useAuth } from "../../../context/AuthContext";
import { getPermissionContext } from "../../../utils/permissions";
import { opexReportService } from "../../../services/opexReportService";
import { costingMatrixService } from "../../../services/costingMatrixService";
import { formatPesos, normalizeS0, reportSummary, snapshotFrom } from "../../../utils/opexReport";

/**
 * One OPEX Report (#1244, spec #1241): the header, the P0 lines, the expenses grouped into
 * Operation & Admin and Marketing, and the summary. Opening the page, or pressing Read again,
 * reads Odoo and saves the snapshot the list shows. Finance's hand edits come in #1245.
 */

const HEAD = "text-label font-bold uppercase tracking-wider";
const when = (value) => new Date(value).toLocaleString("en-PH", { dateStyle: "medium", timeStyle: "short" });

const GROUPS = [
  { key: "operation_admin", label: "Operation & Admin" },
  { key: "marketing", label: "Marketing" },
];

function P0LinesTable({ lines }) {
  if (lines.length === 0) {
    return <EmptyState title="No P0 lines" description="Odoo has no P0 line tagged to this S0, or named by a P0's Source Document." />;
  }
  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-card">
      <Table tableId="opex-p0-lines" className="md:min-w-[56rem]">
        <TableHeader>
          <TableRow className="bg-muted/40 hover:bg-muted/40">
            <TableHead className={HEAD}>P0</TableHead>
            <TableHead className={HEAD}>Supplier</TableHead>
            <TableHead className={HEAD}>State</TableHead>
            <TableHead className={HEAD}>Product</TableHead>
            <TableHead className={`${HEAD} text-right`}>Qty</TableHead>
            <TableHead className={`${HEAD} text-right`}>Share</TableHead>
            <TableHead className={`${HEAD} text-right`}>Pesos</TableHead>
            <TableHead className={`${HEAD} text-right`}>Counted</TableHead>
            <TableHead className={HEAD}>Marks</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {lines.map((line) => {
            const greyed = line.marks.includes("draft/cancelled") || line.marks.includes("other project");
            return (
              <TableRow key={line.lineId} className={greyed ? "opacity-50" : ""} data-greyed={greyed ? "true" : undefined}>
                <TableCell className="font-mono">{line.p0}</TableCell>
                <TableCell>{line.supplier}</TableCell>
                <TableCell>{line.p0State}</TableCell>
                <TableCell>{line.product}</TableCell>
                <TableCell className="text-right">{line.quantity}</TableCell>
                <TableCell className="text-right">{line.sharePercent}%</TableCell>
                <TableCell className="text-right">{formatPesos(line.pesos)}</TableCell>
                <TableCell className="text-right">{formatPesos(line.countedPesos)}</TableCell>
                <TableCell>{line.marks.join(", ")}</TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

function ExpensesTable({ expenses }) {
  if (expenses.length === 0) {
    return <EmptyState title="No expenses" description="Odoo has no petty-cash or bank expense tagged to this S0." />;
  }
  return (
    <div className="space-y-4">
      {GROUPS.map(({ key, label }) => {
        const rows = expenses.filter((e) => (key === "marketing" ? e.group === "marketing" : e.group !== "marketing"));
        return (
          <section key={key} aria-label={label} className="space-y-2">
            <h3 className="text-sm font-semibold">{label}</h3>
            {rows.length === 0 ? (
              <p className="text-xs text-muted-foreground">Nothing in this group.</p>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-border bg-card">
                <Table tableId={`opex-expenses-${key}`} className="md:min-w-[40rem]">
                  <TableHeader>
                    <TableRow className="bg-muted/40 hover:bg-muted/40">
                      <TableHead className={HEAD}>Date</TableHead>
                      <TableHead className={HEAD}>Description</TableHead>
                      <TableHead className={HEAD}>Odoo account</TableHead>
                      <TableHead className={`${HEAD} text-right`}>Amount</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((e) => (
                      <TableRow key={e.analyticLineId}>
                        <TableCell>{e.date ?? "—"}</TableCell>
                        <TableCell>{e.description}</TableCell>
                        <TableCell>{e.account}</TableCell>
                        <TableCell className="text-right">{formatPesos(e.amount)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}

const SUMMARY_ROWS = [
  ["Contract price", "contractPrice"],
  ["VAT-exclusive", "vatExclusive"],
  ["Tax withheld", "tax"],
  ["Retention", "retention"],
  ["Collected", "collected"],
  ["Product cost", "productCost"],
  ["Operation & Admin", "operationAdmin"],
  ["Marketing", "marketing"],
  ["Actual OPEX", "actualOpex"],
  ["ITR", "itr"],
  ["Revenue", "revenue"],
];

function Summary({ summary }) {
  return (
    <dl className="grid max-w-md grid-cols-[1fr_auto] gap-x-6 gap-y-1.5 text-sm">
      {SUMMARY_ROWS.map(([label, key]) => (
        <div key={key} className="contents">
          <dt className="text-muted-foreground">{label}</dt>
          <dd className="text-right font-medium">{formatPesos(summary[key])}</dd>
        </div>
      ))}
      <dt className="text-muted-foreground">Revenue %</dt>
      <dd className="text-right font-medium">{summary.revenuePercent == null ? "—" : `${summary.revenuePercent}%`}</dd>
    </dl>
  );
}

function OpexReportView({ s0 }) {
  const queryClient = useQueryClient();

  const reportQuery = useQuery({ queryKey: ["opex-report", s0], queryFn: () => opexReportService.getByS0(s0) });
  const report = reportQuery.data;

  // Opening the page reads Odoo and saves the snapshot; Read again does the same.
  const readQuery = useQuery({
    queryKey: ["opex-read", s0],
    enabled: Boolean(report),
    staleTime: 0,
    gcTime: 0,
    refetchOnWindowFocus: false,
    retry: false,
    queryFn: async () => {
      const [read, settings] = await Promise.all([opexReportService.readFromOdoo(s0), costingMatrixService.getSettings()]);
      const summary = reportSummary(read, report, settings);
      await opexReportService.saveSnapshot(report.id, snapshotFrom(read, summary));
      queryClient.invalidateQueries({ queryKey: ["opex-reports"] });
      return { read, summary };
    },
  });
  const { read, summary } = readQuery.data ?? {};

  if (reportQuery.isLoading) {
    return (
      <PageShell title={`OPEX Report ${s0}`}>
        <PageLoading label="OPEX Report" />
      </PageShell>
    );
  }
  if (reportQuery.isError) {
    return (
      <PageShell title={`OPEX Report ${s0}`}>
        <QueryError title="The OPEX Report could not be loaded." onRetry={reportQuery.refetch} />
      </PageShell>
    );
  }
  if (!report) {
    return (
      <PageShell title={`OPEX Report ${s0}`}>
        <EmptyState title={`No OPEX Report for ${s0}`} description="Start one from the OPEX page." />
      </PageShell>
    );
  }

  return (
    <PageShell
      title={`OPEX Report ${s0}`}
      description={read ? (read.projectName ?? "No project name: Odoo has no Project tag for this S0.") : undefined}
      action={
        <div className="flex items-center gap-3">
          {read && <span className="text-xs text-muted-foreground">Odoo read at {when(read.readAt)}</span>}
          <Button size="sm" variant="outline" className="gap-1.5" disabled={readQuery.isFetching} onClick={() => readQuery.refetch()}>
            <RefreshCw size={14} className={readQuery.isFetching ? "animate-spin" : ""} />
            Read again
          </Button>
        </div>
      }
    >
      {readQuery.isFetching && !read && <PageLoading label="Odoo" />}
      {readQuery.isError && (
        <div role="alert" className="rounded-xl border border-red-6 bg-red-a2 px-5 py-4 text-sm text-red-11">
          Odoo could not be read, so no figures are shown. {readQuery.error?.message}
        </div>
      )}

      {read?.noProjectTag && (
        <div role="alert" className="flex items-start gap-2 rounded-xl border border-amber-6 bg-amber-a2 px-4 py-3 text-sm">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <span>Odoo has no Project tag for {s0}. This report shows only P0s whose Source Document names it.</span>
        </div>
      )}

      {read && (
        <div className="space-y-6">
          <section aria-label="P0 lines" className="space-y-2">
            <h2 className="text-base font-semibold">P0 lines</h2>
            <P0LinesTable lines={read.lines} />
          </section>
          <section aria-label="Expenses" className="space-y-2">
            <h2 className="text-base font-semibold">Expenses</h2>
            <ExpensesTable expenses={read.expenses} />
          </section>
          <section aria-label="Summary" className="space-y-2">
            <h2 className="text-base font-semibold">Summary</h2>
            <Summary summary={summary} />
          </section>
        </div>
      )}
    </PageShell>
  );
}

export default function OpexReportPage() {
  const { user } = useAuth();
  const { s0: param } = useParams();
  const { isSuperAdmin, hasFinanceFlow } = getPermissionContext(user);
  if (user && !(isSuperAdmin || hasFinanceFlow)) return <Navigate to="/" replace />;
  const s0 = normalizeS0(param);
  if (!s0) return <Navigate to="/finance/opex" replace />;
  return (
    <ProtectedRoute>
      <OpexReportView s0={s0} />
    </ProtectedRoute>
  );
}
