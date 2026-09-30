import { useMemo } from "react";
import { useNavigate } from "react-router";
import { Target } from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import ReportFigure from "../ui/ReportFigure";
import { getStatusTheme } from "../../constants/status";
import { formatPHP, isLostCode, isWonCode } from "../../constants/sor";
import { usePipelineStages } from "../../hooks/usePipelineStages";

const THEME_BAR = {
  green: "bg-green-a7",
  amber: "bg-amber-a7",
  blue: "bg-blue-a7",
  red: "bg-red-a7",
  violet: "bg-violet-a7",
  orange: "bg-orange-a7",
  mauve: "bg-mauve-a7",
};

/**
 * A single employee's own opportunity pipeline in aggregate — the answer to
 * "I own too many opportunities to eyeball every card." Same stage-count +
 * value data as EmployeeOpportunityMatrix, scoped to one person and laid out
 * as stat cards rather than a comparison row, matching PersonalPipelineRadar
 * (the task-side equivalent) rather than shrinking the team component.
 */
export default function PersonalOpportunityOverview({ opportunities }) {
  const navigate = useNavigate();
  const { user } = useAuth();

  const mine = useMemo(
    () => opportunities.filter((o) => o.deal_owner_id === user?.id),
    [opportunities, user?.id],
  );

  // Deactivating a stage removes it from pickers, never from opportunities
  // already sitting in it — so a stage this employee's own pipeline occupies
  // stays visible even after a super admin retires it.
  const occupiedStageCodes = useMemo(() => mine.map((o) => o.status), [mine]);
  const { stages: pipelineStages } = usePipelineStages({
    occupiedCodes: occupiedStageCodes,
  });

  // The won/lost tiles link to the register filtered by those stages, so they
  // follow the flags rather than assuming the policy codes.
  const wonCode = pipelineStages.find((s) => s.is_won)?.code;
  const lostCode = pipelineStages.find((s) => s.is_lost)?.code;

  const stats = useMemo(() => {
    const total = mine.length;
    const value = mine.reduce((sum, o) => sum + Number(o.expected_value || 0), 0);
    const won = mine.filter((o) => isWonCode(o.status, pipelineStages)).length;
    const lost = mine.filter((o) => isLostCode(o.status, pipelineStages)).length;
    const open = total - won - lost;
    const stageCounts = {};
    mine.forEach((o) => {
      stageCounts[o.status] = (stageCounts[o.status] || 0) + 1;
    });
    return { total, value, won, lost, open, stageCounts };
  }, [mine, pipelineStages]);

  const goToStage = (status) => {
    navigate("/sors", {
      state: { filterEmployeeId: user?.id, filterStatus: status },
    });
  };

  if (stats.total === 0) return null;

  return (
    <div className="bg-card border border-border rounded-2xl shadow-sm p-5">
      <div className="flex items-center gap-2 mb-5">
        <div>
          <h2 className="text-base font-semibold text-foreground">
            My pipeline
          </h2>
          <p className="text-sm text-mauve-10 mt-0.5">
            {stats.total} opportunit{stats.total === 1 ? "y" : "ies"} as deal owner
          </p>
        </div>
      </div>

      <ReportFigure
        className="mb-5"
        stats={[
          { label: "Open", value: stats.open, sub: "In progress", onClick: () => navigate("/sors", { state: { filterEmployeeId: user?.id } }) },
          { label: "Value", value: formatPHP(stats.value), sub: "Total pipeline" },
          { label: "Won", value: stats.won, sub: "Closed won", onClick: () => goToStage(wonCode) },
          { label: "Lost", value: stats.lost, sub: "Closed lost", onClick: () => goToStage(lostCode) },
        ]}
      />

      <div className="w-full h-[7px] rounded-sm bg-muted overflow-hidden flex mb-2">
        {pipelineStages.map((stage) => {
          const count = stats.stageCounts[stage.code];
          if (!count) return null;
          const theme = stage.theme || getStatusTheme(stage.code);
          return (
            <div
              key={stage.code}
              className={`h-full hover:opacity-80 cursor-pointer ${THEME_BAR[theme] || THEME_BAR.mauve}`}
              style={{ width: `${(count / stats.total) * 100}%` }}
              title={`${count} ${stage.label}`}
              onClick={() => goToStage(stage.code)}
            />
          );
        })}
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        {pipelineStages.filter((s) => stats.stageCounts[s.code]).map((stage) => (
          <span
            key={stage.code}
            className="text-[11px] text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
            onClick={() => goToStage(stage.code)}
          >
            {stats.stageCounts[stage.code]} {stage.label}
          </span>
        ))}
      </div>
    </div>
  );
}
