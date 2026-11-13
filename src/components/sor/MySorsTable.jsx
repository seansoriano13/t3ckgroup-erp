import { Fragment, useMemo, useState } from "react";
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
import { Button } from "../ui/button";
import StatusBadge from "../StatusBadge";
import { SOURCE_DEAL_TEAM, SOURCE_MENTION } from "../../utils/mySorsFilters";

/**
 * My SOR Work as a work list: one row per SOR, grouped by whether the person
 * owes something on it. "Needs you" leads, with the move waiting longest on
 * top; "Watching" holds SORs they can see but owe nothing on; "Access ended"
 * shows only when the Access filter lets it. "Why you're on it" says in words
 * how the person got onto each SOR (Task, Mention by Ana, Deal Team), with the
 * full list of reasons on hover: someone called in from another team needs to
 * know what pulled them in before they open it.
 */
const VIA_LABEL = {
  [SOURCE_DEAL_TEAM]: "Deal Team",
  action: "Task",
  assignment: "Assignment",
  purchase_request: "Purchase request",
  [SOURCE_MENTION]: "Mention",
};

const DAY = 24 * 60 * 60 * 1000;

const formatDate = (iso) =>
  iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : null;

/** "today", "1 day", "12 days": how long a move has waited. */
const waitedFor = (iso, now) => {
  if (!iso) return null;
  const days = Math.floor((now - new Date(iso).getTime()) / DAY);
  if (days <= 0) return "today";
  return `${days} day${days === 1 ? "" : "s"}`;
};

const describeWindow = (w) =>
  `${VIA_LABEL[w.source] || "Called in"}${w.mentionedBy ? ` by ${w.mentionedBy}` : ""}${
    w.calledInAtStageName ? ` at ${w.calledInAtStageName}` : ""
  } · sees ${w.reachLabel}${w.closedAt ? " (ended)" : ""}`;

/** The column's short answer: "Task", "Mention by Ana", "Deal Team". */
const whyLabel = (w) => `${VIA_LABEL[w.source] || "Called in"}${w.mentionedBy ? ` by ${w.mentionedBy}` : ""}`;

const oldestMove = (r) => r.moves?.[0];

const MY_SORS_SORT = {
  sor: (r) => r.salesReference || r.sorCode,
  move: (r) => oldestMove(r)?.label,
  why: (r) => (r.windows[0] ? whyLabel(r.windows[0]) : null),
  "now-on": (r) => r.currentStageName,
  // Oldest first reads as "longest waiting first" when sorted ascending.
  waiting: (r) => {
    const at = oldestMove(r)?.since || r.windows[0]?.createdAt;
    return at ? new Date(at).getTime() : null;
  },
};

const GROUPS = [
  { key: "needs", label: "Needs you", test: (r) => r.moves?.length > 0 },
  { key: "watching", label: "Watching", test: (r) => !(r.moves?.length > 0) && r.isOpen },
  { key: "ended", label: "Access ended", test: (r) => !(r.moves?.length > 0) && !r.isOpen },
];

function openEntity(move) {
  window.dispatchEvent(
    new CustomEvent("OPEN_ENTITY_DETAILS", { detail: { id: move.id, type: move.entityType } }),
  );
}

function MoveCell({ moves }) {
  if (!moves?.length) return <span className="text-muted-foreground">Nothing owed</span>;
  const [first, ...rest] = moves;
  return (
    <span className="inline-flex min-w-0 max-w-full items-center gap-2">
      <Button
        type="button"
        variant="link"
        onClick={(e) => {
          e.stopPropagation();
          openEntity(first);
        }}
        onKeyDown={(e) => e.stopPropagation()}
        className="h-auto min-w-0 justify-start truncate px-0 text-left text-[length:inherit] font-medium"
      >
        <span className="truncate">
          <span className="text-muted-foreground">{first.kind}:</span> {first.label}
        </span>
      </Button>
      {rest.length > 0 && (
        <Tooltip
          content={
            <ul className="space-y-1 font-medium">
              {rest.map((m) => (
                <li key={`${m.entityType}-${m.id}`}>
                  {m.kind}: {m.label}
                </li>
              ))}
            </ul>
          }
        >
          <span
            tabIndex={0}
            aria-label={`${rest.length} more to do`}
            className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-black text-muted-foreground"
          >
            +{rest.length}
          </span>
        </Tooltip>
      )}
    </span>
  );
}

/**
 * Why this person is on the SOR: the first reason in words, the Stage it came
 * at below it, and every reason in full on hover when there are several.
 */
function WhyCell({ windows }) {
  if (!windows.length) return <span className="text-muted-foreground">—</span>;
  const [first, ...rest] = windows;
  return (
    <Tooltip
      content={
        <div className="space-y-1 font-medium">
          <p className="text-muted-foreground">Why you can see this</p>
          <ul className="space-y-1">
            {windows.map((w) => (
              <li key={w.id}>{describeWindow(w)}</li>
            ))}
          </ul>
        </div>
      }
    >
      <span
        tabIndex={0}
        aria-label="Why you can see this SOR"
        onClick={(e) => e.stopPropagation()}
        className="inline-flex min-w-0 max-w-full flex-col"
      >
        <span className="inline-flex min-w-0 items-center gap-2">
          <span className="truncate font-medium text-foreground">{whyLabel(first)}</span>
          {rest.length > 0 && (
            <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-black text-muted-foreground">
              +{rest.length}
            </span>
          )}
        </span>
        {first.calledInAtStageName && (
          <span className="truncate text-xs text-muted-foreground">at {first.calledInAtStageName}</span>
        )}
      </span>
    </Tooltip>
  );
}

function WaitingCell({ row, now }) {
  const move = oldestMove(row);
  if (!move) {
    const since = formatDate(row.windows[0]?.createdAt);
    return <span className="text-muted-foreground">{since ? `Since ${since}` : "—"}</span>;
  }
  const overdue = move.dueAt && new Date(move.dueAt).getTime() < now;
  return (
    <div className="flex flex-col">
      <span className="tabular-nums text-foreground">{waitedFor(move.since, now)}</span>
      {move.dueAt && (
        <span className={overdue ? "text-xs font-semibold text-red-11" : "text-xs text-muted-foreground"}>
          {overdue ? "Overdue · " : "Due "}
          {formatDate(move.dueAt)}
        </span>
      )}
    </div>
  );
}

export default function MySorsTable({ rows: unsortedRows, onOpen }) {
  // One clock for the whole list, read once when it mounts.
  const [now] = useState(() => Date.now());
  // Until a header is clicked, the move waiting longest leads.
  const byWaiting = useMemo(() => {
    const at = MY_SORS_SORT.waiting;
    return [...unsortedRows].sort((a, b) => (at(a) ?? Infinity) - (at(b) ?? Infinity));
  }, [unsortedRows]);
  const { sorted: rows, sort, toggle } = useTableSort(byWaiting, MY_SORS_SORT);
  const groups = GROUPS.map((g) => ({ ...g, rows: rows.filter(g.test) })).filter((g) => g.rows.length > 0);

  return (
    <div className="rounded-2xl border border-border bg-card overflow-hidden shadow-sm">
      <Table tableId="my-sors" className="min-w-[860px]">
        <TableHeader>
          <TableRow>
            <SortHead id="sor" sortKey="sor" sort={sort} onSort={toggle}>SOR</SortHead>
            <SortHead id="why" sortKey="why" sort={sort} onSort={toggle}>Why you're on it</SortHead>
            <SortHead id="move" sortKey="move" sort={sort} onSort={toggle}>Your move</SortHead>
            <SortHead id="now-on" sortKey="now-on" sort={sort} onSort={toggle}>Now on</SortHead>
            <SortHead id="waiting" sortKey="waiting" sort={sort} onSort={toggle}>Waiting</SortHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {groups.map((group) => (
            <Fragment key={group.key}>
              <TableRow className="hover:bg-transparent" data-testid={`my-sors-group-${group.key}`}>
                <TableHead colSpan={5} className="h-9 bg-muted/40 text-xs font-semibold text-foreground">
                  {group.label}
                  <span className="ml-2 tabular-nums font-normal text-muted-foreground">{group.rows.length}</span>
                </TableHead>
              </TableRow>
              {group.rows.map((row) => (
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
                  <TableCell className="w-[26%]">
                    <span className="font-mono text-[13px] font-semibold text-foreground">
                      {row.salesReference || row.sorCode || "—"}
                    </span>
                    <div className="max-w-xs truncate text-muted-foreground">
                      {row.projectTitle || "Untitled"}
                    </div>
                  </TableCell>
                  <TableCell className="max-w-0 w-[20%]">
                    <WhyCell windows={row.windows} />
                  </TableCell>
                  <TableCell className="max-w-0 w-[30%]">
                    <MoveCell moves={row.moves} />
                  </TableCell>
                  <TableCell>
                    {row.currentStageName ? (
                      <StatusBadge theme={row.currentStageColor || "mauve"} label={row.currentStageName} />
                    ) : (
                      "—"
                    )}
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    <WaitingCell row={row} now={now} />
                  </TableCell>
                </TableRow>
              ))}
            </Fragment>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
