import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  ShieldAlert,
  Star,
  Users,
  TrendingUp,
  Search,
  X,
  List,
  LayoutGrid,
  Trophy,
} from "lucide-react";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { useAuth } from "../context/AuthContext";
import { taskService } from "../services/taskService.js";
import { TASK_STATUS } from "../constants/status";
import Avatar from "./Avatar";
import { Button } from "./ui/button";
import { useEmployeeAvatarMap } from "../hooks/useEmployeeAvatarMap";
import HighlightText from "./HighlightText";
import { Input } from "@/components/ui/input";

export default function EmployeePipelineMatrix({ selectedRange }) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const isHr = user?.is_hr === true || user?.isHr === true;

  const handleDeepLink = (e, status, empId) => {
    e.stopPropagation();
    navigate("/tasks", {
      state: {
        presetFilter: { status },
        filterEmployeeId: empId,
      },
    });
  };
  const isHead = user?.is_head === true || user?.isHead === true;

  const userDepartment = user?.department;
  const [searchTerm, setSearchTerm] = useState("");
  const [layoutMode, setLayoutMode] = useState("grid"); // "list" | "leaderboard" | "grid"
  const avatarMap = useEmployeeAvatarMap();

  // Fetch ALL tasks (we will filter them down for Heads)
  const { data: rawTasks = [], isLoading } = useQuery({
    queryKey: ["allTasks", "matrix"],
    queryFn: () => taskService.getAllTasks(),
    enabled: !!user?.id,
  });

  const employeeStats = useMemo(() => {
    if (!rawTasks.length) return [];

    const rangeStart = selectedRange?.startDate
      ? new Date(`${selectedRange.startDate}T00:00:00`)
      : new Date(0);
    const rangeEnd = selectedRange?.endDate
      ? new Date(`${selectedRange.endDate}T00:00:00`)
      : new Date();

    const empMap = {};

    rawTasks.forEach((task) => {
      if (!task.loggedById || task.status === TASK_STATUS.DELETED) return;

      const taskDate = new Date(task.createdAt);
      if (taskDate < rangeStart || taskDate >= rangeEnd) {
        return;
      }

      // If they are a Head (but NOT HR), strictly filter out tasks from other departments
      if (!isHr && isHead) {
        if (task.creator?.department !== userDepartment) return;
      }

      // If Super Admin, exclude tasks/stats belonging to other Heads or HR
      if (user?.isSuperAdmin) {
        if (task.creator?.is_head || task.creator?.is_hr) return;
      }

      // Exclude tasks logged BY any super admin (they don't need pipeline tracking)
      if (task.status === TASK_STATUS.DELETED || task.creator?.is_super_admin)
        return;

      if (!empMap[task.loggedById]) {
        empMap[task.loggedById] = {
          id: task.loggedById,
          name: task.loggedByName || "Unknown Employee",
          dept: task.creator?.department || "N/A",
          subDept: task.creator?.sub_department || "N/A",
          total: 0,
          draft: 0, // INCOMPLETE
          rejected: 0, // NOT APPROVED
          eval: 0, // AWAITING_APPROVAL
          pendingHr: 0, // COMPLETE (Not verified)
          verified: 0, // COMPLETE (Verified)
          totalGrade: 0,
          gradedCount: 0,
        };
      }

      const emp = empMap[task.loggedById];
      let matched = false;
      if (task.status === TASK_STATUS.INCOMPLETE) {
        emp.draft++;
        matched = true;
      } else if (task.status === TASK_STATUS.NOT_APPROVED) {
        emp.rejected++;
        matched = true;
      } else if (task.status === TASK_STATUS.AWAITING_APPROVAL) {
        emp.eval++;
        matched = true;
      } else if (task.status === TASK_STATUS.COMPLETE) {
        if (task.hrVerified) emp.verified++;
        else emp.pendingHr++;
        matched = true;
      }

      if (matched) {
        emp.total++;
      }

      // Grade Logic
      // Only count finalized "COMPLETE" tasks toward average grade.
      if (task.status === TASK_STATUS.COMPLETE && task.grade > 0) {
        emp.totalGrade += task.grade;
        emp.gradedCount++;
      }
    });

    // 2. Convert Map to Array & Calculate final percentages
    return Object.values(empMap)
      .map((emp) => ({
        ...emp,
        avgGrade:
          emp.gradedCount > 0
            ? (emp.totalGrade / emp.gradedCount).toFixed(1)
            : "N/A",
        completionRate:
          Math.round(((emp.pendingHr + emp.verified) / emp.total) * 100) || 0,
      }))
      .sort((a, b) => b.total - a.total);
  }, [
    rawTasks,
    isHr,
    isHead,
    userDepartment,
    user?.isSuperAdmin,
    selectedRange,
  ]);

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

  if (isLoading || employeeStats.length === 0) return null;

  return (
    <div className="bg-card border border-border rounded-2xl shadow-sm p-5 overflow-x-auto">
      <div className="flex items-center justify-between mb-5 flex-wrap gap-4">
        <div>
          <h2 className="text-lg font-semibold text-foreground flex items-center gap-2 tracking-tight">
            <div className="w-10 h-10 rounded-xl bg-mauve-2 flex items-center justify-center text-mauve-11 shadow-sm border border-mauve-4">
              <Activity size={18} />
            </div>
            Team Pipeline Radar
          </h2>
          <p className="text-sm text-mauve-10  mt-0.5">
            {isHr ? "Performance metrics" : "Performance metrics"} •{" "}
            <span className="font-semibold text-foreground">
              {selectedRange?.label || "This Range"}
            </span>
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 bg-card border border-border rounded-lg px-3 py-1.5 min-w-[200px]">
            <Search size={14} className="text-[#9CA3AF]" />
            <Input
              type="text"
              placeholder="Search employee..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              containerClassName="w-full" className="border-0 bg-transparent rounded-none px-0 py-0 shadow-none focus-visible:ring-0 h-auto bg-transparent border-none outline-none text-xs text-foreground placeholder-[#9CA3AF]"
            />
            {searchTerm && (
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={() => setSearchTerm("")}
                className="h-auto w-auto text-[#9CA3AF] hover:text-foreground hover:bg-transparent"
              >
                <X size={12} />
              </Button>
            )}
          </div>

          <div className="flex items-center gap-1.5 bg-mauve-2 border border-mauve-5 p-1 rounded-lg">
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={() => setLayoutMode("list")}
              className={`h-auto w-auto p-1 rounded transition-all ${layoutMode === "list" ? "bg-card shadow-sm text-red-9 hover:bg-card" : "text-muted-foreground hover:text-mauve-11 hover:bg-transparent"}`}
              title="List View"
            >
              <List size={16} />
            </Button>
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={() => setLayoutMode("leaderboard")}
              className={`h-auto w-auto p-1 rounded transition-all ${layoutMode === "leaderboard" ? "bg-card shadow-sm text-red-9 hover:bg-card" : "text-muted-foreground hover:text-mauve-11 hover:bg-transparent"}`}
              title="Leaderboard View"
            >
              <Trophy size={16} />
            </Button>
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={() => setLayoutMode("grid")}
              className={`h-auto w-auto p-1 rounded transition-all ${layoutMode === "grid" ? "bg-card shadow-sm text-red-9 hover:bg-card" : "text-muted-foreground hover:text-mauve-11 hover:bg-transparent"}`}
              title="Full Grid"
            >
              <LayoutGrid size={16} />
            </Button>
          </div>

          <div className="hidden sm:flex items-center gap-1.5 bg-card border border-border px-3 py-1.5 rounded-lg h-full">
            <Users size={14} className="text-[#9CA3AF]" />
            <span className="text-xs text-[#6B7280]">
              {employeeStats.length} members
            </span>
          </div>
        </div>
      </div>

      {/* DYNAMIC PIPELINE GRID */}
      <div
        className={`max-h-[500px] overflow-y-auto overflow-x-hidden pr-1
        ${layoutMode === "list" ? "flex flex-col gap-3 pb-4" : ""}
        ${layoutMode === "leaderboard" ? "flex flex-col gap-2.5 pb-4" : ""}
        ${layoutMode === "grid" ? "grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 pb-4" : ""}
      `}
      >
        {filteredStats.map((emp, index) => {
          if (layoutMode === "list") {
            return (
              <div
                key={emp.id}
                onClick={() =>
                  navigate("/tasks", { state: { filterEmployeeId: emp.id } })
                }
                className="cursor-pointer flex flex-col lg:flex-row lg:items-center justify-between transition-colors hover:bg-mauve-3 hover:border-mauve-5 w-full bg-card gap-4"
                style={{
                  border: "1px solid #E5E7EB",
                  borderRadius: "8px",
                  padding: "12px 16px",
                  boxShadow: "none",
                }}
              >
                {/* Header: Avatar & Name */}
                <div className="flex items-center gap-3 min-w-[200px] w-full lg:w-1/4">
                  <Avatar
                    className="bg-white shrink-0"
                    size="sm"
                    name={emp.name}
                    src={avatarMap.get(emp.id) ?? undefined}
                  />
                  <div className="min-w-0">
                    <h3
                      className="line-clamp-1"
                      style={{
                        fontSize: "14px",
                        fontWeight: 600,
                        color: "#111827",
                      }}
                    >
                      <HighlightText text={emp.name} search={searchTerm} />
                    </h3>
                    <p
                      className="line-clamp-1"
                      style={{
                        fontSize: "12px",
                        fontWeight: 400,
                        color: "#6B7280",
                      }}
                    >
                      <HighlightText text={emp.subDept} search={searchTerm} />
                    </p>
                  </div>
                </div>

                {/* Pipeline Bar & Legend inline */}
                <div className="flex-1 flex flex-col justify-center min-w-0 w-full lg:w-auto">
                  <div
                    className="flex justify-between"
                    style={{
                      fontSize: "10px",
                      fontWeight: 700,
                      textTransform: "uppercase",
                      letterSpacing: "0.05em",
                      color: "#9CA3AF",
                      marginBottom: "6px",
                    }}
                  >
                    <span>Task Pipeline</span>
                    <span style={{ color: "#374151" }}>{emp.total} Total</span>
                  </div>

                  <div
                    className="w-full overflow-hidden flex"
                    style={{
                      height: "7px",
                      borderRadius: "2px",
                      background: "#F3F4F6",
                    }}
                  >
                    {emp.draft > 0 && (
                      <div
                        className="bg-orange-a7 hover:opacity-80 cursor-pointer"
                        style={{ width: `${(emp.draft / emp.total) * 100}%` }}
                        title={`${emp.draft} Incomplete`}
                        onClick={(e) =>
                          handleDeepLink(e, TASK_STATUS.INCOMPLETE, emp.id)
                        }
                      />
                    )}
                    {emp.rejected > 0 && (
                      <div
                        className="bg-red-a7 hover:opacity-80 cursor-pointer"
                        style={{
                          width: `${(emp.rejected / emp.total) * 100}%`,
                        }}
                        title={`${emp.rejected} Returned`}
                        onClick={(e) =>
                          handleDeepLink(e, TASK_STATUS.NOT_APPROVED, emp.id)
                        }
                      />
                    )}
                    {emp.eval > 0 && (
                      <div
                        className="bg-violet-a7 hover:opacity-80 cursor-pointer"
                        style={{ width: `${(emp.eval / emp.total) * 100}%` }}
                        title={`${emp.eval} Awaiting Approval`}
                        onClick={(e) =>
                          handleDeepLink(
                            e,
                            TASK_STATUS.AWAITING_APPROVAL,
                            emp.id,
                          )
                        }
                      />
                    )}
                    {emp.pendingHr > 0 && (
                      <div
                        className="bg-blue-a7 hover:opacity-80 cursor-pointer"
                        style={{
                          width: `${(emp.pendingHr / emp.total) * 100}%`,
                        }}
                        title={`${emp.pendingHr} Completed`}
                        onClick={(e) =>
                          handleDeepLink(e, TASK_STATUS.COMPLETE, emp.id)
                        }
                      />
                    )}
                    {emp.verified > 0 && (
                      <div
                        className="bg-green-a7 hover:opacity-80 cursor-pointer"
                        style={{
                          width: `${(emp.verified / emp.total) * 100}%`,
                        }}
                        title={`${emp.verified} HR Verified`}
                        onClick={(e) =>
                          handleDeepLink(e, TASK_STATUS.COMPLETE, emp.id)
                        }
                      />
                    )}
                  </div>

                  <div className="flex items-center gap-2.5 flex-wrap py-2">
                    <span
                      className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                      onClick={(e) =>
                        handleDeepLink(e, TASK_STATUS.INCOMPLETE, emp.id)
                      }
                    >
                      <span className="w-1.5 h-1.5 rounded-full inline-block bg-orange-a7" />
                      {emp.draft} Incomplete
                    </span>
                    {emp.rejected > 0 && (
                      <span
                        className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                        onClick={(e) =>
                          handleDeepLink(e, TASK_STATUS.NOT_APPROVED, emp.id)
                        }
                      >
                        <span className="w-1.5 h-1.5 rounded-full inline-block bg-red-a7" />
                        {emp.rejected} Returned
                      </span>
                    )}
                    {emp.eval > 0 && (
                      <span
                        className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                        onClick={(e) =>
                          handleDeepLink(
                            e,
                            TASK_STATUS.AWAITING_APPROVAL,
                            emp.id,
                          )
                        }
                      >
                        <span className="w-1.5 h-1.5 rounded-full inline-block bg-violet-a7" />
                        {emp.eval} Awaiting Approval
                      </span>
                    )}
                    <span
                      className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                      onClick={(e) =>
                        handleDeepLink(e, TASK_STATUS.COMPLETE, emp.id)
                      }
                    >
                      <span className="w-1.5 h-1.5 rounded-full inline-block bg-blue-a7" />
                      {emp.pendingHr} Completed
                    </span>
                    <span
                      className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                      onClick={(e) =>
                        handleDeepLink(e, TASK_STATUS.COMPLETE, emp.id)
                      }
                    >
                      <span className="w-1.5 h-1.5 rounded-full inline-block bg-green-a7" />
                      {emp.verified} HR Verified
                    </span>
                  </div>
                </div>

                {/* Grade & Completion Rate */}
                <div className="flex items-center gap-4 lg:gap-6 shrink-0 w-full lg:w-auto justify-between lg:justify-end">
                  <div
                    className="flex items-center gap-1 shrink-0"
                    style={{
                      border: "1px solid #E5E7EB",
                      borderRadius: "9999px",
                      padding: "2px 8px",
                      background: "transparent",
                    }}
                  >
                    <Star size={11} className="text-mauve-6 fill-gray-6" />
                    <span
                      style={{
                        fontSize: "12px",
                        fontWeight: 600,
                        color: "#111827",
                      }}
                    >
                      {emp.avgGrade}
                    </span>
                  </div>

                  <div className="flex items-center gap-3">
                    <span
                      style={{
                        fontSize: "12px",
                        fontWeight: 500,
                        color: "#6B7280",
                      }}
                    >
                      Completion Rate
                    </span>
                    <span
                      className="flex items-center gap-1"
                      style={{
                        fontSize: "14px",
                        fontWeight: 600,
                        color: "#111827",
                      }}
                    >
                      {emp.completionRate}%
                      <TrendingUp
                        size={13}
                        style={{
                          color:
                            emp.completionRate >= 80
                              ? "#22C55E"
                              : emp.completionRate >= 50
                                ? "#F59E0B"
                                : "#EF4444",
                        }}
                      />
                    </span>
                  </div>
                </div>
              </div>
            );
          }

          if (layoutMode === "leaderboard") {
            return (
              <div
                key={emp.id}
                onClick={() =>
                  navigate("/tasks", { state: { filterEmployeeId: emp.id } })
                }
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
                    src={avatarMap.get(emp.id) ?? undefined}
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
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Avg Grade
                    </span>
                    <span className="flex items-center gap-1 text-xs font-semibold text-foreground">
                      {emp.avgGrade}
                      <Star size={11} className="text-amber-11 fill-amber-5" />
                    </span>
                  </div>

                  <div className="hidden sm:flex flex-col items-end">
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Tasks Completed
                    </span>
                    <span className="text-xs font-semibold text-foreground">
                      {emp.pendingHr + emp.verified} / {emp.total}
                    </span>
                  </div>

                  <div className="flex flex-col items-end min-w-[100px]">
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Completion
                    </span>
                    <span className="flex items-center gap-1 text-sm font-bold text-foreground">
                      {emp.completionRate}%
                      <TrendingUp
                        size={13}
                        className={
                          emp.completionRate >= 80
                            ? "text-green-9"
                            : emp.completionRate >= 50
                              ? "text-amber-9"
                              : "text-red-9"
                        }
                      />
                    </span>
                  </div>
                </div>
              </div>
            );
          }

          return (
            <div
              key={emp.id}
              onClick={() =>
                navigate("/tasks", { state: { filterEmployeeId: emp.id } })
              }
              className="cursor-pointer flex flex-col transition-colors hover:bg-mauve-3 hover:border-mauve-5 w-full bg-card"
              style={{
                border: "1px solid #E5E7EB",
                borderRadius: "8px",
                padding: "16px",
                boxShadow: "none",
              }}
            >
              {/* Header: Avatar & Name */}
              <div className="flex justify-between items-center gap-2">
                <div className="flex gap-2.5 items-center min-w-0">
                  <Avatar
                    className="bg-white"
                    size="sm"
                    name={emp.name}
                    src={avatarMap.get(emp.id) ?? undefined}
                  />
                  <div className="min-w-0">
                    <h3
                      className="line-clamp-1"
                      style={{
                        fontSize: "14px",
                        fontWeight: 600,
                        color: "#111827",
                      }}
                    >
                      <HighlightText text={emp.name} search={searchTerm} />
                    </h3>
                    <p
                      className="line-clamp-1"
                      style={{
                        fontSize: "12px",
                        fontWeight: 400,
                        color: "#6B7280",
                      }}
                    >
                      <HighlightText text={emp.subDept} search={searchTerm} />
                    </p>
                  </div>
                </div>
                <div
                  className="flex items-center gap-1 shrink-0"
                  style={{
                    border: "1px solid #E5E7EB",
                    borderRadius: "9999px",
                    padding: "2px 8px",
                    background: "transparent",
                  }}
                >
                  <Star size={11} className="text-mauve-6 fill-gray-6" />
                  <span
                    style={{
                      fontSize: "12px",
                      fontWeight: 600,
                      color: "#111827",
                    }}
                  >
                    {emp.avgGrade}
                  </span>
                </div>
              </div>

              {/* Segmented Pipeline Bar */}
              <div style={{ marginTop: "14px" }}>
                <div
                  className="flex justify-between"
                  style={{
                    fontSize: "10px",
                    fontWeight: 700,
                    textTransform: "uppercase",
                    letterSpacing: "0.05em",
                    color: "#9CA3AF",
                    marginBottom: "6px",
                  }}
                >
                  <span>Task Pipeline</span>
                  <span style={{ color: "#374151" }}>{emp.total} Total</span>
                </div>

                <div
                  className="w-full overflow-hidden flex"
                  style={{
                    height: "7px",
                    borderRadius: "2px",
                    background: "#F3F4F6",
                  }}
                >
                  {emp.draft > 0 && (
                    <div
                      className="bg-orange-a7 hover:opacity-80 cursor-pointer"
                      style={{
                        width: `${(emp.draft / emp.total) * 100}%`,
                      }}
                      title={`${emp.draft} Incomplete`}
                      onClick={(e) =>
                        handleDeepLink(e, TASK_STATUS.INCOMPLETE, emp.id)
                      }
                    />
                  )}
                  {emp.rejected > 0 && (
                    <div
                      className="bg-red-a7 hover:opacity-80 cursor-pointer"
                      style={{
                        width: `${(emp.rejected / emp.total) * 100}%`,
                      }}
                      title={`${emp.rejected} Returned`}
                      onClick={(e) =>
                        handleDeepLink(e, TASK_STATUS.NOT_APPROVED, emp.id)
                      }
                    />
                  )}
                  {emp.eval > 0 && (
                    <div
                      className="bg-violet-a7 hover:opacity-80 cursor-pointer"
                      style={{
                        width: `${(emp.eval / emp.total) * 100}%`,
                      }}
                      title={`${emp.eval} Awaiting Approval`}
                      onClick={(e) =>
                        handleDeepLink(e, TASK_STATUS.AWAITING_APPROVAL, emp.id)
                      }
                    />
                  )}
                  {emp.pendingHr > 0 && (
                    <div
                      className="bg-blue-a7 hover:opacity-80 cursor-pointer"
                      style={{
                        width: `${(emp.pendingHr / emp.total) * 100}%`,
                      }}
                      title={`${emp.pendingHr} Completed`}
                      onClick={(e) =>
                        handleDeepLink(e, TASK_STATUS.COMPLETE, emp.id)
                      }
                    />
                  )}
                  {emp.verified > 0 && (
                    <div
                      className="bg-green-a7 hover:opacity-80 cursor-pointer"
                      style={{
                        width: `${(emp.verified / emp.total) * 100}%`,
                      }}
                      title={`${emp.verified} HR Verified`}
                      onClick={(e) =>
                        handleDeepLink(e, TASK_STATUS.COMPLETE, emp.id)
                      }
                    />
                  )}
                </div>

                {/* Legend – ultra-clean: dot + number only */}
                <div className="flex items-center gap-2.5 flex-wrap py-2">
                  <span
                    className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                    onClick={(e) =>
                      handleDeepLink(e, TASK_STATUS.INCOMPLETE, emp.id)
                    }
                  >
                    <span className="w-1.5 h-1.5 rounded-full inline-block bg-orange-a7" />
                    {emp.draft} Incomplete
                  </span>
                  {emp.rejected > 0 && (
                    <span
                      className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                      onClick={(e) =>
                        handleDeepLink(e, TASK_STATUS.NOT_APPROVED, emp.id)
                      }
                    >
                      <span className="w-1.5 h-1.5 rounded-full inline-block bg-red-a7" />
                      {emp.rejected} Returned
                    </span>
                  )}
                  {emp.eval > 0 && (
                    <span
                      className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                      onClick={(e) =>
                        handleDeepLink(e, TASK_STATUS.AWAITING_APPROVAL, emp.id)
                      }
                    >
                      <span className="w-1.5 h-1.5 rounded-full inline-block bg-violet-a7" />
                      {emp.eval} Awaiting Approval
                    </span>
                  )}
                  <span
                    className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                    onClick={(e) =>
                      handleDeepLink(e, TASK_STATUS.COMPLETE, emp.id)
                    }
                  >
                    <span className="w-1.5 h-1.5 rounded-full inline-block bg-blue-a7" />
                    {emp.pendingHr} Completed
                  </span>
                  <span
                    className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                    onClick={(e) =>
                      handleDeepLink(e, TASK_STATUS.COMPLETE, emp.id)
                    }
                  >
                    <span className="w-1.5 h-1.5 rounded-full inline-block bg-green-a7" />
                    {emp.verified} HR Verified
                  </span>
                </div>
              </div>

              {/* Completion Rate Footer */}
              <div
                className="flex justify-between items-center mt-auto"
                style={{
                  paddingTop: "12px",
                  marginTop: "14px",
                  borderTop: "1px solid #E5E7EB",
                }}
              >
                <span
                  style={{
                    fontSize: "12px",
                    fontWeight: 500,
                    color: "#6B7280",
                  }}
                >
                  Completion Rate
                </span>
                <span
                  className="flex items-center gap-1"
                  style={{
                    fontSize: "14px",
                    fontWeight: 600,
                    color: "#111827",
                  }}
                >
                  {emp.completionRate}%
                  <TrendingUp
                    size={13}
                    style={{
                      color:
                        emp.completionRate >= 80
                          ? "#22C55E"
                          : emp.completionRate >= 50
                            ? "#F59E0B"
                            : "#EF4444",
                    }}
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
