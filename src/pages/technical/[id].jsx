import { useNavigate, useParams } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";

import ProtectedRoute from "../../components/ProtectedRoute";
import TeamsOnly from "./_components/TeamsOnly";
import PageShell from "../../components/ui/PageShell";
import QueryError from "../../components/ui/QueryError";
import PageLoading from "../../components/ui/PageLoading";
import StatusBadge from "../../components/StatusBadge";
import { Button } from "../../components/ui/button";
import ComplianceCell from "../../components/costing/ComplianceCell";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../components/ui/table";
import { useAuth } from "../../context/AuthContext";
import { costingMatrixService } from "../../services/costingMatrixService";
import { getPermissionContext } from "../../utils/permissions";
import { judgedLabel, linesForTeams, technicalKeys } from "../../utils/technicalList";

/**
 * One SOR's Technical sheet (#706): only what a Technical person judges. For each row given to their team
 * it shows what the client asks for, what we offer, and the verdict (Complies or Deviates, with a note and an
 * optional alternative). It never shows a price, a cost or a markup: it reads the matrix at the participant
 * tier, which carries no money. Writing a verdict is the same call as on the S0 Evaluation sheet, so the
 * database's rules hold: only a member of the row's team can judge it. Rows of another team are left out.
 */

const HEAD = "text-label font-bold uppercase tracking-wider";

function TechnicalSheet() {
  const { id } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const ctx = getPermissionContext(user);

  const sheet = useQuery({
    queryKey: technicalKeys.sheet(id),
    queryFn: async () => {
      const [matrix, list] = await Promise.all([costingMatrixService.get(id), costingMatrixService.technicalList()]);
      return { matrix, mine: list.filter((row) => row.opportunityId === id) };
    },
    retry: false,
    enabled: Boolean(id),
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["technical"] });
  const back = () => navigate("/technical");

  const matrix = sheet.data?.matrix ?? null;
  const mine = sheet.data?.mine ?? [];
  // A Super Admin reads every team's rows; a team member, only their own.
  const teams = ctx.isSuperAdmin ? null : mine.map((row) => row.team);
  const lines = matrix ? linesForTeams(matrix.tenderLines, teams) : [];
  const components = lines.flatMap((line) => line.components);
  const judged = components.filter((c) => c.compliance).length;
  // A verdict is the row's team's to give: a Super Admin reads every team's rows but judges only their own.
  const mineTeams = mine.filter((row) => row.isMine).map((row) => row.team);
  const header = mine[0];

  return (
    <PageShell
      title={header ? `${header.sorNumber} · ${header.projectTitle}` : "Technical sheet"}
      description={header ? `${header.soNumber ? `SO ${header.soNumber} · ` : ""}${header.clientName}` : "The rows given to your team."}
      action={
        <Button variant="outline" onClick={back}>
          <ArrowLeft className="size-4" aria-hidden="true" />
          Technical
        </Button>
      }
    >
      {sheet.isLoading && <PageLoading label="Technical sheet" />}
      {sheet.isError && <QueryError title="This sheet could not be loaded." onRetry={sheet.refetch} />}

      {matrix && !sheet.isError && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-3 text-sm" data-testid="technical-summary">
            <span className="tabular-nums text-foreground">{judgedLabel({ rowsJudged: judged, rowsTotal: components.length })}</span>
            <StatusBadge
              label={matrix.evaluation?.approved ? "Evaluation approved" : "Evaluation not approved yet"}
              theme={matrix.evaluation?.approved ? "green" : "mauve"}
            />
          </div>

          {components.length === 0 ? (
            <p className="text-sm text-muted-foreground">No rows are given to your team on this SOR.</p>
          ) : (
            <div className="overflow-hidden rounded-xl border border-border bg-card">
              <div className="overflow-x-auto">
                <Table tableId="technical-sheet" className="md:min-w-[48rem]">
                  <TableHeader>
                    <TableRow className="bg-muted/40 hover:bg-muted/40">
                      <TableHead className={HEAD}>Item</TableHead>
                      <TableHead className={HEAD}>Qty</TableHead>
                      <TableHead className={HEAD}>Client asks for</TableHead>
                      <TableHead className={HEAD}>We offer</TableHead>
                      <TableHead className={HEAD}>Your verdict</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {lines.flatMap((line) =>
                      line.components.map((component, index) => (
                        <TableRow key={component.id} data-testid="technical-component">
                          <TableCell className="align-top text-xs font-medium text-foreground">
                            {component.number} · {component.name || line.tender_specification}
                            <span className="block text-muted-foreground">{line.evaluating_team}</span>
                          </TableCell>
                          <TableCell className="align-top text-xs tabular-nums text-foreground">
                            {component.quantity} {component.unit ?? ""}
                          </TableCell>
                          <TableCell className="align-top text-xs text-foreground">{index === 0 ? line.tender_specification : ""}</TableCell>
                          <TableCell className="align-top text-xs text-foreground">
                            {component.offer_specification || component.brand ? (
                              <>
                                {component.offer_specification}
                                {component.brand && <span className="block text-muted-foreground">{component.brand}</span>}
                              </>
                            ) : (
                              <span className="text-muted-foreground">Not entered yet</span>
                            )}
                          </TableCell>
                          <TableCell className="min-w-[14rem] align-top">
                            <ComplianceCell component={component} number={component.number} readOnly={!mineTeams.includes(line.evaluating_team)} onChanged={refresh} />
                          </TableCell>
                        </TableRow>
                      )),
                    )}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}
          <p className="text-xs text-muted-foreground">No prices or costs are shown here. Rows of another team are left out.</p>
        </div>
      )}
    </PageShell>
  );
}

export default function TechnicalSheetPage() {
  return (
    <ProtectedRoute>
      <TeamsOnly>
        <TechnicalSheet />
      </TeamsOnly>
    </ProtectedRoute>
  );
}
