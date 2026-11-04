import { useNavigate } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { ClipboardCheck } from "lucide-react";

import ProtectedRoute from "../../components/ProtectedRoute";
import TeamsOnly from "./_components/TeamsOnly";
import PageShell from "../../components/ui/PageShell";
import EmptyState from "../../components/ui/EmptyState";
import QueryError from "../../components/ui/QueryError";
import PageLoading from "../../components/ui/PageLoading";
import StatusBadge from "../../components/StatusBadge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../components/ui/table";
import { costingMatrixService } from "../../services/costingMatrixService";
import { judgedLabel, technicalKeys } from "../../utils/technicalList";

/**
 * The Technical list (#706): the SORs with S0 Evaluation rows given to the caller's team (RRD or IOE),
 * for judging compliance. SOR names and counts only, never money. The menu offers it to the teams'
 * members and Super Admins; the page sends anyone else home and the database refuses the read.
 */

const HEAD = "text-label font-bold uppercase tracking-wider";

function TechnicalList() {
  const navigate = useNavigate();
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: technicalKeys.list,
    queryFn: () => costingMatrixService.technicalList(),
    retry: false,
  });
  const rows = data ?? [];

  return (
    <PageShell title="Technical" description="The S0 Evaluation rows given to your team. Open one to mark each as Complies or Deviates.">
      {isLoading && <PageLoading label="Technical" />}

      {isError && <QueryError title="The Technical list could not be loaded." onRetry={refetch} />}

      {!isLoading && !isError && rows.length === 0 && (
        <EmptyState
          icon={ClipboardCheck}
          title="Nothing to judge yet"
          description="Rows appear here once Sales or Purchasing gives them to your team."
        />
      )}

      {!isLoading && !isError && rows.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          <div className="overflow-x-auto">
            <Table tableId="technical-list" className="md:min-w-[44rem]">
              <TableHeader>
                <TableRow className="bg-muted/40 hover:bg-muted/40">
                  <TableHead className={HEAD}>SOR</TableHead>
                  <TableHead className={HEAD}>SO</TableHead>
                  <TableHead className={HEAD}>Project</TableHead>
                  <TableHead className={HEAD}>Team</TableHead>
                  <TableHead className={HEAD}>Progress</TableHead>
                  <TableHead className={HEAD}>Approval</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow
                    key={`${row.opportunityId}-${row.team}`}
                    tabIndex={0}
                    data-testid="technical-row"
                    onClick={() => navigate(`/technical/${row.opportunityId}`)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && e.target === e.currentTarget) {
                        e.preventDefault();
                        navigate(`/technical/${row.opportunityId}`);
                      }
                    }}
                    className="cursor-pointer outline-none focus-visible:bg-muted"
                  >
                    <TableCell className="font-mono text-xs font-semibold text-foreground">{row.sorNumber}</TableCell>
                    <TableCell className="font-mono text-xs text-foreground">{row.soNumber || "—"}</TableCell>
                    <TableCell>
                      <span className="block max-w-[22rem] truncate text-xs font-medium text-foreground" title={row.projectTitle}>
                        {row.projectTitle}
                      </span>
                      <span className="block text-xs text-muted-foreground">{row.clientName}</span>
                    </TableCell>
                    <TableCell className="text-xs text-foreground">{row.team}</TableCell>
                    <TableCell className="text-xs tabular-nums text-foreground" data-testid="technical-progress">
                      {judgedLabel(row)}
                    </TableCell>
                    <TableCell>
                      <StatusBadge label={row.approved ? "Approved" : "Not approved yet"} theme={row.approved ? "green" : "mauve"} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}
    </PageShell>
  );
}

export default function TechnicalPage() {
  return (
    <ProtectedRoute>
      <TeamsOnly>
        <TechnicalList />
      </TeamsOnly>
    </ProtectedRoute>
  );
}
