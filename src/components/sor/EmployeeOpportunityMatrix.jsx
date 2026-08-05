import { useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { Activity, Search, X, Users } from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import Avatar from "../Avatar";
import HighlightText from "../HighlightText";
import { getStatusTheme } from "../../constants/status";
import { OPPORTUNITY_STAGES, formatPHP } from "../../constants/sor";

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
export default function EmployeeOpportunityMatrix({ opportunities, title = "Team Opportunity Radar" }) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const isHr = user?.is_hr === true || user?.isHr === true;
  const isHead = user?.is_head === true || user?.isHead === true;
  const userDepartment = user?.department;
  const [searchTerm, setSearchTerm] = useState("");

  const employeeStats = useMemo(() => {
    if (!opportunities?.length) return [];

    const empMap = {};

    opportunities.forEach((o) => {
      const owner = o.deal_owner;
      if (!owner || owner.is_super_admin) return;

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
          stageCounts: {},
        };
      }

      const emp = empMap[owner.id];
      emp.total++;
      emp.value += Number(o.expected_value || 0);
      emp.stageCounts[o.status] = (emp.stageCounts[o.status] || 0) + 1;
    });

    return Object.values(empMap).sort((a, b) => b.value - a.value);
  }, [opportunities, isHr, isHead, userDepartment]);

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
    navigate("/opportunities", {
      state: { filterEmployeeId: empId, filterStatus: status || undefined },
    });
  };

  if (employeeStats.length === 0) return null;

  return (
    <div className="bg-card border border-border rounded-2xl shadow-sm p-5 overflow-x-auto">
      <div className="flex items-center justify-between mb-5 flex-wrap gap-4">
        <div>
          <h2 className="text-lg font-semibold text-foreground flex items-center gap-2 tracking-tight">
            <div className="w-10 h-10 rounded-xl bg-mauve-2 flex items-center justify-center text-mauve-11 shadow-sm border border-mauve-4">
              <Activity size={18} />
            </div>
            {title}
          </h2>
          <p className="text-sm text-mauve-10 mt-0.5">
            Stage distribution and pipeline value per salesperson
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 bg-card border border-border rounded-lg px-3 py-1.5 min-w-[200px]">
            <Search size={14} className="text-muted-foreground" />
            <input
              type="text"
              placeholder="Search employee..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="bg-transparent border-none outline-none text-xs text-foreground placeholder-muted-foreground w-full"
            />
            {searchTerm && (
              <button
                onClick={() => setSearchTerm("")}
                className="text-muted-foreground hover:text-foreground"
              >
                <X size={12} />
              </button>
            )}
          </div>
          <div className="hidden sm:flex items-center gap-1.5 bg-card border border-border px-3 py-1.5 rounded-lg">
            <Users size={14} className="text-muted-foreground" />
            <span className="text-xs text-muted-foreground">
              {employeeStats.length} salespeople
            </span>
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-3 pb-1">
        {filteredStats.map((emp) => (
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
              <div className="flex justify-between text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-1.5">
                <span>Pipeline</span>
                <span className="text-foreground">
                  {emp.total} · {formatPHP(emp.value)}
                </span>
              </div>

              <div className="w-full h-[7px] rounded-sm bg-muted overflow-hidden flex">
                {OPPORTUNITY_STAGES.map((stage) => {
                  const count = emp.stageCounts[stage.value];
                  if (!count) return null;
                  const theme = getStatusTheme(stage.value);
                  return (
                    <div
                      key={stage.value}
                      className={`h-full hover:opacity-80 cursor-pointer ${THEME_BAR[theme] || THEME_BAR.mauve}`}
                      style={{ width: `${(count / emp.total) * 100}%` }}
                      title={`${count} ${stage.label}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        goToEmployee(emp.id, stage.value);
                      }}
                    />
                  );
                })}
              </div>

              <div className="flex items-center gap-3 flex-wrap pt-2">
                {OPPORTUNITY_STAGES.filter((s) => emp.stageCounts[s.value]).map(
                  (stage) => {
                    const theme = getStatusTheme(stage.value);
                    return (
                      <span
                        key={stage.value}
                        className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                        onClick={(e) => {
                          e.stopPropagation();
                          goToEmployee(emp.id, stage.value);
                        }}
                      >
                        <span
                          className={`w-1.5 h-1.5 rounded-full inline-block ${THEME_DOT[theme] || THEME_DOT.mauve}`}
                        />
                        {emp.stageCounts[stage.value]} {stage.label}
                      </span>
                    );
                  },
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
