import { useEffect, useMemo, useState } from "react";
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
import ActivityLogFilterBar from "../../../components/ActivityLogFilterBar";
import { LiveIndicator, LogLoadError, LogPager } from "../../../components/ActivityLogParts";
import { DEFAULT_LOG_FILTERS, formatWhen } from "../../../lib/activityLog";
import HrLogsPanel from "../../../components/hr/HrLogsPanel";
import PageShell from "../../../components/ui/PageShell";
import EmptyState from "../../../components/ui/EmptyState";
import TabGroup from "../../../components/ui/TabGroup";
import Spinner from "../../../components/ui/Spinner";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

import { Activity, CheckSquare, Square } from "lucide-react";
import StatusBadge from "@/components/StatusBadge.jsx";
import { useQuery, useQueryClient } from "@tanstack/react-query";

const PAGE_SIZE = 50;

const TABS = [
  { value: "TASKS", label: "Task Logs", saOnly: true },
  { value: "GROUP", label: "Group Task Logs", saOnly: true },
  { value: "SOR", label: "SOR Logs", saOnly: true },
  { value: "SYSTEM", label: "System Logs", saOnly: true },
  { value: "HR", label: "HR Logs" },
];

// A date-only filter value covers the whole day at either end.
const startOfDayIso = (d) => (d ? new Date(`${d}T00:00:00`).toISOString() : null);
const endOfDayIso = (d) => (d ? new Date(`${d}T23:59:59.999`).toISOString() : null);

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
  } catch (e) {
    console.error("Failed to parse checklist:", e);
  }
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
      <div className="flex flex-col space-y-1.5">
        {displayItems.map((item, idx) => (
          <div
            key={idx}
            className="flex items-start gap-2 text-xs text-muted-foreground"
          >
            {item.checked ? (
              <CheckSquare
                size={13}
                className="shrink-0 text-mauve-10 mt-[2px]"
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
    <span className="line-clamp-2 break-words leading-relaxed">
      <HighlightText text={content} search={search} />
    </span>
  );
}

// "HR_NOTE" -> "HR note": codes are for the database, not the reader.
const humanizeCode = (code) =>
  String(code || "")
    .toLowerCase()
    .replace(/_/g, " ")
    .replace(/^hr(?= |$)/, "HR")
    .replace(/^./, (c) => c.toUpperCase());

// Entity type badge colors for SYSTEM logs
const ENTITY_TYPE_STYLES = {
  EMPLOYEE: "bg-blue-a2 text-blue-11 border-blue-a4",
  CATEGORY: "bg-orange-a2 text-orange-11 border-orange-a4",
  ANNOUNCEMENT: "bg-yellow-a2 text-yellow-11 border-yellow-a4",
  SETTINGS: "bg-purple-a2 text-purple-11 border-purple-a4",
  HR_SETTINGS: "bg-purple-a2 text-purple-11 border-purple-a4",
  QUOTA: "bg-green-a2 text-green-11 border-green-a4",
  OPPORTUNITY: "bg-cyan-a2 text-cyan-11 border-cyan-a4",
};

// What the subject cell shows: a checklist title becomes its first two items.
function EntryTitle({ title, search }) {
  const checklist = tryParseChecklist(title);
  if (!checklist) {
    return (
      <span className="line-clamp-1 break-words text-sm font-bold text-foreground">
        <HighlightText text={title} search={search} />
      </span>
    );
  }
  const remaining = checklist.length - 2;
  return (
    <span className="block space-y-1">
      {checklist.slice(0, 2).map((item, idx) => (
        <span key={idx} className="flex items-start gap-1.5 text-xs font-bold text-foreground">
          {item.checked ? (
            <CheckSquare size={13} className="shrink-0 text-mauve-10" />
          ) : (
            <Square size={13} className="mt-px shrink-0 text-muted-foreground/50" />
          )}
          <span className={`${item.checked ? "line-through opacity-60" : ""} line-clamp-1`}>
            <HighlightText text={item.text} search={search} />
          </span>
        </span>
      ))}
      {remaining > 0 && (
        <span className="block pl-5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground/60">
          + {remaining} more checklist item{remaining !== 1 ? "s" : ""}
        </span>
      )}
    </span>
  );
}

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

  const [filters, setFilters] = useState(DEFAULT_LOG_FILTERS);

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
        dateFrom: startOfDayIso(filters.dateFrom),
        dateTo: endOfDayIso(filters.dateTo),
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

  const hasActiveFilters = Object.keys(DEFAULT_LOG_FILTERS).some(
    (k) => filters[k] !== DEFAULT_LOG_FILTERS[k],
  );

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

  const showStatus = activeTab !== "SYSTEM" && activeTab !== "SOR";

  let body;
  if (activeTab === "HR") {
    body = <HrLogsPanel />;
  } else if (isLoading) {
    body = (
      <div className="flex justify-center py-20">
        <Spinner size="md" />
      </div>
    );
  } else if (isError) {
    body = <LogLoadError title="Failed to load activity log" message={error?.message} />;
  } else if (filteredEntries.length === 0) {
    body = (
      <>
        <EmptyState
          icon={Activity}
          title="No activity found"
          description={hasActiveFilters ? "Try adjusting your filters." : "No log entries yet."}
        />
        {/* A page past the last row comes back empty: keep the way back. */}
        {page > 0 && <LogPager page={page} setPage={setPage} hasMore={false} />}
      </>
    );
  } else {
    body = (
      <>
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          <Table tableId="activity-log">
            <TableHeader>
              <TableRow>
                <TableHead id="when">When</TableHead>
                <TableHead id="type">Type</TableHead>
                <TableHead id="subject">Subject</TableHead>
                <TableHead id="details">Details</TableHead>
                <TableHead id="by">By</TableHead>
                {showStatus && <TableHead id="status">Status</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredEntries.map((e) => {
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
                  <TableRow
                    key={e.id}
                    onClick={isClickable ? () => handleEntryClick(e) : undefined}
                    className={`align-top ${isClickable ? "cursor-pointer" : ""}`}
                  >
                    <TableCell className="whitespace-nowrap text-xs font-semibold text-muted-foreground">
                      {formatWhen(e.createdAt)}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-[10px] font-black tracking-widest text-muted-foreground">
                          {humanizeCode(e.type || "SYSTEM")}
                        </span>
                        {e.isGroup && (
                          <span className="rounded-sm border border-violet-5 bg-violet-3 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wider text-violet-11">
                            Group Task
                          </span>
                        )}
                        {(activeTab === "SYSTEM" || activeTab === "SOR") && e.entityType && (
                          <span
                            className={`rounded-sm border px-1.5 py-0.5 text-[9px] font-black tracking-wider ${ENTITY_TYPE_STYLES[e.entityType] || "bg-mauve-a2 text-mauve-11 border-mauve-a4"}`}
                          >
                            {humanizeCode(e.entityType)}
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="max-w-xs">
                      {isClickable ? (
                        <Button
                          type="button"
                          variant="ghost"
                          onClick={(ev) => {
                            ev.stopPropagation();
                            handleEntryClick(e);
                          }}
                          className="h-auto w-full min-w-0 justify-start whitespace-normal p-0 text-left font-normal hover:bg-transparent"
                        >
                          <EntryTitle title={displayTitle} search={filters.search} />
                        </Button>
                      ) : (
                        <EntryTitle title={displayTitle} search={filters.search} />
                      )}
                    </TableCell>
                    <TableCell className="max-w-md whitespace-normal text-xs text-muted-foreground">
                      <ContentDisplay content={displayContent} search={filters.search} />
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1.5 whitespace-nowrap">
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
                    </TableCell>
                    {showStatus && (
                      <TableCell>{e.taskStatus && <StatusBadge status={e.taskStatus} />}</TableCell>
                    )}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
        <LogPager page={page} setPage={setPage} hasMore={entries.length >= PAGE_SIZE} />
      </>
    );
  }

  return (
    <ProtectedRoute requireHr={true}>
      <PageShell
        title="Activity Log"
        description="Recent timeline events across the system."
        tabs={
          <TabGroup
            variant="underline"
            tabs={visibleTabs}
            activeTab={activeTab}
            onChange={setActiveTab}
            size="md"
          />
        }
        toolbar={
          activeTab !== "HR" && (
            <ActivityLogFilterBar
              filters={filters}
              setFilters={setFilters}
              employees={employees}
              liveIndicator={<LiveIndicator active={liveAnim} />}
            />
          )
        }
      >
        {body}
      </PageShell>
    </ProtectedRoute>
  );
}
