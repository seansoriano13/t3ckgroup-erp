import { CornerDownRight } from "lucide-react";

import { cn } from "@/lib/utils";
import { Table, TableBody, TableCell, TableHeader, TableRow } from "../../ui/table";
import StatusBadge from "../../StatusBadge";
import { Cell } from "../GridCell";
import { costingMatrixService } from "../../../services/costingMatrixService";
import { tierReads } from "../../../constants/costing";
import { pesos } from "../gridFormat";
import { useAuth } from "../../../context/AuthContext";
import ComplianceColumn from "./ComplianceColumn";
import { useMyEvaluationTeams } from "./evaluationTeams";

/**
 * The Costing Matrix as one flat grid, one row per line of the SOR's S0 (layout A "Sheet", spec #699,
 * ticket #700). A header strip of facts, two header rows (the team that owns each column, then the
 * column), and the Item column frozen while the money scrolls sideways. A box you can type in is a
 * `Cell`; everything else is plain text. This ticket draws Item, Qty, Client asks for, ABC / unit and
 * Final Offer / unit; later tickets add the cost, markup and compliance columns after them. A column
 * the viewer's tier is not sent is left out, not blanked.
 */

const CELL = "border-b border-r border-border px-3 py-2.5 align-top text-[13px] leading-snug";
const HEAD = "border-b border-r border-border bg-muted px-3 py-2 text-left text-label font-bold uppercase tracking-wider text-muted-foreground whitespace-nowrap";
const GROUP = "border-r border-border bg-card px-3 pb-2 pt-3 text-left text-label font-bold uppercase tracking-wider text-muted-foreground whitespace-nowrap";
const NUM = "text-right tabular-nums";
// Opaque, so the money slides under it; a plain border, no shadow.
const FROZEN = "sticky left-0 z-10";
const SUB = "mt-1 text-xs text-muted-foreground";

const firstLine = (text) => (text ?? "").split("\n")[0].trim();

function Fact({ label, children, sub }) {
  return (
    <div className="min-w-0 px-4 py-3">
      <div className="text-label font-bold uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-1 text-sm font-semibold leading-snug tabular-nums">{children}</div>
      {sub && <div className="text-xs font-normal text-muted-foreground">{sub}</div>}
    </div>
  );
}

/** The row's name: what the S0 line says, falling back to the tender wording. */
const itemName = (line) => line.sor_line_snapshot?.name || firstLine(line.tender_specification) || "Untitled line";

/** The client's ask is shown only where it says more than the item's own name (the fill copies the name in). */
const askOf = (line) => (line.tender_specification && line.tender_specification !== itemName(line) ? line.tender_specification : "");

export default function CostingSheet({ matrix, opportunity, writes, canWrite }) {
  const { user } = useAuth();
  const myTeams = useMyEvaluationTeams(user?.id ?? null);
  const lines = matrix.tenderLines;
  const { totals } = matrix;
  const showAbc = tierReads(matrix.tier, "abc_unit");
  const showOffer = tierReads(matrix.tier, "final_offer_unit");
  const byId = new Map(lines.map((line) => [line.id, line]));
  const priced = lines.filter((line) => !line.included);
  const judged = matrix.compliance.total - matrix.compliance.notEvaluated;

  const save = (line, fields) => async (value) => {
    await costingMatrixService.updateTenderLine(line.id, fields(value));
    await writes.refresh();
  };

  return (
    <div className="space-y-3" data-testid="costing-sheet">
      <div className="grid grid-cols-2 divide-x divide-y divide-border overflow-hidden rounded-xl border border-border bg-card sm:grid-cols-5 sm:divide-y-0">
        <Fact label="S0 · client">
          <span className="font-mono text-xs">{opportunity?.sales_reference ?? opportunity?.sor_code ?? "—"}</span>
          {opportunity?.client_name ? ` · ${opportunity.client_name}` : ""}
        </Fact>
        <Fact label="S0 lines" sub={lines.length === priced.length ? undefined : `${lines.length - priced.length} included`}>
          {lines.length}
        </Fact>
        <Fact label="Judged">
          {judged} of {matrix.compliance.total}
        </Fact>
        {showAbc && (
          <Fact label="ABC total" sub={totals.missingAbc ? `${totals.missingAbc} without one` : undefined}>
            {pesos(totals.abcTotal)}
          </Fact>
        )}
        {showOffer && (
          <Fact
            label="Final Offer total"
            sub={totals.missingOffer ? `${totals.missingOffer} without one` : totals.percentOfAbc == null ? undefined : `${totals.percentOfAbc.toFixed(1)}% of the ABC`}
          >
            {pesos(totals.finalOfferTotal)}
          </Fact>
        )}
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <Table className="border-separate border-spacing-0 text-[13px]">
          <TableHeader className="bg-transparent">
            <TableRow>
              <th className={cn(GROUP, FROZEN)}>S0 line</th>
              <th className={GROUP} />
              <th colSpan={1 + (showAbc ? 1 : 0) + (showOffer ? 1 : 0)} className={GROUP}>
                Sales · the client&apos;s ask
              </th>
              <th className={cn(GROUP, "border-r-0")}>Technical</th>
            </TableRow>
            <TableRow>
              <th className={cn(HEAD, FROZEN)}>Item</th>
              <th className={cn(HEAD, "text-right")}>Qty</th>
              <th className={HEAD}>Client asks for</th>
              {showAbc && <th className={cn(HEAD, "text-right")}>ABC / unit</th>}
              {showOffer && <th className={cn(HEAD, "text-right")}>Final Offer / unit</th>}
              <th className={cn(HEAD, "border-r-0")}>Compliance</th>
            </TableRow>
          </TableHeader>
          <TableBody>
            {lines.length === 0 && (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={4 + (showAbc ? 1 : 0) + (showOffer ? 1 : 0)} className="px-3 py-4 text-sm text-muted-foreground">
                  No S0 lines yet.
                </TableCell>
              </TableRow>
            )}
            {lines.map((line, index) => {
              const kid = line.included;
              const parent = kid ? byId.get(line.includedIn) : null;
              const startsBlock = !kid && index > 0;
              const parts = line.components.length;
              return (
                <TableRow
                  key={line.id}
                  data-testid="sheet-row"
                  data-included={kid ? "true" : "false"}
                  className={cn("hover:bg-transparent", startsBlock && "[&>td]:border-t [&>td]:border-t-mauve-7", kid && "[&>td:not(:first-child)]:bg-muted/40")}
                >
                  <TableCell className={cn(CELL, FROZEN, kid ? "bg-muted" : "bg-card", "min-w-[11rem] max-w-[13rem] sm:min-w-[17rem] sm:max-w-[19rem]")}>
                    <div className={cn("flex gap-2", kid && "pl-5")}>
                      {kid && <CornerDownRight size={14} aria-hidden="true" className="mt-0.5 shrink-0 text-muted-foreground" />}
                      <div className="min-w-0">
                        <div className={cn(!kid && "font-semibold")}>{itemName(line)}</div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
                          <span>{kid ? `comes with ${parent ? itemName(parent) : "the line above"}` : `line ${line.number}`}</span>
                          {line.source !== "sor_line" && <StatusBadge label="Not on the S0" theme="amber" />}
                          {parts > 1 && <span>· {parts} parts</span>}
                        </div>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className={cn(CELL, NUM)}>
                    {line.quantity}
                    {line.unit && <div className={SUB}>{line.unit}</div>}
                  </TableCell>
                  <TableCell className={cn(CELL, "min-w-[14rem] max-w-[17rem]")}>
                    {kid ? null : (
                      <Cell
                        label={`Client asks for ${line.number}`}
                        noun="The client's ask"
                        value={askOf(line)}
                        multiline
                        placeholder="The client's words"
                        readOnly={!canWrite}
                        onSave={save(line, (value) => ({ tenderSpecification: value || itemName(line) }))}
                      />
                    )}
                  </TableCell>
                  {showAbc && (
                    <TableCell className={cn(CELL, NUM, "w-36")}>
                      {kid ? (
                        <span className="text-muted-foreground">incl.</span>
                      ) : (
                        <Cell
                          label={`ABC / unit ${line.number}`}
                          noun="ABC"
                          value={line.abc_unit}
                          numeric
                          money
                          align="right"
                          placeholder="Budget"
                          readOnly={!canWrite}
                          onSave={save(line, (value) => ({ abcUnit: value }))}
                          className="min-w-28"
                        />
                      )}
                    </TableCell>
                  )}
                  {showOffer && (
                    <TableCell className={cn(CELL, NUM, "w-40")}>
                      {kid ? (
                        <span className="text-muted-foreground">incl.</span>
                      ) : (
                        <>
                          <Cell
                            label={`Final Offer / unit ${line.number}`}
                            noun="Final Offer"
                            value={line.final_offer_unit}
                            numeric
                            money
                            align="right"
                            placeholder="Our bid"
                            readOnly={!canWrite}
                            onSave={save(line, (value) => ({ finalOfferUnit: value }))}
                            className="min-w-28"
                          />
                          {line.totals.overAbc && <div className="mt-1 text-xs text-destructive">Over the ABC</div>}
                        </>
                      )}
                    </TableCell>
                  )}
                  <TableCell className={cn(CELL, "min-w-[12rem] max-w-[16rem] border-r-0")}>
                    <ComplianceColumn line={line} myTeams={myTeams} canSetTeam={canWrite} onChanged={writes.refresh} />
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
      <p className="text-xs text-muted-foreground">A box you can type in is yours to change. An S0 line priced at ₱0 reads as included in the line above it.</p>
    </div>
  );
}
