import { TableCell, TableRow } from "../../../../components/ui/table";
import { ORDER_OWNER_LABELS } from "../../../../constants/orderMonitoring";
import { lateRowClass } from "./format";
import { NextThing, OrderCell, SorCell, WaitCell } from "./parts";

/** One open order on What needs doing: the next thing, who owes it, the wait, then which order it is. */
export default function OrderRow({ row, onOpen }) {
  return (
    <TableRow className={`cursor-pointer ${lateRowClass(row)}`} onClick={() => onOpen(row.id)}>
      <TableCell>
        <NextThing row={row} />
      </TableCell>
      <TableCell>{ORDER_OWNER_LABELS[row.next?.owner] ?? "—"}</TableCell>
      <TableCell>
        <WaitCell row={row} />
      </TableCell>
      <TableCell>
        <OrderCell row={row} />
      </TableCell>
      <TableCell>
        <SorCell row={row} />
      </TableCell>
      <TableCell>{row.supplier ?? "—"}</TableCell>
    </TableRow>
  );
}
