import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";

import { cn } from "@/lib/utils";
import { Table, TableBody, TableCell, TableHeader, TableRow } from "../../../ui/table";
import StatusBadge from "../../../StatusBadge";
import { Cell } from "../../GridCell";
import { pesos } from "../../gridFormat";
import { costingMatrixService } from "../../../../services/costingMatrixService";
import { COSTING_BAND, COSTING_TIER, LANDED_COST_MARK_LABEL, tierReadsCost, tierReadsLandedCost } from "../../../../constants/costing";
import { IPAS_STATE_LABELS } from "../../../../constants/ipas";
import { lineLanded } from "../../../../utils/costingMath";

const HEAD = "border-b border-border bg-muted px-3 py-2 text-label font-bold uppercase tracking-wider text-muted-foreground whitespace-nowrap";
const CELL = "border-b border-border px-3 py-2.5 align-top text-sm";
const lineName = (line) => line.sor_line_snapshot?.name || (line.tender_specification ?? "").split("\n")[0].trim() || "Untitled line";

/** The IPAS that pay for a line, from its parts: number and state, linked when the viewer may open it; a dash when none. */
function IpasList({ line, linkIpas }) {
  const seen = new Set();
  const ipas = [];
  for (const component of line.components ?? []) {
    for (const i of component.purchases?.ipas ?? []) {
      if (!i.ipasId || seen.has(i.ipasId)) continue;
      seen.add(i.ipasId);
      ipas.push(i);
    }
  }
  if (ipas.length === 0) return <span className="text-muted-foreground">—</span>;
  return (
    <ul className="space-y-1" data-testid="after-buying-ipas">
      {ipas.map((i) => (
        <li key={i.ipasId} className="whitespace-nowrap">
          {linkIpas ? (
            <Link to={`/purchasing/ipas/${i.ipasId}`} className="font-medium underline underline-offset-2 hover:text-foreground">
              {i.number}
            </Link>
          ) : (
            <span className="font-medium">{i.number}</span>
          )}
          <span className="text-xs text-muted-foreground"> {IPAS_STATE_LABELS[i.state] || i.state}</span>
        </li>
      ))}
    </ul>
  );
}

/** Landed / unit (#702): the IPAS's real figure once the line's parts all have one, else the estimate on the peso price. */
function Landed({ line, addons }) {
  const landed = lineLanded(line, addons);
  if (!landed) return <span className="text-muted-foreground">—</span>;
  return (
    <span data-testid="after-buying-landed">
      <span className="font-medium tabular-nums">{pesos(landed.unit)}</span>
      <span className="mt-1 flex flex-wrap items-center justify-end gap-x-1.5 gap-y-1 text-xs text-muted-foreground">
        {landed.kind === "real" ? (
          <>
            <span>Real · from the IPAS</span>
            <StatusBadge label={LANDED_COST_MARK_LABEL[landed.mark]} theme={landed.mark === "final" ? "green" : "amber"} />
          </>
        ) : (
          <span>{landed.local ? "Estimate · local" : `Estimate · +${landed.percent}%`}</span>
        )}
      </span>
    </span>
  );
}

/**
 * After buying, in the Overview: per line, the IPAS that pay for it and the Landed Cost per unit, with the
 * Import add-on that estimates it until the IPAS has the real one. The S0 Evaluation itself is the estimate
 * for the Go / No-go; this is what buying brought back, so it stays out of the steps. Only the tiers sent
 * the Landed Cost see it.
 */
export default function AfterBuying({ matrix, writes }) {
  const show = tierReadsCost(matrix.tier, "acquire_unit") && tierReadsLandedCost(matrix.tier);
  const { data: defaults } = useQuery({
    queryKey: ["costing", "landed-defaults"],
    queryFn: () => costingMatrixService.getLandedDefaults(),
    enabled: show,
  });
  if (!show) return null;
  const canAddon = (matrix.bands ?? []).includes(COSTING_BAND.PURCHASING);
  const addons = { import: matrix.importAddonPercent ?? defaults?.import ?? 0, local: defaults?.local ?? 0 };
  const lines = matrix.tenderLines ?? [];

  return (
    <section className="overflow-hidden rounded-xl border border-border bg-card" aria-label="After buying" data-testid="after-buying">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-border bg-muted px-4 py-2.5">
        <div>
          <h3 className="text-sm font-semibold">After buying</h3>
          <p className="text-xs text-muted-foreground">What the IPAS brought back. The evaluation above is the estimate the Go was decided on.</p>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          Import add-on
          <Cell
            label="Import add-on percent"
            noun="The Import add-on"
            value={addons.import}
            numeric
            align="right"
            placeholder="0"
            readOnly={!canAddon}
            onSave={async (value) => {
              await costingMatrixService.setImportAddon(matrix.matrixId, value);
              await writes.refresh();
            }}
            className="w-20"
          />
          % until the IPAS has the real Landed Cost
        </div>
      </div>
      <div className="overflow-x-auto">
        <Table className="border-separate border-spacing-0">
          <TableHeader className="bg-transparent">
            <TableRow className="hover:bg-transparent">
              <th className={cn(HEAD, "text-left")}>S0 line</th>
              <th className={cn(HEAD, "text-left")}>IPAS</th>
              <th className={cn(HEAD, "text-right")}>Landed / unit</th>
            </TableRow>
          </TableHeader>
          <TableBody>
            {lines.map((line) => (
              <TableRow key={line.id} className="hover:bg-transparent" data-testid="after-buying-line">
                <TableCell className={cn(CELL, "min-w-[14rem]")}>
                  <span className="text-muted-foreground">{line.number}.</span> {lineName(line)}
                </TableCell>
                <TableCell className={CELL}>
                  <IpasList line={line} linkIpas={matrix.tier !== COSTING_TIER.PARTICIPANT} />
                </TableCell>
                <TableCell className={cn(CELL, "w-48 text-right")}>
                  <Landed line={line} addons={addons} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </section>
  );
}
