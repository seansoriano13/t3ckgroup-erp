import { useState, useMemo } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  CheckCircle2,
  Clock,
  AlertTriangle,
  Eye,
  Calendar,
  Users,
} from "lucide-react";
import Avatar from "../../../components/Avatar";
import AvatarGroup from "../../../components/AvatarGroup";
import StatusBadge from "../../../components/StatusBadge";
import HighlightText from "../../../components/HighlightText";
import EmptyState from "../../../components/ui/EmptyState";
import { formatDueDate } from "../../../utils/formatDate";
import { getDueCountdown } from "../utils/dueCountdown";
import { useEmployeeAvatarMap } from "../../../hooks/useEmployeeAvatarMap";
import { SorLinkChip } from "../../../components/ui/SorLinkChip";
import { Button } from "@/components/ui/button";
import { usePaging } from "@/hooks/usePaging";
import { TablePager } from "@/components/ui/TablePager";

export default function GroupTaskTableView({
  tasks = [],
  searchTerm = "",
  onView,
  hasAnyTasks = false,
  onClearFilters,
}) {
  const avatarMap = useEmployeeAvatarMap();

  // Internal Sorting State
  const [sortField, setSortField] = useState("created_at");
  const [sortOrder, setSortOrder] = useState("desc");

  const handleSort = (field) => {
    if (sortField === field) {
      setSortOrder((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortOrder("asc");
    }
    paging.setPage(1);
  };

  const sortedTasks = useMemo(() => {
    return [...tasks].sort((a, b) => {
      let aVal = a[sortField];
      let bVal = b[sortField];

      if (sortField === "title") {
        aVal = (a.title || "").toLowerCase();
        bVal = (b.title || "").toLowerCase();
      } else if (sortField === "creator") {
        aVal = (a.creator?.name || "").toLowerCase();
        bVal = (b.creator?.name || "").toLowerCase();
      } else if (sortField === "dueDate") {
        aVal = a.due_date ? new Date(a.due_date).getTime() : 0;
        bVal = b.due_date ? new Date(b.due_date).getTime() : 0;
      } else if (sortField === "created_at") {
        aVal = a.created_at ? new Date(a.created_at).getTime() : 0;
        bVal = b.created_at ? new Date(b.created_at).getTime() : 0;
      } else if (sortField === "progress") {
        const aMembers = a.members || [];
        const bMembers = b.members || [];
        const aDone = aMembers.filter((m) => m.status === "DONE").length;
        const bDone = bMembers.filter((m) => m.status === "DONE").length;
        aVal = aMembers.length > 0 ? aDone / aMembers.length : 0;
        bVal = bMembers.length > 0 ? bDone / bMembers.length : 0;
      } else if (sortField === "status") {
        aVal = (a.status || "").toLowerCase();
        bVal = (b.status || "").toLowerCase();
      }

      if (aVal < bVal) return sortOrder === "asc" ? -1 : 1;
      if (aVal > bVal) return sortOrder === "asc" ? 1 : -1;
      return 0;
    });
  }, [tasks, sortField, sortOrder]);

  const paging = usePaging(sortedTasks);
  const paginatedTasks = paging.rows;

  const ariaSort = (field) =>
    sortField !== field ? "none" : sortOrder === "asc" ? "ascending" : "descending";

  const renderSortIcon = (field) => {
    if (sortField !== field) {
      return <ArrowUpDown size={12} className="size-3 opacity-40 ml-1 inline-block" />;
    }
    return sortOrder === "asc" ? (
      <ArrowUp size={12} className="size-3 text-primary ml-1 inline-block" />
    ) : (
      <ArrowDown size={12} className="size-3 text-primary ml-1 inline-block" />
    );
  };

  if (tasks.length === 0) {
    return (
      <EmptyState
        icon={Users}
        title="No group tasks found"
        description={
          hasAnyTasks
            ? "No group tasks match these filters."
            : "There are no active group tasks at the moment."
        }
        action={
          hasAnyTasks && onClearFilters ? (
            <Button variant="outline" size="sm" className="mt-2" onClick={onClearFilters}>
              Clear filters
            </Button>
          ) : undefined
        }
      />
    );
  }

  return (
    <div className="space-y-4">
      {/* Table Container */}
      <div className="rounded-2xl border border-border bg-card overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <Table tableId="group-tasks" className="md:min-w-[900px]">
            <TableHeader>
              <TableRow>
                <TableHead
                  id="title"
                  aria-sort={ariaSort("title")}
                  className="hover:text-foreground transition-colors"
                >
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => handleSort("title")}
                    className="h-auto p-0 font-[inherit] text-[length:inherit] [text-transform:inherit] [letter-spacing:inherit] hover:bg-transparent aria-expanded:bg-transparent gap-1 justify-start"
                  >
                    Group Task / Description {renderSortIcon("title")}
                  </Button>
                </TableHead>
                <TableHead
                  id="creator"
                  aria-sort={ariaSort("creator")}
                  className="hover:text-foreground transition-colors w-[170px] hidden md:table-cell"
                >
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => handleSort("creator")}
                    className="h-auto p-0 font-[inherit] text-[length:inherit] [text-transform:inherit] [letter-spacing:inherit] hover:bg-transparent aria-expanded:bg-transparent gap-1 justify-start"
                  >
                    Creator {renderSortIcon("creator")}
                  </Button>
                </TableHead>
                <TableHead id="members" className="w-[160px] hidden md:table-cell">Members</TableHead>
                <TableHead
                  id="status"
                  aria-sort={ariaSort("status")}
                  className="px-3 hover:text-foreground transition-colors w-[150px]"
                >
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => handleSort("status")}
                    className="h-auto p-0 font-[inherit] text-[length:inherit] [text-transform:inherit] [letter-spacing:inherit] hover:bg-transparent aria-expanded:bg-transparent gap-1 justify-start"
                  >
                    Status {renderSortIcon("status")}
                  </Button>
                </TableHead>
                <TableHead
                  id="dueDate"
                  aria-sort={ariaSort("dueDate")}
                  className="px-3 hover:text-foreground transition-colors w-[130px] hidden md:table-cell"
                >
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => handleSort("dueDate")}
                    className="h-auto p-0 font-[inherit] text-[length:inherit] [text-transform:inherit] [letter-spacing:inherit] hover:bg-transparent aria-expanded:bg-transparent gap-1 justify-start"
                  >
                    Due Date {renderSortIcon("dueDate")}
                  </Button>
                </TableHead>
                <TableHead
                  id="progress"
                  aria-sort={ariaSort("progress")}
                  className="px-3 hover:text-foreground transition-colors w-[140px] hidden md:table-cell"
                >
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => handleSort("progress")}
                    className="h-auto p-0 font-[inherit] text-[length:inherit] [text-transform:inherit] [letter-spacing:inherit] hover:bg-transparent aria-expanded:bg-transparent gap-1 justify-start"
                  >
                    Progress {renderSortIcon("progress")}
                  </Button>
                </TableHead>
                <TableHead id="action" className="text-right w-[80px]">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {paginatedTasks.map((task) => {
                const members = task.members || [];
                const totalMembers = members.length;
                const completedMembers = members.filter(
                  (m) => m.status === "DONE",
                ).length;
                const progressPercent =
                  totalMembers > 0
                    ? Math.round((completedMembers / totalMembers) * 100)
                    : 0;

                const memberPeople = members.map((m) => ({
                  id: m.employee_id,
                  name: m.employee?.name || "Member",
                  picture: avatarMap.get(m.employee_id) ?? null,
                }));

                const isHrPending = task.status === "HR_PENDING";
                const isHrVerified = task.status === "HR_VERIFIED";
                const isOverdue =
                  task.due_date &&
                  new Date(task.due_date) < new Date() &&
                  task.status === "ACTIVE";

                return (
                  <TableRow
                    key={task.id}
                    tabIndex={0}
                    onClick={() => onView && onView(task)}
                    onKeyDown={(e) => {
          if (e.key === "Enter" && e.target === e.currentTarget) {
            e.preventDefault();
            onView && onView(task);
          }
        }}
                    className={`cursor-pointer outline-none focus-visible:bg-muted group ${
                      isOverdue ? "bg-amber-500/[0.03]" : ""
                    }`}
                  >
                    {/* Task Title & Description */}
                    <TableCell className="align-middle">
                      <div className="flex flex-col gap-1 max-w-[340px] sm:max-w-[420px]">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold text-foreground group-hover:text-primary transition-colors text-[13px] line-clamp-1">
                            <HighlightText text={task.title} search={searchTerm} />
                          </span>
                        </div>
                        {task.description && (
                          <p className="text-[11px] text-muted-foreground line-clamp-1">
                            <HighlightText text={task.description} search={searchTerm} />
                          </p>
                        )}
                        {task.opportunity && (
                          <div className="flex flex-wrap items-center gap-1">
                            <SorLinkChip opportunityId={task.opportunity_id} opportunity={task.opportunity} />
                          </div>
                        )}
                        {(task.status === "ACTIVE" || task.status === "AWAITING_EVALUATION") && task.hr_remarks && (
                          <div className="flex items-center gap-1 mt-0.5 text-[10px] font-bold text-destructive">
                            <AlertTriangle size={10} /> HR Rejected: {task.hr_remarks}
                          </div>
                        )}
                      </div>
                    </TableCell>

                    {/* Creator */}
                    <TableCell className="align-middle hidden md:table-cell">
                      <div className="flex items-center gap-2">
                        <Avatar
                          name={task.creator?.name || "Unknown"}
                          src={avatarMap.get(task.created_by) ?? undefined}
                          size="xs"
                          className="shrink-0 shadow-inner bg-mauve-2 text-mauve-10 border-mauve-4"
                        />
                        <span className="font-medium text-foreground truncate max-w-[120px]">
                          {task.creator?.name || "Unknown"}
                        </span>
                      </div>
                    </TableCell>

                    {/* Members Avatar Group */}
                    <TableCell className="align-middle hidden md:table-cell">
                      <div className="flex items-center gap-1.5">
                        {memberPeople.length > 0 ? (
                          <div className="flex items-center gap-2">
                            <AvatarGroup people={memberPeople} max={3} size="xs" />
                            <span className="text-[10px] text-muted-foreground font-semibold">
                              {totalMembers}
                            </span>
                          </div>
                        ) : (
                          <span className="text-muted-foreground text-[11px]">
                            No members
                          </span>
                        )}
                      </div>
                    </TableCell>

                    {/* Status Badge */}
                    <TableCell className="align-middle">
                      <div className="flex items-center gap-1.5">
                        <StatusBadge
                          status={
                            isHrPending || isHrVerified ? "COMPLETED" : task.status
                          }
                        />
                        {(isHrPending || isHrVerified) && (
                          <div
                            title={
                              isHrVerified
                                ? "Verified by HR"
                                : "Pending HR Verification"
                            }
                            className="shrink-0"
                          >
                            {isHrVerified ? (
                              <CheckCircle2
                                size={12}
                                className="text-green-600 dark:text-green-400"
                              />
                            ) : (
                              <Clock
                                size={12}
                                className="text-amber-600 dark:text-amber-400"
                              />
                            )}
                          </div>
                        )}
                      </div>
                    </TableCell>

                    {/* Due Date */}
                    <TableCell className="align-middle hidden md:table-cell">
                      {task.due_date ? (
                        <div className="flex flex-col">
                          <span
                            className={`text-[12px] font-medium flex items-center gap-1 ${
                              isOverdue
                                ? "text-destructive font-semibold"
                                : "text-foreground"
                            }`}
                          >
                            <Calendar size={12} className="shrink-0 opacity-70" />
                            {formatDueDate(task.due_date)}
                          </span>
                          {task.status === "ACTIVE" && getDueCountdown(task.due_date) && (
                            <span
                              className={`text-label font-bold tracking-tight ${
                                isOverdue ? "text-destructive" : "text-muted-foreground"
                              }`}
                            >
                              {getDueCountdown(task.due_date).label}
                            </span>
                          )}
                        </div>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>

                    {/* Progress Bar */}
                    <TableCell className="align-middle hidden md:table-cell">
                      {totalMembers > 0 ? (
                        <div className="flex items-center gap-2 w-full max-w-[120px]">
                          <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
                            <div
                              className="h-full rounded-full bg-green-600 transition-all duration-300"
                              style={{ width: `${progressPercent}%` }}
                            />
                          </div>
                          <span className="text-[10px] font-bold text-muted-foreground shrink-0 tabular-nums">
                            {completedMembers}/{totalMembers}
                          </span>
                        </div>
                      ) : (
                        <span className="text-muted-foreground text-[11px]">—</span>
                      )}
                    </TableCell>

                    {/* Actions */}
                    <TableCell className="text-right align-middle">
                      <Button
                        type="button"
                        variant="outline"
                        size="icon-sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (onView) onView(task);
                        }}
                        className="rounded-lg bg-card text-muted-foreground active:scale-95"
                        title="View details"
                        aria-label="View details"
                      >
                        <Eye size={13} />
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </div>

      <TablePager {...paging} noun="tasks" className="rounded-xl border" />
    </div>
  );
}
