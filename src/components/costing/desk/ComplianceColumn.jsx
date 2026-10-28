import { SelectField } from "../../ui/SelectField";
import StatusBadge from "../../StatusBadge";
import { COMPLIANCE_LABEL, COMPLIANCE_THEME, EVALUATION_TEAMS } from "../../../constants/costing";
import { costingMatrixService } from "../../../services/costingMatrixService";
import ComplianceCell from "../ComplianceCell";
import { lineVerdict } from "./evaluationTeams";

/**
 * The Compliance column of the sheet (spec #699, ticket #706). The Technical team that judges the row
 * as a small pill, then the verdict (Complies / Deviates / Not judged) with its note under it. Only a
 * member of that team can mark the row; everyone else reads it. Sales and Purchasing choose the team.
 * No money here: the column is served to every tier.
 */

const NO_TEAM = "__none__";
const TEAM_OPTIONS = [{ value: NO_TEAM, label: "No team" }, ...EVALUATION_TEAMS.map((team) => ({ value: team, label: team }))];

export default function ComplianceColumn({ line, myTeams, canSetTeam, onChanged }) {
  const team = line.evaluating_team ?? null;
  const mayMark = team !== null && myTeams.includes(team);
  const parts = line.components ?? [];
  const verdict = lineVerdict(line);

  const setTeam = async (value) => {
    await costingMatrixService.updateTenderLine(line.id, { evaluatingTeam: value === NO_TEAM ? null : value });
    await onChanged?.();
  };

  return (
    <div className="space-y-1.5" data-testid="sheet-compliance">
      {canSetTeam ? (
        <SelectField aria-label={`Evaluating team ${line.number}`} size="sm" className="w-28" options={TEAM_OPTIONS} value={team ?? NO_TEAM} onChange={setTeam} />
      ) : (
        <StatusBadge label={team ?? "No team"} theme={team ? "blue" : "mauve"} title="The team that judges this row" />
      )}

      {mayMark && parts.length > 0 ? (
        parts.map((part, index) => (
          <ComplianceCell key={part.id} component={part} number={parts.length > 1 ? `${line.number}.${index + 1}` : `${line.number}`} readOnly={false} onChanged={onChanged} />
        ))
      ) : (
        <>
          <StatusBadge label={COMPLIANCE_LABEL[verdict] ?? "Not judged"} theme={COMPLIANCE_THEME[verdict] ?? "mauve"} title="Compliance" />
          {parts
            .filter((part) => part.compliance === "deviates" && part.compliance_note)
            .map((part) => (
              <p key={part.id} className="whitespace-pre-line text-xs text-foreground">
                {part.compliance_note}
              </p>
            ))}
        </>
      )}
    </div>
  );
}
