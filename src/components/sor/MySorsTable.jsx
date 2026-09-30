import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../ui/table";
import { Tooltip } from "../ui/Tooltip";
import StatusBadge from "../StatusBadge";

/**
 * My SORs as a Register table: one row per SOR, showing its most recent
 * call-in. Any other windows collapse into a "+N" chip whose tooltip lists
 * them, so "why can I see this" keeps every answer without a row each.
 */
const VIA_LABEL = {
  action: "Task",
  assignment: "Assignment",
  purchase_request: "Purchase request",
};

const formatSince = (iso) =>
  iso
    ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
    : "—";

const describeWindow = (w) =>
  `${w.calledInAtStageName || "This deal"} · ${VIA_LABEL[w.source] || "—"} · sees ${w.reachLabel}${
    w.closedAt ? " (closed)" : ""
  }`;

export default function MySorsTable({ rows, onOpen }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>SOR</TableHead>
          <TableHead>Now on</TableHead>
          <TableHead>Called in at</TableHead>
          <TableHead>Via</TableHead>
          <TableHead>Access</TableHead>
          <TableHead>Since</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => {
          const [first, ...others] = row.windows;
          return (
            <TableRow
              key={row.opportunityId}
              tabIndex={0}
              onClick={() => onOpen(row.opportunityId)}
              onKeyDown={(e) => {
                if (e.key === "Enter") onOpen(row.opportunityId);
              }}
              className="cursor-pointer"
            >
              <TableCell>
                <div className="font-mono text-xs font-bold text-foreground">
                  {row.salesReference || "—"}
                </div>
                <div className="max-w-xs truncate text-muted-foreground">
                  {row.projectTitle || "Untitled"}
                </div>
              </TableCell>
              <TableCell>
                {row.currentStageName ? (
                  <StatusBadge theme="blue" label={row.currentStageName} />
                ) : (
                  "—"
                )}
              </TableCell>
              <TableCell>{first?.calledInAtStageName || "—"}</TableCell>
              <TableCell>{VIA_LABEL[first?.source] || "—"}</TableCell>
              <TableCell>
                <span className="inline-flex items-center gap-2">
                  {first ? `Sees ${first.reachLabel}` : "—"}
                  {others.length > 0 && (
                    <Tooltip
                      content={
                        <ul className="space-y-1 font-medium">
                          {others.map((w) => (
                            <li key={w.id}>{describeWindow(w)}</li>
                          ))}
                        </ul>
                      }
                    >
                      <span
                        tabIndex={0}
                        aria-label={`${others.length} more windows`}
                        className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-black text-muted-foreground"
                      >
                        +{others.length}
                      </span>
                    </Tooltip>
                  )}
                </span>
              </TableCell>
              <TableCell className="whitespace-nowrap text-muted-foreground">
                {formatSince(first?.createdAt)}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
