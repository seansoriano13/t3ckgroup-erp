import { Table, TableBody, TableHead, TableHeader, TableRow } from "../../../../components/ui/table";
import OrderRow from "./OrderRow";
import { TABLE_HEAD_CLASS } from "./format";

const HEADINGS = ["Next thing", "Owed by", "Waiting", "IPAS and PO", "SOR and entity", "Supplier"];

/** One group of open orders as a table. */
export default function GroupTable({ rows, onOpen }) {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="overflow-x-auto">
        <Table tableId="order-monitoring" className="md:min-w-[48rem]">
          <TableHeader>
            <TableRow className="bg-muted/40 hover:bg-muted/40">
              {HEADINGS.map((heading) => (
                <TableHead key={heading} className={TABLE_HEAD_CLASS}>
                  {heading}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <OrderRow key={row.id} row={row} onOpen={onOpen} />
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
