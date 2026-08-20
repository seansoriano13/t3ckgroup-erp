import { useEffect, useMemo, useState } from "react";
import Dot from "../../../components/ui/Dot";
import ProtectedRoute from "../../../components/ProtectedRoute.jsx";
import { useAuth } from "../../../context/AuthContext";
import { taskActivityService } from "../../../services/tasks/taskActivityService";
import { employeeService } from "../../../services/employeeService";
import { groupTaskActivityService } from "../../../services/groupTaskActivityService";
import { systemAuditLogService } from "../../../services/systemAuditLogService";
import { opportunityService } from "../../../services/opportunityService";
import Avatar from "../../../components/Avatar.jsx";
import { useEmployeeAvatarMap } from "../../../hooks/useEmployeeAvatarMap";
import HighlightText from "../../../components/HighlightText";
import ActivityLogFilters from "../../../components/ActivityLogFilters";
import HrLogsPanel from "../../../components/hr/HrLogsPanel";

import {
  ShieldCheck,
  MessageCircle,
  Zap,
  ChevronLeft,
  ChevronRight,
  X,
  Activity,
  Clock,
  CheckSquare,
  Square,
  Settings,
  DollarSign,
  Target,
} from "lucide-react";
import StatusBadge from "@/components/StatusBadge.jsx";
import { useQuery, useQueryClient } from "@tanstack/react-query";

const PAGE_SIZE = 50;

const TABS = [
  { id: "TASKS", label: "Task Logs", saOnly: true },
  { id: "GROUP", label: "Group Task Logs", saOnly: true },
  { id: "SOR", label: "SOR Logs", saOnly: true },
  { id: "SYSTEM", label: "System Logs", saOnly: true },
  { id: "HR", label: "HR Logs" },
];

function typeIcon(type) {
  if (type === "APPROVAL") return ShieldCheck;
  if (type === "HR_NOTE") return ShieldCheck;
  if (type === "COMMENT") return MessageCircle;
  return Zap;
}

function formatWhen(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

// ── Checklist Parser ──────────────────────────────────────────────────────────
function tryParseChecklist(str) {
  if (!str) return null;
  try {
    const trimmed = str.trim();
    if (!trimmed.startsWith("[")) return null;
    let parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed) && Array.isArray(parsed[0])) {
      parsed = parsed[0];
    }
    if (
      Array.isArray(parsed) &&
      parsed.length > 0 &&
      typeof parsed[0] === "object" &&
      "text" in parsed[0]
    ) {
      return parsed;
    }
    // eslint-disable-next-line no-empty, no-unused-vars
  } catch (e) { }
  return null;
}

// ── ContentDisplay ────────────────────────────────────────────────────────────
function ContentDisplay({ content, search }) {
  if (!content) return <span className="italic opacity-70">(no message)</span>;

  const parsedChecklist = tryParseChecklist(content);

  if (parsedChecklist) {
    const displayItems = parsedChecklist.slice(0, 4);
    const remaining = parsedChecklist.length - 4;

    return (
      <div className="space-y-1.5 mt-2 flex flex-col">
        {displayItems.map((item, idx) => (
          <div
            key={idx}
            className="flex items-start gap-2 text-xs text-muted-foreground"
          >
            {item.checked ? (
              <CheckSquare
                size={13}
                className="shrink-0 text-primary mt-[2px]"
              />
            ) : (
              <Square
                size={13}
                className="shrink-0 text-muted-foreground/40 mt-[2px]"
              />
            )}
            <span
              className={`${item.checked ? "line-through opacity-60" : ""} wrap-break-word leading-snug line-clamp-2`}
            >
              <HighlightText text={item.text} search={search} />
            </span>
          </div>
        ))}
        {remaining > 0 && (
          <div className="text-[10px] font-bold text-muted-foreground/60 pl-[22px] pt-0.5 uppercase tracking-wider">
            + {remaining} more item{remaining !== 1 ? "s" : ""}
          </div>
        )}
      </div>
    );
  }

  return (
    <span className="line-clamp-2 leading-relaxed">
      <HighlightText text={content} search={search} />
    </span>
  );
}

// ── Skeleton ──────────────────────────────────────────────────────────────────
function SkeletonCard() {
  return (
    <div className="bg-card border border-border rounded-xl p-4 animate-pulse">
      <div className="flex items-start gap-3">
        <div className="w-8 h-8 rounded-lg bg-muted shrink-0" />
        <div className="flex-1 min-w-0 space-y-2">
          <div className="flex items-center justify-between gap-3">
            <div className="h-2.5 w-16 bg-muted rounded-full" />
            <div className="h-2.5 w-28 bg-muted rounded-full" />
          </div>
          <div className="h-4 w-3/4 bg-muted rounded-full" />
          <div className="h-3 w-full bg-muted rounded-full" />
          <div className="h-3 w-2/3 bg-muted rounded-full" />
          <div className="flex items-center gap-2 pt-1">
            <div className="h-5 w-5 bg-muted rounded-full" />
            <div className="h-3 w-20 bg-muted rounded-full" />
            <div className="h-5 w-16 bg-muted rounded-full" />
          </div>
        </div>
      </div>
    </div>
  );
}

// Entity type badge colors for SYSTEM logs
const ENTITY_TYPE_STYLES = {
  EMPLOYEE: "bg-blue-a2 text-blue-11 border-blue-a4",
  CATEGORY: "bg-orange-a2 text-orange-11 border-orange-a4",
  ANNOUNCEMENT: "bg-yellow-a2 text-yellow-11 border-yellow-a4",
  SETTINGS: "bg-purple-a2 text-purple-11 border-purple-a4",
  QUOTA: "bg-green-a2 text-green-11 border-green-a4",
  OPPORTUNITY: "bg-cyan-a2 text-cyan-11 border-cyan-a4",
};

// ═════════════════════════════════════════════════════════════════════════════
//  PAGE COMPONENT
// ═════════════════════════════════════════════════════════════════════════════
export default function SuperAdminActivityLogPage() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const isSA = user?.isSuperAdmin || user?.is_super_admin;
  const visibleTabs = useMemo(() => TABS.filter((t) => !t.saOnly || isSA), [isSA]);
  const [activeTab, setActiveTab] = useState(() => (isSA ? "TASKS" : "HR"));
  const [page, setPage] = useState(0);
  const [liveAnim, setLiveAnim] = useState(false);
  const avatarMap = useEmployeeAvatarMap();

  const [filters, setFilters] = useState({
    type: "ALL",
    authorId: "ALL",
    employeeId: "ALL",
    taskStatus: "ALL",
    dept: "ALL",
    subDept: "ALL",
    dateFrom: null,
    dateTo: null,
    search: "",
  });

  const offset = useMemo(() => page * PAGE_SIZE, [page]);

  useEffect(() => {
    queueMicrotask(() => setPage(0));
  }, [
    filters.type,
    filters.authorId,
    filters.employeeId,
    filters.taskStatus,
    filters.dept,
    filters.subDept,
    filters.dateFrom,
    filters.dateTo,
    filters.search,
    activeTab,
  ]);

  useEffect(() => {
    const handleNewEntry = () => {
      setLiveAnim(true);
      setTimeout(() => setLiveAnim(false), 2000);
      queryClient.invalidateQueries({
        queryKey: ["superAdminActivityLog", activeTab],
      });
    };

    let sub;
    if (activeTab === "TASKS")
      sub = taskActivityService.subscribeToAllActivity(handleNewEntry);
    else if (activeTab === "GROUP")
      sub = groupTaskActivityService.subscribeToAllActivity(handleNewEntry);
    else if (activeTab === "SYSTEM")
      sub = systemAuditLogService.subscribeToAllActivity(handleNewEntry);

    return () => {
      if (sub) {
        if (activeTab === "TASKS")
          taskActivityService.unsubscribeFromActivity(sub);
        else if (activeTab === "GROUP")
          groupTaskActivityService.unsubscribeFromActivity(sub);
        else if (activeTab === "SYSTEM")
          systemAuditLogService.unsubscribeFromActivity(sub);
      }
    };
  }, [activeTab, queryClient]);

  const { data: employees = [] } = useQuery({
    queryKey: ["allEmployees"],
    queryFn: () => employeeService.getAllEmployees(),
  });

  const { data: opportunities = [] } = useQuery({
    queryKey: ["opportunities"],
    queryFn: () => opportunityService.getOpportunities(),
    enabled: activeTab === "SOR" || activeTab === "SYSTEM",
  });

  const {
    data: entries = [],
    isLoading,
    isError,
    error,
  } = useQuery({
    queryKey: ["superAdminActivityLog", activeTab, offset, filters],
    queryFn: () => {
      const params = {
        limit: PAGE_SIZE,
        offset,
        type: filters.type,
        authorId: filters.authorId,
        employeeId: filters.employeeId,
        taskStatus: filters.taskStatus,
        dateFrom: filters.dateFrom
          ? new Date(filters.dateFrom).toISOString()
          : null,
        dateTo: filters.dateTo ? new Date(filters.dateTo).toISOString() : null,
        search: filters.search,
      };

      if (activeTab === "GROUP")
        return groupTaskActivityService.getRecentGroupActivity(params);
      if (activeTab === "SYSTEM")
        return systemAuditLogService.getRecentSystemActivity(params);
      if (activeTab === "SOR")
        return systemAuditLogService.getRecentSystemActivity({ ...params, entityType: "OPPORTUNITY" });
      return taskActivityService.getRecentTaskActivity(params);
    },
    enabled: activeTab !== "HR",
    staleTime: 15_000,
  });

  const filteredEntries = useMemo(() => {
    const isDeptFiltered = activeTab !== "SYSTEM" && activeTab !== "SOR";

    const raw = entries.filter((e) => {
      if (isDeptFiltered) {
        if (filters.dept !== "ALL" && (e.taskCreatorDept || "") !== filters.dept)
          return false;
        if (
          filters.subDept !== "ALL" &&
          (e.taskCreatorSubDept || "") !== filters.subDept
        )
          return false;
      }
      return true;
    });

    // Consolidate redundant logs (tasks/group only)
    if (activeTab === "SYSTEM" || activeTab === "SOR") return raw;

    const consolidated = [];
    for (let i = 0; i < raw.length; i++) {
      const current = raw[i];
      const next = raw[i + 1];

      const isSameTask = next && current.taskId === next.taskId;

      const isReportedSubmit =
        isSameTask &&
        current.content?.startsWith("Reported to:") &&
        next.content?.startsWith("Task submitted");

      const isHrRedundant =
        isSameTask &&
        ((current.type === "SYSTEM" &&
          next.type === "HR_NOTE" &&
          current.content?.toLowerCase().includes("verified") &&
          next.content?.toLowerCase().includes("verified")) ||
          (current.type === "HR_NOTE" &&
            next.type === "SYSTEM" &&
            next.content?.toLowerCase().includes("verified") &&
            current.content?.toLowerCase().includes("verified")));

      const isApprovalRedundant =
        isSameTask &&
        ((current.type === "SYSTEM" &&
          next.type === "APPROVAL" &&
          (current.content?.includes("bulk-approved") ||
            current.content?.includes("bulk-rejected"))) ||
          (current.type === "APPROVAL" &&
            next.type === "SYSTEM" &&
            (next.content?.includes("bulk-approved") ||
              next.content?.includes("bulk-rejected"))));

      if (isReportedSubmit) {
        consolidated.push({
          ...next,
          content: `${next.content} ${current.content}`,
        });
        i++;
      } else if (isHrRedundant) {
        consolidated.push(current.type === "HR_NOTE" ? current : next);
        i++;
      } else if (isApprovalRedundant) {
        consolidated.push(current.type === "APPROVAL" ? current : next);
        i++;
      } else {
        consolidated.push(current);
      }
    }

    return consolidated;
  }, [entries, filters.dept, filters.subDept, activeTab]);

  const hasActiveFilters =
    filters.type !== "ALL" ||
    filters.authorId !== "ALL" ||
    filters.employeeId !== "ALL" ||
    filters.taskStatus !== "ALL" ||
    filters.dept !== "ALL" ||
    filters.subDept !== "ALL" ||
    filters.dateFrom !== null ||
    filters.dateTo !== null ||
    filters.search !== "";

  const clearFilters = () =>
    setFilters({
      type: "ALL",
      authorId: "ALL",
      employeeId: "ALL",
      taskStatus: "ALL",
      dept: "ALL",
      subDept: "ALL",
      dateFrom: null,
      dateTo: null,
      search: "",
    });

  // Entity-details dispatch — TASKS, GROUP, SOR, and OPPORTUNITY system logs are clickable
  const handleEntryClick = (e) => {
    if (activeTab === "SOR" || (activeTab === "SYSTEM" && e.entityType === "OPPORTUNITY")) {
      const oppId = e.entityId || e.taskId;
      if (!oppId) return;
      window.dispatchEvent(
        new CustomEvent("OPEN_ENTITY_DETAILS", {
          detail: { id: oppId, type: "OPPORTUNITY" },
        }),
      );
      return;
    }

    if (activeTab === "SYSTEM") return;

    const typeMap = {
      TASKS: "TASK",
      GROUP: "GROUP_TASK",
    };
    if (!typeMap[activeTab] || !e.taskId) return;
    window.dispatchEvent(
      new CustomEvent("OPEN_ENTITY_DETAILS", {
        detail: { id: e.taskId, type: typeMap[activeTab] },
      }),
    );
  };

  return (
    <ProtectedRoute requireHr={true}>
      <div className="max-w-6xl mx-auto space-y-5 px-2 pb-10">
        {/* ── Header ──────────────────────────────────────────────── */}
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 border-b border-border/40 pb-5">
          <div>
            <h1 className="text-2xl sm:text-3xl font-black text-foreground">
              Activity Log
            </h1>
            <p className="text-muted-foreground mt-1 font-medium text-sm">
              Recent timeline events across the system.
            </p>
            {/* Tab bar */}
            <div className="flex items-center gap-1 bg-muted/50 p-1 rounded-xl shrink-0 mt-4 max-w-fit border border-border/40 flex-wrap">
              {visibleTabs.map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`px-4 py-2 text-xs font-bold rounded-lg transition-all ${activeTab === tab.id
                      ? "bg-card text-foreground shadow-sm ring-1 ring-border"
                      : "text-muted-foreground hover:text-foreground"
                    }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          {/* Pagination + live indicator */}
          {activeTab !== "HR" && (
            <div className="flex flex-col items-end gap-3 shrink-0">
              <div
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border transition-all duration-300 ${liveAnim ? "bg-green-a2 border-green-a4 text-green-11" : "bg-transparent border-transparent text-muted-foreground/60"}`}
              >
                <Dot
                  size="w-1.5 h-1.5"
                  color={
                    liveAnim
                      ? "bg-green-9 shadow-[0_0_8px_var(--green-9)]"
                      : "bg-muted-foreground/40"
                  }
                  className={liveAnim ? "animate-pulse" : ""}
                />
                <span className="text-[10px] font-bold uppercase tracking-wider">
                  {liveAnim ? "New Update" : "Live"}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                  disabled={page === 0}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-border bg-card text-muted-foreground font-bold text-xs disabled:opacity-40 disabled:cursor-not-allowed hover:bg-muted hover:text-foreground transition-colors"
                >
                  <ChevronLeft size={14} /> Newer
                </button>
                {page > 0 && (
                  <span className="text-[11px] font-bold text-muted-foreground px-1">
                    Page {page + 1}
                  </span>
                )}
                <button
                  onClick={() => setPage((p) => p + 1)}
                  disabled={entries.length < PAGE_SIZE}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-border bg-card text-muted-foreground font-bold text-xs disabled:opacity-40 disabled:cursor-not-allowed hover:bg-muted hover:text-foreground transition-colors"
                >
                  Older <ChevronRight size={14} />
                </button>
              </div>
            </div>
          )}
        </div>

        {activeTab === "HR" ? (
          <HrLogsPanel />
        ) : (
        <>
        {/* ── Filter Panel ─────────────────────────────────────────── */}
        <ActivityLogFilters
          filters={filters}
          setFilters={setFilters}
          employees={employees}
        />

        {/* ── Entry count ───────────────────────────────────────────── */}
        {!isLoading && !isError && filteredEntries.length > 0 && (
          <p className="text-[11px] font-semibold text-muted-foreground/70 px-0.5">
            {filteredEntries.length} entr
            {filteredEntries.length === 1 ? "y" : "ies"}
            {hasActiveFilters && " (filtered)"}
          </p>
        )}

        {/* ── States ────────────────────────────────────────────────── */}
        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 8 }).map((_, i) => (
              <SkeletonCard key={i} />
            ))}
          </div>
        ) : isError ? (
          <div className="py-8 px-5 rounded-2xl border border-red-a5 bg-red-a2 flex items-start gap-4">
            <div className="w-8 h-8 rounded-lg bg-red-a3 border border-red-a5 flex items-center justify-center shrink-0">
              <X size={15} className="text-red-11" />
            </div>
            <div>
              <p className="text-red-11 font-black text-sm">
                Failed to load activity log
              </p>
              <p className="text-red-11/70 text-xs mt-1 font-medium">
                {error?.message || "Unknown error"}
              </p>
            </div>
          </div>
        ) : filteredEntries.length === 0 ? (
          <div className="py-20 flex flex-col items-center justify-center text-center gap-3">
            <div className="w-12 h-12 rounded-xl bg-muted border border-border flex items-center justify-center mb-1">
              <Activity size={20} className="text-muted-foreground/40" />
            </div>
            <p className="text-sm font-black text-foreground">
              No activity found
            </p>
            <p className="text-xs text-muted-foreground/70 font-medium max-w-[220px]">
              {hasActiveFilters
                ? "Try adjusting your filters."
                : "No log entries yet."}
            </p>
            {hasActiveFilters && (
              <button
                onClick={clearFilters}
                className="text-xs font-semibold text-primary hover:underline mt-1"
              >
                Clear filters
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-2">
            {filteredEntries.map((e) => {
              const Icon =
                activeTab === "SYSTEM"
                  ? Settings
                  : activeTab === "SOR"
                  ? Target
                  : typeIcon(e.type);

              const isClickable =
                activeTab === "TASKS" ||
                activeTab === "GROUP" ||
                (activeTab === "SOR" && !!(e.entityId || e.taskId)) ||
                (activeTab === "SYSTEM" && e.entityType === "OPPORTUNITY" && !!(e.entityId || e.taskId));

              let displayTitle = e.taskDescription || `Task ${e.taskId}`;
              let displayContent = e.content;

              if ((activeTab === "SOR" || e.entityType === "OPPORTUNITY") && e.content) {
                const oppMatch = e.content.match(/^Sales opportunity (S\d+)/);
                if (oppMatch) {
                  const oppNo = oppMatch[1];
                  const opp = opportunities.find((o) => o.opportunity_no === oppNo);
                  if (opp && opp.project_title) {
                    displayTitle = `${opp.project_title} ${oppNo}`;
                  } else {
                    displayTitle = `Opportunity ${oppNo}`;
                  }

                  if (e.metadata && Array.isArray(e.metadata.changes) && e.metadata.changes.length > 0) {
                    displayContent = JSON.stringify(
                      e.metadata.changes.map((c) => ({ text: c, checked: true }))
                    );
                  } else {
                    displayContent = e.content.replace(new RegExp(`^Sales opportunity ${oppNo}( details updated:?|:| registered for)?\\s*`), "");
                    displayContent = displayContent.charAt(0).toUpperCase() + displayContent.slice(1);
                  }
                }
              }

              return (
                <button
                  key={e.id}
                  type="button"
                  onClick={() => handleEntryClick(e)}
                  disabled={!isClickable}
                  className={`w-full text-left bg-card border border-border rounded-xl p-4 transition-all duration-150 animate-content-in group ${isClickable
                      ? "hover:border-mauve-6 hover:bg-muted/40 cursor-pointer"
                      : "cursor-default"
                    }`}
                >
                  <div className="flex items-start gap-3">
                    <div className="w-8 h-8 rounded-lg bg-muted border border-border flex items-center justify-center shrink-0">
                      <Icon size={14} className="text-muted-foreground" />
                    </div>

                    <div className="min-w-0 flex-1">
                      {/* Row 1: type eyebrow + timestamp */}
                      <div className="flex items-center justify-between gap-3 mb-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-[10px] font-black text-muted-foreground uppercase tracking-widest">
                            {e.type || "SYSTEM"}
                          </p>
                          {e.isGroup && (
                            <span className="text-[9px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded-sm bg-violet-3 text-violet-11 border border-violet-5">
                              Group Task
                            </span>
                          )}
                          {/* Entity type badge for SYSTEM logs */}
                          {(activeTab === "SYSTEM" || activeTab === "SOR") && e.entityType && (
                            <span
                              className={`text-[9px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded-sm border ${ENTITY_TYPE_STYLES[e.entityType] || "bg-mauve-a2 text-mauve-11 border-mauve-a4"}`}
                            >
                              {e.entityType}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-1 shrink-0 text-muted-foreground/60">
                          <Clock size={10} />
                          <span className="text-[11px] font-bold">
                            {formatWhen(e.createdAt)}
                          </span>
                        </div>
                      </div>

                      {/* Task / entity title */}
                      {(() => {
                        const checklist = tryParseChecklist(displayTitle);
                        if (checklist) {
                          const displayItems = checklist.slice(0, 2);
                          const remaining = checklist.length - 2;
                          return (
                            <div className="mb-1.5 space-y-1">
                              {displayItems.map((item, idx) => (
                                <div
                                  key={idx}
                                  className="flex items-start gap-1.5 text-xs font-bold text-foreground"
                                >
                                  {item.checked ? (
                                    <CheckSquare
                                      size={13}
                                      className="shrink-0 text-mauve-10 mt"
                                    />
                                  ) : (
                                    <Square
                                      size={13}
                                      className="shrink-0 text-muted-foreground/50 mt-px"
                                    />
                                  )}
                                  <span
                                    className={`${item.checked ? "line-through opacity-60" : ""} line-clamp-1`}
                                  >
                                    <HighlightText
                                      text={item.text}
                                      search={filters.search}
                                    />
                                  </span>
                                </div>
                              ))}
                              {remaining > 0 && (
                                <div className="text-[10px] font-bold text-muted-foreground/60 pl-5 uppercase tracking-wider">
                                  + {remaining} more checklist item
                                  {remaining !== 1 ? "s" : ""}
                                </div>
                              )}
                            </div>
                          );
                        }
                        return (
                          <p className="text-sm font-bold text-foreground line-clamp-1">
                            <HighlightText
                              text={displayTitle}
                              search={filters.search}
                            />
                          </p>
                        );
                      })()}

                      {/* Content */}
                      <div className="text-xs text-muted-foreground mt-1">
                        <ContentDisplay
                          content={displayContent}
                          search={filters.search}
                        />
                      </div>

                      {/* Footer: author + status */}
                      <div className="flex items-center gap-2 mt-2.5 flex-wrap">
                        <div className="flex items-center gap-1.5">
                          <Avatar
                            name={e.authorName || "System"}
                            src={avatarMap.get(e.authorId)}
                            size="xxs"
                            className="bg-mauve-4 text-mauve-12 shadow-sm"
                          />
                          <span className="text-[11px] font-semibold text-muted-foreground">
                            {e.authorName || "System"}
                          </span>
                        </div>

                        {activeTab !== "SYSTEM" && e.taskStatus && (
                          <StatusBadge status={e.taskStatus} />
                        )}
                      </div>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}

        {/* ── Bottom pagination ─────────────────────────────────────── */}
        {filteredEntries.length > 0 && (
          <div className="flex items-center justify-center gap-3 pt-3 border-t border-border/40">
            <button
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl border border-border bg-card text-muted-foreground font-bold text-xs disabled:opacity-40 disabled:cursor-not-allowed hover:bg-muted hover:text-foreground transition-colors"
            >
              <ChevronLeft size={14} /> Newer
            </button>
            <span className="text-[11px] font-bold text-muted-foreground">
              Page {page + 1}
            </span>
            <button
              onClick={() => setPage((p) => p + 1)}
              disabled={entries.length < PAGE_SIZE}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl border border-border bg-card text-muted-foreground font-bold text-xs disabled:opacity-40 disabled:cursor-not-allowed hover:bg-muted hover:text-foreground transition-colors"
            >
              Older <ChevronRight size={14} />
            </button>
          </div>
        )}
        </>
        )}
      </div>
    </ProtectedRoute>
  );
}
