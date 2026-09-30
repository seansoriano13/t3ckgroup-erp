import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  Tags,
  Timer,
  CalendarClock,
  CalendarHeart,
  ShieldCheck,
  Users,
  UserCog,
  Settings,
} from "lucide-react";
import { systemAuditLogService, HR_ENTITY_TYPES } from "../../services/systemAuditLogService";
import { employeeService } from "../../services/employeeService";
import { useEmployeeAvatarMap } from "../../hooks/useEmployeeAvatarMap";
import Avatar from "../Avatar";
import HighlightText from "../HighlightText";
import EmptyState from "../ui/EmptyState";
import FilterBar from "../ui/FilterBar";
import { FilterSelect } from "../ui/FilterDropdown";
import Spinner from "../ui/Spinner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../ui/table";
import { LiveIndicator, LogLoadError, LogPager } from "../ActivityLogParts";
import { formatWhen } from "../../lib/activityLog";

const PAGE_SIZE = 30;

const ENTITY_CONFIG = {
  EMPLOYEE: { label: "Employee", icon: UserCog, style: "bg-blue-a2 text-blue-11 border-blue-a4" },
  CATEGORY: { label: "Category", icon: Tags, style: "bg-orange-a2 text-orange-11 border-orange-a4" },
  OVERTIME: { label: "Overtime", icon: Timer, style: "bg-mauve-a2 text-mauve-11 border-mauve-a4" },
  OFFSET_LEAVE: { label: "Offset Leave", icon: CalendarClock, style: "bg-blue-2 text-blue-11 border-blue-6" },
  SIL_LEAVE: { label: "SIL Leave", icon: CalendarHeart, style: "bg-green-2 text-green-11 border-green-6" },
  HR_SETTINGS: { label: "Settings", icon: Settings, style: "bg-purple-a2 text-purple-11 border-purple-a4" },
};

const ACTION_OPTIONS = [
  { value: "ALL", label: "All actions" },
  { value: "APPROVAL", label: "Decisions (Approve/Reject)" },
  { value: "SYSTEM", label: "Updates (Apply/Undo/Withdraw)" },
];

const DEFAULT_FILTERS = { entityType: "ALL", type: "ALL", authorId: "ALL", employeeId: "ALL", search: "" };

const chip = "h-9 w-auto gap-2 px-2.5";

export default function HrLogsPanel() {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(0);
  const [liveAnim, setLiveAnim] = useState(false);
  const avatarMap = useEmployeeAvatarMap();

  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const set = (key) => (value) => setFilters((p) => ({ ...p, [key]: value }));

  const [debouncedSearch, setDebouncedSearch] = useState(filters.search);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(filters.search), 300);
    return () => clearTimeout(timer);
  }, [filters.search]);

  const queryFilters = useMemo(
    () => ({ ...filters, search: debouncedSearch }),
    [filters, debouncedSearch],
  );

  const offset = useMemo(() => page * PAGE_SIZE, [page]);

  useEffect(() => {
    queueMicrotask(() => setPage(0));
  }, [filters.entityType, filters.type, filters.authorId, filters.employeeId, debouncedSearch]);

  useEffect(() => {
    const handleNewEntry = (entry) => {
      if (!HR_ENTITY_TYPES.includes(entry?.entity_type)) return;
      setLiveAnim(true);
      setTimeout(() => setLiveAnim(false), 2000);
      queryClient.invalidateQueries({ queryKey: ["hrActivityLog"] });
    };

    const sub = systemAuditLogService.subscribeToAllActivity(handleNewEntry);
    return () => systemAuditLogService.unsubscribeFromActivity(sub);
  }, [queryClient]);

  const { data: employees = [] } = useQuery({
    queryKey: ["allEmployees"],
    queryFn: () => employeeService.getAllEmployees(),
  });

  const {
    data: entries = [],
    isLoading,
    isError,
    error,
  } = useQuery({
    queryKey: ["hrActivityLog", offset, queryFilters],
    queryFn: () =>
      systemAuditLogService.getRecentHrActivity({
        limit: PAGE_SIZE,
        offset,
        entityType: queryFilters.entityType,
        type: queryFilters.type,
        authorId: queryFilters.authorId,
        employeeId: queryFilters.employeeId,
        search: queryFilters.search,
      }),
    staleTime: 15_000,
  });

  const hasActiveFilters = Object.keys(DEFAULT_FILTERS).some((k) => filters[k] !== DEFAULT_FILTERS[k]);
  const people = (label) => [{ value: "ALL", label }, ...employees.map((emp) => ({ value: emp.id, label: emp.name }))];

  return (
    <div className="space-y-4">
      <FilterBar
        search={{ value: filters.search, onChange: set("search"), placeholder: "Search log content" }}
        chips={
          <>
            <FilterSelect
              icon={Activity}
              label="Category"
              options={[
                { value: "ALL", label: "All categories" },
                ...HR_ENTITY_TYPES.map((t) => ({ value: t, label: ENTITY_CONFIG[t]?.label || t })),
              ]}
              value={filters.entityType}
              onChange={set("entityType")}
              className={chip}
              wrapperClassName="w-auto shrink-0"
            />
            <FilterSelect
              icon={ShieldCheck}
              label="Action"
              options={ACTION_OPTIONS}
              value={filters.type}
              onChange={set("type")}
              className={chip}
              wrapperClassName="w-auto shrink-0"
            />
            <FilterSelect
              icon={ShieldCheck}
              label="Actor"
              options={people("All actors")}
              value={filters.authorId}
              onChange={set("authorId")}
              className={chip}
              wrapperClassName="w-auto shrink-0"
            />
          </>
        }
        filters={
          <FilterSelect
            icon={Users}
            label="Employee involved"
            options={people("All employees")}
            value={filters.employeeId}
            onChange={set("employeeId")}
          />
        }
        activeCount={filters.employeeId !== "ALL" ? 1 : 0}
        hasActiveFilters={hasActiveFilters}
        onClearAll={() => setFilters(DEFAULT_FILTERS)}
        actions={<LiveIndicator active={liveAnim} />}
      />

      {isLoading ? (
        <div className="flex justify-center py-20">
          <Spinner size="md" />
        </div>
      ) : isError ? (
        <LogLoadError title="Failed to load HR logs" message={error?.message} />
      ) : entries.length === 0 ? (
        <>
          <EmptyState
            icon={Activity}
            title="No HR activity found"
            description={
              hasActiveFilters
                ? "Try adjusting your filters."
                : "Employee, category, and leave/OT actions will show up here."
            }
          />
          {page > 0 && <LogPager page={page} setPage={setPage} hasMore={false} />}
        </>
      ) : (
        <>
          <div className="overflow-hidden rounded-xl border border-border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Activity</TableHead>
                  <TableHead>By</TableHead>
                  <TableHead>For</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {entries.map((e) => {
                  const cfg = ENTITY_CONFIG[e.entityType] || {
                    label: e.entityType,
                    icon: Activity,
                    style: "bg-mauve-a2 text-mauve-11 border-mauve-a4",
                  };
                  const involvedEmployee = e.metadata?.employeeId
                    ? employees.find((emp) => emp.id === e.metadata.employeeId)
                    : null;

                  return (
                    <TableRow key={e.id} className="align-top">
                      <TableCell className="whitespace-nowrap text-xs font-semibold text-muted-foreground">
                        {formatWhen(e.createdAt)}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span
                            className={`rounded-sm border px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wider ${cfg.style}`}
                          >
                            {cfg.label}
                          </span>
                          {e.type === "APPROVAL" && (
                            <span className="rounded-sm border border-violet-5 bg-violet-3 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wider text-violet-11">
                              Decision
                            </span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="max-w-lg whitespace-normal text-sm font-semibold leading-relaxed text-foreground">
                        <HighlightText text={e.content} search={filters.search} />
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
                      <TableCell>
                        {involvedEmployee && involvedEmployee.id !== e.authorId ? (
                          <div className="flex items-center gap-1.5 whitespace-nowrap">
                            <Avatar
                              name={involvedEmployee.name}
                              src={avatarMap.get(involvedEmployee.id)}
                              size="xxs"
                              className="bg-mauve-4 text-mauve-12 shadow-sm"
                            />
                            <span className="text-[11px] font-semibold text-muted-foreground">
                              {involvedEmployee.name}
                            </span>
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground/50">-</span>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
          <LogPager page={page} setPage={setPage} hasMore={entries.length >= PAGE_SIZE} />
        </>
      )}
    </div>
  );
}
