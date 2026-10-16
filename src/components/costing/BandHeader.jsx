import { TableHead } from "../ui/table";

const TONE = {
  sales: "bg-blue-3/60 text-blue-11",
  pms: "bg-violet-3/60 text-violet-11",
  mngt: "bg-amber-3/60 text-amber-12",
};

/** The owner-band label over a run of columns, as the PMS sheet had it: SALES, PMS, MNGT. `band` is `sales`, `pms` or `mngt`. */
export default function BandHeader({ band, span, children }) {
  return (
    <TableHead colSpan={span} className={`border-l border-border/70 text-center text-[11px] font-bold uppercase tracking-widest ${TONE[band]}`}>
      {children}
    </TableHead>
  );
}
