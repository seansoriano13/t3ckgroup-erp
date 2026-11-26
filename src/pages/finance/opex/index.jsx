import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Navigate, useNavigate } from "react-router";
import toast from "react-hot-toast";
import { Banknote, Plus } from "lucide-react";

import ProtectedRoute from "../../../components/ProtectedRoute";
import PageShell from "../../../components/ui/PageShell";
import EmptyState from "../../../components/ui/EmptyState";
import QueryError from "../../../components/ui/QueryError";
import PageLoading from "../../../components/ui/PageLoading";
import ModalShell from "../../../components/ui/ModalShell";
import { Button } from "../../../components/ui/button";
import { FieldBox } from "../../../components/ui/FieldBox";
import { Input } from "../../../components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../../components/ui/table";
import { useAuth } from "../../../context/AuthContext";
import { getPermissionContext } from "../../../utils/permissions";
import { opexReportService } from "../../../services/opexReportService";
import { formatPesos, normalizeS0 } from "../../../utils/opexReport";

/**
 * The OPEX page (#1244, spec #1241): every OPEX Report from its saved snapshot, so no row
 * calls Odoo. "New OPEX Report" asks for an S0 number; a second report for the same S0
 * opens the one that is there.
 */

const HEAD = "text-label font-bold uppercase tracking-wider";
const OPEX_KEY = ["opex-reports"];

const readAt = (value) =>
  value ? new Date(value).toLocaleString("en-PH", { dateStyle: "medium", timeStyle: "short" }) : "Not read yet";

function NewReportDialog({ open, onOpenChange }) {
  const navigate = useNavigate();
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const s0 = normalizeS0(text);

  const start = async () => {
    if (!s0) return;
    setSaving(true);
    try {
      const { report, existed } = await opexReportService.create(s0);
      if (existed) toast(`${s0} already has an OPEX Report. Opening it.`);
      onOpenChange(false);
      setText("");
      navigate(`/finance/opex/${report.s0_number}`);
    } catch {
      toast.error("The OPEX Report could not be started.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalShell
      open={open}
      onOpenChange={(next) => {
        if (!next) setText("");
        onOpenChange(next);
      }}
      crumbs={["OPEX Report", "New OPEX Report"]}
      dirty={text.trim() !== ""}
      discardWhat="OPEX Report"
      actions={
        <Button onClick={start} disabled={saving || !s0}>
          {saving ? "Starting…" : "Start OPEX Report"}
        </Button>
      }
    >
      <p className="text-sm text-muted-foreground">An OPEX Report is for one S0. It reads what Odoo says the project spent.</p>
      <FieldBox label="S0 number" bare>
        <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. S06637" />
      </FieldBox>
    </ModalShell>
  );
}

function OpexList() {
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);
  const { data: rows = [], isLoading, isError, refetch } = useQuery({ queryKey: OPEX_KEY, queryFn: () => opexReportService.list() });

  return (
    <PageShell
      title="OPEX"
      description="What Odoo says each project really spent, one report per S0."
      action={
        <Button size="sm" onClick={() => setCreating(true)} className="gap-1.5">
          <Plus size={14} />
          New OPEX Report
        </Button>
      }
    >
      {isLoading && <PageLoading label="OPEX Reports" />}
      {isError && <QueryError title="OPEX Reports could not be loaded." onRetry={refetch} />}

      {!isLoading && !isError && rows.length === 0 && (
        <EmptyState icon={Banknote} title="No OPEX Reports yet" description="Start one from an S0 number." />
      )}

      {!isLoading && !isError && rows.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          <div className="overflow-x-auto">
            <Table tableId="opex-reports" className="md:min-w-[48rem]">
              <TableHeader>
                <TableRow className="bg-muted/40 hover:bg-muted/40">
                  <TableHead className={HEAD}>S0</TableHead>
                  <TableHead className={HEAD}>Project</TableHead>
                  <TableHead className={`${HEAD} text-right`}>Contract price</TableHead>
                  <TableHead className={`${HEAD} text-right`}>Actual OPEX</TableHead>
                  <TableHead className={`${HEAD} text-right`}>Revenue</TableHead>
                  <TableHead className={`${HEAD} text-right`}>Revenue %</TableHead>
                  <TableHead className={HEAD}>Last read</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => {
                  const snap = row.snapshot;
                  return (
                    <TableRow key={row.id} className="cursor-pointer" onClick={() => navigate(`/finance/opex/${row.s0_number}`)}>
                      <TableCell className="font-mono">{row.s0_number}</TableCell>
                      <TableCell>{snap?.project_name ?? "—"}</TableCell>
                      <TableCell className="text-right">{formatPesos(snap?.contract_price)}</TableCell>
                      <TableCell className="text-right">{formatPesos(snap?.actual_opex)}</TableCell>
                      <TableCell className="text-right">{formatPesos(snap?.revenue)}</TableCell>
                      <TableCell className="text-right">{snap?.revenue_percent == null ? "—" : `${snap.revenue_percent}%`}</TableCell>
                      <TableCell>{readAt(snap?.read_at)}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </div>
      )}

      <NewReportDialog open={creating} onOpenChange={setCreating} />
    </PageShell>
  );
}

export default function OpexPage() {
  const { user } = useAuth();
  const { isSuperAdmin, hasFinanceFlow } = getPermissionContext(user);
  if (user && !(isSuperAdmin || hasFinanceFlow)) return <Navigate to="/" replace />;
  return (
    <ProtectedRoute>
      <OpexList />
    </ProtectedRoute>
  );
}
