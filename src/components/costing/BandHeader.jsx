import { TableHead } from "../ui/table";

/** The owner-band label over a run of columns, as the PMS sheet had it: SALES, PMS, MNGT. `band` is `sales`, `pms`, `mngt` or `tech`. */
// Status colours are for badges only (DESIGN.md), so every band header is the same neutral surface;
// the band is told apart by its name and by data-band.
export default function BandHeader({ band, span, children }) {
  return (
    <TableHead colSpan={span} data-band={band} className="border-l border-border/70 bg-muted/60 text-center text-label text-foreground">
      {children}
    </TableHead>
  );
}
