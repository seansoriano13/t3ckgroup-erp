import { useEffect, useState } from "react";
import { CircleAlert, MessageSquareReply, Paperclip } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import HighlightText from "../../../components/HighlightText";
import { shortAge, shortDate } from "../../../utils/approvalItems.js";
import { neighbourTaskId, resolveNavigationKey } from "../../../utils/approvalQueue.js";
import { StageMeter, StatusPill } from "./ApprovalParts";
import { PersonChip } from "@/components/ui/DetailParts";

const HEAD = "text-[10px] font-bold uppercase tracking-wider";

/**
 * One dense table for any Approval Center queue.
 *
 * Rows are ApprovalItems. Clicking a row (or Enter on the keyboard cursor)
 * opens it; J / K move the cursor while `keyboard` is on — the page turns it
 * off while the review sheet is open, so the sheet owns the keys then.
 */
export function ApprovalTable({
  items,
  queueIcon: QueueIcon,
  personLabel = "Logged by",
  onOpen,
  selectedIds = [],
  onToggle,
  onToggleAll,
  selectable = false,
  renderRowAction,
  repliedIds,
  searchTerm = "",
  keyboard = true,
  empty,
}) {
  const [cursorId, setCursorId] = useState(null);
  const cursor = items.some((i) => i.id === cursorId) ? cursorId : items[0]?.id;

  useEffect(() => {
    if (!keyboard) return;
    const onKey = (e) => {
      if (e.target?.closest?.("button, a, input, textarea, [role='checkbox'], [role='tab'], [role='dialog']")) return;
      const dir = resolveNavigationKey(e);
      const index = items.findIndex((i) => i.id === cursor);
      if (dir) {
        const next = neighbourTaskId(items, index, dir);
        if (next) {
          e.preventDefault();
          setCursorId(next);
          document.querySelector(`[data-approval-row="${CSS.escape(String(next))}"]`)?.scrollIntoView({ block: "nearest" });
        }
        return;
      }
      if (e.key === "Enter" && !e.metaKey && !e.ctrlKey && !e.altKey && items[index]) {
        e.preventDefault();
        onOpen(items[index]);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [keyboard, items, cursor, onOpen]);

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border px-6 py-20 text-center">
        <p className="text-sm font-bold text-foreground">{empty?.title}</p>
        <p className="max-w-sm text-xs text-muted-foreground">{empty?.description}</p>
      </div>
    );
  }

  const allChecked = items.every((i) => selectedIds.includes(i.id));

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/40 hover:bg-muted/40">
            <TableHead className="w-10 pl-4">
              {selectable && <Checkbox checked={allChecked} onCheckedChange={(v) => onToggleAll?.(v)} aria-label="Select all" />}
            </TableHead>
            <TableHead className={HEAD}>Request</TableHead>
            <TableHead className={HEAD}>{personLabel}</TableHead>
            <TableHead className={`${HEAD} hidden lg:table-cell`}>Submitted</TableHead>
            <TableHead className={`${HEAD} hidden md:table-cell`}>Waiting</TableHead>
            <TableHead className={`${HEAD} hidden 2xl:table-cell`}>Stage</TableHead>
            <TableHead className={HEAD}>Status</TableHead>
            <TableHead className="w-24" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((item) => {
            const checked = selectedIds.includes(item.id);
            const replied = repliedIds?.has?.(item.id);
            return (
              <TableRow
                key={item.id}
                data-approval-queue=""
                data-approval-row={item.id}
                data-state={checked ? "selected" : undefined}
                tabIndex={0}
                onClick={() => {
                  setCursorId(item.id);
                  onOpen(item);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && e.target === e.currentTarget) {
                    e.preventDefault();
                    e.stopPropagation();
                    onOpen(item);
                  }
                }}
                className={`group h-14 cursor-pointer outline-none focus-visible:bg-muted ${cursor === item.id && keyboard ? "bg-muted/60" : ""}`}
              >
                <TableCell className="pl-4" onClick={(e) => e.stopPropagation()}>
                  {selectable && <Checkbox checked={checked} onCheckedChange={() => onToggle?.(item.id)} aria-label={`Select ${item.title}`} />}
                </TableCell>
                <TableCell className="max-w-[280px] 2xl:max-w-[360px]">
                  <div className="flex items-center gap-2.5">
                    <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
                      <QueueIcon size={14} />
                    </span>
                    <div className="min-w-0">
                      <p className="flex items-center gap-1.5 text-[13px] font-semibold text-foreground">
                        {item.isHighPriority && <CircleAlert size={12} className="shrink-0 text-red-10" aria-label="High priority" />}
                        <span className="truncate">
                          <HighlightText text={item.title} search={searchTerm} />
                        </span>
                        {replied && (
                          <span className="inline-flex shrink-0 items-center gap-0.5 text-[10px] font-bold uppercase tracking-wider text-blue-11" title="You replied on this task">
                            <MessageSquareReply size={11} /> Replied
                          </span>
                        )}
                      </p>
                      <p className="flex items-center gap-1 truncate text-[11px] text-muted-foreground">
                        <span className="font-mono">{item.ref}</span> · <HighlightText text={item.typeLabel} search={searchTerm} />
                        {item.attachmentCount > 0 && (
                          <span className="inline-flex items-center gap-0.5">
                            · <Paperclip size={11} /> {item.attachmentCount}
                          </span>
                        )}
                      </p>
                    </div>
                  </div>
                </TableCell>
                <TableCell className="max-w-[180px]">
                  <PersonChip person={item.person} />
                </TableCell>
                <TableCell className="hidden whitespace-nowrap font-mono text-xs text-muted-foreground lg:table-cell">{shortDate(item.submittedAt)}</TableCell>
                <TableCell className={`hidden font-mono text-xs tabular-nums md:table-cell ${item.isStale ? "font-bold text-amber-11" : "text-muted-foreground"}`}>
                  {item.done ? "—" : shortAge(item.clockAt)}
                </TableCell>
                <TableCell className="hidden 2xl:table-cell">
                  <StageMeter chain={item.chain} />
                </TableCell>
                <TableCell>
                  <StatusPill item={item} />
                </TableCell>
                <TableCell className="pr-4 text-right" onClick={(e) => e.stopPropagation()}>
                  <div className="flex justify-end gap-1 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">{renderRowAction?.(item)}</div>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      <div className="flex items-center justify-between border-t border-border px-4 py-2 text-[11px] text-muted-foreground">
        <span>
          {items.length} request{items.length === 1 ? "" : "s"}
        </span>
        <span className="hidden sm:inline">
          <span className="font-mono">J / K</span> to move · <span className="font-mono">Enter</span> to open
        </span>
      </div>
    </div>
  );
}
