import { useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  Search,
  X,
  Users,
  List,
  Trophy,
  LayoutGrid,
  TrendingUp,
} from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import Avatar from "../Avatar";
import HighlightText from "../HighlightText";
import { getStatusTheme } from "../../constants/status";
import { formatPHP, isRealizedOpportunity } from "../../constants/sor";
import { flowStageTone } from "../../constants/salesFlow";
import { salesFlowService } from "../../services/salesFlowService";
import { usePipelineStages } from "../../hooks/usePipelineStages";
import { Button } from "../ui/button";
import { Input } from "@/components/ui/input";
import { CAPTION_BASE } from "@/lib/captionStyle";
import { useIsPhone } from "@/hooks/useScreenBand";

const THEME_BAR = {
  green: "bg-green-a7",
  amber: "bg-amber-a7",
  blue: "bg-blue-a7",
  red: "bg-red-a7",
  violet: "bg-violet-a7",
  orange: "bg-orange-a7",
  mauve: "bg-mauve-a7",
};

const THEME_DOT = {
  green: "bg-green-9",
  amber: "bg-amber-9",
  blue: "bg-blue-9",
  red: "bg-red-9",
  violet: "bg-violet-9",
  orange: "bg-orange-9",
  mauve: "bg-mauve-9",
};

/**
 * Per-employee opportunity breakdown — the SOR equivalent of
 * EmployeePipelineMatrix (tasks). Attribution follows the deal owner only,
 * matching Annex C's "the Deal Owner shall be recognized as the primary
 * salesperson responsible for the project" — support/director participation
 * isn't double-counted here.
 *
 * Reused for both the Head/HR/Super Admin team view and (by the caller
 * passing a single-employee list) an individual's own row.
 */
export default function EmployeeOpportunityMatrix({
  opportunities,
  title = "Team opportunity radar",
}) {
  const navigate = useNavigate();
  // Deactivating a stage removes it from pickers, never from opportunities
  // already sitting in it — so a stage an opportunity here occupies stays
  // visible even after a super admin retires it.
  const occupiedStageCodes = useMemo(
    () => opportunities.filter((o) => !o.sale_type_id).map((o) => o.status),
    [opportunities],
  );
  const { stages: pipelineStages } = usePipelineStages({
    occupiedCodes: occupiedStageCodes,
  });
  // A SOR on a Sales Flow keeps a stale `status`; its real Stage is
  // `flow_stage_id`. Only SORs with no Sale Type are read by `status`, the
  // same rule the SORS List uses. The query keys match the List's, so the
  // two share one cache.
  const hasFlowSors = useMemo(() => opportunities.some((o) => o.sale_type_id), [opportunities]);
  const { data: flowStagesIndex } = useQuery({
    queryKey: ["allFlowStagesIndex"],
    queryFn: () => salesFlowService.getAllStagesIndex(),
    enabled: hasFlowSors,
  });
  const snapshotIds = useMemo(
    () => [...new Set(opportunities.map((o) => o.flow_snapshot_id).filter(Boolean))].sort(),
    [opportunities],
  );
  const { data: snapshotsById = {} } = useQuery({
    queryKey: ["flowSnapshotsById", snapshotIds.join(",")],
    queryFn: () => salesFlowService.getSnapshotsByIds(snapshotIds),
    enabled: snapshotIds.length > 0,
  });
  const stageContext = useMemo(
    () => ({ snapshotsById, stages: pipelineStages }),
    [snapshotsById, pipelineStages],
  );
  const stageKeyOf = (o) => (o.sale_type_id ? `flow:${o.flow_stage_id}` : o.status);
  // Legacy Stages first, then the flow Stages that SORs here actually sit on.
  const segments = useMemo(() => {
    const legacy = pipelineStages.map((st) => ({
      key: st.code,
      label: st.label,
      theme: st.theme || getStatusTheme(st.code),
      filterStatus: st.code,
    }));
    const flowSegments = [];
    const seen = new Set();
    for (const o of opportunities) {
      if (!o.sale_type_id || seen.has(o.flow_stage_id)) continue;
      seen.add(o.flow_stage_id);
      const stage = flowStagesIndex?.stagesById?.[o.flow_stage_id];
      if (!stage) continue;
      const flow = flowStagesIndex.flowsById[stage.flow_id];
      const stagesOfFlow = flowStagesIndex.stagesByFlow[stage.flow_id] || [];
      flowSegments.push({
        key: `flow:${stage.id}`,
        label: stage.name,
        theme: flowStageTone(stage, flow, stagesOfFlow),
        // The List's stage filter reads the old status code, which a flow SOR
        // does not move; the click opens the person's SORs instead.
        filterStatus: undefined,
        sortKey: [flow?.name || "", stage.sort_order ?? 0],
      });
    }
    flowSegments.sort((a, b) => a.sortKey[0].localeCompare(b.sortKey[0]) || a.sortKey[1] - b.sortKey[1]);
    return [...legacy, ...flowSegments];
  }, [pipelineStages, opportunities, flowStagesIndex]);
  const { user } = useAuth();
  const isHr = user?.is_hr === true || user?.isHr === true;
  const isHead = user?.is_head === true || user?.isHead === true;
  const userDepartment = user?.department;
  const [searchTerm, setSearchTerm] = useState("");
  const [layoutMode, setLayoutMode] = useState("grid"); // "list" | "leaderboard" | "grid"
  // Phones show the grid as compact rows instead of tall cards.
  const phone = useIsPhone();

  const employeeStats = useMemo(() => {
    if (!opportunities?.length) return [];

    const empMap = {};

    opportunities.forEach((o) => {
      const owner = o.deal_owner;
      // Super admins count like anyone else — they can own deals, and skipping
      // them here would drop those deals out of the radar entirely.
      if (!owner) return;

      // Head (not HR, not Super Admin) only tracks their own department.
      if (!isHr && isHead && owner.department !== userDepartment) return;

      if (!empMap[owner.id]) {
        empMap[owner.id] = {
          id: owner.id,
          name: owner.name,
          avatarPath: owner.avatar_path,
          dept: owner.department || "N/A",
          subDept: owner.sub_department || "N/A",
          total: 0,
          value: 0,
          wonCount: 0,
          stageCounts: {},
        };
      }

      const emp = empMap[owner.id];
      emp.total++;
      emp.value += Number(o.expected_value || 0);
      if (isRealizedOpportunity(o, stageContext)) {
        emp.wonCount++;
      }
      const key = stageKeyOf(o);
      emp.stageCounts[key] = (emp.stageCounts[key] || 0) + 1;
    });

    return Object.values(empMap)
      .map((emp) => ({
        ...emp,
        winRate:
          emp.total > 0 ? Math.round((emp.wonCount / emp.total) * 100) : 0,
      }))
      .sort((a, b) => b.value - a.value);
  }, [opportunities, isHr, isHead, userDepartment, stageContext]);

  const filteredStats = useMemo(() => {
    if (!searchTerm.trim()) return employeeStats;
    const lower = searchTerm.toLowerCase();
    return employeeStats.filter(
      (e) =>
        e.name.toLowerCase().includes(lower) ||
        e.subDept.toLowerCase().includes(lower) ||
        e.dept.toLowerCase().includes(lower),
    );
  }, [employeeStats, searchTerm]);

  const goToEmployee = (empId, status) => {
    navigate("/sors", {
      state: { filterEmployeeId: empId, filterStatus: status || undefined },
    });
  };

  if (employeeStats.length === 0) return null;

  return (
    <div className="py-5 overflow-x-auto">
      <div className="mb-5 flex flex-wrap items-center gap-x-3 gap-y-3 laptop:mb-3 sm:flex-nowrap">
        <div className="order-1 min-w-0 flex-1">
          <h2 className="text-base font-semibold text-foreground flex items-center gap-2">
            {title}
          </h2>
          <p className="text-sm text-mauve-10 mt-0.5">
            Stage distribution and pipeline value per salesperson
          </p>
        </div>

        <div className="contents">
          <div className="order-3 flex w-full items-center gap-2 rounded-lg border border-border bg-card px-3 py-1.5 sm:order-2 sm:w-auto sm:min-w-[200px]">
            <Search size={14} className="text-muted-foreground" />
            <Input
              type="text"
              placeholder="Search employee..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              containerClassName="w-full" className="border-0 bg-transparent rounded-none px-0 py-0 shadow-none focus-visible:ring-0 h-auto bg-transparent border-none outline-none text-xs text-foreground placeholder-muted-foreground"
            />
            {searchTerm && (
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                onClick={() => setSearchTerm("")}
                className="text-muted-foreground hover:bg-transparent hover:text-foreground"
              >
                <X size={12} />
              </Button>
            )}
          </div>

          <div className="order-2 flex items-center gap-1.5 rounded-lg border border-mauve-5 bg-mauve-2 p-1 sm:order-3">
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              onClick={() => setLayoutMode("list")}
              className={layoutMode === "list"
                ? "bg-card shadow-sm text-red-9 hover:bg-card hover:text-red-9"
                : "text-muted-foreground hover:text-mauve-11"
              }
              title="List View"
            >
              <List size={16} />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              onClick={() => setLayoutMode("leaderboard")}
              className={layoutMode === "leaderboard"
                ? "bg-card shadow-sm text-red-9 hover:bg-card hover:text-red-9"
                : "text-muted-foreground hover:text-mauve-11"
              }
              title="Leaderboard View"
            >
              <Trophy size={16} />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              onClick={() => setLayoutMode("grid")}
              className={layoutMode === "grid"
                ? "bg-card shadow-sm text-red-9 hover:bg-card hover:text-red-9"
                : "text-muted-foreground hover:text-mauve-11"
              }
              title="Full Grid"
            >
              <LayoutGrid size={16} />
            </Button>
          </div>

          <div className="order-4 hidden items-center gap-1.5 bg-card border border-border px-3 py-1.5 rounded-lg">
            <Users size={14} className="text-muted-foreground" />
            <span className="text-xs text-muted-foreground">
              {employeeStats.length} salespeople
            </span>
          </div>
        </div>
      </div>

      {/* DYNAMIC PIPELINE MATRIX CONTAINER */}
      <div
        className={`max-h-[500px] overflow-y-auto overflow-x-hidden pr-1
        ${layoutMode === "list" ? "flex flex-col gap-3 pb-1" : ""}
        ${layoutMode === "leaderboard" ? "flex flex-col gap-2.5 pb-1" : ""}
        ${layoutMode === "grid" && phone ? "flex flex-col gap-2 pb-1" : ""}
        ${layoutMode === "grid" && !phone
            ? "grid grid-cols-[repeat(auto-fill,minmax(17rem,1fr))] gap-3 pb-4"
            : ""
          }
      `}
      >
        {filteredStats.map((emp, index) => {
          if (layoutMode === "list") {
            return (
              <div
                key={emp.id}
                onClick={() => goToEmployee(emp.id)}
                className="cursor-pointer flex flex-col lg:flex-row lg:items-center justify-between transition-colors hover:bg-mauve-3 border border-border rounded-lg px-4 py-3 gap-4"
              >
                <div className="flex items-center gap-3 min-w-[200px] w-full lg:w-1/4">
                  <Avatar
                    className="bg-white shrink-0"
                    size="sm"
                    name={emp.name}
                    src={emp.avatarPath}
                  />
                  <div className="min-w-0">
                    <h3 className="line-clamp-1 text-sm font-semibold text-foreground">
                      <HighlightText text={emp.name} search={searchTerm} />
                    </h3>
                    <p className="line-clamp-1 text-xs text-muted-foreground">
                      <HighlightText text={emp.subDept} search={searchTerm} />
                    </p>
                  </div>
                </div>

                <div className="flex-1 flex flex-col justify-center min-w-0 w-full lg:w-auto">
                  <div className={`flex justify-between ${CAPTION_BASE} tracking-widest text-muted-foreground mb-1.5`}>
                    <span>Pipeline</span>
                    <span className="text-foreground">
                      {emp.total} · {formatPHP(emp.value)}
                    </span>
                  </div>

                  <div className="w-full h-[7px] rounded-sm bg-muted overflow-hidden flex">
                    {segments.map((stage) => {
                      const count = emp.stageCounts[stage.key];
                      if (!count) return null;
                      const theme = stage.theme;
                      return (
                        <div
                          key={stage.key}
                          className={`h-full hover:opacity-80 cursor-pointer ${THEME_BAR[theme] || THEME_BAR.mauve}`}
                          style={{ width: `${(count / emp.total) * 100}%` }}
                          title={`${count} ${stage.label}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            goToEmployee(emp.id, stage.filterStatus);
                          }}
                        />
                      );
                    })}
                  </div>

                  <div className="flex items-center gap-3 flex-wrap pt-2">
                    {segments.filter((s) => emp.stageCounts[s.key]).map(
                      (stage) => {
                        const theme = stage.theme;
                        return (
                          <span
                            key={stage.key}
                            className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                            onClick={(e) => {
                              e.stopPropagation();
                              goToEmployee(emp.id, stage.filterStatus);
                            }}
                          >
                            <span
                              className={`w-1.5 h-1.5 rounded-full inline-block ${THEME_DOT[theme] || THEME_DOT.mauve}`}
                            />
                            {emp.stageCounts[stage.key]} {stage.label}
                          </span>
                        );
                      },
                    )}
                  </div>
                </div>
              </div>
            );
          }

          if (layoutMode === "leaderboard") {
            return (
              <div
                key={emp.id}
                onClick={() => goToEmployee(emp.id)}
                className="cursor-pointer flex items-center justify-between p-3.5 bg-card hover:bg-mauve-3 border border-border rounded-xl transition-all gap-4"
              >
                {/* Left: Rank Badge + Avatar + Name & Subdept */}
                <div className="flex items-center gap-3.5 min-w-0">
                  <div
                    className={`w-7 h-7 rounded-lg flex items-center justify-center font-bold text-xs shrink-0 ${index === 0
                      ? "bg-amber-3 text-amber-11 border border-amber-5 shadow-xs"
                      : index === 1
                        ? "bg-mauve-3 text-mauve-11 border border-mauve-5"
                        : index === 2
                          ? "bg-orange-3 text-orange-11 border border-orange-5"
                          : "bg-muted text-muted-foreground border border-border"
                      }`}
                  >
                    #{index + 1}
                  </div>
                  <Avatar
                    className="bg-white shrink-0"
                    size="sm"
                    name={emp.name}
                    src={emp.avatarPath}
                  />
                  <div className="min-w-0">
                    <h3 className="line-clamp-1 text-sm font-semibold text-foreground flex items-center gap-1.5">
                      <HighlightText text={emp.name} search={searchTerm} />
                      {index === 0 && (
                        <Trophy size={13} className="text-amber-11 shrink-0" />
                      )}
                    </h3>
                    <p className="line-clamp-1 text-xs text-muted-foreground">
                      <HighlightText text={emp.subDept} search={searchTerm} />
                    </p>
                  </div>
                </div>

                {/* Right: Metrics */}
                <div className="flex items-center gap-4 sm:gap-6 shrink-0">
                  <div className="hidden md:flex flex-col items-end">
                    <span className="text-label font-semibold uppercase tracking-wider text-muted-foreground">
                      Deals
                    </span>
                    <span className="text-xs font-semibold text-foreground">
                      {emp.wonCount} won / {emp.total} total
                    </span>
                  </div>

                  <div className="hidden sm:flex flex-col items-end">
                    <span className="text-label font-semibold uppercase tracking-wider text-muted-foreground">
                      Win Rate
                    </span>
                    <span className="flex items-center gap-1 text-xs font-semibold text-foreground">
                      {emp.winRate}%
                      <TrendingUp
                        size={12}
                        className={
                          emp.winRate >= 50
                            ? "text-green-9"
                            : emp.winRate >= 25
                              ? "text-amber-9"
                              : "text-muted-foreground"
                        }
                      />
                    </span>
                  </div>

                  <div className="flex flex-col items-end min-w-[100px]">
                    <span className="text-label font-semibold uppercase tracking-wider text-muted-foreground">
                      Pipeline Value
                    </span>
                    <span className="text-sm font-bold text-foreground">
                      {formatPHP(emp.value)}
                    </span>
                  </div>
                </div>
              </div>
            );
          }

          // Phones: the grid becomes compact rows (name, value, win rate, stage bar).
          if (phone) {
            return (
              <div
                key={emp.id}
                onClick={() => goToEmployee(emp.id)}
                className="flex w-full cursor-pointer flex-col gap-2 rounded-lg border border-border bg-card px-3 py-2.5 transition-colors hover:bg-mauve-3"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <Avatar className="bg-white shrink-0" size="sm" name={emp.name} src={emp.avatarPath} />
                    <h3 className="line-clamp-1 text-sm font-semibold text-foreground">
                      <HighlightText text={emp.name} search={searchTerm} />
                    </h3>
                  </div>
                  <div className="flex shrink-0 items-center gap-2 text-xs font-semibold text-foreground">
                    <span>{formatPHP(emp.value)}</span>
                    <span className="flex items-center gap-0.5 text-muted-foreground">
                      {emp.winRate}%
                      <TrendingUp
                        size={12}
                        className={
                          emp.winRate >= 50
                            ? "text-green-9"
                            : emp.winRate >= 25
                              ? "text-amber-9"
                              : "text-muted-foreground"
                        }
                      />
                    </span>
                  </div>
                </div>
                <div className="flex h-[7px] w-full overflow-hidden rounded-sm bg-muted">
                  {segments.map((stage) => {
                    const count = emp.stageCounts[stage.key];
                    if (!count) return null;
                    const theme = stage.theme;
                    return (
                      <div
                        key={stage.key}
                        className={`h-full ${THEME_BAR[theme] || THEME_BAR.mauve}`}
                        style={{ width: `${(count / emp.total) * 100}%` }}
                        title={`${count} ${stage.label}`}
                      />
                    );
                  })}
                </div>
              </div>
            );
          }

          // Render Grid Card View
          return (
            <div
              key={emp.id}
              onClick={() => goToEmployee(emp.id)}
              className="cursor-pointer flex flex-col transition-colors hover:bg-mauve-3 border border-border rounded-lg p-4 bg-card w-full"
            >
              {/* Header: Avatar, Name, Dept & Value Pill */}
              <div className="flex justify-between items-center gap-2">
                <div className="flex gap-2.5 items-center min-w-0">
                  <Avatar
                    className="bg-white shrink-0"
                    size="sm"
                    name={emp.name}
                    src={emp.avatarPath}
                  />
                  <div className="min-w-0">
                    <h3 className="line-clamp-1 text-sm font-semibold text-foreground">
                      <HighlightText text={emp.name} search={searchTerm} />
                    </h3>
                    <p className="line-clamp-1 text-xs text-muted-foreground">
                      <HighlightText text={emp.subDept} search={searchTerm} />
                    </p>
                  </div>
                </div>
                <div
                  className="flex items-center gap-1 shrink-0 px-2 py-0.5 rounded-full border border-border bg-transparent text-xs font-semibold text-foreground"
                  title="Total Pipeline Value"
                >
                  <span>{formatPHP(emp.value)}</span>
                </div>
              </div>

              {/* Segmented Pipeline Bar */}
              <div className="mt-3.5">
                <div className={`flex justify-between ${CAPTION_BASE} tracking-wider text-muted-foreground mb-1.5`}>
                  <span>Pipeline</span>
                  <span className="text-foreground">{emp.total} Total</span>
                </div>

                <div className="w-full h-[7px] rounded-sm bg-muted overflow-hidden flex">
                  {segments.map((stage) => {
                    const count = emp.stageCounts[stage.key];
                    if (!count) return null;
                    const theme = stage.theme;
                    return (
                      <div
                        key={stage.key}
                        className={`h-full hover:opacity-80 cursor-pointer ${THEME_BAR[theme] || THEME_BAR.mauve}`}
                        style={{ width: `${(count / emp.total) * 100}%` }}
                        title={`${count} ${stage.label}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          goToEmployee(emp.id, stage.filterStatus);
                        }}
                      />
                    );
                  })}
                </div>

                {/* Legend */}
                <div className="flex items-center gap-2.5 flex-wrap py-2">
                  {segments.filter((s) => emp.stageCounts[s.key]).map(
                    (stage) => {
                      const theme = stage.theme;
                      return (
                        <span
                          key={stage.key}
                          className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                          onClick={(e) => {
                            e.stopPropagation();
                            goToEmployee(emp.id, stage.filterStatus);
                          }}
                        >
                          <span
                            className={`w-1.5 h-1.5 rounded-full inline-block ${THEME_DOT[theme] || THEME_DOT.mauve}`}
                          />
                          {emp.stageCounts[stage.key]} {stage.label}
                        </span>
                      );
                    },
                  )}
                </div>
              </div>

              {/* Footer */}
              <div className="flex justify-between items-center mt-auto pt-3 mt-3.5 border-t border-border">
                <span className="text-xs font-medium text-muted-foreground">
                  Win Rate
                </span>
                <span className="flex items-center gap-1 text-sm font-semibold text-foreground">
                  {emp.winRate}%
                  <TrendingUp
                    size={13}
                    className={
                      emp.winRate >= 50
                        ? "text-green-9"
                        : emp.winRate >= 25
                          ? "text-amber-9"
                          : "text-muted-foreground"
                    }
                  />
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
