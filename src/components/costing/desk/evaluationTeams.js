import { useQuery } from "@tanstack/react-query";

import { EVALUATION_TEAMS, EVALUATION_TEAM_LIST } from "../../../constants/costing";
import { costingEvaluationSettingsService } from "../../../services/costingEvaluationSettingsService";
import { costingKeys } from "../costingKeys";

/** Which of the teams the viewer is in. The database shows a member only their own list rows. */
export function useMyEvaluationTeams(actorId) {
  const { data = [] } = useQuery({
    queryKey: [...costingKeys.signerLists, "my-teams", actorId],
    enabled: Boolean(actorId),
    retry: false,
    staleTime: 60_000,
    queryFn: async () => {
      const mine = [];
      for (const team of EVALUATION_TEAMS) {
        const members = await costingEvaluationSettingsService.getSigners(EVALUATION_TEAM_LIST[team]);
        if (members.includes(actorId)) mine.push(team);
      }
      return mine;
    },
  });
  return data;
}

/** The verdict of a whole row from its parts: Deviates if any deviates, Complies if all comply, else not judged. */
export function lineVerdict(line) {
  const parts = line.components ?? [];
  if (parts.length === 0) return null;
  if (parts.some((part) => part.compliance === "deviates")) return "deviates";
  return parts.every((part) => part.compliance === "complies") ? "complies" : null;
}
