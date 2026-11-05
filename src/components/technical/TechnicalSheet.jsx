import { AlertTriangle } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import QueryError from "../ui/QueryError";
import PageLoading from "../ui/PageLoading";
import EvaluationBar from "../costing/EvaluationBar";
import TechnicalVerdict from "../costing/TechnicalVerdict";
import { useCostingWrites, useInchargeOptions } from "../costing/useCostingWrites";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../ui/table";
import { useAuth } from "../../context/AuthContext";
import { costingMatrixService } from "../../services/costingMatrixService";
import { technicalKeys } from "../../utils/technicalList";

/**
 * One SOR's Technical sheet (#877, #908), shown in a record window over the Technical list. The Technical in-charge
 * gives one offer-level verdict for the whole S0 Evaluation: the same card as on the S0 Evaluation sheet (#909). Only
 * the named in-charge can write it; everyone else reads it. The rows show what the client asks for and what we offer.
 * No prices or costs: the sheet reads the matrix at the participant tier, which carries no money.
 */

const HEAD = "text-label font-bold uppercase tracking-wider";

export default function TechnicalSheet({ opportunityId }) {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  const sheet = useQuery({
    queryKey: technicalKeys.sheet(opportunityId),
    queryFn: async () => {
      const [matrix, list] = await Promise.all([costingMatrixService.get(opportunityId), costingMatrixService.technicalList()]);
      return { matrix, header: list.find((row) => row.opportunityId === opportunityId) ?? null };
    },
    retry: false,
    enabled: Boolean(opportunityId),
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["technical"] });

  // Approving the evaluation (the Evaluation list): the same button as on the S0 Evaluation sheet, then this sheet and
  // the list behind it are read again so the approval shows without a reload.
  const costingWrites = useCostingWrites(opportunityId);
  const { nameOf } = useInchargeOptions(null);
  const approvalWrites = { busy: costingWrites.busy, run: (work) => costingWrites.run(async () => { await work(); await refresh(); }) };

  const matrix = sheet.data?.matrix ?? null;
  const header = sheet.data?.header ?? null;
  const lines = matrix?.tenderLines ?? [];

  return (
    <div className="space-y-4 pb-2">
      <div>
        <h2 className="text-lg font-semibold text-foreground">{header ? `${header.sorNumber} · ${header.projectTitle}` : "Technical sheet"}</h2>
        {header && (
          <p className="text-sm text-muted-foreground">
            {header.soNumber ? `SO ${header.soNumber} · ` : ""}
            {header.clientName}
          </p>
        )}
      </div>

      {sheet.isLoading && <PageLoading label="Technical sheet" />}
      {sheet.isError && <QueryError title="This sheet could not be loaded." onRetry={sheet.refetch} />}

      {matrix && !sheet.isError && (
        <>
          {costingWrites.notice && (
            <p role="alert" className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
              {costingWrites.notice}
            </p>
          )}

          <EvaluationBar matrix={matrix} opportunityId={opportunityId} actorId={user?.id ?? null} nameOf={nameOf} writes={approvalWrites} />

          <TechnicalVerdict matrix={matrix} actorId={user?.id ?? null} writes={{ refresh }} />

          {lines.length === 0 ? (
            <p className="text-sm text-muted-foreground">This S0 Evaluation has no rows yet.</p>
          ) : (
            <div className="overflow-hidden rounded-xl border border-border bg-card">
              <div className="overflow-x-auto">
                <Table tableId="technical-sheet" className="md:min-w-[40rem]">
                  <TableHeader>
                    <TableRow className="bg-muted/40 hover:bg-muted/40">
                      <TableHead className={HEAD}>Item</TableHead>
                      <TableHead className={HEAD}>Qty</TableHead>
                      <TableHead className={HEAD}>Client asks for</TableHead>
                      <TableHead className={HEAD}>We offer</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {lines.flatMap((line) =>
                      line.components.map((component, index) => (
                        <TableRow key={component.id} data-testid="technical-component">
                          <TableCell className="align-top text-xs font-medium text-foreground">
                            {component.number} · {component.name || line.tender_specification}
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
                        </TableRow>
                      )),
                    )}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}
          <p className="text-xs text-muted-foreground">No prices or costs are shown here.</p>
        </>
      )}
    </div>
  );
}
