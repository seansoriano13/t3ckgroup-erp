import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../ui/table";
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
  mention: "Mention",
};

const formatSince = (iso) =>
  iso
    ? new Date(iso).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : "—";

const describeWindow = (w) =>
  `${w.calledInAtStageName || "This deal"} · ${VIA_LABEL[w.source] || "—"}${
    w.mentionedBy ? ` by ${w.mentionedBy}` : ""
  } · sees ${w.reachLabel}${
    w.closedAt ? " (closed)" : ""
  }`;

export default function MySorsTable({ rows, onOpen }) {
  return (
    <div className="rounded-2xl border border-border bg-card overflow-hidden shadow-sm">
      <Table tableId="my-sors" className="min-w-[900px]">
        <TableHeader>
          <TableRow>
            <TableHead id="sor">SOR</TableHead>
            <TableHead id="now-on">Now on</TableHead>
            <TableHead id="called-in-at">Called in at</TableHead>
            <TableHead id="via">Via</TableHead>
            <TableHead id="access">Access</TableHead>
            <TableHead id="since">Since</TableHead>
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
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onOpen(row.opportunityId);
                  }
                }}
                className="group cursor-pointer"
              >
                <TableCell>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[13px] font-semibold text-foreground">
                      {row.salesReference || row.sorCode || "—"}
                    </span>
                    {!row.isOpen && <StatusBadge theme="mauve" label="Access ended" />}
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
                <TableCell>
                  {VIA_LABEL[first?.source] || "—"}
                  {first?.mentionedBy ? <span className="text-muted-foreground"> by {first.mentionedBy}</span> : null}
                </TableCell>
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
    </div>
  );
}
