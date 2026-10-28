import {
  SortHead,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../ui/table";
import { useTableSort } from "../../hooks/useTableSort";
import { Tooltip } from "../ui/Tooltip";
import StatusBadge from "../StatusBadge";
import { SOURCE_DEAL_TEAM, SOURCE_MENTION } from "../../utils/mySorsFilters";

/**
 * My SORs as a Register table: one row per SOR, showing its most recent
 * call-in. Any other windows collapse into a "+N" chip whose tooltip lists
 * them, so "why can I see this" keeps every answer without a row each.
 */
const VIA_LABEL = {
  [SOURCE_DEAL_TEAM]: "Deal Team",
  action: "Task",
  assignment: "Assignment",
  purchase_request: "Purchase request",
  [SOURCE_MENTION]: "Mention",
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

const MY_SORS_SORT = {
  sor: (r) => r.salesReference || r.sorCode,
  "now-on": (r) => r.currentStageName,
  "called-in-at": (r) => r.windows[0]?.calledInAtStageName,
  via: (r) => VIA_LABEL[r.windows[0]?.source],
  access: (r) => r.windows[0]?.reachLabel,
  since: (r) => (r.windows[0]?.createdAt ? new Date(r.windows[0].createdAt).getTime() : null),
};

export default function MySorsTable({ rows: unsortedRows, onOpen }) {
  const { sorted: rows, sort, toggle } = useTableSort(unsortedRows, MY_SORS_SORT);
  return (
    <div className="rounded-2xl border border-border bg-card overflow-hidden shadow-sm">
      <Table tableId="my-sors" className="min-w-[900px]">
        <TableHeader>
          <TableRow>
            <SortHead id="sor" sortKey="sor" sort={sort} onSort={toggle}>SOR</SortHead>
            <SortHead id="now-on" sortKey="now-on" sort={sort} onSort={toggle}>Now on</SortHead>
            <SortHead id="called-in-at" sortKey="called-in-at" sort={sort} onSort={toggle}>Called in at</SortHead>
            <SortHead id="via" sortKey="via" sort={sort} onSort={toggle}>Via</SortHead>
            <SortHead id="access" sortKey="access" sort={sort} onSort={toggle}>Access</SortHead>
            <SortHead id="since" sortKey="since" sort={sort} onSort={toggle}>Since</SortHead>
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
                    <StatusBadge theme={row.currentStageColor || "mauve"} label={row.currentStageName} />
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
