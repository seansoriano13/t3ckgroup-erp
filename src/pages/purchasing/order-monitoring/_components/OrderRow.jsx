import { TableCell, TableRow } from "../../../../components/ui/table";
import { ORDER_OWNER_LABELS } from "../../../../constants/orderMonitoring";
import { NextThing, WaitCell } from "./parts";

/** One open order on What needs doing: the next thing, who owes it, the wait, then which order it is. */
export default function OrderRow({ row, onOpen }) {
  return (
    <TableRow className="cursor-pointer" onClick={() => onOpen(row.id)}>
      <TableCell>
        <NextThing row={row} />
      </TableCell>
      <TableCell>{ORDER_OWNER_LABELS[row.next?.owner] ?? "—"}</TableCell>
      <TableCell>
        <WaitCell row={row} />
      </TableCell>
      <TableCell>
        <span className="font-mono font-semibold">{row.number}</span>
        <div className="text-xs text-muted-foreground">PO {row.poNumber}</div>
      </TableCell>
      <TableCell>
        {row.sors.length ? row.sors.map((sor) => sor.salesReference).join(", ") : "No SOR"}
        <div className="text-xs text-muted-foreground">{row.entity ?? "—"}</div>
      </TableCell>
      <TableCell>{row.supplier ?? "—"}</TableCell>
    </TableRow>
  );
}
