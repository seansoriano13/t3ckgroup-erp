import { useState, useMemo } from "react";
import {
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  CheckCircle2,
  Clock,
  TriangleAlert,
  Eye,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import Avatar from "./Avatar";
import StatusBadge from "./StatusBadge";
import Dot from "./ui/Dot";
import { Button } from "./ui/button";
import { SorLinkChip } from "./ui/SorLinkChip";
import HighlightText from "./HighlightText";
import { useAuth } from "../context/AuthContext";
import { useEmployeeAvatarMap } from "../hooks/useEmployeeAvatarMap";
import { TASK_STATUS } from "../constants/status";
import { ArrowUpRight } from "lucide-react";

import { getChecklistProgress } from "../utils/checklist";
import { SelectField } from "@/components/ui/SelectField";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const formatDate = (dateString) => {
  if (!dateString) return "—";
  const date = new Date(dateString);
  if (isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
};

const getTaskProgress = (task) => {
  const source = task.checklist || task.taskDescription;
  const progress = getChecklistProgress(source);

  if (progress.total > 0) {
    return {
      isChecklist: true,
      total: progress.total,
      checked: progress.checked,
      percent: Math.round((progress.checked / progress.total) * 100),
      isGrouped: progress.isGrouped,
      activeStepIndex: progress.activeStepIndex,
      totalSteps: progress.totalSteps,
    };
  }

  return {
    isChecklist: false,
    total: 0,
    checked: 0,
    percent: task.status === TASK_STATUS.COMPLETE ? 100 : 0,
  };
};

const getTaskDisplayData = (task) => {
  let displayTitle = task.projectTitle || "";
  let displaySnippet = "";

  const desc = task.taskDescription;
  if (typeof desc === "string") {
    const trimmed = desc.trim();
    if (!trimmed.startsWith("[") && !trimmed.startsWith("{")) {
      const parts = trimmed.split("\n");
      if (!displayTitle) displayTitle = parts[0] || "";
      displaySnippet = parts.slice(1).join(" ").trim() || (parts[0] !== displayTitle ? parts[0] : "");
    }
  }

  if (!displayTitle) {
    displayTitle = task.categoryName || "Untitled Task";
  }

  return { displayTitle, displaySnippet };
};

export default function TaskTableView({
  tasks = [],
  searchTerm = "",
  onView,
}) {
  const { user } = useAuth();
  const avatarMap = useEmployeeAvatarMap();

  // Internal Sorting State
  const [sortField, setSortField] = useState("createdAt");
  const [sortOrder, setSortOrder] = useState("desc"); // 'asc' | 'desc'

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

      // Custom field extractions
      if (sortField === "title") {
        aVal = (a.projectTitle || a.taskDescription || "").toLowerCase();
        bVal = (b.projectTitle || b.taskDescription || "").toLowerCase();
      } else if (sortField === "assignee") {
        aVal = (a.loggedByName || "").toLowerCase();
        bVal = (b.loggedByName || "").toLowerCase();
      } else if (sortField === "dueDate") {
        aVal = a.endAt ? new Date(a.endAt).getTime() : 0;
        bVal = b.endAt ? new Date(b.endAt).getTime() : 0;
      } else if (sortField === "createdAt") {
        aVal = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        bVal = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      } else if (sortField === "priority") {
        const priorityRank = { HIGH: 3, MEDIUM: 2, LOW: 1 };
        aVal = priorityRank[a.priority] || 0;
        bVal = priorityRank[b.priority] || 0;
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

  const isHr =
    user?.is_hr === true ||
    user?.isHr === true ||
    user?.is_super_admin === true ||
    user?.isSuperAdmin === true;
  const isHead = user?.is_head === true || user?.isHead === true;
  const isManagement = isHr || isHead;

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
      <div className="text-center py-16 md:py-24 bg-card border border-border border-dashed rounded-2xl">
        <p className="text-muted-foreground/80 font-bold text-base md:text-lg">
          No tasks found.
        </p>
        <p className="text-muted-foreground text-xs md:text-sm mt-1 px-4">
          Try adjusting your search query or active filters.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Table Container */}
      <div className="rounded-2xl border border-border bg-card overflow-hidden shadow-sm">
          <Table className="min-w-[900px]">
            <TableHeader>
              <TableRow>
                <TableHead
                  onClick={() => handleSort("title")}
                  className="cursor-pointer hover:text-foreground transition-colors"
                >
                  <div className="flex items-center gap-1">
                    Task / Description {renderSortIcon("title")}
                  </div>
                </TableHead>
                <TableHead
                  onClick={() => handleSort("assignee")}
                  className="cursor-pointer hover:text-foreground transition-colors w-[180px]"
                >
                  <div className="flex items-center gap-1">
                    Assignee {renderSortIcon("assignee")}
                  </div>
                </TableHead>
                <TableHead
                  onClick={() => handleSort("status")}
                  className="px-3 cursor-pointer hover:text-foreground transition-colors w-[150px]"
                >
                  <div className="flex items-center gap-1">
                    Status {renderSortIcon("status")}
                  </div>
                </TableHead>
                <TableHead
                  onClick={() => handleSort("priority")}
                  className="px-3 cursor-pointer hover:text-foreground transition-colors w-[110px]"
                >
                  <div className="flex items-center gap-1">
                    Priority {renderSortIcon("priority")}
                  </div>
                </TableHead>
                <TableHead
                  onClick={() => handleSort("dueDate")}
                  className="px-3 cursor-pointer hover:text-foreground transition-colors w-[130px]"
                >
                  <div className="flex items-center gap-1">
                    Due Date {renderSortIcon("dueDate")}
                  </div>
                </TableHead>
                <TableHead className="px-3 w-[140px]">Progress</TableHead>
                <TableHead className="text-right w-[80px]">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {paginatedTasks.map((task) => {
                const isOwner = user?.id === task.loggedById;
                const isOverdue =
                  task.status === TASK_STATUS.INCOMPLETE &&
                  task.endAt &&
                  new Date(task.endAt) < new Date();
                const isOwnerOverdue = !isManagement && isOverdue && isOwner;

                const { displayTitle, displaySnippet } = getTaskDisplayData(task);
                const progress = getTaskProgress(task);

                return (
                  <TableRow
                    key={task.id}
                    onClick={() => onView && onView(task)}
                    className={`hover:bg-muted/40 transition-colors cursor-pointer group ${isOwnerOverdue ? "bg-amber-500/[0.03]" : ""
                      }`}
                  >
                    {/* Task Title & Category */}
                    <TableCell>
                      <div className="flex flex-col gap-1 max-w-[340px] sm:max-w-[420px]">
                        <div className="flex items-center gap-2 flex-wrap">
                          {task.categoryName && (
                            <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-muted text-muted-foreground border border-border shrink-0">
                              {task.categoryName}
                            </span>
                          )}
                          <span className="font-semibold text-foreground group-hover:text-primary transition-colors text-[13px] line-clamp-1">
                            <HighlightText text={displayTitle} search={searchTerm} />
                          </span>
                          <SorLinkChip
                            opportunityId={task.opportunityId}
                            opportunity={task.opportunity}
                            className="max-w-[90px]"
                          />
                        </div>
                        {displaySnippet && (
                          <p className="text-[11px] text-muted-foreground line-clamp-1">
                            <HighlightText text={displaySnippet} search={searchTerm} />
                          </p>
                        )}
                      </div>
                    </TableCell>

                    {/* Assignee & Dept */}
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Avatar
                          name={task.loggedByName || "User"}
                          src={avatarMap.get(task.loggedById) || task.loggedByAvatar}
                          size="xs"
                          className="shrink-0"
                        />
                        <div className="min-w-0 flex flex-col">
                          <span className="font-medium text-foreground truncate max-w-[120px]">
                            {task.loggedByName || "Unassigned"}
                          </span>
                          {(task.department || task.subDepartment) && (
                            <span className="text-[10px] text-muted-foreground truncate max-w-[120px]">
                              {task.subDepartment || task.department}
                            </span>
                          )}
                        </div>
                      </div>
                    </TableCell>

                    {/* Status Badge */}
                    <TableCell className="px-3">
                      <div className="flex items-center gap-1.5">
                        <StatusBadge status={task.status} />
                        {task.status === TASK_STATUS.COMPLETE && (
                          <div
                            title={
                              task.hrVerified
                                ? "Verified by HR"
                                : "Pending HR Verification"
                            }
                            className="shrink-0"
                          >
                            {task.hrVerified ? (
                              <CheckCircle2 size={12} className="text-green-600 dark:text-green-400" />
                            ) : (
                              <Clock size={12} className="text-amber-600 dark:text-amber-400" />
                            )}
                          </div>
                        )}
                      </div>
                    </TableCell>

                    {/* Priority */}
                    <TableCell className="px-3">
                      {task.priority ? (
                        <div className="flex items-center gap-1.5 font-bold text-[10px] uppercase tracking-wider">
                          {task.priority === "HIGH" && (
                            <Dot
                              color="bg-destructive"
                              className="shadow-[0_0_6px_rgba(239,68,68,0.4)]"
                            />
                          )}
                          {task.priority === "MEDIUM" && (
                            <Dot
                              color="bg-amber-500"
                              className="shadow-[0_0_6px_rgba(245,158,11,0.4)]"
                            />
                          )}
                          {task.priority === "LOW" && <Dot />}
                          <span
                            className={
                              task.priority === "HIGH"
                                ? "text-destructive"
                                : task.priority === "MEDIUM"
                                  ? "text-amber-600 dark:text-amber-400"
                                  : "text-muted-foreground"
                            }
                          >
                            {task.priority}
                          </span>
                        </div>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>

                    {/* Due Date & Overdue */}
                    <TableCell className="px-3">
                      <div className="flex flex-col">
                        <span
                          className={`text-[12px] font-medium ${isOverdue
                              ? "text-amber-600 dark:text-amber-400 font-semibold"
                              : "text-foreground"
                            }`}
                        >
                          {formatDate(task.endAt || task.targetDate)}
                        </span>
                        {isOverdue && (
                          <span className="flex items-center gap-1 text-[10px] font-bold text-amber-600 dark:text-amber-400 uppercase tracking-tight">
                            <TriangleAlert size={10} /> Overdue
                          </span>
                        )}
                      </div>
                    </TableCell>

                    {/* Progress / Checklist */}
                    <TableCell className="px-3">
                      {progress.isChecklist ? (
                        <div
                          className="flex items-center gap-2 w-full max-w-[130px]"
                          title={
                            progress.isGrouped && progress.totalSteps > 1
                              ? `Step ${progress.activeStepIndex + 1} of ${progress.totalSteps} · ${progress.checked}/${progress.total} completed`
                              : `${progress.checked}/${progress.total} completed`
                          }
                        >
                          <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
                            <div
                              className="h-full rounded-full bg-green-600 transition-all duration-300"
                              style={{ width: `${progress.percent}%` }}
                            />
                          </div>
                          <span className="text-[10px] font-bold text-muted-foreground shrink-0 tabular-nums">
                            {progress.isGrouped && progress.totalSteps > 1
                              ? `S${progress.activeStepIndex + 1} · ${progress.checked}/${progress.total}`
                              : `${progress.checked}/${progress.total}`}
                          </span>
                        </div>
                      ) : (
                        <span className="text-[11px] text-muted-foreground font-medium">
                          {task.status === TASK_STATUS.COMPLETE
                            ? "Completed"
                            : "1 item"}
                        </span>
                      )}
                    </TableCell>

                    {/* Actions */}
                    <TableCell className="text-right">
                      <Button
                        type="button"
                        variant="outline"
                        size="icon-sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (onView) onView(task);
                        }}
                        className="h-auto w-auto p-1.5 rounded-lg bg-card hover:bg-muted text-muted-foreground hover:text-foreground transition-all active:scale-95"
                        title="View details"
                      >
                        <ArrowUpRight size={13} />
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
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
            <SelectField
              value={pageSize}
              onChange={(next) => {
                setPageSize(Number(next));
                setCurrentPage(1);
              }}
              options={[10, 25, 50].map((n) => ({ value: n, label: String(n) }))}
              size="sm"
            />
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
              className="h-auto w-auto p-1.5 rounded-md bg-card hover:bg-muted text-foreground disabled:opacity-30 disabled:hover:bg-card transition-all"
              title="Previous Page"
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
              className="h-auto w-auto p-1.5 rounded-md bg-card hover:bg-muted text-foreground disabled:opacity-30 disabled:hover:bg-card transition-all"
              title="Next Page"
            >
              <ChevronRight size={14} />
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
