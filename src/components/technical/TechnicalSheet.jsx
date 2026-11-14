import { useState } from "react";
import { AlertTriangle } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import QueryError from "../ui/QueryError";
import PageLoading from "../ui/PageLoading";
import EvaluationBar from "../costing/EvaluationBar";
import TechnicalVerdict from "../costing/TechnicalVerdict";
import ItemVerdict from "./ItemVerdict";
import BulkVerdictBar from "./BulkVerdictBar";
import { Checkbox } from "../ui/checkbox";
import LinerList from "../record/LinerList";
import { COMPLIANCE_LABEL, COMPLIANCE_THEME } from "../../constants/costing";
import { useCostingWrites, useInchargeOptions } from "../costing/useCostingWrites";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../ui/table";
import { useAuth } from "../../context/AuthContext";
import { costingMatrixService } from "../../services/costingMatrixService";
import { technicalKeys } from "../../utils/technicalList";
import { useIsPhone } from "@/hooks/useScreenBand";

/**
 * One SOR's Technical sheet (#877, #908), shown in a record window over the Technical list. The Technical in-charge
 * gives one offer-level verdict for the whole S0 Evaluation: the same card as on the S0 Evaluation sheet (#909). Only
 * the named in-charge can write it; everyone else reads it. The rows show what the client asks for and what we offer.
 * No prices or costs: the sheet reads the matrix at the participant tier, which carries no money.
 */

const HEAD = "text-label font-bold uppercase tracking-wider";

// On a phone a product is one Liner row: item and quantity on top, the verdict badge on the right, then what the
// client asks for and what we offer. The row opens to the verdict and remark.
function phoneRows(lines, canWriteVerdict, refresh) {
  return lines.flatMap((line) =>
    line.components.map((component, index) => {
      const offer = [component.offer_specification, component.brand].filter(Boolean).join(" · ");
      const asks = index === 0 ? line.tender_specification : "";
      return {
        key: component.id,
        testId: "technical-component",
        main: `${component.number} · ${component.name || line.tender_specification}`,
        quantity: `${component.quantity} ${component.unit ?? ""}`.trim(),
        badge: { label: COMPLIANCE_LABEL[component.compliance] ?? "Not judged", theme: COMPLIANCE_THEME[component.compliance] ?? "mauve" },
        subWrap: true,
        sub: (
          <>
            {asks ? <span className="block break-words">Asks for: {asks}</span> : null}
            <span className="block break-words">We offer: {offer || "Not entered yet"}</span>
          </>
        ),
        children: <ItemVerdict component={component} canWrite={canWriteVerdict} onChanged={refresh} />,
      };
    }),
  );
}

export default function TechnicalSheet({ opportunityId }) {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [checked, setChecked] = useState(() => new Set());
  const phone = useIsPhone();

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
  const canWriteVerdict = Boolean(user?.id) && user.id === (matrix?.matrix?.technical_incharge_id ?? null);
  const allIds = lines.flatMap((line) => line.components.map((component) => component.id));
  const checkedIds = allIds.filter((id) => checked.has(id));
  const allChecked = allIds.length > 0 && checkedIds.length === allIds.length;
  const toggle = (id) =>
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const toggleAll = () => setChecked(allChecked ? new Set() : new Set(allIds));

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

          {!phone && canWriteVerdict && checkedIds.length > 0 && (
            <BulkVerdictBar
              ids={checkedIds}
              components={lines.flatMap((line) => line.components)}
              onDone={async () => {
                setChecked(new Set());
                await refresh();
              }}
            />
          )}

          {lines.length === 0 ? (
            <p className="text-sm text-muted-foreground">This S0 Evaluation has no rows yet.</p>
          ) : phone ? (
            <LinerList label="Products" rows={phoneRows(lines, canWriteVerdict, refresh)} />
          ) : (
            <div className="overflow-hidden rounded-xl border border-border bg-card">
              <div className="overflow-x-auto">
                <Table tableId="technical-sheet" className="md:min-w-[56rem]">
                  <TableHeader>
                    <TableRow className="bg-muted/40 hover:bg-muted/40">
                      {canWriteVerdict && (
                        <TableHead className="w-8">
                          <Checkbox aria-label="Check all products" checked={allChecked} onCheckedChange={toggleAll} />
                        </TableHead>
                      )}
                      <TableHead className={HEAD}>Item</TableHead>
                      <TableHead className={HEAD}>Qty</TableHead>
                      <TableHead className={HEAD}>Client asks for</TableHead>
                      <TableHead className={HEAD}>We offer</TableHead>
                      <TableHead className={HEAD}>Verdict and remark</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {lines.flatMap((line) =>
                      line.components.map((component, index) => (
                        <TableRow key={component.id} data-testid="technical-component">
                          {canWriteVerdict && (
                            <TableCell className="align-top">
                              <Checkbox aria-label={`Check ${component.number}`} checked={checked.has(component.id)} onCheckedChange={() => toggle(component.id)} />
                            </TableCell>
                          )}
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
                          <TableCell className="min-w-56 align-top">
                            <ItemVerdict component={component} canWrite={canWriteVerdict} onChanged={refresh} />
                          </TableCell>
                        </TableRow>
                      )),
                    )}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}
          <TechnicalVerdict matrix={matrix} actorId={user?.id ?? null} writes={{ refresh }} onTechnicalPage />

          <p className="text-xs text-muted-foreground">No prices or costs are shown here.</p>
        </>
      )}
    </div>
  );
}
