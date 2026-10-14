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
import IpasStateBadge from "./IpasStateBadge";

/**
 * One row of the IPAS list. The whole row opens the IPAS (click, or Enter on
 * the focused row); Supplier, Entity, SORs and Raised hide below md so the
 * number, Purpose and State stay in view.
 */
export default function IpasRow({ row, onOpen }) {
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
        <span className="block font-mono text-xs font-semibold text-foreground">{row.number}</span>
        <span className="mt-0.5 block text-[11px] text-muted-foreground">
          {IPAS_PRIORITY_LABELS[row.priority]} · {IPAS_SOURCE_LABELS[row.source]}
        </span>
      </TableCell>
      <TableCell>
        <span className="font-mono text-xs text-foreground">{row.po_number}</span>
      </TableCell>
      <TableCell className="hidden md:table-cell">
        <span className="block max-w-[16rem] truncate text-xs text-foreground">{row.supplier || "—"}</span>
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
          <span className="font-mono text-xs text-foreground">
            {row.sors.map((s) => s.salesReference).join(", ")}
          </span>
        )}
      </TableCell>
      <TableCell className="hidden md:table-cell">
        <span className="text-xs tabular-nums text-muted-foreground">{formatDate(row.created_at)}</span>
      </TableCell>
      <TableCell className="text-right">
        <IpasStateBadge state={row.state} />
      </TableCell>
    </TableRow>
  );
}
