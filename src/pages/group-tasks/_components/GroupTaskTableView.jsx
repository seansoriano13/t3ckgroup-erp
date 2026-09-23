import { useState, useMemo } from "react";
import {
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  CheckCircle2,
  Clock,
  AlertTriangle,
  Eye,
  ChevronLeft,
  ChevronRight,
  Calendar,
} from "lucide-react";
import Avatar from "../../../components/Avatar";
import AvatarGroup from "../../../components/AvatarGroup";
import StatusBadge from "../../../components/StatusBadge";
import HighlightText from "../../../components/HighlightText";
import { formatDueDate } from "../../../utils/formatDate";
import { useEmployeeAvatarMap } from "../../../hooks/useEmployeeAvatarMap";
import { TagPill } from "../../../components/ui/TagPill";
import { SorLinkChip } from "../../../components/ui/SorLinkChip";
import { Button } from "@/components/ui/button";

export default function GroupTaskTableView({
  tasks = [],
  searchTerm = "",
  onView,
}) {
  const avatarMap = useEmployeeAvatarMap();

  // Internal Sorting State
  const [sortField, setSortField] = useState("created_at");
  const [sortOrder, setSortOrder] = useState("desc");

  // Pagination State
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  const handleSort = (field) => {
    if (sortField === field) {
      setSortOrder((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortOrder("asc");
    }
    setCurrentPage(1);
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

  const totalPages = Math.ceil(sortedTasks.length / pageSize) || 1;
  const paginatedTasks = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return sortedTasks.slice(start, start + pageSize);
  }, [sortedTasks, currentPage, pageSize]);

  const renderSortIcon = (field) => {
    if (sortField !== field) {
      return <ArrowUpDown size={12} className="opacity-40 ml-1 inline-block" />;
    }
    return sortOrder === "asc" ? (
      <ArrowUp size={12} className="text-primary ml-1 inline-block" />
    ) : (
      <ArrowDown size={12} className="text-primary ml-1 inline-block" />
    );
  };

  if (tasks.length === 0) {
    return (
      <div className="py-20 text-center bg-card border border-border border-dashed rounded-2xl">
        <p className="text-muted-foreground/80 font-bold text-base md:text-lg">
          No Group Tasks Found
        </p>
        <p className="text-sm text-muted-foreground mt-1 px-4">
          {searchTerm
            ? "Try adjusting your search criteria."
            : "There are no active group tasks at the moment."}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Table Container */}
      <div className="rounded-2xl border border-border bg-card overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse min-w-[900px]">
            <thead>
              <tr className="bg-muted/50 border-b border-border text-muted-foreground font-bold tracking-wider uppercase text-[11px] select-none">
                <th
                  onClick={() => handleSort("title")}
                  className="py-3.5 px-4 cursor-pointer hover:text-foreground transition-colors"
                >
                  <div className="flex items-center gap-1">
                    Group Task / Description {renderSortIcon("title")}
                  </div>
                </th>
                <th
                  onClick={() => handleSort("creator")}
                  className="py-3.5 px-4 cursor-pointer hover:text-foreground transition-colors w-[170px]"
                >
                  <div className="flex items-center gap-1">
                    Creator {renderSortIcon("creator")}
                  </div>
                </th>
                <th className="py-3.5 px-3 w-[160px]">Members</th>
                <th
                  onClick={() => handleSort("status")}
                  className="py-3.5 px-3 cursor-pointer hover:text-foreground transition-colors w-[150px]"
                >
                  <div className="flex items-center gap-1">
                    Status {renderSortIcon("status")}
                  </div>
                </th>
                <th
                  onClick={() => handleSort("dueDate")}
                  className="py-3.5 px-3 cursor-pointer hover:text-foreground transition-colors w-[130px]"
                >
                  <div className="flex items-center gap-1">
                    Due Date {renderSortIcon("dueDate")}
                  </div>
                </th>
                <th
                  onClick={() => handleSort("progress")}
                  className="py-3.5 px-3 cursor-pointer hover:text-foreground transition-colors w-[140px]"
                >
                  <div className="flex items-center gap-1">
                    Progress {renderSortIcon("progress")}
                  </div>
                </th>
                <th className="py-3.5 px-4 text-right w-[80px]">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
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
                  <tr
                    key={task.id}
                    onClick={() => onView && onView(task)}
                    className={`hover:bg-muted/40 transition-colors cursor-pointer group ${
                      isOverdue ? "bg-amber-500/[0.03]" : ""
                    }`}
                  >
                    {/* Task Title & Description */}
                    <td className="py-3.5 px-4 align-middle">
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
                        {(task.opportunity || (task.tags && task.tags.length > 0)) && (
                          <div className="flex flex-wrap items-center gap-1">
                            <SorLinkChip opportunityId={task.opportunity_id} opportunity={task.opportunity} />
                            {(task.tags || [])
                              .filter((t) => !t.archived_at)
                              .map((tag) => (
                                <TagPill key={tag.id} tag={tag} />
                              ))}
                          </div>
                        )}
                        {task.status === "ACTIVE" && task.hr_remarks && (
                          <div className="flex items-center gap-1 mt-0.5 text-[10px] font-bold text-destructive">
                            <AlertTriangle size={10} /> HR Rejected: {task.hr_remarks}
                          </div>
                        )}
                      </div>
                    </td>

                    {/* Creator */}
                    <td className="py-3.5 px-4 align-middle">
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
                    </td>

                    {/* Members Avatar Group */}
                    <td className="py-3.5 px-3 align-middle">
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
                    </td>

                    {/* Status Badge */}
                    <td className="py-3.5 px-3 align-middle">
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
                    </td>

                    {/* Due Date */}
                    <td className="py-3.5 px-3 align-middle">
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
                          {isOverdue && (
                            <span className="text-[10px] font-bold text-destructive uppercase tracking-tight">
                              Overdue
                            </span>
                          )}
                        </div>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>

                    {/* Progress Bar */}
                    <td className="py-3.5 px-3 align-middle">
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
                    </td>

                    {/* Actions */}
                    <td className="py-3.5 px-4 text-right align-middle">
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
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pagination Footer */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3 px-1 py-1 text-xs text-muted-foreground">
        <div className="flex items-center gap-2">
          <span>
            Showing{" "}
            <span className="font-semibold text-foreground">
              {(currentPage - 1) * pageSize + 1}
            </span>{" "}
            to{" "}
            <span className="font-semibold text-foreground">
              {Math.min(currentPage * pageSize, sortedTasks.length)}
            </span>{" "}
            of{" "}
            <span className="font-semibold text-foreground">
              {sortedTasks.length}
            </span>{" "}
            tasks
          </span>
          <span className="text-border">|</span>
          <div className="flex items-center gap-1.5">
            <span>Rows:</span>
            <select
              value={pageSize}
              onChange={(e) => {
                setPageSize(Number(e.target.value));
                setCurrentPage(1);
              }}
              className="bg-card border border-border rounded-md px-2 py-1 text-foreground text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-primary cursor-pointer"
            >
              <option value={10}>10</option>
              <option value={25}>25</option>
              <option value={50}>50</option>
            </select>
          </div>
        </div>

        {/* Page Nav Controls */}
        {totalPages > 1 && (
          <div className="flex items-center gap-1.5">
            <Button
              variant="outline"
              size="icon-sm"
              disabled={currentPage === 1}
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              className="rounded-md bg-card text-foreground disabled:opacity-30 disabled:hover:bg-card"
              title="Previous Page"
              aria-label="Previous Page"
            >
              <ChevronLeft size={14} />
            </Button>

            <span className="px-2 text-xs font-semibold text-foreground">
              Page {currentPage} of {totalPages}
            </span>

            <Button
              variant="outline"
              size="icon-sm"
              disabled={currentPage === totalPages}
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              className="rounded-md bg-card text-foreground disabled:opacity-30 disabled:hover:bg-card"
              title="Next Page"
              aria-label="Next Page"
            >
              <ChevronRight size={14} />
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
