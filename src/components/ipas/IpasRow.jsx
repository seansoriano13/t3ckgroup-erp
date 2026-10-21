import { TableCell, TableRow } from "../ui/table";
import { formatDate } from "../../utils/formatDate.js";
import {
  IPAS_COMPUTATION_STATUS,
  IPAS_COMPUTATION_STATUS_LABELS,
  IPAS_PRIORITY_LABELS,
  IPAS_PURPOSE_LABELS,
  IPAS_SOURCE_LABELS,
  IPAS_STATE,
} from "../../constants/ipas";
import { raisedByParts, sorLineParts } from "../../utils/ipas";
import HighlightText from "../HighlightText";
import IpasStateBadge from "./IpasStateBadge";

/**
 * One row of the IPAS list. The whole row opens the IPAS (click, or Enter on
 * the focused row); Supplier, Entity, Project / SO, Raised and Raised by hide
 * below md so the number, Purpose and State stay in view. `search` is the
 * list's search text: where it matches, the text is highlighted.
 */
export default function IpasRow({ row, onOpen, search = "" }) {
  const raisedBy = raisedByParts(row);
  const term = search.trim().toLowerCase();

  return (
    <TableRow
      tabIndex={0}
      data-testid="ipas-row"
      onClick={() => onOpen(row.id)}
      onKeyDown={(e) => {
        if (e.key === "Enter" && e.target === e.currentTarget) {
          e.preventDefault();
          onOpen(row.id);
        }
      }}
      className={`group cursor-pointer outline-none focus-visible:bg-muted ${row.state === IPAS_STATE.CANCELLED ? "opacity-70" : ""}`}
    >
      <TableCell>
        <span className="block font-mono text-xs font-semibold text-foreground">
          <HighlightText text={row.number} search={search} />
        </span>
        <span className="mt-0.5 block text-[11px] text-muted-foreground">
          {IPAS_PRIORITY_LABELS[row.priority]} · {IPAS_SOURCE_LABELS[row.source]}
        </span>
      </TableCell>
      <TableCell>
        <span className="font-mono text-xs text-foreground">
          <HighlightText text={row.po_number} search={search} />
        </span>
      </TableCell>
      <TableCell className="hidden md:table-cell">
        <span className="block max-w-[16rem] truncate text-xs text-foreground">
          {row.supplier ? <HighlightText text={row.supplier} search={search} /> : "—"}
        </span>
      </TableCell>
      <TableCell className="hidden md:table-cell">
        <span className="text-xs text-muted-foreground">{row.entity || "—"}</span>
      </TableCell>
      <TableCell>
        <span className="text-xs font-medium text-foreground">{IPAS_PURPOSE_LABELS[row.purpose]}</span>
      </TableCell>
      <TableCell>
        <span className="text-xs text-foreground" data-testid="ipas-row-costing">
          {IPAS_COMPUTATION_STATUS_LABELS[row.computation_status || IPAS_COMPUTATION_STATUS.ENCODING] ?? "—"}
        </span>
      </TableCell>
      <TableCell className="hidden md:table-cell">
        {row.sors.length === 0 ? (
          <span className="text-xs text-muted-foreground">—</span>
        ) : (
          <ul className="space-y-0.5" data-testid="ipas-row-sors">
            {row.sors.map((sor) => {
              const { reference, project } = sorLineParts(sor);
              // A line leads with the SO number; when the search is the SOR number
              // of an SOR that has an SO number, the SOR number is shown so the match is visible.
              const showSorCode = Boolean(sor.salesReference && sor.sorCode && term && sor.sorCode.toLowerCase().includes(term));
              return (
                <li key={sor.id} className="max-w-[20rem] truncate text-xs text-foreground">
                  <span className="font-mono">{reference ? <HighlightText text={reference} search={search} /> : "—"}</span>
                  {project && (
                    <>
                      {" · "}
                      <HighlightText text={project} search={search} />
                    </>
                  )}
                  {showSorCode && (
                    <span className="ml-1 font-mono text-muted-foreground">
                      (<HighlightText text={sor.sorCode} search={search} />)
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </TableCell>
      <TableCell className="hidden md:table-cell">
        <span className="text-xs tabular-nums text-muted-foreground">{formatDate(row.created_at)}</span>
      </TableCell>
      <TableCell className="hidden md:table-cell">
        {raisedBy ? (
          <span className="block max-w-[14rem] truncate text-xs text-foreground" data-testid="ipas-row-raised-by">
            {raisedBy.callSign ? `${raisedBy.callSign} · ${raisedBy.name}` : raisedBy.name}
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        )}
      </TableCell>
      <TableCell className="text-right">
        <IpasStateBadge state={row.state} />
      </TableCell>
    </TableRow>
  );
}
